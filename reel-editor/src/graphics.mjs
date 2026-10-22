import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, r3 } from "./util.mjs";

/**
 * Graphic scenes: designed full-screen cards that show what the speaker is saying, the way explainer reels cut
 * to a big number, a checklist, a highlighted quote or a step diagram. Claude (headless, no tools) reads the
 * timed transcript and picks the moments and the words; every word on a card comes from the speaker. The
 * editor renders the cards in HTML in the brand colors and fonts, so nothing is misspelled. The voice keeps
 * playing and the captions stay on top.
 *
 * Types: stat (a number or amount), list (2-4 items, checked or struck), quote (a line on a paper card with one
 * phrase highlighted), headline (the key statement), steps (2-4 connected nodes: a flow or a before -> after).
 */

export const TYPES = ["stat", "list", "quote", "headline", "steps"];

/** How long each kind of card holds, from how much there is to read. */
export function sceneDuration(s) {
  const n = (s.items || []).length;
  if (s.type === "list" || s.type === "steps") return r3(Math.min(3.8, 2.2 + 0.45 * n));
  if (s.type === "quote") return 3.2;
  if (s.type === "headline") return 2.6;
  return 2.6;
}

/** Up to one card per `every` seconds after the hook. */
export function graphicsCount(duration, { max = 6, every = 10 } = {}) {
  return Math.max(0, Math.min(max, Math.floor((duration - 4) / every)));
}

const clean = (s, max = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Tidy one scene from Claude: known type, short text, the fields that type needs. Returns null if unusable. */
export function normalizeScene(raw) {
  if (!raw || !TYPES.includes(raw.type)) return null;
  const s = { type: raw.type, line: Number.isInteger(raw.line) ? raw.line : parseInt(raw.line, 10), eyebrow: clean(raw.eyebrow, 40) };
  if (!Number.isInteger(s.line)) return null;
  if (s.type === "stat") {
    s.value = clean(raw.value, 16);
    s.value2 = clean(raw.value2, 16);
    s.sub = clean(raw.sub, 60);
    if (!s.value) return null;
  } else if (s.type === "list" || s.type === "steps") {
    s.title = clean(raw.title, 48);
    s.items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it) => (typeof it === "string" ? { text: it } : it || {}))
      .map((it) => ({ text: clean(it.text, 32), tag: clean(it.tag, 18), state: ["check", "strike"].includes(it.state) ? it.state : "plain" }))
      .filter((it) => it.text)
      .slice(0, 4);
    if (s.items.length < 2) return null;
  } else {
    s.text = clean(raw.text, s.type === "quote" ? 140 : 60);
    if (!s.text) return null;
  }
  s.duration = sceneDuration(s);
  return s;
}

/** Caption lines a card may start on: after the hook, with room before the end and the CTA. */
export function sceneCandidates(groups, duration, { hook, cta, lead = 0.5, tail = 1.5, longest = 3.8 } = {}) {
  const from = hook ? hook.start + hook.duration + lead : 3;
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  return groups.map((g, i) => ({ i, start: g.start, text: g.text })).filter((c) => c.start >= from && c.start + 2.2 <= until && c.start + Math.min(longest, until - c.start) <= until);
}

/** Time the scenes: real candidate lines, in order, `gap` seconds apart, each ending before `until`. */
export function placeScenes(scenes, candidates, { duration, cta, gap = 3, max = 6, tail = 1.5 } = {}) {
  const byLine = new Map(candidates.map((c) => [c.i, c]));
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  const out = [];
  for (const s of [...scenes].filter((x) => x && byLine.has(x.line)).sort((a, b) => byLine.get(a.line).start - byLine.get(b.line).start)) {
    const start = byLine.get(s.line).start;
    const prev = out[out.length - 1];
    if (prev && start < prev.start + prev.duration + gap) continue;
    const dur = r3(Math.min(s.duration, until - start));
    if (dur < 2) continue;
    out.push({ ...s, start: r3(start), duration: dur });
    if (out.length >= max) break;
  }
  return out;
}

export function scenesPrompt({ candidates, transcript, hook, count, voice = "" }) {
  return [
    "You are the motion designer on a talking-head Instagram reel. You pick the moments where a designed graphic card cuts in to show what the speaker is saying, and you write the words on each card. You never use tools; reply with JSON only.",
    `Pick up to ${count} moments, spread across the reel, at least 6 seconds apart. Only pick a moment when a card makes the point clearer or hit harder: the speaker says a number or amount, lists things, describes steps or a before and after, contrasts two things, quotes something, or lands the key line.`,
    "",
    "Card types and their fields:",
    '- stat: a number or amount the speaker says. value ("$10,000", "10 minutes", "8 years"), optional value2 for a range or change (shown as value -> value2), sub (a short line under it, from their words).',
    "- list: 2 to 4 short items the speaker names. title (optional), items [{text, tag, state}]: state is check (things to do / that count), strike (things that don't matter / to stop), or plain. tag is an optional 1-2 word label on the right.",
    "- quote: a line worth reading, either something the speaker quotes (eyebrow = where it is from, as they say it) or their own strongest line (eyebrow = a 2-4 word label). text, with the one phrase that matters in *asterisks* (it is highlighted).",
    "- headline: the key statement in at most 7 words, with the one phrase that matters in *asterisks* (it is set in gold).",
    "- steps: 2 to 4 short nodes connected top to bottom: a sequence the speaker gives, or a cause -> effect / before -> after. items [{text}].",
    "Every card has an eyebrow: a 2-5 word label in caps over it (\"AFTER A BAD NUMBER\", \"THE STANDARD\", \"WHAT YOU OWN\").",
    "",
    "Rules:",
    "- Use only what the speaker says: their words, names and numbers, lightly trimmed. Never invent numbers, sources, quotes, results or steps they did not give.",
    "- Keep every qualifier the speaker puts on a number (almost, about, over, nearly, up to, around): they said \"almost eight years\", so the value is \"Almost 8 years\", never \"8 years\".",
    "- When the speaker quotes someone else or acts out a message or line, a quote card may show it but must not present it as the speaker's own words.",
    "- Short: items at most 4 words, headline at most 7 words, sub and eyebrow at most 6 words.",
    "- Vary the card types; no type more than twice unless the reel is mostly a list.",
    "- No emojis, no hashtags, no calls to action.",
    voice ? `\nVoice for labels and trims:\n${voice.trim()}` : "",
    "",
    `Hook on screen at the start: ${hook || "(none)"}`,
    "",
    "Whole transcript for context:",
    transcript,
    "",
    "Lines a card may start on (number: start time, text). A card starts when that line is spoken, so pick the line where the idea begins:",
    ...candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`),
    "",
    'Reply with JSON only: {"scenes":[{"line":<number from the list>,"type":"stat|list|quote|headline|steps","eyebrow":"...","value":"","value2":"","sub":"","title":"","text":"","items":[{"text":"","tag":"","state":"plain"}]}]}',
  ].join("\n");
}

/**
 * Plan the graphic scenes for one reel. Saves <workDir>/graphics.json and reuses it while the transcript lines
 * are unchanged (`force` replans). Never throws: any failure returns [] and the reel renders without cards.
 */
export async function makeGraphics({ workDir, groups, duration, hook, cta, settings = {}, voice = "", force = false }) {
  const planPath = path.join(workDir, "graphics.json");
  const max = graphicsCount(duration, { max: settings.max ?? 6, every: settings.every ?? 10 });
  if (!max) { log("graphics: reel too short, skipped"); return []; }
  const candidates = sceneCandidates(groups, duration, { hook, cta });
  if (!candidates.length) { log("graphics: no room after the hook, skipped"); return []; }
  const key = candidates.map((c) => `${c.i}@${c.start}:${c.text}`).join("|");
  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    if (saved.key === key && Array.isArray(saved.scenes)) {
      log(`graphics: reusing ${saved.scenes.length} card${saved.scenes.length === 1 ? "" : "s"} from ${planPath}`);
      return saved.scenes;
    }
  }
  if (!hasClaude()) { warn("graphics need the Claude Code CLI (claude) signed in; skipped"); return []; }
  const t0 = Date.now();
  let scenes;
  try {
    log(`graphics: Claude is designing up to ${max} card${max === 1 ? "" : "s"}…`);
    const transcript = groups.map((g) => g.text).join(" ");
    const reply = await claudeText(scenesPrompt({ candidates, transcript, hook: hook?.text, count: max, voice }), { timeoutMs: 240000 });
    const raw = firstJSON(reply).scenes || [];
    scenes = placeScenes(raw.map(normalizeScene).filter(Boolean), candidates, { duration, cta, gap: settings.gap ?? 3, max });
  } catch (e) {
    warn(`graphics: ${String(e.message).split("\n")[0]}; rendering without them`);
    return [];
  }
  writeJSON(planPath, { key, scenes });
  log(`graphics: ${scenes.length} card${scenes.length === 1 ? "" : "s"} in ${Math.round((Date.now() - t0) / 1000)}s${scenes.map((s) => `\n  ${s.start}s ${s.type}: ${s.eyebrow} | ${s.value || s.text || s.title || ""}${s.items ? " " + s.items.map((i) => i.text).join(" / ") : ""}`).join("")}`);
  return scenes;
}

// ---------------------------------------------------------------- rendering

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const marked = (s, cls) => esc(s).replace(/\*([^*]+)\*/g, `<span class="${cls}">$1</span>`).replace(/\*/g, "");

/** Inner HTML of one card. Elements with g-in animate in, in document order. */
export function sceneHTML(s) {
  const eyebrow = s.eyebrow ? `<div class="g-eyebrow g-in"><span class="g-dot"></span>${esc(s.eyebrow)}</div>` : "";
  if (s.type === "stat") {
    // Long values ("10 minutes") step down from 190px so they stay on one line.
    const size = (v) => Math.round(Math.min(190, 1500 / Math.max(1, String(v).length)));
    const range = s.value2 ? `<div class="g-arrow g-in">to</div><div class="g-stat g-stat2 g-in" style="font-size:calc(var(--u) * ${size(s.value2)})">${esc(s.value2)}</div>` : "";
    return `<div class="g-box g-center">${eyebrow}<div class="g-stat g-in" style="font-size:calc(var(--u) * ${size(s.value)})">${esc(s.value)}</div>${range}${s.sub ? `<div class="g-sub g-in">${esc(s.sub)}</div>` : ""}</div>`;
  }
  if (s.type === "list") {
    const rows = s.items
      .map((it, k) => {
        const mark = it.state === "check" ? `<span class="g-mark g-check">&#10003;</span>` : it.state === "strike" ? `<span class="g-mark g-x">&#10005;</span>` : `<span class="g-mark g-num">${String(k + 1).padStart(2, "0")}</span>`;
        return `<div class="g-row g-in g-${it.state}">${mark}<span class="g-row-text">${esc(it.text)}${it.state === "strike" ? '<span class="g-strike-line"></span>' : ""}</span>${it.tag ? `<span class="g-tag">${esc(it.tag)}</span>` : ""}</div>`;
      })
      .join("");
    return `<div class="g-box">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-rows">${rows}</div></div>`;
  }
  if (s.type === "quote") {
    return `<div class="g-box g-center"><div class="g-paper g-in">${s.eyebrow ? `<div class="g-paper-eyebrow">${esc(s.eyebrow)}</div>` : ""}<div class="g-quote">&ldquo;${marked(s.text, "g-hl")}&rdquo;</div><div class="g-paper-mark"></div></div></div>`;
  }
  if (s.type === "headline") {
    return `<div class="g-box g-center">${eyebrow}<div class="g-headline g-in">${marked(s.text, "g-gold")}</div><div class="g-rule g-in"></div></div>`;
  }
  // steps
  const nodes = s.items.map((it, k) => `${k ? '<div class="g-link"></div>' : ""}<div class="g-node g-in${k === s.items.length - 1 ? " g-node-last" : ""}"><span class="g-node-num">${String(k + 1).padStart(2, "0")}</span>${esc(it.text)}</div>`).join("");
  return `<div class="g-box g-center">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-steps">${nodes}</div></div>`;
}

/** CSS for the cards at canvas size W x H. Content sits in the upper two thirds; captions keep the bottom. */
export function graphicsCSS({ W, H, colors }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  return `
      .gfx { --u: ${u}px; position: absolute; inset: 0; overflow: hidden; opacity: 0; background: radial-gradient(120% 62% at 50% 34%, ${c.accent}2e 0%, ${c.accent}00 60%), ${c.bg}; color: ${c.text}; font-family: "Inter", sans-serif; }
      .gfx::after { content: ""; position: absolute; inset: 0; background: radial-gradient(90% 60% at 50% 40%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%); pointer-events: none; }
      .g-box { position: absolute; left: 8%; right: 8%; top: 12%; bottom: 34%; display: flex; flex-direction: column; justify-content: center; gap: ${px(34)}; z-index: 1; }
      .g-center { align-items: center; text-align: center; }
      .g-eyebrow { display: inline-flex; align-items: center; gap: ${px(14)}; font-size: ${px(30)}; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: ${c.accent}; }
      .g-dot { width: ${px(12)}; height: ${px(12)}; border-radius: 50%; background: ${c.accent}; box-shadow: 0 0 ${px(18)} ${c.accent}; }
      .g-stat { font-weight: 900; white-space: nowrap; line-height: 0.95; letter-spacing: -0.03em; color: ${c.text}; text-shadow: 0 0 ${px(60)} ${c.accent}66; }
      .g-stat2 { color: ${c.accent}; text-shadow: 0 0 ${px(70)} ${c.accent}88; }
      .g-arrow { font-size: ${px(34)}; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; opacity: 0.6; margin: ${px(-14)} 0; }
      .g-sub { font-size: ${px(46)}; font-weight: 600; line-height: 1.25; opacity: 0.85; max-width: 90%; }
      .g-title { font-weight: 900; font-size: ${px(84)}; line-height: 1.02; letter-spacing: -0.02em; text-transform: uppercase; text-wrap: balance; }
      .g-gold { color: ${c.accent}; }
      .g-rows { display: flex; flex-direction: column; gap: ${px(20)}; }
      .g-row { position: relative; display: flex; align-items: center; gap: ${px(26)}; padding: ${px(30)} ${px(34)}; border-radius: ${px(22)}; background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03)); border: ${px(2)} solid rgba(255,255,255,0.10); box-shadow: 0 ${px(18)} ${px(50)} rgba(0,0,0,0.45); font-size: ${px(52)}; font-weight: 800; text-transform: uppercase; letter-spacing: -0.005em; }
      .g-row.g-check { border-color: ${c.accent}88; box-shadow: 0 0 ${px(40)} ${c.accent}22, 0 ${px(18)} ${px(50)} rgba(0,0,0,0.45); }
      .g-row.g-strike .g-row-text { opacity: 0.45; }
      .g-row-text { position: relative; flex: 1; }
      .g-strike-line { position: absolute; left: 0; right: 0; top: 52%; height: ${px(5)}; background: ${c.text}; transform-origin: 0 50%; }
      .g-mark { flex: none; width: ${px(64)}; text-align: center; font-weight: 900; }
      .g-check { color: ${c.accent}; }
      .g-x { opacity: 0.5; }
      .g-num { font-size: ${px(34)}; color: ${c.accent}; letter-spacing: 0.06em; }
      .g-tag { flex: none; font-size: ${px(24)}; font-weight: 700; letter-spacing: 0.18em; opacity: 0.6; }
      .g-paper { position: relative; width: 88%; padding: ${px(64)} ${px(60)} ${px(70)}; background: #F5F1E8; color: #141414; border-radius: ${px(10)}; box-shadow: 0 ${px(30)} ${px(80)} rgba(0,0,0,0.55); transform: rotate(-1.2deg); text-align: left; }
      .g-paper-eyebrow { font-size: ${px(24)}; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase; opacity: 0.55; margin-bottom: ${px(22)}; }
      .g-quote { font-size: ${px(62)}; font-weight: 800; line-height: 1.22; letter-spacing: -0.01em; }
      .g-hl { background-image: linear-gradient(${c.accent}, ${c.accent}); background-repeat: no-repeat; background-size: 0% 46%; background-position: 0 88%; padding: 0 0.06em; }
      .g-paper-mark { position: absolute; right: ${px(40)}; bottom: ${px(30)}; width: ${px(40)}; height: ${px(8)}; border-radius: ${px(4)}; background: ${c.accent}; }
      .g-headline { font-weight: 900; font-size: ${px(104)}; line-height: 1.0; letter-spacing: -0.02em; text-transform: uppercase; text-wrap: balance; }
      .g-rule { width: ${px(150)}; height: ${px(12)}; border-radius: ${px(6)}; background: ${c.accent}; transform-origin: 50% 50%; }
      .g-steps { display: flex; flex-direction: column; align-items: center; }
      .g-node { display: inline-flex; align-items: center; gap: ${px(20)}; padding: ${px(26)} ${px(40)}; border-radius: ${px(18)}; background: rgba(255,255,255,0.06); border: ${px(2)} solid rgba(255,255,255,0.14); font-size: ${px(50)}; font-weight: 800; text-transform: uppercase; box-shadow: 0 ${px(18)} ${px(50)} rgba(0,0,0,0.45); }
      .g-node-last { border-color: ${c.accent}; box-shadow: 0 0 ${px(50)} ${c.accent}33, 0 ${px(18)} ${px(50)} rgba(0,0,0,0.45); }
      .g-node-num { font-size: ${px(28)}; color: ${c.accent}; letter-spacing: 0.08em; }
      .g-link { width: ${px(4)}; height: ${px(70)}; background: linear-gradient(${c.accent}, ${c.accent}55); transform-origin: 50% 0; }`;
}

/** GSAP for the cards (runs inside the composition's timeline script; expects PLAN.graphics and tl). */
export const GRAPHICS_JS = `
        PLAN.graphics.forEach((g, i) => {
          const el = document.getElementById("gfx-" + i);
          const box = el.querySelector(".g-box");
          const ins = el.querySelectorAll(".g-in");
          tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: "power1.out" }, g.start);
          tl.fromTo(box, { scale: 1 }, { scale: 1.035, duration: g.duration, ease: "none" }, g.start);
          tl.fromTo(ins, { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 0.42, ease: "power3.out", stagger: Math.min(0.22, 1.1 / Math.max(1, ins.length)) }, g.start + 0.06);
          const t1 = g.start + 0.06 + 0.42 + Math.min(0.22, 1.1 / Math.max(1, ins.length)) * Math.max(0, ins.length - 1);
          el.querySelectorAll(".g-strike-line").forEach((s, k) => tl.fromTo(s, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power2.inOut" }, t1 + 0.1 + k * 0.18));
          el.querySelectorAll(".g-link").forEach((s, k) => tl.fromTo(s, { scaleY: 0 }, { scaleY: 1, duration: 0.25, ease: "power2.out" }, g.start + 0.3 + k * 0.2));
          el.querySelectorAll(".g-hl").forEach((s) => tl.fromTo(s, { backgroundSize: "0% 46%" }, { backgroundSize: "100% 46%", duration: 0.5, ease: "power2.inOut" }, t1 + 0.05));
          el.querySelectorAll(".g-rule").forEach((s) => tl.fromTo(s, { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power3.inOut" }, t1));
          tl.to(el, { opacity: 0, duration: 0.16, ease: "power1.in" }, g.start + g.duration - 0.16);
        });`;

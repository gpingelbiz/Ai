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

export const TYPES = ["stat", "list", "quote", "headline", "steps", "compare", "bars", "message", "post", "chapter"];

/**
 * Line icons for list rows (24x24 stroke paths, drawn on as the row appears). Claude picks one per row from
 * this list; a row without a pick gets one from its words, or none. Nothing is downloaded: HyperFrames ships no
 * icon pack, and Lottie files would have to come from LottieFiles with their own licenses.
 */
export const ICONS = {
  dollar: "M12 2v20 M17 6.5a4 4 0 0 0-4-2.5h-2a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5",
  clock: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 7v5l3 2",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  people: "M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8 M3 21v-1a6 6 0 0 1 12 0v1 M16 3.5a4 4 0 0 1 0 7.5 M21 21v-1a6 6 0 0 0-4-5.7",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  growth: "M3 17l6-6 4 4 8-8 M15 7h6v6",
  calendar: "M4 6h16v15H4z M4 11h16 M8 3v5 M16 3v5",
  check: "M4 12.5l5 5L20 7",
  x: "M6 6l12 12 M18 6L6 18",
  fire: "M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1 2-2 3-4 4 0-3-1-5-3-7-1 4-3 5-3 12a7 7 0 0 0 7 7z",
  target: "M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18 M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8",
  message: "M4 5h16v11H9l-5 4z",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4 M12 14v4 M8 21h8",
  lock: "M6 11h12v10H6z M9 11V7a3 3 0 0 1 6 0v4",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  brain: "M10 4a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h1V4z M14 4a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-1V4z",
  home: "M4 11l8-7 8 7 M6 10v10h12V10",
  shield: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z M6 11a6 6 0 0 0 12 0 M12 17v4",
  doc: "M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6",
  flag: "M5 21V4 M5 4h12l-2 4 2 4H5",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6",
  repeat: "M4 10a8 8 0 0 1 14-4l2 2 M20 4v4h-4 M20 14a8 8 0 0 1-14 4l-2-2 M4 20v-4h4",
};
const ICON_WORDS = [
  ["dollar", /\b(money|dollar|pay|paid|cash|revenue|price|profit|income|cost)\b|\$/i],
  ["clock", /\b(time|minute|minutes|hour|hours|day|days|week|weeks|wait|late|early)\b/i],
  ["phone", /\b(call|calls|phone|dial|ring)\b/i],
  ["people", /\b(team|people|rep|reps|closer|closers|client|clients|staff|hire|setter|setters|customer|customers)\b/i],
  ["chart", /\b(number|numbers|data|report|metrics|stats|scoreboard)\b/i],
  ["growth", /\b(grow|growth|scale|increase|more|double)\b/i],
  ["calendar", /\b(calendar|schedule|book|booked|monday|friday|month|quarter)\b/i],
  ["x", /\b(stop|never|quit|cut|kill|no)\b/i],
  ["fire", /\b(fire|burn|hot|urgent)\b/i],
  ["target", /\b(goal|goals|target|aim|focus)\b/i],
  ["message", /\b(text|texts|message|messages|dm|dms|say|tell|ask|reply)\b/i],
  ["trophy", /\b(win|wins|winner|close|closed|closes|deal|deals)\b/i],
  ["lock", /\b(lock|secure|locked)\b/i],
  ["heart", /\b(love|heart|care|family|wife|kids)\b/i],
  ["brain", /\b(think|mind|mindset|brain|decide|decision)\b/i],
  ["home", /\b(home|house)\b/i],
  ["shield", /\b(protect|safe|guard|defend|own|owned)\b/i],
  ["mic", /\b(speak|talk|speech|voice|pitch)\b/i],
  ["doc", /\b(plan|script|sheet|list|notes|contract|offer)\b/i],
  ["flag", /\b(standard|standards|rule|rules|lead|leader)\b/i],
  ["star", /\b(best|star|elite|top)\b/i],
  ["bolt", /\b(fast|quick|energy|push|now)\b/i],
  ["eye", /\b(see|watch|watching|look|show|showed)\b/i],
  ["repeat", /\b(repeat|again|reps|habit|daily|every)\b/i],
];
export function iconFor(text, pick) {
  if (pick && ICONS[pick]) return pick;
  const hit = ICON_WORDS.find(([, re]) => re.test(String(text || "")));
  return hit ? hit[0] : "";
}

/** How long each kind of card holds, from how much there is to read. */
export function sceneDuration(s) {
  const n = (s.items || []).length;
  // Cards hold long enough to be read twice: the speaker is still on screen, so a card is never a cut.
  if (s.type === "list" || s.type === "steps" || s.type === "bars") return r3(Math.min(8, 4.5 + 0.7 * n));
  if (s.type === "message") return r3(Math.min(8, 4 + 1.2 * n));
  if (s.type === "quote" || s.type === "compare") return 6;
  if (s.type === "chapter") return 3.5;
  if (s.type === "headline") return 5.5;
  return 5.5;
}

/** Up to one card per `every` seconds after the hook; a short reel (9 s and up) still gets one. */
export function graphicsCount(duration, { max = 6, every = 10 } = {}) {
  const n = Math.max(0, Math.min(max, Math.floor((duration - 4) / every)));
  return n === 0 && duration >= 9 && max >= 1 ? 1 : n;
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
      .map((it) => ({ text: clean(it.text, 32), tag: clean(it.tag, 18), state: ["check", "strike"].includes(it.state) ? it.state : "plain", icon: s.type === "list" ? iconFor(it.text, clean(it.icon, 12).toLowerCase()) : "" }))
      .filter((it) => it.text)
      .slice(0, 4);
    if (s.items.length < 2) return null;
  } else if (s.type === "bars") {
    s.title = clean(raw.title, 48);
    s.unit = clean(raw.unit, 8);
    s.items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it) => ({ label: clean(it?.label, 24), value: clean(it?.value, 12) }))
      .filter((it) => it.label && splitStat(it.value))
      .slice(0, 4);
    if (s.items.length < 2) return null;
    const hi = Number.isInteger(raw.emphasize) ? raw.emphasize : s.items.length - 1;
    s.emphasize = Math.max(0, Math.min(s.items.length - 1, hi));
  } else if (s.type === "compare") {
    s.title = clean(raw.title, 40);
    const side = (x) => ({ label: clean(x?.label, 22), value: clean(x?.value, 12), note: clean(x?.note, 28) });
    s.a = side(raw.a);
    s.b = side(raw.b);
    if (!s.a.label || !s.b.label) return null;
    if (!(splitStat(s.a.value) && splitStat(s.b.value))) { s.a.value = ""; s.b.value = ""; }
  } else if (s.type === "message") {
    s.contact = clean(raw.contact, 18);
    s.items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it) => ({ from: it?.from === "me" ? "me" : "them", text: clean(it?.text, 90) }))
      .filter((it) => it.text)
      .slice(0, 3);
    if (!s.items.length) return null;
  } else if (s.type === "post") {
    s.text = clean(raw.text, 150);
    if (!s.text) return null;
  } else if (s.type === "chapter") {
    s.text = clean(raw.text, 48);
    s.number = Number.isInteger(raw.number) ? raw.number : 0;
    if (!s.text) return null;
  } else {
    s.text = clean(raw.text, s.type === "quote" ? 140 : 60);
    if (!s.text) return null;
  }
  s.duration = sceneDuration(s);
  return s;
}

/** Caption lines a card may start on: after the hook, with room before the end and the CTA. */
export function sceneCandidates(groups, duration, { hook, cta, lead = 0.5, tail = 1.5, longest = 8 } = {}) {
  const from = hook ? hook.start + hook.duration + lead : 3;
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  return groups.map((g, i) => ({ i, start: g.start, text: g.text })).filter((c) => c.start >= from && c.start + 2.2 <= until && c.start + Math.min(longest, until - c.start) <= until);
}

/**
 * Time the scenes: real candidate lines, in order, `gap` seconds apart, each ending before `until`. When the next
 * card comes before the previous one would end, the previous one is shortened (never below `minHold`) rather than
 * the next one dropped: a card that holds long is good, a point with no card is worse.
 */
export function placeScenes(scenes, candidates, { duration, cta, gap = 3, max = 6, tail = 1.5, minHold = 4 } = {}) {
  const byLine = new Map(candidates.map((c) => [c.i, c]));
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  const out = [];
  for (const s of [...scenes].filter((x) => x && byLine.has(x.line)).sort((a, b) => byLine.get(a.line).start - byLine.get(b.line).start)) {
    const start = byLine.get(s.line).start;
    const prev = out[out.length - 1];
    if (prev && start < prev.start + prev.duration + gap) {
      const room = r3(start - gap - prev.start);
      if (room < minHold) continue;
      prev.duration = room;
    }
    const dur = r3(Math.min(s.duration, until - start));
    if (dur < 2) continue;
    out.push({ ...s, start: r3(start), duration: dur });
    if (out.length >= max) break;
  }
  return out;
}

export function scenesPrompt({ candidates, transcript, hook, count, voice = "", looks = "" }) {
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
    "- compare: two things the speaker sets against each other (the old way vs the new way, closer A vs closer B, what you say vs what they hear). title (optional), a {label, value, note} and b {label, value, note}: label 1-3 words, value only when the speaker gives a number for both sides, note an optional 2-4 word line.",
    "- bars: 2 to 4 numbers the speaker gives that belong together (months, reps, before/after amounts). title (optional), unit (\"%\", \"k\", \"\"), items [{label, value}], emphasize = index of the number that matters most.",
    "- message: a text exchange the speaker reads out or acts out (a client text, a rep\u2019s reply, what they typed). contact (who it is from, as the speaker names them, else empty), items [{from: \"them\" | \"me\", text}] 1-3 bubbles, their words only.",
    "- post: the speaker\u2019s own strongest line shown as a social post card. text, at most 20 words.",
    `- list items may carry icon: one of ${Object.keys(ICONS).join(", ")} (pick the one that fits the item, else leave empty).`,
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
    looks ? `\n${looks}\n` : "",
    'Reply with JSON only: {"look":"<id>","lookWhy":"...","scenes":[{"line":<number from the list>,"type":"stat|list|quote|headline|steps|compare|bars|message|post","eyebrow":"...","value":"","value2":"","sub":"","title":"","text":"","unit":"","emphasize":0,"contact":"","a":{"label":"","value":"","note":""},"b":{"label":"","value":"","note":""},"items":[{"text":"","tag":"","state":"plain","icon":"","label":"","value":"","from":"them"}]}]}',
  ].join("\n");
}

/**
 * Plan the graphic scenes for one reel. Saves <workDir>/graphics.json and reuses it while the transcript lines
 * are unchanged (`force` replans). Never throws: any failure returns [] and the reel renders without cards.
 */
export async function makeGraphics({ workDir, groups, duration, hook, cta, settings = {}, voice = "", force = false, handle = "", tail = 1.5 }) {
  const planPath = path.join(workDir, "graphics.json");
  const max = graphicsCount(duration, { max: settings.max ?? 6, every: settings.every ?? 10 });
  if (!max) { log("graphics: reel too short, skipped"); return []; }
  const candidates = sceneCandidates(groups, duration, { hook, cta, tail });
  if (!candidates.length) { log("graphics: no room after the hook, skipped"); return []; }
  const key = candidates.map((c) => `${c.i}@${c.start}:${c.text}`).join("|");
  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    // Reuse while every card still has its line (a new hook hides different caption lines and shifts the line
    // numbers; the cards follow their line by start time instead of costing another Claude call).
    const byStart = (s) => candidates.find((c) => Math.abs(c.start - (s.start ?? -1)) < 0.05);
    const sameLines = Array.isArray(saved.scenes) && saved.scenes.length && saved.scenes.every(byStart);
    if ((saved.key === key || sameLines) && Array.isArray(saved.scenes)) {
      // Timing rules may have changed since the plan was saved: keep the picks, re-time them.
      // A plan saved before looks existed keeps its glass cards, so an old reel renders as it did.
      const look = settings.look && LOOKS[settings.look] ? settings.look : saved.look || "glass";
      const scenes = placeScenes(saved.scenes.map((s) => ({ ...s, line: byStart(s)?.i ?? s.line, duration: sceneDuration(s), skin: skinFor(look, s.type), ...(s.type === "post" ? { handle } : {}) })), candidates, { duration, cta, gap: settings.gap ?? 3, max, tail });
      log(`graphics: reusing ${scenes.length} card${scenes.length === 1 ? "" : "s"} from ${planPath} (look: ${look})`);
      scenes.look = look;
      return scenes;
    }
  }
  if (!hasClaude()) { warn("graphics need the Claude Code CLI (claude) signed in; skipped"); return []; }
  const t0 = Date.now();
  let scenes, lookPicked = null;
  try {
    log(`graphics: Claude is designing up to ${max} card${max === 1 ? "" : "s"}…`);
    const transcript = groups.map((g) => g.text).join(" ");
    const recent = recentLooks();
    const fixed = settings.look && LOOKS[settings.look] ? settings.look : null;
    const reply = firstJSON(await claudeText(scenesPrompt({ candidates, transcript, hook: hook?.text, count: max, voice, looks: fixed ? "" : looksPrompt(recent) }), { timeoutMs: 240000 }));
    const picked = fixed ? { look: fixed, why: "set for this reel" } : pickLook(reply, { transcript, recent });
    lookPicked = picked;
    const raw = reply.scenes || [];
    scenes = placeScenes(raw.map(normalizeScene).filter(Boolean).map((s) => ({ ...(s.type === "post" ? { ...s, handle } : s), skin: skinFor(picked.look, s.type) })), candidates, { duration, cta, gap: settings.gap ?? 3, max, tail });
  } catch (e) {
    warn(`graphics: ${String(e.message).split("\n")[0]}; rendering without them`);
    return [];
  }
  writeJSON(planPath, { key, look: lookPicked?.look || "glass", lookWhy: lookPicked?.why || "", scenes });
  if (lookPicked && !settings.look) rememberLook(lookPicked.look);
  log(`graphics: look "${LOOKS[lookPicked?.look || "glass"].label}"${lookPicked?.why ? ` (${lookPicked.why})` : ""}`);
  scenes.look = lookPicked?.look || "glass";
  log(`graphics: ${scenes.length} card${scenes.length === 1 ? "" : "s"} in ${Math.round((Date.now() - t0) / 1000)}s${scenes.map((s) => `\n  ${s.start}s ${s.type}: ${s.eyebrow} | ${s.value || s.text || s.title || ""}${s.items ? " " + s.items.map((i) => i.text).join(" / ") : ""}`).join("")}`);
  return scenes;
}

// ---------------------------------------------------------------- rendering

import { esc } from "./text.mjs";
import { skinHTML, SKINS_JS, looksPrompt, pickLook, recentLooks, rememberLook, skinFor, LOOKS } from "./looks.mjs";
const marked = (s, cls) => esc(s).replace(/\*([^*]+)\*/g, `<span class="${cls}">$1</span>`).replace(/\*/g, "");

/**
 * Split a stat value into the part that counts up and the text around it: "$10,000" -> {prefix:"$", number:"10,000",
 * suffix:""}, "Almost 8 years" -> {prefix:"Almost ", number:"8", suffix:" years"}. null when there is no number.
 */
export function splitStat(value) {
  const m = /^(.*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(String(value ?? ""));
  if (!m) return null;
  const number = m[2];
  const to = parseFloat(number.replace(/,/g, ""));
  if (!Number.isFinite(to)) return null;
  const dec = (number.split(".")[1] || "").length;
  return { prefix: m[1], number, suffix: m[3], to, dec, commas: number.includes(","), percent: /^\s*%/.test(m[3]) };
}

/** The stat line: the number counts up from 0 as the card lands (tabular figures so nothing shifts). */
function statHTML(value, size, extraClass = "") {
  const p = splitStat(value);
  if (!p) return `<div class="g-stat g-in${extraClass}" style="font-size:calc(var(--u) * ${size})">${esc(value)}</div>`;
  const affix = (t) => (!t ? "" : /^[\s$€£%+x×~-]+$/.test(t) ? `<span class="g-affix g-sym">${esc(t)}</span>` : `<span class="g-affix">${esc(t)}</span>`);
  const ring = p.percent ? `<span class="g-ring" style="--ring:0%" data-pct="${Math.max(0, Math.min(100, p.to))}"></span>` : "";
  return `<div class="g-stat g-in${extraClass}" style="font-size:calc(var(--u) * ${size})">${ring}${affix(p.prefix)}<span class="g-count" data-to="${p.to}" data-dec="${p.dec}" data-commas="${p.commas ? 1 : 0}">${esc(p.number)}</span>${affix(p.suffix)}</div>`;
}

/** Inner HTML of one card. Elements with g-in animate in, in document order. */
export function sceneHTML(s) {
  // A look can reshape a card into an artifact (notification, Notes list, receipt, typed card); otherwise its skin
  // only restyles the regular markup below.
  if (s.skin && s.skin !== "glass") { const h = skinHTML(s, s.skin, { statHTML }); if (h) return h; }
  const eyebrow = s.eyebrow ? `<div class="g-eyebrow g-in"><span class="g-dot"></span>${esc(s.eyebrow)}</div>` : "";
  if (s.type === "stat") {
    // Sized by length so a long value ("Almost 8 years") stays inside the card; short ones go big.
    const size = (v) => Math.round(Math.min(170, 1250 / Math.max(1, String(v).length)));
    const range = s.value2 ? `<div class="g-arrow g-in">to</div>${statHTML(s.value2, size(s.value2), " g-stat2")}` : "";
    // Every number gets a fill that sweeps with the count (a ring for a percentage, a bar for anything else).
    const fill = splitStat(s.value) && !splitStat(s.value).percent ? `<div class="g-fill g-in"><div class="g-fill-bar"></div></div>` : "";
    return `<div class="g-box g-center">${eyebrow}${statHTML(s.value, size(s.value))}${range}${fill}${s.sub ? `<div class="g-sub g-in">${esc(s.sub)}</div>` : ""}</div>`;
  }
  if (s.type === "list") {
    const rows = s.items
      .map((it, k) => {
        const mark = it.state === "check" ? `<span class="g-mark g-check">&#10003;</span>` : it.state === "strike" ? `<span class="g-mark g-x">&#10005;</span>` : `<span class="g-mark g-num">${String(k + 1).padStart(2, "0")}</span>`;
        const icon = it.icon && ICONS[it.icon] ? `<svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[it.icon]}"/></svg>` : "";
        return `<div class="g-row g-in g-${it.state}">${mark}<span class="g-row-text">${esc(it.text)}${it.state === "strike" ? '<span class="g-strike-line"></span>' : ""}</span>${it.tag ? `<span class="g-tag">${esc(it.tag)}</span>` : ""}${icon}</div>`;
      })
      .join("");
    return `<div class="g-box">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-rows">${rows}</div></div>`;
  }
  if (s.type === "quote") {
    return `<div class="g-box g-center"><div class="g-paper g-in">${s.eyebrow ? `<div class="g-paper-eyebrow">${esc(s.eyebrow)}</div>` : ""}<div class="g-quote">${/["“”]/.test(s.text) ? marked(s.text, "g-hl") : `&ldquo;${marked(s.text, "g-hl")}&rdquo;`}</div><div class="g-paper-mark"></div></div></div>`;
  }
  if (s.type === "headline") {
    return `<div class="g-box g-center">${eyebrow}<div class="g-headline g-in">${marked(s.text, "g-gold")}</div><div class="g-rule g-in"></div></div>`;
  }
  if (s.type === "chapter") {
    // A chapter title card: the number as the eyebrow, the title, a rule that draws under it.
    return `<div class="g-box g-center g-chapter"><div class="g-eyebrow g-in"><span class="g-dot"></span>${esc(s.eyebrow || (s.number ? `Chapter ${s.number}` : "Next"))}</div><div class="g-headline g-in">${marked(s.text, "g-gold")}</div><div class="g-rule g-in"></div></div>`;
  }
  if (s.type === "compare") {
    // Two panels: the muted left side is the base, the accent right side wipes over from the divider.
    const max = Math.max(1, ...[s.a, s.b].map((x) => (splitStat(x.value) || { to: 0 }).to));
    const side = (x, cls) => {
      const v = splitStat(x.value);
      return `<div class="g-side ${cls}${String(x.label).length > 14 ? " g-side-long" : ""}"><div class="g-side-label">${esc(x.label)}</div>${v ? `<div class="g-side-value">${esc(x.value)}</div><div class="g-side-bar"><div class="g-side-fill" style="--w:${Math.round((v.to / max) * 100)}%"></div></div>` : ""}${x.note ? `<div class="g-side-note">${esc(x.note)}</div>` : ""}</div>`;
    };
    return `<div class="g-box g-center">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-compare g-in">${side(s.a, "g-side-a")}<div class="g-vs">VS</div>${side(s.b, "g-side-b")}</div></div>`;
  }
  if (s.type === "bars") {
    const max = Math.max(1, ...s.items.map((it) => splitStat(it.value).to));
    const rows = s.items
      .map((it, k) => {
        const v = splitStat(it.value);
        return `<div class="g-bar-row g-in${k === s.emphasize ? " g-bar-hi" : ""}"><div class="g-bar-head"><span class="g-bar-label">${esc(it.label)}</span><span class="g-bar-value"><span class="g-count" data-to="${v.to}" data-dec="${v.dec}" data-commas="${v.commas ? 1 : 0}">${esc(v.number)}</span>${esc(v.suffix || s.unit || "")}</span></div><div class="g-bar-track"><div class="g-bar-fill" style="--w:${Math.round((v.to / max) * 100)}%"></div></div></div>`;
      })
      .join("");
    return `<div class="g-box">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-bars">${rows}</div></div>`;
  }
  if (s.type === "message") {
    const bubbles = s.items.map((it) => `<div class="g-bubble g-in g-${it.from}">${esc(it.text)}</div>`).join("");
    return `<div class="g-box">${eyebrow}<div class="g-thread">${s.contact ? `<div class="g-thread-head g-in"><span class="g-avatar">${esc(s.contact.slice(0, 1).toUpperCase())}</span>${esc(s.contact)}</div>` : ""}<div class="g-typing"><i></i><i></i><i></i></div>${bubbles}</div></div>`;
  }
  if (s.type === "post") {
    const handle = s.handle ? `<span class="g-post-handle">${esc(s.handle)}</span>` : "";
    const name = s.handle ? esc(s.handle.replace(/^@/, "").replace(/^official/i, "")) : "";
    return `<div class="g-box g-center"><div class="g-post g-in"><div class="g-post-head"><span class="g-post-avatar"></span><span class="g-post-who"><span class="g-post-name">${name}<svg class="g-post-badge" viewBox="0 0 24 24"><path d="M12 2l2.4 2.2 3.2-.5 1 3.1 2.9 1.5-1.3 3 1.3 3-2.9 1.5-1 3.1-3.2-.5L12 22l-2.4-2.2-3.2.5-1-3.1-2.9-1.5 1.3-3-1.3-3 2.9-1.5 1-3.1 3.2.5z"/><path class="g-post-tick" d="M8 12.5l2.6 2.5L16 9.5"/></svg></span>${handle}</span></div><div class="g-post-text">${esc(s.text)}</div><div class="g-post-foot"><span class="g-post-heart">&#9829;</span></div></div></div>`;
  }
  // steps
  const nodes = s.items.map((it, k) => `${k ? '<div class="g-link"></div>' : ""}<div class="g-node g-in${k === s.items.length - 1 ? " g-node-last" : ""}"><span class="g-node-num">${String(k + 1).padStart(2, "0")}</span>${esc(it.text)}</div>`).join("");
  return `<div class="g-box g-center">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-steps">${nodes}</div></div>`;
}

/**
 * CSS for the cards at canvas size W x H. Two modes: "full" takes the screen (content in the upper two thirds,
 * captions keep the bottom); "overlay" is a compact glass panel in the top third while the footage keeps playing,
 * the way explainer reels drop a payroll card or a checklist over the speaker.
 */
export function graphicsCSS({ W, H, colors, mode = "overlay" }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  const overlay = mode === "overlay" ? `
      .gfx { background: none; }
      .gfx::after { background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0) 42%); }
      .g-box { left: 4%; right: 4%; top: 5.5%; bottom: auto; max-height: 40%; justify-content: flex-start; gap: ${px(24)}; padding: ${px(36)} ${px(40)} ${px(40)}; border-radius: ${px(26)}; background: linear-gradient(180deg, rgba(10,10,12,0.86), rgba(10,10,12,0.78)); border: ${px(2)} solid rgba(255,255,255,0.12); box-shadow: 0 ${px(24)} ${px(60)} rgba(0,0,0,0.55), inset 0 ${px(3)} 0 ${c.accent}; }
      .g-center { align-items: flex-start; text-align: left; }
      .g-eyebrow { font-size: ${px(32)}; }
      .g-stat { line-height: 1; }
      .g-arrow { font-size: ${px(28)}; margin: ${px(-6)} 0; }
      .g-sub { font-size: ${px(44)}; max-width: 100%; }
      .g-fill { width: 100%; height: ${px(10)}; }
      .g-title { font-size: ${px(64)}; }
      .g-rows { gap: ${px(14)}; }
      .g-row { padding: ${px(20)} ${px(24)}; font-size: ${px(48)}; border-radius: ${px(18)}; gap: ${px(18)}; }
      .g-mark { width: ${px(54)}; }
      .g-num { font-size: ${px(30)}; }
      .g-tag { font-size: ${px(22)}; }
      .g-paper { width: 100%; padding: ${px(34)} ${px(36)} ${px(38)}; transform: none; }
      .g-paper-eyebrow { font-size: ${px(22)}; margin-bottom: ${px(14)}; }
      .g-quote { font-size: ${px(54)}; line-height: 1.2; }
      .g-headline { font-size: ${px(82)}; text-align: left; }
      .g-rule { width: ${px(110)}; height: ${px(10)}; }
      .g-steps { flex-direction: row; align-items: stretch; gap: ${px(12)}; width: 100%; }
      .g-node { flex: 1; justify-content: center; padding: ${px(22)} ${px(12)}; font-size: ${px(34)}; text-align: center; gap: ${px(10)}; flex-direction: column; }
      .g-node-num { font-size: ${px(22)}; }
      .g-link { width: ${px(26)}; height: ${px(4)}; align-self: center; background: linear-gradient(90deg, ${c.accent}, ${c.accent}55); }
      .g-icon { width: ${px(44)}; height: ${px(44)}; }
      .g-side { padding: ${px(20)} ${px(20)}; min-height: ${px(120)}; }
      .g-side-label { font-size: ${px(34)}; overflow-wrap: break-word; }
      .g-side-long .g-side-label { font-size: ${px(27)}; }
      .g-side-value { font-size: ${px(54)}; }
      .g-side-note { font-size: ${px(24)}; }
      .g-bar-label { font-size: ${px(30)}; }
      .g-bar-value { font-size: ${px(36)}; }
      .g-bars { gap: ${px(12)}; }
      .g-bubble { font-size: ${px(32)}; padding: ${px(16)} ${px(24)}; }
      .g-post { padding: ${px(24)} ${px(28)} ${px(22)}; }
      .g-post-text { font-size: ${px(36)}; }` : "";
  const band = mode === "band" ? `
      .gfx { background: none; }
      .gfx::after { background: linear-gradient(0deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 30%, rgba(0,0,0,0) 44%); }
      .g-box { left: var(--gx, 56%); right: auto; width: var(--gw, 40%); top: var(--gy, 20%); bottom: auto; max-height: 62%; justify-content: flex-start; gap: ${px(18)}; padding: ${px(28)} ${px(36)} ${px(30)}; border-radius: ${px(22)}; background: linear-gradient(180deg, rgba(10,10,12,0.86), rgba(10,10,12,0.78)); border: ${px(2)} solid rgba(255,255,255,0.12); box-shadow: 0 ${px(24)} ${px(60)} rgba(0,0,0,0.55); border-left: ${px(8)} solid ${c.accent}; }
      .g-center { align-items: flex-start; text-align: left; }
      .g-eyebrow { font-size: ${px(26)}; }
      .g-stat { line-height: 1; }
      .g-sub { font-size: ${px(36)}; max-width: 100%; }
      .g-fill { width: 60%; height: ${px(10)}; }
      .g-title { font-size: ${px(48)}; }
      .g-rows { display: grid; grid-template-columns: 1fr 1fr; gap: ${px(10)} ${px(18)}; }
      .g-row { padding: ${px(14)} ${px(18)}; font-size: ${px(34)}; border-radius: ${px(14)}; gap: ${px(14)}; }
      .g-mark { width: ${px(40)}; }
      .g-num { font-size: ${px(24)}; }
      .g-tag { font-size: ${px(20)}; }
      .g-icon { width: ${px(36)}; height: ${px(36)}; }
      .g-paper { width: 100%; padding: ${px(26)} ${px(30)} ${px(28)}; transform: none; }
      .g-paper-eyebrow { font-size: ${px(20)}; margin-bottom: ${px(10)}; }
      .g-quote { font-size: ${px(40)}; line-height: 1.2; }
      .g-headline { font-size: ${px(64)}; text-align: left; }
      .g-rule { width: ${px(110)}; height: ${px(8)}; }
      .g-steps { flex-direction: row; align-items: stretch; gap: ${px(12)}; width: 100%; }
      .g-node { flex: 1; justify-content: center; padding: ${px(16)} ${px(12)}; font-size: ${px(28)}; text-align: center; gap: ${px(8)}; flex-direction: column; }
      .g-node-num { font-size: ${px(20)}; }
      .g-link { width: ${px(26)}; height: ${px(4)}; align-self: center; background: linear-gradient(90deg, ${c.accent}, ${c.accent}55); }
      .g-compare { grid-template-columns: 1fr 1fr; }
      .g-side { padding: ${px(16)} ${px(18)}; min-height: ${px(100)}; }
      .g-side-label { font-size: ${px(30)}; overflow-wrap: break-word; }
      .g-side-long .g-side-label { font-size: ${px(24)}; }
      .g-side-value { font-size: ${px(46)}; }
      .g-side-note { font-size: ${px(22)}; }
      .g-bar-label { font-size: ${px(26)}; }
      .g-bar-value { font-size: ${px(30)}; }
      .g-bars { gap: ${px(10)}; }
      .g-bar-track { height: ${px(16)}; }
      .g-bubble { font-size: ${px(28)}; padding: ${px(12)} ${px(20)}; max-width: 70%; }
      .g-post { padding: ${px(20)} ${px(24)} ${px(18)}; }
      .g-post-text { font-size: ${px(30)}; }
      .g-chapter { width: var(--gw, 40%); }
      .g-chapter .g-headline { font-size: ${px(72)}; }` : "";
  return `
      .gfx { --u: ${u}px; position: absolute; inset: 0; overflow: hidden; opacity: 0; background: radial-gradient(120% 62% at 50% 34%, ${c.accent}2e 0%, ${c.accent}00 60%), ${c.bg}; color: ${c.text}; font-family: "Inter", sans-serif; }
      .gfx::after { content: ""; position: absolute; inset: 0; background: radial-gradient(90% 60% at 50% 40%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%); pointer-events: none; }
      .g-box { position: absolute; left: 8%; right: 11%; top: 15%; bottom: 46%; display: flex; flex-direction: column; justify-content: center; gap: ${px(34)}; z-index: 1; }
      .g-center { align-items: center; text-align: center; }
      .g-eyebrow { display: inline-flex; align-items: center; gap: ${px(14)}; font-size: ${px(30)}; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: ${c.accent}; }
      .g-dot { width: ${px(12)}; height: ${px(12)}; border-radius: 50%; background: ${c.accent}; box-shadow: 0 0 ${px(18)} ${c.accent}; }
      .g-stat { font-weight: 900; white-space: nowrap; line-height: 0.95; letter-spacing: -0.03em; color: ${c.text}; text-shadow: 0 0 ${px(60)} ${c.accent}66; }
      .g-stat2 { color: ${c.accent}; text-shadow: 0 0 ${px(70)} ${c.accent}88; }
      .g-stat { display: inline-flex; align-items: baseline; font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; transform-origin: 50% 58%; }
      .g-count { display: inline-block; min-width: 1ch; }
      .g-affix { white-space: pre; }
      .g-sym { font-size: 0.6em; align-self: center; margin: 0 0.06em; opacity: 0.9; }
      .g-fill { width: 60%; height: ${px(12)}; border-radius: ${px(6)}; background: rgba(255,255,255,0.12); overflow: hidden; }
      .g-fill-bar { width: 100%; height: 100%; background: ${c.accent}; transform-origin: 0 50%; transform: scaleX(0); }
      .g-ring { --ring: 0%; display: inline-block; width: 0.9em; height: 0.9em; margin-right: 0.18em; align-self: center; border-radius: 50%; background: conic-gradient(from -90deg, ${c.accent} 0 var(--ring), rgba(255,255,255,0.14) var(--ring) 100%); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 16%), #000 0); mask: radial-gradient(farthest-side, transparent calc(100% - 16%), #000 0); }
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
      .g-link { width: ${px(4)}; height: ${px(70)}; background: linear-gradient(${c.accent}, ${c.accent}55); transform-origin: 50% 0; }
      .g-icon { flex: none; width: ${px(52)}; height: ${px(52)}; transform-origin: 50% 50%; }
      .g-icon path { fill: none; stroke: ${c.accent}; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .g-compare { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: ${px(96)}; width: 100%; }
      .g-side { position: relative; padding: ${px(28)} ${px(26)}; border-radius: ${px(20)}; background: rgba(255,255,255,0.06); border: ${px(2)} solid rgba(255,255,255,0.12); text-align: left; min-height: ${px(150)}; }
      .g-side-b { background: linear-gradient(180deg, ${c.accent}2a, ${c.accent}14); border-color: ${c.accent}aa; clip-path: inset(0 100% 0 0); }
      .g-side-label { font-size: ${px(40)}; font-weight: 900; text-transform: uppercase; line-height: 1.05; }
      .g-side-a .g-side-label { opacity: 0.7; }
      .g-side-b .g-side-label { color: ${c.accent}; }
      .g-side-value { margin-top: ${px(10)}; font-size: ${px(64)}; font-weight: 900; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
      .g-side-bar { margin-top: ${px(12)}; height: ${px(10)}; border-radius: ${px(5)}; background: rgba(255,255,255,0.12); overflow: hidden; }
      .g-side-fill { width: var(--w); height: 100%; background: ${c.text}; transform-origin: 0 50%; transform: scaleX(0); opacity: 0.6; }
      .g-side-b .g-side-fill { background: ${c.accent}; opacity: 1; }
      .g-side-note { margin-top: ${px(10)}; font-size: ${px(26)}; font-weight: 600; opacity: 0.75; }
      .g-vs { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(0); width: ${px(74)}; height: ${px(74)}; border-radius: 50%; display: grid; place-items: center; background: ${c.bg}; border: ${px(3)} solid ${c.accent}; color: ${c.accent}; font-size: ${px(26)}; font-weight: 900; letter-spacing: 0.08em; z-index: 1; }
      .g-bars { display: flex; flex-direction: column; gap: ${px(16)}; width: 100%; }
      .g-bar-head { display: flex; justify-content: space-between; align-items: baseline; gap: ${px(16)}; margin-bottom: ${px(8)}; }
      .g-bar-label { font-size: ${px(34)}; font-weight: 800; text-transform: uppercase; opacity: 0.8; }
      .g-bar-value { display: inline-block; transform-origin: 100% 50%; font-size: ${px(40)}; font-weight: 900; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
      .g-bar-track { height: ${px(22)}; border-radius: ${px(11)}; background: rgba(255,255,255,0.12); overflow: hidden; }
      .g-bar-fill { width: var(--w); height: 100%; border-radius: ${px(11)}; background: rgba(255,255,255,0.55); transform-origin: 0 50%; transform: scaleX(0); }
      .g-bar-hi .g-bar-fill { background: ${c.accent}; }
      .g-bar-hi .g-bar-label, .g-bar-hi .g-bar-value { color: ${c.accent}; opacity: 1; }
      .g-thread { position: relative; display: flex; flex-direction: column; gap: ${px(12)}; width: 100%; font-family: -apple-system, "Inter", sans-serif; }
      .g-thread-head { display: flex; align-items: center; gap: ${px(14)}; font-size: ${px(28)}; font-weight: 600; opacity: 0.85; margin-bottom: ${px(6)}; }
      .g-avatar { width: ${px(48)}; height: ${px(48)}; border-radius: 50%; background: #8e8e93; color: #fff; display: grid; place-items: center; font-size: ${px(26)}; font-weight: 700; }
      .g-bubble { position: relative; max-width: 82%; padding: ${px(18)} ${px(26)}; border-radius: ${px(30)}; font-size: ${px(34)}; font-weight: 500; line-height: 1.25; text-transform: none; letter-spacing: 0; transform-origin: 0 100%; }
      .g-bubble.g-them { align-self: flex-start; background: #2a2a2e; color: #fff; border-bottom-left-radius: ${px(8)}; }
      .g-bubble.g-me { align-self: flex-end; background: #0a80f8; color: #fff; border-bottom-right-radius: ${px(8)}; transform-origin: 100% 100%; }
      .g-typing { position: absolute; left: 0; top: 0; display: flex; gap: ${px(8)}; padding: ${px(18)} ${px(24)}; border-radius: ${px(30)}; background: #2a2a2e; opacity: 0; }
      .g-typing i { width: ${px(14)}; height: ${px(14)}; border-radius: 50%; background: #8e8e93; }
      .g-post { width: 100%; padding: ${px(30)} ${px(32)} ${px(26)}; border-radius: ${px(24)}; background: #15202b; border: ${px(2)} solid #38444d; box-shadow: 0 ${px(18)} ${px(50)} rgba(0,0,0,0.5); text-align: left; text-transform: none; }
      .g-post-head { display: flex; align-items: center; gap: ${px(16)}; margin-bottom: ${px(18)}; }
      .g-post-avatar { width: ${px(64)}; height: ${px(64)}; border-radius: 50%; background: linear-gradient(135deg, ${c.accent}, ${c.accent}55); }
      .g-post-who { display: flex; flex-direction: column; line-height: 1.1; }
      .g-post-name { display: inline-flex; align-items: center; gap: ${px(6)}; font-size: ${px(30)}; font-weight: 800; color: #e7e9ea; }
      .g-post-badge { width: ${px(30)}; height: ${px(30)}; fill: #1d9bf0; }
      .g-post-tick { fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .g-post-handle { font-size: ${px(24)}; color: #8b98a5; font-weight: 500; }
      .g-post-text { font-size: ${px(40)}; font-weight: 600; line-height: 1.25; color: #e7e9ea; }
      .g-post-foot { display: flex; align-items: center; gap: ${px(10)}; margin-top: ${px(18)}; font-size: ${px(30)}; color: #8b98a5; }
      .g-post-heart { display: inline-block; transform-origin: 50% 50%; }
      .g-post-heart.lit { color: #f91880; }${overlay}${band}`;
}

/** GSAP for the cards (runs inside the composition's timeline script; expects PLAN.graphics and tl). */
export const GRAPHICS_JS = `
        PLAN.graphics.forEach((g, i) => {
          const el = document.getElementById("gfx-" + i);
          const box = el.querySelector(".g-box");
          const ins = el.querySelectorAll(".g-in");
          tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: "power1.out" }, g.start);
          if (PLAN.graphicsMode === "band") tl.fromTo(box, { y: 28, scale: 0.985 }, { y: 0, scale: 1, duration: 0.32, ease: "power3.out" }, g.start);
          else if (PLAN.graphicsMode !== "overlay") tl.fromTo(box, { scale: 1 }, { scale: 1.035, duration: g.duration, ease: "none" }, g.start);
          else {
            tl.fromTo(box, { y: -24, scale: 0.98 }, { y: 0, scale: 1, duration: 0.3, ease: "power3.out" }, g.start);
            // The footage slides down a little while the card is up, so the card never sits on the forehead.
            const drop = PLAN.height * 0.11;
            tl.to("#video-wrap", { y: drop, duration: 0.35, ease: "power2.out" }, g.start);
            tl.to("#video-wrap", { y: 0, duration: 0.35, ease: "power2.inOut" }, g.start + g.duration - 0.2);
          }
${SKINS_JS}
          tl.fromTo(ins, { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 0.42, ease: "power3.out", stagger: Math.min(0.22, 1.1 / Math.max(1, ins.length)) }, g.start + 0.06);
          // Bubbles run on their own clock (typing, then pop), so take them out of the stagger.
          el.querySelectorAll(".g-bubble.g-in").forEach((b) => tl.set(b, { opacity: 0 }, g.start + 0.06));
          const t1 = g.start + 0.06 + 0.42 + Math.min(0.22, 1.1 / Math.max(1, ins.length)) * Math.max(0, ins.length - 1);
          el.querySelectorAll(".g-strike-line").forEach((s, k) => tl.fromTo(s, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power2.inOut" }, t1 + 0.1 + k * 0.18));
          el.querySelectorAll(".g-link").forEach((s, k) => tl.fromTo(s, PLAN.graphicsMode === "overlay" ? { scaleX: 0 } : { scaleY: 0 }, PLAN.graphicsMode === "overlay" ? { scaleX: 1, duration: 0.25, ease: "power2.out" } : { scaleY: 1, duration: 0.25, ease: "power2.out" }, g.start + 0.3 + k * 0.2));
          el.querySelectorAll(".g-hl").forEach((s) => tl.fromTo(s, { backgroundSize: "0% 46%" }, { backgroundSize: "100% 46%", duration: 0.5, ease: "power2.inOut" }, t1 + 0.05));
          el.querySelectorAll(".g-rule").forEach((s) => tl.fromTo(s, { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power3.inOut" }, t1));
          // List icons draw on with their row, then settle with a small pop.
          el.querySelectorAll(".g-icon path").forEach((p, k) => {
            const L = p.getTotalLength();
            p.style.strokeDasharray = L + " " + L;
            const at = g.start + 0.2 + k * Math.min(0.22, 1.1 / Math.max(1, ins.length));
            tl.fromTo(p, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: 0.45, ease: "power2.inOut", immediateRender: false }, at);
            tl.fromTo(p.closest(".g-icon"), { scale: 1 }, { scale: 1.12, duration: 0.1, ease: "power2.out", yoyo: true, repeat: 1, immediateRender: false }, at + 0.4);
          });
          // Compare: the accent side wipes over from the divider, the VS badge pops, the bars fill.
          el.querySelectorAll(".g-side-b").forEach((b) => tl.fromTo(b, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "sine.inOut", immediateRender: false }, g.start + 0.45));
          el.querySelectorAll(".g-vs").forEach((v) => tl.to(v, { scale: 1, duration: 0.35, ease: "back.out(2)" }, g.start + 0.95));
          el.querySelectorAll(".g-side-fill, .g-bar-fill").forEach((f, k) => tl.fromTo(f, { scaleX: 0 }, { scaleX: 1, duration: 0.85, ease: "power3.out", immediateRender: false }, g.start + 0.5 + k * 0.18));
          // Message thread: typing dots before each incoming bubble, bubbles pop from their tail.
          const bubbles = el.querySelectorAll(".g-bubble");
          const dots = el.querySelector(".g-typing");
          bubbles.forEach((b, k) => {
            const at = g.start + 0.3 + k * 1.15;
            if (dots && b.classList.contains("g-them")) {
              tl.set(dots, { opacity: 1, y: b.offsetTop }, at - 0.55);
              dots.querySelectorAll("i").forEach((d, j) => tl.fromTo(d, { y: 0 }, { y: -6, duration: 0.18, ease: "sine.inOut", yoyo: true, repeat: 1, immediateRender: false }, at - 0.5 + j * 0.12));
              tl.set(dots, { opacity: 0 }, at);
            }
            tl.fromTo(b, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.32, ease: "back.out(1.8)", immediateRender: false }, at);
          });
          // Post card: the like lands a beat after the text.
          el.querySelectorAll(".g-post-heart").forEach((h) => {
            tl.fromTo(h, { scale: 1 }, { scale: 1.5, duration: 0.14, ease: "power2.out", yoyo: true, repeat: 1, immediateRender: false }, t1 + 0.5);
            tl.set(h, { className: "g-post-heart lit" }, t1 + 0.5);
          });
          // Stat: the number accelerates up from 0 and decelerates onto the exact value (one integer per frame, so
          // a seek shows the same digits), the fill sweeps with it, and the line lands with one small pulse.
          const COUNT = Math.min(1.3, Math.max(0.6, g.duration * 0.25));
          const fps = PLAN.fps || 30;
          const countEase = gsap.parseEase("sine.inOut");
          el.querySelectorAll(".g-count").forEach((n, k) => {
            const to = parseFloat(n.dataset.to), dec = parseInt(n.dataset.dec || "0", 10), commas = n.dataset.commas === "1";
            const fmt = (v) => (commas ? Number(v.toFixed(dec)).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec));
            const at = g.start + 0.16 + k * (COUNT + 0.25);
            const last = Math.max(1, Math.round(COUNT * fps));
            for (let f = 0; f <= last; f++) tl.set(n, { textContent: fmt(to * countEase(f / last)) }, at + COUNT * (f / last));
            const stat = n.closest(".g-stat") || n.closest(".g-bar-value");
            tl.to(stat, { scale: 1.07, duration: 0.165, ease: "power3.out" }, at + COUNT);
            tl.to(stat, { scale: 1, duration: 0.165, ease: "power2.out" }, at + COUNT + 0.165);
            const ring = stat.querySelector(".g-ring");
            if (ring) for (let f = 0; f <= last; f++) tl.set(ring, { "--ring": (parseFloat(ring.dataset.pct) * countEase(f / last)).toFixed(2) + "%" }, at + COUNT * (f / last));
            if (k === 0) el.querySelectorAll(".g-fill-bar").forEach((bar) => tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: COUNT, ease: "sine.inOut" }, at));
          });
          tl.to(el, { opacity: 0, duration: 0.16, ease: "power1.in" }, g.start + g.duration - 0.16);
        });`;

import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON } from "./claude.mjs";
import { detectFaces } from "./placement.mjs";
import { r3 } from "./util.mjs";
import { GREG_PRESETS, isClientJob } from "./client-mode.mjs";
import { glowSoundCues } from "./glow-sound.mjs";
import { glowWindow, pacingReport } from "./glow-pacing.mjs";

export { pacingReport } from "./glow-pacing.mjs";
import { glowIconAction } from "./glow-icons.mjs";
import { firstGlowIcon, GLOW_BRIDGE_DURATION } from "./glow-scenes.mjs";

/**
 * The glow look (studio style): feature lines float as glowing capitals in the band under the chin, built word by
 * word; everything else is a plain subtitle low in the frame; 3D icons land beside the feature band as words are
 * spoken; and a few full-screen scenes (3D icons on the brand's dark ground with glowing text) carry lists, numbers
 * and big claims. Claude picks what to show; the layout here is measured and deterministic.
 *
 * The 3D icon library is a brand asset, not code: a folder of cut-out PNGs with library.json
 * ([{ name, draw, words }]), named by the brand's `icons3d` path. Without one, the look runs with no icons or scenes.
 */

/** The glow look runs on Greg's own vertical reels when the preset turns it on; never on a client job or a wide video. */
export function glowEnabled(preset, plan, env = process.env) {
  return preset?.glow?.enabled === true && GREG_PRESETS.includes(plan?.preset) && !isClientJob(env) && plan.canvas.height > plan.canvas.width;
}

/** Where the brand's 3D icons live: the preset's glow.icons, then REEL_ICONS3D, then ~/Reels/brand-assets/icons3d. */
export function glowIconDir(settings = {}, env = process.env) {
  return settings.icons || env.REEL_ICONS3D || path.join(env.HOME || "", "Reels", "brand-assets", "icons3d");
}

export function loadIconLibrary(dir) {
  if (!dir) return [];
  const file = path.join(dir, "library.json");
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"))
    .map((icon) => ({ ...icon, file: path.join(dir, `icon-${icon.name}.png`) }))
    .filter((icon) => fs.existsSync(icon.file));
}

const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9']/g, "");
const clean = (t) => String(t).replace(/["“”]/g, "");
const featWord = (t) => clean(t).replace(/[.,;:]$/, "");

const SCENE_TYPES = ["icons", "number", "meter", "list", "steps", "versus", "quote", "people", "flow", "thread", "bars"];
const OVERLAY_TYPES = ["notify", "stamp"];

export function glowPrompt(words, library, { hook = "", duration = 0 } = {}) {
  const lines = words.map((w, i) => `${i} ${w.start.toFixed(2)} ${w.text}`).join("\n");
  const icons = library.map((icon) => `${icon.name}: ${icon.draw}`).join("\n");
  return [
    "You are directing the on-screen graphics of a short vertical talking-head reel in a premium studio look (black and gold, glowing text, glossy 3D icons), like a high-end sales video.",
    `The reel is ${duration.toFixed(1)} seconds. Its title card says: "${hook}".`,
    "Words, one per line: index, start time in seconds, word.",
    lines,
    "",
    "3D icons you may use (name: what it shows):",
    icons,
    "",
    "You have a kit of display elements. Pick the right one for each moment from what is being said, so the reel keeps changing and every graphic matches its words. Reply with JSON only.",
    "",
    "A. features: punchy phrases shown as big glowing capitals under the speaker's chin, built word by word. 2 to 7 consecutive words that read well alone. Fields: from, to (word indexes, inclusive), key (the index shown in gold), br (index that starts line two, or null). Each line holds at most 16 characters including spaces.",
    "   hero: use variant \"hero\" when one word carries the phrase. Add hero (its word index inside from..to, at most 9 characters). It stands alone in gold at twice the size; the exact spoken words before and after each form one small support line, at most 16 characters each. Up to three lines, e.g. YOUR MOST / EXPENSIVE / HABIT. No br or extra key needed.",
    "   swap: use variant \"swap\" only when Greg literally contrasts a wrong idea with a right one (e.g. IT'S NOT LUCK / IT'S WORK). Add wrong and right (distinct word indexes inside from..to, wrong before right). Both words must be spoken in the phrase; do not invent a contrast. The wrong word strikes and dims when the right word is said; right lands in gold. Keep one or two lines of at most 16 characters using br.",
    "B. icons: a 3D icon beside the speaker on a spoken word. Fields: word (index), icon (name), action (optional: drop, spin, stack, ping, hit, float; default float). The icon must show what that word literally means here. Never the same icon twice in a row.",
    "   Pick the action that acts out the sentence: drop falls and settles; spin turns once to reveal the same icon; stack adds two ghost copies for more/stack/pile; ping adds a gold notification dot; hit gives one short impact and a gold ring; float gently bobs. Examples: phone + messages -> ping, coins + adds up -> stack, target + hit -> hit. Keep it restrained; never invent a claim through motion.",
    "   An icon on a word up to a second before a scene whose first icon is the same one (the icons, number, list, versus or people scene) flies into its place as the scene comes up; use that hand-off when the same idea carries on.",
    "C. overlays, over the speaker in the band under the chin:",
    "   notify: a message card, for a short line someone says or texts (a lead, client, prospect). Fields: type \"notify\", from, to (the quoted spoken words, at most 9), who (\"Lead\", \"Client\", \"Prospect\", at most 12 characters), icon (optional name, e.g. text-message, phone-alert).",
    "   stamp: one huge glowing word for a single punch word that carries the point (a noun, verb or number, like EQUATION or PAY), never a filler such as okay, right or so. Fields: type \"stamp\", word (index).",
    "D. scenes: full-screen moments on the black and gold ground that replace the speaker for at least 1.8 seconds (usually 1.8 to 4 seconds). Fields always: type, from, to (the spoken words the scene covers). Types:",
    "   icons: one to three big icons with the spoken words glowing under them, for one strong idea. Extra: icons (names), key (index in gold).",
    "   number: a big spoken fact that appears instantly with a scale/glow land; never count a plain fact from zero. For a spoken change only, add countFrom (the spoken starting value) to count from that value to value. The scene field from is already the first word index; countFrom is separate. Both numbers must be spoken inside from..to. For a price, amount, percent, count or time span that is said out loud. Extra: value (exactly as it should read, e.g. \"$736\", \"57%\", \"10 MIN\", \"15\"; its digits must be spoken in from..to), label (at most 24 characters, what the number is), icon (optional name).",
    "   meter: a bar filling to a percent, for a rate or share. Extra: percent (0 to 100, spoken in from..to), label (at most 24 characters).",
    "   list: two to four rows of icon plus label, landing as each is said. Extra: items [{word (index where it is said, inside from..to), icon (name), label (at most 18 characters)}].",
    "   steps: a numbered path for a process or sequence. Extra: items [{word, label (at most 18 characters)}], two to four.",
    "   versus: wrong on the left, right on the right, for a contrast or choice. Extra: left and right, each {word (index where it is said), icon (name), label (at most 14 characters)}; right is the better one.",
    "   quote: a phone with the words typing into a chat bubble, for a longer line someone says. Extra: who (at most 12 characters). The bubble shows the spoken words from..to (at most 14 words).",
    "   flow: a process or framework along a connected path. Extra: items [{word (index where the label is said, inside from..to), label (at most 14 characters, verbatim spoken phrase), icon (optional library name)}], two to four in spoken order; optional branch {word, label (at most 14 characters, verbatim)} for an objection or detour, shown dimmed.",
    "   thread: a short reconstructed conversation. Extra: bubbles [{from, to (inclusive word indexes inside the scene, at most 12 words each, exact spoken words), side (\"them\" or \"me\")}], two to four in spoken order without overlapping ranges; who (at most 12 characters, e.g. \"Lead\"). Always labelled ILLUSTRATIVE. Never write or paraphrase bubble text: select transcript ranges.",
    "   bars: before/after or two-option comparison. Extra: left and right, each {label (at most 14 characters, verbatim spoken phrase), value (as spoken, e.g. \"$10K\" or \"20%\"), amount (numeric value in full units, e.g. 10000 for $10K, 20 for 20%), word (index where that value starts, inside from..to)}. Both values must be spoken in the scene; left precedes right, and right is the better or later option, in gold. Amounts must match the displayed values; no invented comparison.",
    "   people: a row of people icons, for a team, group, cohort or hiring. Extra: count (2 to 10), label (at most 24 characters).",
    "",
    "Direction:",
    "- Pace graphics to the argument. For each beat choose a graphic, leave room for a camera move (zooms are planned elsewhere), or choose a clean hold on Greg's face with subtitles only. A beat does not need a graphic.",
    "- Aim for a visual change roughly every 2 to 4 seconds across graphics, camera moves and clean holds. Do not decorate every phrase; let a claim land before changing the picture.",
    "- About 25 to 35% of the reel should be clean holds on Greg: subtitles only, with no feature, overlay, icon or scene. Omit picks for these beats; do not add camera or hold objects to the JSON.",
    "- Full-screen scenes together cover at most a third of the reel. After each scene has fully exited, leave at least 1.2 seconds settled on Greg with subtitles only before the next scene or band element. Never use the same scene type twice in a row.",
    "- No more than 2 band elements (features, overlays and icons combined) may start inside any rolling 3-second window. Keep the graphic that carries the argument; drop decorative icons first.",
    "- Prefer a specific type (number, meter, list, steps, flow, thread, bars, versus, quote, people, notify) when the spoken argument earns it. Use the icons scene only when nothing more specific fits; there is no type quota.",
    "- Labels say what the speaker says, in his words, never new claims or numbers.",
    "- Features, overlays and scenes never share words. Nothing on the words in the first 3 seconds, where the title card sits.",
    'Reply as {"features":[],"icons":[],"overlays":[],"scenes":[]}',
  ].join("\n");
}

const SMALL_NUMBERS = Object.fromEntries("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ").map((w, i) => [w, i]));
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { thousand: 1000, million: 1000000, billion: 1000000000, k: 1000, m: 1000000, b: 1000000000 };

/** Compare the actual amount, including compact units, rather than accepting any nearby number. */
function numberAmount(value) {
  const m = String(value).replace(/,/g, "").match(/^[^\d-]*(-?\d+(?:\.\d+)?)\s*([kmb])?(?:\b|(?=[^a-z])|$)/i);
  return m ? Number(m[1]) * (SCALES[m[2]?.toLowerCase()] || 1) : null;
}

function spokenAmount(tokens) {
  let total = 0, group = 0, seen = false, decimal = "", point = false;
  for (const t of tokens) {
    if (t === "and" && seen) continue;
    if (t === "point" && seen && !point) { point = true; continue; }
    if (point) { if (SMALL_NUMBERS[t] == null || SMALL_NUMBERS[t] > 9) return null; decimal += SMALL_NUMBERS[t]; continue; }
    if (SMALL_NUMBERS[t] != null || TENS[t] != null) { group += SMALL_NUMBERS[t] ?? TENS[t]; seen = true; }
    else if (t === "hundred" && seen) group *= 100;
    else if (SCALES[t] && seen) { total += group * SCALES[t]; group = 0; }
    else if (/^[$£€]?-?\d[\d,]*(?:\.\d+)?[kmb%]?$/.test(t)) { group += numberAmount(t); seen = true; }
    else return null;
  }
  return seen ? total + group + (decimal ? Number(`0.${decimal}`) : 0) : null;
}

function saysAmount(words, value, atStart = false) {
  const target = numberAmount(value);
  if (target == null || !Number.isFinite(target)) return false;
  const tokens = words.flatMap((w) => w.text.toLowerCase().replace(/[,.!?;:]+$/, "").split(/(?<=[a-z])-(?=[a-z])|\s+/));
  for (let i = 0; i < tokens.length; i++) {
    if (atStart && i > 0) break;
    const prev = tokens[i - 1];
    if (i && (SMALL_NUMBERS[prev] != null || TENS[prev] != null || SCALES[prev] || prev === "hundred" || prev === "point" || prev === "and" && i > 1 && (tokens[i - 2] === "hundred" || spokenAmount([tokens[i - 2]]) != null))) continue;
    for (let end = i + 1; end <= Math.min(tokens.length, i + 10); end++) {
      // Do not match a fragment of a larger number (twenty out of twenty five, or 10 out of 10 thousand).
      if (SMALL_NUMBERS[tokens[end]] != null || TENS[tokens[end]] != null || SCALES[tokens[end]] || tokens[end] === "hundred" || tokens[end] === "point" || tokens[end] === "and" && (SMALL_NUMBERS[tokens[end + 1]] != null || TENS[tokens[end + 1]] != null)) continue;
      if (Math.abs((spokenAmount(tokens.slice(i, end)) ?? NaN) - target) < 1e-8) {
        if (!String(value).includes("%") || tokens.slice(i, end).some((t) => t.endsWith("%")) || /^(percent|percentage)$/.test(tokens[end] || "") || tokens[end] === "per" && tokens[end + 1] === "cent") return true;
      }
    }
  }
  return false;
}

const FILLER = new Set("okay ok right so like yeah yes no um uh well and but or the a an to of in on it is was that this just really very you i we they he she gonna kinda".split(" "));
/** A stamp word carries meaning: at least four letters (or a number) and never a filler. */
export const punchWord = (t) => { const w = String(t).toLowerCase().replace(/[^a-z0-9']/g, ""); return !FILLER.has(w) && (/\d/.test(w) || w.length >= 4); };
const short = (t, n) => { const v = String(t ?? "").replace(/\s+/g, " ").trim(); return v && v.length <= n ? v : ""; };

/** Keep only well-formed, non-overlapping picks that point at real words and real icons, and say what was spoken. */
export function checkPicks(picks, words, library, { hookEnd = 3, duration = Infinity } = {}) {
  const names = new Set(library.map((icon) => icon.name));
  const n = words.length;
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < n;
  const taken = new Set();
  const claim = (from, to) => {
    for (let i = from; i <= to; i++) if (taken.has(i)) return false;
    for (let i = from; i <= to; i++) taken.add(i);
    return true;
  };
  hookEnd = Math.max(3, hookEnd);
  const afterHook = (i) => words[i].start >= hookEnd;
  const span = (x, max) => inRange(x.from) && inRange(x.to) && x.to >= x.from && x.to - x.from < max && afterHook(x.from);
  const within = (x, i) => Number.isInteger(i) && i >= x.from && i <= x.to;
  const spoken = (x) => words.slice(x.from, x.to + 1).map((w) => w.text.toLowerCase());
  const saysNumber = (x, value) => saysAmount(words.slice(x.from, x.to + 1), value);
  const labelSaid = (x, label, limit, word = null) => {
    const text = short(label, limit);
    if (!text) return "";
    const want = text.split(/\s+/).map(norm).join(" ");
    const source = (word == null ? spoken(x) : words.slice(word, x.to + 1).map((w) => w.text)).map(norm).join(" ");
    return want && ` ${source} `.includes(` ${want} `) && (word == null || source === want || source.startsWith(`${want} `)) ? text : "";
  };
  const icon = (name) => (names.has(name) ? name : null);
  const scenes = [];
  const sceneCap = Number.isFinite(duration) ? duration / 3 : Infinity;
  let sceneTime = 0, lastType = "";
  for (const s of [...(picks.scenes || [])].sort((a, b) => a.from - b.from)) {
    const type = SCENE_TYPES.includes(s.type) ? s.type : (s.icons ? "icons" : null);
    if (!type || !span(s, type === "thread" ? 48 : type === "flow" || type === "bars" ? 32 : type === "quote" ? 15 : 12) || type === lastType) continue;
    let out = null;
    if (type === "icons") { const list = (s.icons || []).filter(icon).slice(0, 3); if (list.length) out = { icons: list, key: within(s, s.key) ? s.key : null }; }
    if (type === "number") { const value = short(s.value, 10); const countFrom = s.countFrom == null ? null : short(s.countFrom, 10); if (value && /\d/.test(value) && saysNumber(s, value) && (s.countFrom == null || countFrom && saysNumber(s, countFrom))) out = { value, ...(countFrom == null ? {} : { countFrom }), label: short(s.label, 24), icon: icon(s.icon) }; }
    if (type === "meter") { const p = Math.round(Number(s.percent)); if (p >= 0 && p <= 100 && saysNumber(s, p)) out = { percent: p, value: `${p}%`, label: short(s.label, 24) }; }
    if (type === "list" || type === "steps") {
      const items = (s.items || []).filter((it) => within(s, it.word) && short(it.label, 18) && (type === "steps" || icon(it.icon))).sort((a, b) => a.word - b.word).slice(0, 4).map((it) => ({ word: it.word, label: short(it.label, 18), icon: icon(it.icon) }));
      if (items.length >= 2) out = { items };
    }
    if (type === "versus") {
      const side = (x) => x && within(s, x.word) && icon(x.icon) && short(x.label, 14) ? { word: x.word, icon: x.icon, label: short(x.label, 14) } : null;
      const l = side(s.left), r = side(s.right);
      if (l && r && l.word <= r.word) out = { left: l, right: r };
    }
    if (type === "flow") {
      const node = (it) => {
        if (!it || !within(s, it.word)) return null;
        const label = labelSaid(s, it.label, 14, it.word);
        return label && (it.icon == null || icon(it.icon)) ? { word: it.word, label, icon: icon(it.icon) } : null;
      };
      const items = Array.isArray(s.items) ? s.items.map(node) : [];
      const branch = s.branch == null ? null : node(s.branch);
      if (items.length >= 2 && items.length <= 4 && items.every(Boolean) && items.every((it, i) => !i || it.word > items[i - 1].word) && (s.branch == null || branch)) out = { items, ...(branch ? { branch: { word: branch.word, label: branch.label } } : {}) };
    }
    if (type === "thread") {
      const bubbles = Array.isArray(s.bubbles) ? s.bubbles : [];
      if (short(s.who, 12) && bubbles.length >= 2 && bubbles.length <= 4 && bubbles.every((b, i) => b && within(s, b.from) && within(s, b.to) && b.to >= b.from && b.to - b.from < 12 && ["them", "me"].includes(b.side) && (!i || b.from > bubbles[i - 1].to))) out = { who: short(s.who, 12), bubbles: bubbles.map((b) => ({ from: b.from, to: b.to, side: b.side })) };
    }
    if (type === "bars") {
      const side = (x) => {
        if (!x || !within(s, x.word)) return null;
        const label = labelSaid(s, x.label, 14), value = short(x.value, 10);
        return label && value && typeof x.amount === "number" && Number.isFinite(x.amount) && x.amount >= 0 && x.amount === numberAmount(value) && saysAmount(words.slice(x.word, s.to + 1), value, true) ? { label, value, amount: x.amount, word: x.word } : null;
      };
      const left = side(s.left), right = side(s.right);
      if (left && right && left.word < right.word && Math.max(left.amount, right.amount) > 0) out = { left, right };
    }
    if (type === "quote") out = { who: short(s.who, 12) || "Lead" };
    if (type === "people") { const c = Math.round(Number(s.count)); if (c >= 2 && c <= 10 && names.has("person")) out = { count: c, label: short(s.label, 24) }; }
    if (!out) continue;
    const window = glowWindow("scenes", { type, from: s.from, to: s.to, ...out }, words, duration, hookEnd);
    const length = window.end - window.start;
    // A scene holds at least 1.8 s (the end of the reel can cut one short); pacing keeps 1.2 s settled between them.
    if (length < 1.8 - 1e-9 || sceneTime + length > sceneCap) continue;
    if (!claim(s.from, s.to)) continue;
    scenes.push({ type, from: s.from, to: s.to, ...out });
    sceneTime += length;
    lastType = type;
  }
  const overlays = [];
  for (const o of [...(picks.overlays || [])].sort((a, b) => (a.from ?? a.word) - (b.from ?? b.word))) {
    if (!OVERLAY_TYPES.includes(o.type)) continue;
    if (o.type === "stamp") { const w = o.word ?? o.from; if (inRange(w) && afterHook(w) && punchWord(words[w].text) && claim(w, w)) overlays.push({ type: "stamp", from: w, to: w }); continue; }
    if (span(o, 9) && claim(o.from, o.to)) overlays.push({ type: "notify", from: o.from, to: o.to, who: short(o.who, 12) || "Lead", icon: icon(o.icon) || (names.has("text-message") ? "text-message" : null) });
  }
  const features = [];
  for (const f of picks.features || []) {
    if (!span(f, 8)) continue;
    const variant = f.variant ?? (f.hero != null ? "hero" : f.wrong != null || f.right != null ? "swap" : null);
    const out = { from: f.from, to: f.to, key: within(f, f.key) ? f.key : null, br: within(f, f.br) && f.br > f.from ? f.br : null };
    if (variant && (f.to <= f.from || f.to - f.from >= 7)) continue;
    if (variant === "hero") {
      if (!within(f, f.hero) || !norm(words[f.hero].text) || featWord(words[f.hero].text).length > 9 || lineChars(words, f.from, f.hero - 1) > 16 || lineChars(words, f.hero + 1, f.to) > 16) continue;
      Object.assign(out, { variant, hero: f.hero, key: f.hero, br: null });
    } else if (variant === "swap") {
      if (!within(f, f.wrong) || !within(f, f.right) || f.wrong >= f.right || !norm(words[f.wrong].text) || !norm(words[f.right].text) || norm(words[f.wrong].text) === norm(words[f.right].text)) continue;
      Object.assign(out, { variant, wrong: f.wrong, right: f.right, key: f.right });
      if (!fitsTwoLines(words, out)) continue;
    } else if (variant || !fitsTwoLines(words, out)) continue;
    if (claim(f.from, f.to)) features.push(out);
  }
  const busy = (i) => [...scenes, ...overlays].some((x) => i >= x.from && i <= x.to);
  let last = "";
  const icons = (picks.icons || []).filter((p) => inRange(p.word) && names.has(p.icon) && afterHook(p.word) && !busy(p.word))
    .sort((a, b) => a.word - b.word)
    .filter((p) => { const ok = p.icon !== last; if (ok) last = p.icon; return ok; })
    .map((p) => ({ word: p.word, icon: p.icon, action: glowIconAction(p.action) }));
  return pacingReport({ features, icons, overlays, scenes }, words, duration, { hookEnd }).picks;
}

const lineChars = (words, from, to) => words.slice(from, to + 1).map((w) => featWord(w.text)).join(" ").length;
export function fitsTwoLines(words, f, max = 16) {
  if (f.br == null) return lineChars(words, f.from, f.to) <= max;
  return lineChars(words, f.from, f.br - 1) <= max && lineChars(words, f.br, f.to) <= max;
}

/**
 * Size variant rows (0.72 em per character: Inter 760 capitals plus tracking, the same measure that fits a 16-character
 * line at the feature size) and reserve their line height plus the 8px entrance.
 */
function featureLayout(words, f, size, w, H) {
  if (!f.variant) return { size, h: 0.07 * H };
  const hero = f.variant === "hero";
  const lengths = hero
    ? [lineChars(words, f.from, f.hero - 1), lineChars(words, f.hero, f.hero) * 2, lineChars(words, f.hero + 1, f.to)].filter(Boolean)
    : f.br == null ? [lineChars(words, f.from, f.to)] : [lineChars(words, f.from, f.br - 1), lineChars(words, f.br, f.to)];
  size = Math.max(1, Math.min(size, Math.floor(w / (Math.max(...lengths) * 0.72))));
  const h = Math.ceil(size * ((lengths.length + (hero ? 1 : 0)) * 1.08 + (lengths.length - 1) * 0.04) + 8);
  return { size, ...(hero ? { heroSize: size * 2 } : {}), h };
}

/** The largest face in each detected frame across [t0, t1]. */
export function faceDuring(detection, t0, t1) {
  return (detection?.frames || []).filter((f) => f.t >= t0 - 0.13 && f.t <= t1 + 0.13 && f.faces?.length).map((f) => f.faces.reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a)));
}

/** The speaker's chin (fraction of the height) across [t0, t1] in a face detection, or a fallback. */
export function chinDuring(detection, t0, t1, fallback = 0.47) {
  const frames = (detection?.frames || []).filter((f) => f.t >= t0 - 0.13 && f.t <= t1 + 0.13 && f.faces?.length);
  if (!frames.length) return fallback;
  return Math.max(...frames.map((f) => { const b = f.faces.reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a)); return b.y + b.h; }));
}

/**
 * Turn checked picks into plan captions, icons, scenes and the hook's placement. Words outside features and scenes
 * become subtitles (clauses broken at punctuation, three words a line).
 */
export function layoutGlow(plan, picks, library, detection, { W = 1080, H = 1920 } = {}) {
  const words = plan.words;
  const D = plan.video.duration;
  const window = (kind, pick) => glowWindow(kind, pick, words, D, Math.max(3, plan.hook ? plan.hook.start + plan.hook.duration : 0));
  const lib = new Map(library.map((icon) => [icon.name, icon]));
  const featSize = Math.round(0.029 * H);
  // The band starts just under the chin, wherever the chin is; text that would not fit above the subtitles (0.8)
  // there is not shown in the band at all.
  const band = (t0, t1) => Math.round((Math.max(0.4, chinDuring(detection, t0, t1)) + 0.02) * H);
  const roomy = (t0, t1, h) => Math.max(0.4, chinDuring(detection, t0, t1)) + 0.02 + h <= 0.785;
  const featAt = new Map(picks.features.map((f) => [f.from, f]));
  const sceneAt = new Map(picks.scenes.map((s) => [s.from, s]));
  const overAt = new Map((picks.overlays || []).map((o) => [o.from, o]));
  const captions = [];
  const scenes = [];
  const overlays = [];
  const file = (name) => (name && lib.get(name) ? { name, file: lib.get(name).file } : null);
  const at = (i) => words[i].start;
  const labelWords = (label) => String(label || "").split(/\s+/).filter(Boolean).map((text) => ({ text, start: 0 }));
  const sceneFrom = (s, ws) => {
    const base = { type: s.type };
    switch (s.type) {
      case "number": return { ...base, value: s.value, ...(s.countFrom == null ? {} : { from: s.countFrom }), labelWords: labelWords(s.label), icon: file(s.icon) };
      case "meter": return { ...base, value: s.value, percent: s.percent, labelWords: labelWords(s.label) };
      case "list": case "steps": return { ...base, items: s.items.map((it) => ({ label: it.label, icon: file(it.icon), at: at(it.word) })) };
      case "flow": return { ...base, items: s.items.map((it) => ({ label: it.label, icon: file(it.icon), at: at(it.word) })), ...(s.branch ? { branch: { label: s.branch.label, at: at(s.branch.word) } } : {}) };
      case "thread": return { ...base, who: s.who, bubbles: s.bubbles.map((b) => ({ side: b.side, at: at(b.from), words: words.slice(b.from, b.to + 1).map((w) => ({ ...w, text: clean(w.text) })) })) };
      case "bars": return { ...base, left: { label: s.left.label, value: s.left.value, amount: s.left.amount, at: at(s.left.word) }, right: { label: s.right.label, value: s.right.value, amount: s.right.amount, at: at(s.right.word) } };
      case "versus": return { ...base, left: { label: s.left.label, icon: file(s.left.icon), at: at(s.left.word) }, right: { label: s.right.label, icon: file(s.right.icon), at: at(s.right.word) }, cross: file("cross"), check: file("check") };
      case "quote": return { ...base, who: s.who, words: ws.map((w) => ({ ...w, text: clean(words.find((x) => x.start === w.start)?.text || w.text), key: false })) };
      case "people": return { ...base, count: s.count, icon: file("person"), labelWords: labelWords(s.label) };
      default: return { ...base, words: ws, icons: s.icons.map(file) };
    }
  };
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const n = Math.ceil(cur.length / 3), per = Math.ceil(cur.length / n);
    for (let k = 0; k < cur.length; k += per) {
      const part = cur.slice(k, k + per);
      captions.push({ kind: "sub", start: r3(words[part[0]].start - 0.05), end: r3(words[part.at(-1)].end + 0.05), text: part.map((i) => words[i].text).join(" "), words: part.map((i) => ({ text: clean(words[i].text), start: words[i].start, end: words[i].end })) });
    }
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    let f = featAt.get(i), o = overAt.get(i);
    const s = sceneAt.get(i);
    // No room under the chin (a close zoom): a feature line becomes subtitles, an overlay is left out.
    const featureBox = f ? featureLayout(words, f, featSize, Math.round(0.58 * W), H) : null;
    if (f && !roomy(words[f.from].start - 0.05, words[f.to].end + 0.35, featureBox.h / H)) f = null;
    if (o && !roomy(words[o.from].start - 0.1, words[o.to].end + 0.7, o.type === "stamp" ? 0.08 : 0.075)) o = null;
    if (o) {
      flush();
      const ix = Array.from({ length: o.to - o.from + 1 }, (_, k) => o.from + k);
      const { start, end } = window("overlays", o);
      overlays.push({ type: o.type, start, end, who: o.who, icon: file(o.icon), text: featWord(words[o.from].text).toUpperCase(), words: ix.map((j) => ({ text: clean(words[j].text), start: words[j].start, end: words[j].end })), place: { x: Math.round(0.07 * W), y: band(start, end), w: Math.round(0.62 * W) } });
      i = o.to;
      continue;
    }
    if (f || s) {
      flush();
      const g = f || s;
      const ix = Array.from({ length: g.to - g.from + 1 }, (_, k) => g.from + k);
      const { start, end } = window(f ? "features" : "scenes", g);
      const hero = f?.variant === "hero", swap = f?.variant === "swap";
      const key = hero ? f.hero : swap ? f.right : g.key;
      const ws = ix.map((j) => ({
        text: featWord(words[j].text), start: words[j].start, end: words[j].end,
        ...(j === key ? { key: true } : {}),
        ...(f && (hero ? j > f.from && (j === f.hero || j === f.hero + 1) : j === f.br) ? { br: true } : {}),
        ...(hero && j === f.hero ? { hero: true } : {}),
        ...(swap && j === f.wrong ? { wrong: true } : {}),
        ...(swap && j === f.right ? { right: true } : {}),
      }));
      if (f) captions.push({ kind: "feat", ...(f.variant ? { variant: f.variant } : {}), start, end, text: ix.map((j) => words[j].text).join(" "), words: ws, place: { x: Math.round(0.07 * W), y: band(start, end), w: Math.round(0.58 * W), ...featureBox } });
      else {
        const scene = sceneFrom(s, ws);
        if (end - start >= 1.8 - 1e-9) scenes.push({ ...scene, start, end });
      }
      i = g.to;
      continue;
    }
    cur.push(i);
    if (/[.,?!;:]["”]?$/.test(words[i].text)) flush();
  }
  flush();
  // A subtitle under half a second joins its neighbour (the one it runs into), up to five words.
  const merged = [];
  for (const g of captions.sort((a, b) => a.start - b.start)) {
    const prev = merged.at(-1);
    const short = (x) => x.end - x.start < 0.45;
    if (prev && prev.kind === "sub" && g.kind === "sub" && (short(g) || short(prev)) && prev.words.length + g.words.length <= 5 && g.start - prev.end < 0.3) {
      prev.words.push(...g.words); prev.end = g.end; prev.text = `${prev.text} ${g.text}`;
    } else merged.push(g);
  }
  captions.length = 0; captions.push(...merged);
  // Subtitles hand over without flicker; a feature holds until the next feature starts.
  const subs = captions.filter((g) => g.kind === "sub");
  subs.forEach((g, i) => { const nx = subs[i + 1]; if (nx && nx.start - g.end < 0.35) g.end = r3(nx.start - 0.01); });
  // Every subtitle stays up long enough to read: a short one joins the next when that starts too soon, else it holds.
  const MIN_SHOW = 0.5;
  for (let i = 0; i < subs.length; i++) {
    const g = subs[i], nx = subs[i + 1];
    if (g.end - g.start >= MIN_SHOW) continue;
    if (nx && nx.start < g.start + MIN_SHOW && g.words.length + nx.words.length <= 6) {
      nx.words.unshift(...g.words); nx.start = g.start; nx.text = `${g.text} ${nx.text}`;
      captions.splice(captions.indexOf(g), 1);
      continue;
    }
    g.end = r3(Math.min(D - 0.05, Math.max(g.end, g.start + MIN_SHOW), nx ? nx.start - 0.01 : Infinity));
  }
  captions.sort((a, b) => a.start - b.start);
  captions.forEach((g, i) => { if (g.kind !== "feat") return; const nx = captions.slice(i + 1).find((x) => x.kind === "feat"); if (nx && g.end > nx.start - 0.05) g.end = r3(nx.start - 0.05); });
  // No caption under a scene.
  scenes.forEach((sc, k) => { const nx = scenes[k + 1]; if (nx && sc.end > nx.start - 0.3) sc.end = r3(Math.max(sc.start + 1.8, nx.start - 0.3)); });
  // One thing at a time in the band under the chin: a feature line or overlay leaves before the next one arrives.
  const bandItems = [...captions.filter((g) => g.kind === "feat"), ...overlays].sort((x, y) => x.start - y.start);
  bandItems.forEach((g, k) => { const nx = bandItems[k + 1]; if (nx && g.end > nx.start - 0.05) g.end = r3(Math.max(g.start + 0.3, nx.start - 0.05)); });
  const visible = captions.filter((g) => !scenes.some((s) => g.start < s.end && g.end > s.start + 0.15))
    .filter((g) => g.kind !== "feat" || !overlays.some((o) => g.start < o.end && g.end > o.start));

  const size = Math.round(0.2 * W);
  let icons = picks.icons.map((p) => {
    const w = words[p.word];
    const { start: t, end } = window("icons", p);
    return { t, end, icon: "", word: w.text, file: lib.get(p.icon).file, name: p.icon, action: glowIconAction(p.action), x: Math.round(0.84 * W - size), y: band(t, end) - Math.round(size * 0.12), size };
  });
  // A recent matching band icon holds through the shared move; all other scene overlaps still disappear.
  const bridges = new Map();
  scenes.forEach((scene) => {
    const name = firstGlowIcon(scene)?.name;
    const icon = icons.findLast((icon) => name && icon.name === name && icon.t < scene.start && scene.start - icon.t <= 1.2);
    if (icon) {
      bridges.set(icon, scene);
      icon.end = r3(scene.start + GLOW_BRIDGE_DURATION);
      icon.y = band(icon.t, icon.end) - Math.round(size * 0.12);
    }
  });
  icons = icons.filter((icon) => ![...scenes, ...overlays].some((s) => s !== bridges.get(icon) && icon.t < s.end && icon.end > s.start))
    .filter((icon) => icon.y + icon.size <= 0.785 * H)
    .filter((icon) => !faceDuring(detection, icon.t, icon.end).some((f) => icon.x < (f.x + f.w) * W && icon.x + icon.size > f.x * W && icon.y < (f.y + f.h * 0.85) * H && icon.y + icon.size > f.y * H));
  icons.forEach((icon, i) => { const nx = icons[i + 1]; if (nx && icon.end > nx.t - 0.05) icon.end = r3(nx.t - 0.05); });
  icons = icons.filter((icon) => bridges.has(icon) ? icon.end >= bridges.get(icon).start + GLOW_BRIDGE_DURATION - 0.001 : icon.end - icon.t >= 0.6);
  icons.forEach((icon, i) => { const scene = bridges.get(icon); if (scene) scene.bridge = i; });
  return { captions: visible, icons, scenes, overlays, band };
}

/**
 * Where the title sits: under the chin when two lines fit above the subtitles, else above the head when the frame has
 * room there (a webcam shot), else under the chin with the subtitles held back while it shows.
 */
export function hookSpot(detection, duration, sizeFrac, band, H = 1920) {
  const tall = sizeFrac * 2.3;
  const chin = Math.max(0.4, chinDuring(detection, 0, duration));
  if (chin + 0.02 + tall <= 0.785) return { y: band(0, duration) };
  const faces = faceDuring(detection, 0, duration);
  const headTop = faces.length ? Math.min(...faces.map((f) => f.y - 0.15 * f.h)) : 0;
  if (0.07 + tall <= headTop - 0.01) return { y: Math.round(0.07 * H) };
  return { y: band(0, duration), crowded: true };
}

/**
 * A restyle copy leaves the old project folder behind, but a reel's music bed lives only there (the edit trims it into
 * project/assets). Copy every audio track the plan plays, other than the packaged sound effects, into the new project.
 */
export function carryProjectAudio(srcDir, destDir, plan) {
  const carried = [];
  for (const track of plan.audio?.tracks || []) {
    const rel = String(track.src || "");
    if (!rel.startsWith("assets/") || rel.startsWith("assets/sfx/")) continue;
    const from = path.join(srcDir, "project", rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(destDir, "project", rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    carried.push(rel);
  }
  return carried;
}

/** Restyle a finished job in a new folder: same footage, cuts, audio and timing; glow captions, icons and scenes. */
export async function restyleGlow(plan, { render, library, ask = claudeText, picks: saved = null } = {}) {
  const W = plan.canvas.width, H = plan.canvas.height, D = plan.video.duration;
  const times = Array.from({ length: Math.max(1, Math.floor(D * 4)) }, (_, k) => r3(Math.min(D - 0.05, k * 0.25 + 0.05)));
  const detection = render ? await detectFaces(render, times) : null;
  const hookEnd = plan.hook ? plan.hook.start + plan.hook.duration : 0;
  // Saved picks (a re-render after a layout change) skip the Claude call; they are checked again all the same.
  const reply = saved || firstJSON(await ask(glowPrompt(plan.words, library, { hook: plan.hook?.text || "", duration: D }), { timeoutMs: 600000 }));
  const picks = checkPicks(reply, plan.words, library, { hookEnd: Math.max(3, hookEnd), duration: D });
  const out = layoutGlow(plan, picks, library, detection, { W, H });
  plan.captions = out.captions;
  plan.icons = out.icons;
  plan.glowScenes = out.scenes;
  plan.glowOverlays = out.overlays;
  plan.style.captions = { ...plan.style.captions, style: "glow", uppercase: true, subPosition: 0.8, subFontSizeFrac: 0.03 };
  if (plan.hook) {
    plan.style.hook = { ...plan.style.hook, plaque: false, style: "headline" };
    const hookWords = plan.hook.words || plan.hook.text.split(/\s+/).map((text) => ({ text }));
    const total = hookWords.map((w) => w.text).join(" ").length;
    let run = 0, br = -1;
    hookWords.forEach((w, i) => { if (br < 0 && i && run + w.text.length / 2 >= total / 2) br = i; run += w.text.length + 1; });
    plan.hook.words = hookWords.map((w, i) => ({ ...w, ...(i === br ? { br: true } : {}) }));
    const size = Math.round((total > 44 ? 0.028 : 0.032) * H);
    plan.hook.place = { x: Math.round(0.07 * W), ...hookSpot(detection, Math.max(0.5, plan.hook.duration), size / H, out.band, H), w: Math.round(0.86 * W), size };
    // A title that had to stay in a crowded band keeps the subtitles off until it is gone.
    if (plan.hook.place.crowded) plan.captions = plan.captions.filter((g) => g.kind !== "sub" || g.start >= plan.hook.start + plan.hook.duration - 0.1);
    delete plan.hook.place.crowded;
  }
  // The old look's card graphics, slams and lower thirds would fight the new layout; the glow look replaces them.
  plan.graphics = [];
  plan.slams = [];
  plan.premise = null;
  plan.timeLabels = [];
  // The old look's cut cues go; music, narration and a B-roll shot's own generated sound (sfx-broll-*) stay.
  plan.audio = { ...plan.audio, tracks: [...(plan.audio?.tracks || []).filter((t) => !String(t.id || "").startsWith("sfx-") || String(t.id).startsWith("sfx-broll-")), ...glowSoundCues(plan)] };
  return { plan, picks, reply };
}

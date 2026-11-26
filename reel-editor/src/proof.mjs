// reel proof: a narrated proof reel with no filming. Greg's cloned voice (his ElevenLabs clone as el:<voice id> since
// 2026-11-25, or a VoiceStudio voice as vs:<name>; src/voice.mjs) reads real client texts. The narration goes over a slow push on a real photo of Greg (it carries the voice and makes the
// cover) and the normal drop-folder watcher edits, gates and delivers it like any other reel (#aivoice marks it
// AI-made for Publish).
// With the card library's specs (Testimonials/Social/lib-specs.json) the texts are read exactly as sent, names still
// covered, and written to <proof home>/<clip>/proof.json; the editor draws the receipts look from it (src/receipts.mjs:
// the texts full screen, no photo on screen, no dates). Without specs the cards are OCR'd and dropped beside the
// clip as "<clip> proof N - <label>.png" for the older layout.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeText, firstJSON } from "./claude.mjs";
import { ocrBinary, parseOcrJSON } from "./evidence.mjs";
import { DEFAULT_SEED, parseVoice, speak } from "./voice.mjs";
import { checkLines } from "./voicecheck.mjs";
import { ensureDir, log, r3, readJSON, run, writeJSON } from "./util.mjs";

const IMAGE = /\.(png|jpe?g)$/i;
// Folders a card is never picked from: criticism Greg set aside, money screenshots, texts still waiting on a check.
export const SKIP_DIRS = Object.freeze(["not-using", "with-dollar-amounts", "check-flags"]);
// Proof reels are for coaches (Greg 2026-11-25: "I wanted this focused on coaches with coaching offers not sales
// people", "follow the brand guides"). The closer is Brand Guide v11's one-liner, the same words as the bio.
export const DEFAULT_CLOSE = "I build the sales system under the offer you already have.";
export const CARD_LABEL = "Real text";
export const GAPS = Object.freeze({ hook: 0.45, setup: 0.3, quote: 0.65, close: 0.8, lead: 0.15 });
const LIMITS = { hookWords: 12, setupWords: 16, quoteMin: 2, quoteMax: 24 }; // "First purchase!!" is a whole text (11-25)
// Brand Guide v11 Part 4 kill list (Greg's own lines only; a client's quote stays word for word).
const KILL = [/\bunlock/i, /\bunleash/i, /game ?changer/i, /\belevate/i, /\bdive in\b/i, /\bdelve/i, /\bleverag/i, /\bsynergy/i, /\b10x\b/i, /\bgrind/i, /\bhacks?\b/i, /\bmanifest/i, /passive income/i, /autopilot/i, /set it and forget it/i, /while you sleep/i, /24\/7/, /effortless/i, /done for you/i, /here's the thing/i, /the truth is/i, /let's be honest/i, /3 to 5x/i, /\bA to Z\b/i, /runs without you/i, /never misses/i, /\btransform/i, /\bjourney\b/i, /\bempower/i, /\bseamless/i, /\belite\b/i, /\bcrush/i, /level up/i, /hiring portal/i, /\bghost\b/i, /biggest leak/i];
// The audience is coaches: never salespeople, and AI is never the point.
const NOT_COACH = [/\bsales ?(?:people|person|rep|reps|man|men)\b/i, /\breps?\b/i, /\bAI\b/];
// Greg 2026-11-25: "Remove I coached a coach that sounds dumb… we need it to sound professional and like my voice".
const CLUMSY = [/\bcoach(?:ed|es|ing)?\s+(?:a|another|the|this)\s+coach/i, /\bcoach\b[^.!?]*\bcoach\b/i];
const NAME_OK = new Set(["I", "I'm", "I've", "I'd", "I'll", "Greg", "DM", "DMs", "CRM", "VSL"]);

const home = (env = process.env) => env.HOME || os.homedir();
export const proofHome = (env = process.env) => env.REEL_PROOF_HOME || path.join(home(env), "Reels", "proof");
export const tokens = (s) => String(s || "").toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.map((w) => w.replace(/’/g, "'")) || [];

function walk(dir, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.includes(entry.name)) out.push(...walk(full, depth + 1)); }
    else if (IMAGE.test(entry.name)) out.push(full);
  }
  return out;
}

export function readLedger(file) {
  try { const j = readJSON(file); return { cards: j.cards || {}, photos: j.photos || {}, reels: j.reels || [] }; } catch { return { cards: {}, photos: {}, reels: [] }; }
}

/** Where the card library keeps its specs: beside the Cards folder, in Social/lib-specs.json. */
export function specsFile({ from, specs, env = process.env } = {}) {
  if (specs) return path.resolve(specs);
  if (env.REEL_PROOF_SPECS) return path.resolve(env.REEL_PROOF_SPECS);
  return from ? path.join(path.dirname(path.resolve(from)), "Social", "lib-specs.json") : null;
}

/** The library's card specs keyed by their path inside the Cards folder ("1-strongest/004-jason-s5.png"). */
export function loadSpecs(file) {
  if (!file || !fs.existsSync(file)) return null;
  let list;
  try { list = readJSON(file); } catch { return null; }
  const map = new Map();
  for (const spec of Array.isArray(list) ? list : []) {
    const m = String(spec.out || "").match(/\/Cards(?:\.new)?\/(.+)$/);
    if (m && Array.isArray(spec.messages) && spec.messages.length) map.set(m[1], spec);
  }
  return map.size ? map : null;
}

/** The strongest library texts for the wall behind the hook and the closer (never a held folder or a split card). */
export function wallSpecs(specs, count = 30) {
  if (!specs) return [];
  return [...specs.entries()]
    .filter(([rel]) => !rel.split("/").some((part) => SKIP_DIRS.includes(part)) && !/-p\d+\.(png|jpe?g)$/i.test(rel))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, count)
    .map(([, spec]) => ({ label: spec.label || "", messages: spec.messages.map((m) => ({ who: m.who === "greg" ? "greg" : "them", text: String(m.text || "") })), redact: spec.redact || [] }));
}

const NAME = "[name]";
// A coach list text with no card file is named "list:<id>" wherever a card path would go (script, ledger).
export const INLINE = "list:";
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A card's words as the script writer sees them: every covered name is "[name]". */
export function specText(spec) {
  return spec.messages.map((m) => {
    let t = String(m.text || "").trim();
    for (const w of [...(spec.redact || [])].filter(Boolean).sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escRe(w)}(?![\\p{L}\\p{N}])`, "giu"), NAME);
    return t;
  }).join("\n");
}

/**
 * The coach card list (~/Reels/proof/coach-cards.json, or REEL_PROOF_LIST / --list): the only cards a proof reel
 * picks from by default. Each entry names a card inside the Cards folder, the build or fix behind it (the note the
 * script writer may use, nothing beyond it) and its proof event, so one reel never shows the same fix twice.
 */
export function loadList(file, { from, specs = null } = {}) {
  if (!file || !fs.existsSync(file)) return null;
  let j;
  try { j = readJSON(file); } catch { return null; }
  const root = from ? path.resolve(from) : null;
  const entries = (Array.isArray(j.cards) ? j.cards : []).filter((e) => e && (e.card || (e.id && Array.isArray(e.messages)))).map((e) => {
    const base = { context: String(e.context || "").trim(), client: String(e.client || ""), business: String(e.business || e.client || ""), pronoun: String(e.pronoun || "").trim() };
    if (!e.card) {
      // A text carried on the list itself (verified word for word from the Messages database, trims marked "…"):
      // the strong coach texts the card library never made a card for, or filed under a held folder by mistake.
      const rel = `${INLINE}${e.id}`;
      return { ...base, rel, file: rel, inline: true, spec: cleanSpec({ label: e.label || "Build feedback", messages: e.messages, redact: e.redact || [] }, { dropGreg: !!e.drop_greg }), event: String(e.event || rel) };
    }
    const rel = String(e.card).split(path.sep).join("/");
    const spec = specs?.get(rel) || null;
    return { ...base, rel, file: root ? path.join(root, rel) : null, spec: spec ? cleanSpec(spec, { dropGreg: !!e.drop_greg }) : null, event: String(e.event || rel) };
  });
  return { file, entries };
}

/**
 * The next unused cards from the list, in its order: one per proof event, a different client each time while the
 * list allows it, each with a spec (and, for a library card, its file on disk).
 */
export function pickFromList({ list, count = 3, ledger = { cards: {} } }) {
  const usable = list.entries.filter((e) => !ledger.cards[e.rel] && e.spec && (e.inline || (e.file && fs.existsSync(e.file) && !e.rel.split("/").some((part) => SKIP_DIRS.includes(part)))));
  const out = [], events = new Set(), clients = new Set();
  for (const pass of [true, false]) {
    for (const e of usable) {
      if (out.length >= count) break;
      if (out.includes(e) || events.has(e.event) || (pass && e.client && clients.has(e.client))) continue;
      out.push(e); events.add(e.event); if (e.client) clients.add(e.client);
    }
  }
  return list.entries.filter((e) => out.includes(e));
}

function cleanSpec(spec, { dropGreg = false } = {}) {
  const messages = spec.messages.filter((m) => !(dropGreg && m.who === "greg")).map((m) => ({ who: m.who === "greg" ? "greg" : "them", text: String(m.text || "") }));
  return { label: spec.label || "", messages, redact: spec.redact || [] };
}

/** The next unused cards, strongest folder first. Split cards (-p1/-p2) are long threads and stay out. */
export function pickCards({ from, count = 3, ledger = { cards: {} }, specs = null }) {
  const root = path.resolve(from);
  return walk(root)
    .filter((file) => !/-p\d+\.(png|jpe?g)$/i.test(file))
    .filter((file) => !ledger.cards[path.relative(root, file)])
    .filter((file) => !specs || specs.has(path.relative(root, file).split(path.sep).join("/")))
    .slice(0, count);
}

/** Least recently used photo of Greg (alone, real camera) from the proof photo folder. */
export function pickPhoto({ dir, ledger = { photos: {} } }) {
  const files = walk(path.resolve(dir)).filter((f) => !SKIP_DIRS.some((s) => f.includes(`${path.sep}${s}${path.sep}`)));
  if (!files.length) return null;
  return files.map((file) => ({ file, at: ledger.photos[path.basename(file)] || "" })).sort((a, b) => a.at.localeCompare(b.at) || a.file.localeCompare(b.file))[0].file;
}

async function ocr(file, deps = {}) {
  const bin = await (deps.ocrBinary || ocrBinary)();
  if (!bin) throw new Error("Apple Vision OCR is unavailable (reel proof needs macOS)");
  const { out } = await (deps.run || run)(bin, [file], { capture: true });
  return parseOcrJSON(out);
}

export async function readCards(files, deps = {}, { from = null, specs = null, list = null } = {}) {
  const cards = [];
  const notes = new Map((list?.entries || []).map((e) => [e.rel, e]));
  for (const file of files) {
    const rel = file.startsWith(INLINE) ? file : from ? path.relative(path.resolve(from), file).split(path.sep).join("/") : null;
    const listed = rel ? notes.get(rel) : null;
    const spec = listed?.spec || (rel && specs?.get(rel) ? cleanSpec(specs.get(rel)) : null);
    if (spec) { cards.push({ file, text: specText(spec), spec, ...(listed?.context ? { context: listed.context } : {}), ...(listed?.business ? { business: listed.business } : {}), ...(listed?.pronoun ? { pronoun: listed.pronoun } : {}) }); continue; }
    if (file.startsWith(INLINE)) throw new Error(`${file} is not on the coach list any more (its words live only there)`);
    const o = await ocr(file, deps);
    const text = o.lines.map((line) => line.text).join("\n").trim();
    cards.push({ file, text, ...(listed?.context ? { context: listed.context } : {}) });
  }
  return cards;
}

function isContiguous(needle, hay) {
  if (!needle.length) return false;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

function voiceProblems(text, where) {
  const s = String(text || "");
  const out = [];
  if (/[—–]| - |;/.test(s)) out.push(`${where} uses a dash or semicolon (Greg never writes them)`);
  if (/\byo\b/i.test(s)) out.push(`${where} says "Yo"`);
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) out.push(`${where} has an emoji`);
  for (const re of KILL) { const m = s.match(re); if (m) out.push(`${where} uses "${m[0]}" (Brand Guide v11 kill list)`); }
  for (const re of NOT_COACH) { const m = s.match(re); if (m) out.push(`${where} says "${m[0]}"; this reel is for coaches (never salespeople or reps, never AI)`); }
  for (const re of CLUMSY) { const m = s.match(re); if (m) out.push(`${where} says "${m[0]}"; that sounds clumsy, say it the way Greg would tell a peer`); }
  return out;
}

function nameProblems(text, where) {
  const out = [];
  const sentences = String(text || "").split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const ws = sentence.split(/\s+/).filter(Boolean);
    ws.slice(1).forEach((w) => {
      const clean = w.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, "");
      if (/^\p{Lu}/u.test(clean) && !NAME_OK.has(clean)) out.push(`${where} may name someone or something ("${clean}"); keep it anonymous`);
    });
  }
  return out;
}

/** Every rule a script has to pass before it is spoken: quotes word for word from their card, anonymous, Greg's voice. */
export function validateScript(script, cards) {
  const errors = [];
  if (!script || typeof script !== "object") return ["no script"];
  const hookWords = tokens(script.hook).length;
  if (!hookWords) errors.push("hook is empty");
  if (hookWords > LIMITS.hookWords) errors.push(`hook has ${hookWords} words (max ${LIMITS.hookWords})`);
  errors.push(...voiceProblems(script.hook, "hook"), ...nameProblems(script.hook, "hook"));
  const items = Array.isArray(script.items) ? script.items : [];
  if (items.length !== cards.length) errors.push(`script has ${items.length} items for ${cards.length} cards`);
  items.forEach((item, i) => {
    const n = i + 1, card = cards[Number(item.card) - 1] || cards[i];
    const setupWords = tokens(item.setup).length;
    if (!setupWords) errors.push(`item ${n}: setup is empty`);
    if (setupWords > LIMITS.setupWords) errors.push(`item ${n}: setup has ${setupWords} words (max ${LIMITS.setupWords})`);
    errors.push(...voiceProblems(item.setup, `item ${n} setup`), ...nameProblems(item.setup, `item ${n} setup`));
    const q = tokens(item.quote);
    if (q.length < LIMITS.quoteMin || q.length > LIMITS.quoteMax) errors.push(`item ${n}: quote has ${q.length} words (${LIMITS.quoteMin} to ${LIMITS.quoteMax})`);
    // A covered name breaks the card into stretches: a quote never runs over one (it would be spoken out loud).
    const cardTokens = card ? tokens(card.text.split(NAME).join(" qqcoveredqq ")) : [];
    if (!card || !isContiguous(q, cardTokens)) errors.push(isContiguous(q, tokens(card?.text || "")) || /\[name\]/i.test(String(item.quote || ""))
      ? `item ${n}: quote runs over a covered name; quote a stretch without [name]`
      : `item ${n}: quote is not copied word for word from card ${n}`);
    if (/[$€£]|\b\d{2,}k\b/i.test(String(item.quote || "")) && !/[$€£]/.test(card?.text || "")) errors.push(`item ${n}: quote adds a money amount`);
  });
  if (!String(script.close || "").trim()) errors.push("close is empty");
  errors.push(...voiceProblems(script.close, "close"));
  return errors;
}

export function scriptPrompt(cards, { close = DEFAULT_CLOSE, errors = [] } = {}) {
  return [
    "Write a short narrated Instagram reel for coaches. Greg Pingel reads it in his own voice. Greg builds the sales system under the offer a coach already has: closer and setter scripts, lead flow, follow up, booking and show up, nurture and the CRM. On screen are real texts that coaches and coaching clients sent him after a build or a fix; names are covered.",
    "Who it must stop: coaches whose offer already sells and who are still on every sales call. It is a Proof reel under Greg's Brand Guide v11: each text is one real build or fix, named for what it is. It asks for nothing.",
    "Return JSON only, no prose: {\"hook\": \"...\", \"items\": [{\"card\": 1, \"setup\": \"...\", \"quote\": \"...\"}], \"close\": \"...\"}",
    "Rules:",
    `- hook: at most ${LIMITS.hookWords} words, said first. Open on the coach's situation, never on a result or a brag, the way \"Your coaching offer sells. Every sales call still needs you.\" does. Write a new one that fits these texts. Plain words, no question bait.`,
    `- One item per card, in the order given. setup: at most ${LIMITS.setupWords} words, one or two short sentences Greg says out loud the way he tells a peer what happened on a call: professional, plain, confident. Start from their situation or from what was done, in his words (we or I): \"She'd [their situation]. We [what we did].\", \"We [what we did]. [What happened next].\" Every fact in a setup is in that card's note: no needs, motives, steps or timing the note does not say. Refer to the sender only as that card's sender line says (she, he or they); never \"I coached a coach\", never the word coach twice in one line, and never \"a coaching client\" in more than one setup. Never a name, niche, offer, keyword, tool, platform or place. The verb matches the note: built, fixed, set up, ran, worked on, checked. Never grew, doubled or scaled.`,
    `- quote: copied word for word from that card's text, one continuous stretch of ${LIMITS.quoteMin} to ${LIMITS.quoteMax} words. Pick the stretch that shows the build working or how it landed. A short card can be quoted whole. Never change, add, drop or reorder words inside a quote.`,
    "- The hook and every setup add no fact that the card notes and texts do not show: no results, numbers, timelines, times of day or \"unprompted\" beyond them.",
    "- Vary the setups: no two start with the same words, and they read as one story from the first card to the last.",
    "- No names of people, companies, places or programs anywhere. No money amounts or income claims anywhere.",
    "- [name] in a card marks a name that is covered on screen. A quote never includes [name] or runs across it.",
    "- This reel is for coaches: never the words salespeople, salesperson, sales reps or reps, and never AI.",
    "- Sound like Greg talking: a peer, not a professor. Short, direct, plain. Never dashes of any kind, semicolons, emojis or the word \"Yo\". Never: unlock, game changer, elevate, leverage, 10x, grind, hack, autopilot, effortless, done for you, transform, journey, A to Z, runs without you, never misses, 3 to 5x.",
    `- close: exactly ${JSON.stringify(close)}`,
    ...(errors.length ? ["", "Your last attempt broke these rules; fix every one:", ...errors.map((e) => `- ${e}`)] : []),
    "",
    ...cards.flatMap((card, i) => [`Card ${i + 1} note (what was built or fixed): ${card.context || "none on file; say only that a coaching client sent it"}`, `Card ${i + 1} sender: ${card.pronoun || "they"}`, `Card ${i + 1} text:`, card.text, ""]),
  ].join("\n");
}

export async function writeScript(cards, { close = DEFAULT_CLOSE, attempts = 3, deps = {} } = {}) {
  let errors = [], script = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const reply = await (deps.claudeText || claudeText)(scriptPrompt(cards, { close, errors }), { timeoutMs: 180000 });
    try { script = firstJSON(reply); } catch { errors = ["the reply was not JSON"]; continue; }
    script.close = close;
    script.items = (script.items || []).map((item, i) => ({ card: i + 1, setup: String(item.setup || "").trim(), quote: String(item.quote || "").trim() }));
    errors = validateScript(script, cards);
    if (!errors.length) return script;
    log(`proof: script attempt ${attempt} broke ${errors.length} rule${errors.length === 1 ? "" : "s"}: ${errors.join("; ")}`);
  }
  throw new Error(`proof: no script passed the rules after ${attempts} tries: ${errors.join("; ")}`);
}

/** The spoken lines in order with the pause after each. */
export function narrationLines(script) {
  return [
    { kind: "hook", text: script.hook, gap: GAPS.hook },
    ...script.items.flatMap((item, i) => [
      { kind: "setup", item: i + 1, text: item.setup, gap: GAPS.setup },
      { kind: "quote", item: i + 1, text: item.quote, gap: GAPS.quote },
    ]),
    { kind: "close", text: script.close, gap: GAPS.close },
  ];
}

/** Start time of each line once they are joined with their pauses (lead-in silence first). */
export function lineTimes(lines, durations) {
  let t = GAPS.lead;
  return lines.map((line, i) => { const start = r3(t); t += durations[i] + line.gap; return { ...line, start, duration: r3(durations[i]) }; });
}

async function durationOf(file, deps) {
  if (deps.probe) return (await deps.probe(file)).duration;
  const { out } = await (deps.run || run)("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { capture: true });
  const d = Number(String(out).trim());
  if (!(d > 0)) throw new Error(`no audio length for ${file}`);
  return d;
}

/**
 * The narration: each line spoken in the clone (one seed for every line), trimmed, laid out with its pause and
 * loudness-matched. Then it is heard back (Greg 2026-11-25: "we need to make sure the voice is right to the
 * captions"): the whole track is transcribed and lined up with the script, and every line where the voice dropped,
 * swapped or added a real word is re-recorded with another take, up to `tries` rounds. A line still wrong after that
 * stops the run with what was heard, so a reel never shows words the voice did not say.
 */
export async function renderNarration(script, { voice, dir, deps = {}, check = true, tries = 3, env = process.env } = {}) {
  const lines = narrationLines(script);
  const parts = ensureDir(path.join(dir, "voice"));
  const files = [], durations = [];
  const base = Number(env.REEL_VOICE_SEED);
  const seeds = lines.map(() => (Number.isFinite(base) ? base : DEFAULT_SEED));
  const take = async (i) => {
    const raw = path.join(parts, `${String(i + 1).padStart(2, "0")}-${lines[i].kind}.wav`);
    // The lines either side go along so an ElevenLabs take keeps the flow of the whole read (VoiceStudio ignores them).
    await (deps.speak || speak)({ text: lines[i].text, voice, out: raw, seed: seeds[i], env, previousText: lines[i - 1]?.text || "", nextText: lines[i + 1]?.text || "" });
    const clean = raw.replace(/\.wav$/, "-48k.wav");
    await (deps.run || run)("ffmpeg", ["-y", "-v", "error", "-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse", "-ac", "1", "-ar", "48000", clean], { capture: true });
    files[i] = clean;
    durations[i] = await durationOf(clean, deps);
  };
  const out = path.join(dir, "narration.wav");
  const mixAll = async () => {
    const timed = lineTimes(lines, durations);
    const total = r3(timed.at(-1).start + timed.at(-1).duration + timed.at(-1).gap);
    const inputs = files.flatMap((f) => ["-i", f]);
    const delays = timed.map((line, i) => `[${i}:a]adelay=${Math.round(line.start * 1000)}:all=1[a${i}]`).join(";");
    const mix = `${delays};${timed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timed.length}:normalize=0,apad=whole_dur=${total},atrim=0:${total},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
    await (deps.run || run)("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", mix, "-map", "[out]", "-ac", "1", "-ar", "48000", out], { capture: true });
    return { timed, total };
  };
  for (let i = 0; i < lines.length; i++) await take(i);
  let { timed, total } = await mixAll();
  let heardBack = null;
  if (check) {
    const transcribeImpl = deps.transcribe || (async (file, o) => (await import("./transcribe.mjs")).transcribe(file, { engine: "faster-whisper", watch: true, timeoutMs: 300000, ...o }));
    for (let round = 1; round <= tries; round++) {
      const heard = await transcribeImpl(out, { out: path.join(dir, `heard-${round}.json`) });
      const result = checkLines(timed, heard);
      heardBack = { round, lines: result.map((r, i) => ({ ...r, seed: seeds[i] })) };
      writeJSON(path.join(dir, "voicecheck.json"), heardBack);
      const bad = result.map((r, i) => (r.ok ? -1 : i)).filter((i) => i >= 0);
      if (!bad.length) { log(`proof: voice check ok (round ${round}, every word as written)`); break; }
      log(`proof: voice check round ${round}: ${bad.map((i) => `${lines[i].kind} "${lines[i].text.slice(0, 40)}" ${result[i].problems.join(", ")}`).join("; ")}`);
      if (round === tries) throw new Error(`proof: the voice still does not say the script after ${tries} takes: ${bad.map((i) => `${lines[i].kind} "${lines[i].text}" (${result[i].problems.join(", ")})`).join("; ")}. Reword that line or pass --no-voice-check after listening to it.`);
      for (const i of bad) { seeds[i] += 101 * round; await take(i); }
      ({ timed, total } = await mixAll());
    }
  }
  writeJSON(path.join(dir, "narration.json"), { voice, total, lines: timed.map((line, i) => ({ ...line, seed: seeds[i] })), ...(heardBack ? { voiceCheck: { ok: heardBack.lines.every((l) => l.ok), round: heardBack.round } } : {}) });
  return { file: out, total, lines: timed };
}

/**
 * The crop of a photo for a 9:16 frame: centred on the largest face, the face about 12% of the frame wide and a
 * little above the middle (room for the hook over the head, captions under the chin), kept inside the photo.
 */
export function photoCrop({ width, height, face = null, faceShare = 0.12 }) {
  const aspect = 9 / 16;
  let h = height, w = Math.round(h * aspect);
  if (w > width) { w = width; h = Math.round(w / aspect); }
  if (face) {
    const want = Math.round((face.w * width) / faceShare / aspect);
    if (want < h) { h = Math.max(Math.round(height * 0.5), want); w = Math.round(h * aspect); }
  }
  const cx = face ? (face.x + face.w / 2) * width : width / 2;
  const cy = face ? (face.y + face.h / 2) * height : height / 2;
  const x = Math.round(Math.min(Math.max(cx - w / 2, 0), width - w));
  const y = Math.round(Math.min(Math.max(cy - h * 0.42, 0), height - h));
  const fx = face ? Math.min(Math.max((cx - x) / w, 0), 1) : 0.5;
  const fy = face ? Math.min(Math.max((cy - y) / h, 0), 1) : 0.4;
  return { x, y, w: w - (w % 2), h: h - (h % 2), fx: r3(fx), fy: r3(fy) };
}

/** A push toward Greg's face on the photo, with the narration as the only sound. */
export async function makeFootage({ photo, narration, total, out, deps = {} }) {
  const o = await ocr(photo, deps);
  const face = (o.faces || []).slice().sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0]?.box || null;
  const c = photoCrop({ width: o.width, height: o.height, face });
  const frames = Math.max(1, Math.round(total * 30));
  const vf = [
    `crop=${c.w}:${c.h}:${c.x}:${c.y}`,
    "scale=2160:3840:flags=lanczos",
    // A 10% settle-in over the first ~2 s (the preflight wants the open to move), then a slow 4% drift.
    `zoompan=z='1+0.10*(1-exp(-on/36))+0.04*on/${frames}':x='${c.fx}*(iw-iw/zoom)':y='${c.fy}*(ih-ih/zoom)':d=1:s=1080x1920:fps=30`,
    "format=yuv420p",
  ].join(",");
  await (deps.run || run)("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-framerate", "30", "-i", photo, "-i", narration, "-vf", vf,
    "-t", String(total), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", out], { capture: true });
  return { file: out, crop: c, face };
}

const safeName = (s) => String(s || "").replace(/\*/g, "").replace(/[/:"*<>|\\#]/g, "").replace(/\s+/g, " ").trim();

/** File names the drop-folder watcher understands: hook after "__", #aivoice + #proof, cards paired as "<stem> proof N - label". */
export function dropNames({ stem, hook, count, label = CARD_LABEL }) {
  const clip = `${stem}__${safeName(hook).replace(/[?!.]+$/, "")} #aivoice #proof.mp4`;
  const cards = Array.from({ length: count }, (_, i) => `${stem} proof ${i + 1} - ${safeName(label)}.png`);
  return { clip, cards };
}

/**
 * The card as a PNG trimmed to its message panel (cropdetect, 16 px kept; the @handle strip at the bottom left out),
 * so the text is as big as the space above the captions allows. A card with nothing to trim is copied as it is.
 */
async function toPng(src, dst, deps) {
  const runImpl = deps.run || run;
  // The bottom strip holds the card's @handle; leaving it out of the measure lets the crop hug the message panel.
  const { err = "" } = await runImpl("ffmpeg", ["-hide_banner", "-loop", "1", "-i", src, "-t", "0.2", "-vf", "crop=iw:ih-110:0:0,cropdetect=limit=0.1:round=2:reset=0", "-f", "null", "-"], { capture: true, allowFail: true });
  const m = [...String(err).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
  if (m) {
    const [w, h, x, y] = m.slice(1).map(Number);
    const crop = `crop='min(${w + 32},iw)':'min(${h + 32},ih)':'max(${x - 16},0)':'max(${y - 16},0)'`;
    await runImpl("ffmpeg", ["-y", "-v", "error", "-i", src, "-vf", crop, "-frames:v", "1", dst], { capture: true });
    if (fs.existsSync(dst)) return;
  }
  if (/\.png$/i.test(src)) return fs.copyFileSync(src, dst);
  await runImpl("sips", ["-s", "format", "png", src, "--out", dst], { capture: true });
}

/** What the editor needs to draw the receipts look: the script, each text exactly as sent with its covered names, the wall. */
export function proofData({ stem, script, cards, specs, list = null, label = CARD_LABEL }) {
  return {
    version: 1,
    name: stem,
    label,
    hook: script.hook,
    close: script.close,
    // The note behind each text and its business go along for the caption writer (scripts/write-caption.mjs).
    items: script.items.map((item, i) => ({ setup: item.setup, quote: item.quote, messages: cards[i].spec.messages, redact: cards[i].spec.redact, ...(cards[i].context ? { context: cards[i].context } : {}), ...(cards[i].business ? { business: cards[i].business } : {}) })),
    // The wall behind the hook and the closer: the coach list's texts when there is one (never sales reps' texts).
    wall: list?.entries?.some((e) => e.spec) ? list.entries.filter((e) => e.spec).map((e) => e.spec) : wallSpecs(specs),
  };
}

export async function runProof(opts = {}, deps = {}) {
  const env = deps.env || process.env;
  const voice = opts.voice || env.REEL_PROOF_VOICE || "vs:Greg";
  parseVoice(voice);
  const root = ensureDir(proofHome(env));
  const ledgerFile = opts.ledger || path.join(root, "used.json");
  const ledger = readLedger(ledgerFile);
  const from = opts.from || env.REEL_PROOF_CARDS;
  const specs = opts.noSpecs ? null : loadSpecs(specsFile({ from, specs: opts.specs, env }));
  const listFile = path.resolve(opts.list || env.REEL_PROOF_LIST || path.join(root, "coach-cards.json"));
  const list = specs ? loadList(listFile, { from, specs }) : null;
  const resolveCard = (f) => (String(f).startsWith(INLINE) ? String(f) : path.resolve(f));
  let files = (opts.cards || []).map(resolveCard);
  let script = opts.script ? readJSON(path.resolve(opts.script)) : null;
  if (script?.cards?.length) files = script.cards.map(resolveCard);
  if (!files.length) {
    if (!from) throw new Error("no cards: pass card images, --from <folder of cards> or set REEL_PROOF_CARDS");
    if (opts.from || !list) {
      // A folder named on the command line (or no coach list): the folder's next unused cards.
      if (!opts.from && !list) throw new Error(`no coach card list at ${listFile}: proof reels pick only from that list (or pass --from <folder> to pick from a folder)`);
      files = pickCards({ from, count: Number(opts.count) || 3, ledger, specs });
      if (!files.length) throw new Error(`no unused cards left in ${from}`);
    } else {
      files = pickFromList({ list, count: Number(opts.count) || 3, ledger }).map((e) => e.file);
      if (!files.length) throw new Error(`no unused cards left on the coach list (${listFile}); add texts to it`);
    }
  }
  for (const f of files) if (!f.startsWith(INLINE) && !fs.existsSync(f)) throw new Error(`card not found: ${f}`);
  const day = (deps.now || (() => new Date()))().toISOString().slice(0, 10);
  const n = ledger.reels.filter((r) => r.day === day).length + 1;
  const stem = opts.name || `proof-${day}-${n}`;
  const dir = ensureDir(path.join(root, stem));
  const cards = await readCards(files, deps, { from, specs, list });
  // Every card known to the library: the editor draws the receipts look (texts full screen, no photo on screen).
  const receipts = cards.length > 0 && cards.every((c) => c.spec);
  writeJSON(path.join(dir, "cards.json"), cards);
  if (script) {
    const errors = validateScript(script, cards);
    if (errors.length) throw new Error(`proof: the supplied script breaks the rules: ${errors.join("; ")}`);
  } else {
    script = await writeScript(cards, { close: opts.close || DEFAULT_CLOSE, deps });
  }
  script = { ...script, cards: files };
  writeJSON(path.join(dir, "script.json"), script);
  log(`proof: script in ${path.join(dir, "script.json")}`);
  if (opts.dryRun) return { dir, script, stem };

  const photo = opts.photo ? path.resolve(opts.photo) : pickPhoto({ dir: opts.photos || env.REEL_PROOF_PHOTOS || path.join(root, "photos"), ledger });
  if (!photo || !fs.existsSync(photo)) throw new Error("no photo of Greg: pass --photo, --photos <folder> or put photos in ~/Reels/proof/photos");
  const narration = await renderNarration(script, { voice, dir, deps, env, check: !opts.noVoiceCheck });
  const names = dropNames({ stem, hook: script.hook, count: receipts ? 0 : files.length, label: opts.label || CARD_LABEL });
  if (receipts) {
    writeJSON(path.join(dir, "proof.json"), proofData({ stem, script, cards, specs, list, label: opts.label || CARD_LABEL }));
    log(`proof: receipts look (${path.join(dir, "proof.json")})`);
  }
  const footage = await makeFootage({ photo, narration: narration.file, total: narration.total, out: path.join(dir, names.clip), deps });
  log(`proof: ${narration.total}s narration over ${path.basename(photo)}`);

  let dropped = null;
  if (!opts.noDrop) {
    const drop = path.resolve(opts.drop || env.REEL_PROOF_DROP || path.join(home(env), "Reels", "raw"));
    ensureDir(drop);
    // Cards first: the watcher pairs them when it picks the clip up (the receipts look reads proof.json instead).
    for (let i = 0; i < names.cards.length; i++) await toPng(files[i], path.join(drop, names.cards[i]), deps);
    const tmp = path.join(drop, `.${names.clip}.part`);
    fs.copyFileSync(footage.file, tmp);
    fs.renameSync(tmp, path.join(drop, names.clip));
    dropped = path.join(drop, names.clip);
    log(`proof: dropped ${names.clip}${names.cards.length ? ` with ${names.cards.length} card${names.cards.length === 1 ? "" : "s"}` : ""} in ${drop}`);
  }
  const at = (deps.now || (() => new Date()))().toISOString();
  for (const f of files) {
    const rel = f.startsWith(INLINE) ? f : from ? path.relative(path.resolve(from), f) : "..";
    if (!rel.startsWith("..")) ledger.cards[rel] = { at, reel: stem };
  }
  ledger.photos[path.basename(photo)] = at;
  ledger.reels.push({ day, stem, at, hook: script.hook, cards: files, photo, dropped });
  writeJSON(ledgerFile, ledger);
  return { dir, script, stem, footage: footage.file, dropped, narration, receipts };
}

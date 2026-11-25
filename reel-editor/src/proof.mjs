// reel proof: a narrated proof reel with no filming. Greg's cloned voice (VoiceStudio, src/voicestudio.mjs) reads
// real client texts. The narration goes over a slow push on a real photo of Greg (it carries the voice and makes the
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
import { parseVoice, speak } from "./voicestudio.mjs";
import { ensureDir, log, r3, readJSON, run, writeJSON } from "./util.mjs";

const IMAGE = /\.(png|jpe?g)$/i;
// Folders a card is never picked from: criticism Greg set aside, money screenshots, texts still waiting on a check.
export const SKIP_DIRS = Object.freeze(["not-using", "with-dollar-amounts", "check-flags"]);
// Greg's approved closer for proof posts (2026-11-15). Never "shared with permission".
export const DEFAULT_CLOSE = "These aren't my wins. They're theirs. I gave them the plays. They put in the reps.";
export const CARD_LABEL = "Real text";
export const GAPS = Object.freeze({ hook: 0.45, setup: 0.3, quote: 0.65, close: 0.8, lead: 0.15 });
const LIMITS = { hookWords: 12, setupWords: 16, quoteMin: 4, quoteMax: 24 };
const NAME_OK = new Set(["I", "I'm", "I've", "I'd", "I'll", "Greg"]);

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
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A card's words as the script writer sees them: every covered name is "[name]". */
export function specText(spec) {
  return spec.messages.map((m) => {
    let t = String(m.text || "").trim();
    for (const w of [...(spec.redact || [])].filter(Boolean).sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escRe(w)}(?![\\p{L}\\p{N}])`, "giu"), NAME);
    return t;
  }).join("\n");
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

export async function readCards(files, deps = {}, { from = null, specs = null } = {}) {
  const cards = [];
  for (const file of files) {
    const rel = from ? path.relative(path.resolve(from), file).split(path.sep).join("/") : null;
    const spec = rel && specs ? specs.get(rel) : null;
    if (spec) { cards.push({ file, text: specText(spec), spec: { label: spec.label || "", messages: spec.messages.map((m) => ({ who: m.who === "greg" ? "greg" : "them", text: String(m.text || "") })), redact: spec.redact || [] } }); continue; }
    const o = await ocr(file, deps);
    const text = o.lines.map((line) => line.text).join("\n").trim();
    cards.push({ file, text });
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
    "Write a short narrated Instagram reel. Greg Pingel, a sales coach, reads it in his own voice. On screen are real text messages that salespeople and clients sent him; names are already covered.",
    "Return JSON only, no prose: {\"hook\": \"...\", \"items\": [{\"card\": 1, \"setup\": \"...\", \"quote\": \"...\"}], \"close\": \"...\"}",
    "Rules:",
    `- hook: at most ${LIMITS.hookWords} words, said first, makes a salesperson stop scrolling. Plain words, no question bait.`,
    `- One item per card, in the order given. setup: at most ${LIMITS.setupWords} words, says who sent it with no name, company, dealership, city or program, for example "A rep I coach sent me this after week one." quote: copied word for word from that card's text, one continuous stretch of ${LIMITS.quoteMin} to ${LIMITS.quoteMax} words. Pick the strongest stretch on the card: a concrete result, a number that moved, or how it changed them. Skip thank yous, plans to meet up and small talk when the card has something stronger. Never change, add, drop or reorder words inside a quote.`,
    "- The hook and every setup add no fact the cards do not show: no records, timelines, times of day, \"unprompted\", amounts or results that are not written on them.",
    "- Vary the setups: no two start with the same words, and they read as one story from the first card to the last.",
    "- No names of people, companies, places or programs anywhere. No money amounts or income claims outside a quote.",
    "- [name] in a card marks a name that is covered on screen. A quote never includes [name] or runs across it.",
    "- Sound like Greg talking: short, direct, plain, warm. Never use dashes of any kind, semicolons, emojis or the word \"Yo\". No hype words such as game changer, unlock, level up, crush.",
    `- close: exactly ${JSON.stringify(close)}`,
    ...(errors.length ? ["", "Your last attempt broke these rules; fix every one:", ...errors.map((e) => `- ${e}`)] : []),
    "",
    ...cards.flatMap((card, i) => [`Card ${i + 1} text:`, card.text, ""]),
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

export async function renderNarration(script, { voice, dir, deps = {} }) {
  const lines = narrationLines(script);
  const parts = ensureDir(path.join(dir, "voice"));
  const files = [], durations = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = path.join(parts, `${String(i + 1).padStart(2, "0")}-${lines[i].kind}.wav`);
    await (deps.speak || speak)({ text: lines[i].text, voice, out: raw });
    const clean = raw.replace(/\.wav$/, "-48k.wav");
    await (deps.run || run)("ffmpeg", ["-y", "-v", "error", "-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse", "-ac", "1", "-ar", "48000", clean], { capture: true });
    files.push(clean);
    durations.push(await durationOf(clean, deps));
  }
  const timed = lineTimes(lines, durations);
  const total = r3(timed.at(-1).start + timed.at(-1).duration + timed.at(-1).gap);
  const inputs = files.flatMap((f) => ["-i", f]);
  const delays = timed.map((line, i) => `[${i}:a]adelay=${Math.round(line.start * 1000)}:all=1[a${i}]`).join(";");
  const mix = `${delays};${timed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timed.length}:normalize=0,apad=whole_dur=${total},atrim=0:${total},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  const out = path.join(dir, "narration.wav");
  await (deps.run || run)("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", mix, "-map", "[out]", "-ac", "1", "-ar", "48000", out], { capture: true });
  writeJSON(path.join(dir, "narration.json"), { voice, total, lines: timed });
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
export function proofData({ stem, script, cards, specs, label = CARD_LABEL }) {
  return {
    version: 1,
    name: stem,
    label,
    hook: script.hook,
    close: script.close,
    items: script.items.map((item, i) => ({ setup: item.setup, quote: item.quote, messages: cards[i].spec.messages, redact: cards[i].spec.redact })),
    wall: wallSpecs(specs),
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
  let files = (opts.cards || []).map((f) => path.resolve(f));
  let script = opts.script ? readJSON(path.resolve(opts.script)) : null;
  if (script?.cards?.length) files = script.cards.map((f) => path.resolve(f));
  if (!files.length) {
    if (!from) throw new Error("no cards: pass card images, --from <folder of cards> or set REEL_PROOF_CARDS");
    files = pickCards({ from, count: Number(opts.count) || 3, ledger, specs });
    if (!files.length) throw new Error(`no unused cards left in ${from}`);
  }
  for (const f of files) if (!fs.existsSync(f)) throw new Error(`card not found: ${f}`);
  const day = (deps.now || (() => new Date()))().toISOString().slice(0, 10);
  const n = ledger.reels.filter((r) => r.day === day).length + 1;
  const stem = opts.name || `proof-${day}-${n}`;
  const dir = ensureDir(path.join(root, stem));
  const cards = await readCards(files, deps, { from, specs });
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
  const narration = await renderNarration(script, { voice, dir, deps });
  const names = dropNames({ stem, hook: script.hook, count: receipts ? 0 : files.length, label: opts.label || CARD_LABEL });
  if (receipts) {
    writeJSON(path.join(dir, "proof.json"), proofData({ stem, script, cards, specs, label: opts.label || CARD_LABEL }));
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
  if (from) for (const f of files) { const rel = path.relative(path.resolve(from), f); if (!rel.startsWith("..")) ledger.cards[rel] = { at, reel: stem }; }
  ledger.photos[path.basename(photo)] = at;
  ledger.reels.push({ day, stem, at, hook: script.hook, cards: files, photo, dropped });
  writeJSON(ledgerFile, ledger);
  return { dir, script, stem, footage: footage.file, dropped, narration, receipts };
}

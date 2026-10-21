import fs from "node:fs";
import path from "node:path";
import { run, writeJSON, r3, PKG_ROOT } from "./util.mjs";

const PY_SCRIPT = path.join(PKG_ROOT, "scripts", "transcribe_words.py");

const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9&$%']/g, "");

/** Accept the common word-timestamp shapes and return [{text,start,end}]. */
export function normalizeWords(obj) {
  let arr = null;
  if (Array.isArray(obj)) arr = obj;
  else if (Array.isArray(obj?.words)) arr = obj.words;
  else if (Array.isArray(obj?.transcript)) arr = obj.transcript;
  else if (Array.isArray(obj?.segments)) arr = obj.segments.flatMap((s) => s.words || []);
  else if (Array.isArray(obj?.result?.words)) arr = obj.result.words;
  if (!arr) throw new Error("unrecognized transcript shape (want [{text,start,end}] or {words:[...]})");
  return arr
    .filter((w) => (w.type ? w.type === "word" : true))
    .map((w) => {
      const out = { text: String(w.text ?? w.word ?? "").trim(), start: +w.start, end: +w.end };
      const p = w.prob ?? w.probability ?? (w.logprob != null ? Math.exp(+w.logprob) : null);
      if (p != null && Number.isFinite(+p)) out.prob = Math.round(+p * 1000) / 1000;
      return out;
    })
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
}

function parseSrtTime(s) {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return NaN;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

/** Cue-level SRT/VTT → words spread evenly inside each cue. Good enough for captions, rough for cuts. */
export function parseSrt(text) {
  const words = [];
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split("\n").filter(Boolean);
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, c] = lines[ti].split("-->");
    const start = parseSrtTime(a);
    const end = parseSrtTime(c);
    const toks = lines.slice(ti + 1).join(" ").replace(/<[^>]+>/g, "").split(/\s+/).filter(Boolean);
    if (!toks.length || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const step = (end - start) / toks.length;
    toks.forEach((t, i) => words.push({ text: t, start: r3(start + i * step), end: r3(start + (i + 1) * step) }));
  }
  return words;
}

export function importTranscript(file) {
  const raw = fs.readFileSync(file, "utf8");
  if (/\.(srt|vtt)$/i.test(file)) return parseSrt(raw);
  return normalizeWords(JSON.parse(raw));
}

/** Phrase corrections from the dictionary: {from:"ghost p and l", to:"Ghost P&L"}; timings are preserved/split. */
export function applyCorrections(words, corrections = []) {
  const rules = corrections
    .map((c) => ({ from: c.from.toLowerCase().split(/\s+/).map(norm), to: c.to.split(/\s+/) }))
    .filter((r) => r.from.length && r.to.length)
    .sort((a, b) => b.from.length - a.from.length);
  if (!rules.length) return words;
  const out = [];
  let i = 0;
  while (i < words.length) {
    let hit = null;
    for (const r of rules) {
      const k = r.from.length;
      if (i + k > words.length) continue;
      let ok = true;
      for (let j = 0; j < k; j++) if (norm(words[i + j].text) !== r.from[j]) { ok = false; break; }
      if (ok) { hit = r; break; }
    }
    if (!hit) { out.push(words[i]); i++; continue; }
    const k = hit.from.length;
    const s = words[i].start;
    const e = words[i + k - 1].end;
    const tail = (words[i + k - 1].text.match(/[.,!?;:]+$/) || [""])[0];
    const n = hit.to.length;
    hit.to.forEach((t, j) =>
      out.push({ ...words[i], text: t + (j === n - 1 ? tail : ""), start: r3(s + ((e - s) * j) / n), end: r3(s + ((e - s) * (j + 1)) / n) }),
    );
    i += k;
  }
  return out;
}

/**
 * Transcribe to word timestamps.
 * engine: faster-whisper (local python, default) | elevenlabs (Scribe API) | hyperframes (whisper.cpp via the CLI)
 */
export async function transcribe(input, { engine = "auto", model = "large-v3-turbo", language = "en", prompt = "", out, hyperframesBin } = {}) {
  const { resolveEngine } = await import("./review.mjs");
  const wanted = engine;
  engine = resolveEngine(engine);
  if (wanted === "auto" && engine === "elevenlabs") {
    try {
      return await transcribe(input, { engine: "elevenlabs", model, language, prompt, out, hyperframesBin });
    } catch (e) {
      console.warn(`[reel] warning: ElevenLabs Scribe failed (${String(e.message).split("\n")[0]}); using local Whisper`);
      engine = "faster-whisper";
    }
  }
  let words;
  if (engine === "faster-whisper") {
    const python = process.env.REEL_PYTHON || "python3";
    await run(python, [PY_SCRIPT, input, "-o", out, "--model", model, "--lang", language, "--prompt", prompt]);
    words = normalizeWords(JSON.parse(fs.readFileSync(out, "utf8")));
  } else if (engine === "elevenlabs") {
    const { scribe } = await import("./elevenlabs.mjs");
    words = await scribe(input, { language });
  } else if (engine === "hyperframes") {
    const bin = hyperframesBin || ["npx", "hyperframes"];
    const m = model.includes(".") || model.startsWith("large") ? model : `${model}.en`;
    const { out: o } = await run(bin[0], [...bin.slice(1), "transcribe", input, "-d", path.dirname(out), "--json", "--model", m], { capture: true });
    const start = o.indexOf("{") >= 0 ? Math.min(...[o.indexOf("{"), o.indexOf("[")].filter((x) => x >= 0)) : -1;
    if (start < 0) throw new Error("hyperframes transcribe returned no JSON");
    words = normalizeWords(JSON.parse(o.slice(start)));
  } else {
    throw new Error(`unknown transcription engine: ${engine}`);
  }
  if (out) writeJSON(out, { engine, model, words });
  return words;
}

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { checkRunwayVideo } from "../src/broll-runway.mjs";
import { DEFECT_QUESTIONS, eventInPoint } from "../src/broll-qc.mjs";
import { ensureDir, readJSON, writeJSON, run, log, warn } from "../src/util.mjs";

export function qcEvalOptions(args) {
  const { values } = parseArgs({ args, options: { manifest: { type: "string" }, out: { type: "string" } } });
  if (!values.manifest) throw new Error("Use --manifest <file> [--out <dir>]");
  return { manifest: path.resolve(values.manifest), out: path.resolve(values.out || "broll-qc-eval") };
}

export function qcEvalTable(results) {
  const answers = (r) => ["source", "selected", "pinned"].filter((stage) => r[stage]).map((stage) => {
    const checks = r[stage].checks;
    return `${stage}: ${Object.keys(DEFECT_QUESTIONS).map((key) => {
      const answer = checks?.[key];
      return `${key}=${!answer ? "unchecked" : answer.yes ? `YES at ${answer.time}s (${answer.why})` : "no"}`;
    }).join(", ")}`;
  }).join("; ").replace(/\s+/g, " ");
  const rows = [["file", "expected", "got", "defect answers", "check reasons"], ...results.map((r) => [r.file, r.expected, r.got, answers(r), r.why.replace(/\s+/g, " ")])];
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((row) => row[i].length)));
  return rows.map((row) => row.map((value, i) => i < 3 ? value.padEnd(widths[i]) : value).join(" | ")).join("\n");
}

/** Exercise the production check and actual used pixels, keeping human labels out of its prompts. */
export async function runQcEval(options, deps = {}) {
  const manifest = path.resolve(options.manifest), out = path.resolve(options.out || "broll-qc-eval");
  const entries = readJSON(manifest), runner = deps.runFn || run, print = deps.log || log;
  if (!Array.isArray(entries) || !entries.length || entries.some((e) => !e || !["file", "shows", "words", "action"].every((key) => typeof e[key] === "string" && e[key].trim()) || !["pass", "fail", "pass-late"].includes(e.expect) || e.duration !== undefined && !(Number.isFinite(e.duration) && e.duration > 0))) throw new Error("Manifest needs a nonempty array of file, expect (pass|fail|pass-late), shows, action and words; optional duration must be positive");
  ensureDir(out);
  const results = [];
  for (const [i, entry] of entries.entries()) {
    const file = path.resolve(path.dirname(manifest), entry.file);
    // The CLI can see cwd: keep good/bad labels and subject names out of evidence directory names.
    const name = `clip-${String(i + 1).padStart(2, "0")}`;
    const dir = ensureDir(path.join(out, name)), pick = { shows: entry.shows, action: entry.action, words: entry.words, kind: "action" };
    const duration = entry.duration ?? 1.6;
    const groups = [{ start: 0, end: duration, text: entry.words }];
    let source, selected, pinned, inPoint = null;
    try {
      const probe = await runner("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { capture: true });
      const clipDuration = Number(probe.out?.trim());
      if (!(clipDuration > 0)) throw new Error("clip duration unavailable");
      source = await checkRunwayVideo({ file, shot: { start: 0, duration: clipDuration }, pick, groups, dir, selecting: true, deps });
      const usedDuration = Math.min(duration, clipDuration);
      const review = async (start, mode) => {
        const used = path.join(dir, `${mode}.mp4`);
        await runner("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(start), "-i", file, "-t", String(usedDuration), "-an", "-c:v", "libx264", "-crf", "18", used], { quiet: true });
        return checkRunwayVideo({ file: used, shot: { start: 0, duration: usedDuration }, pick, groups, inPoint: start, dir, deps });
      };
      if (source.ok) {
        inPoint = eventInPoint(source, usedDuration, clipDuration);
        selected = await review(inPoint, "selected");
      } else selected = source;
      if (entry.expect === "pass-late") pinned = await review(0, "pinned-zero");
    } catch (e) {
      selected = { ok: false, unavailable: true, why: e.message };
    }
    const unavailable = source?.unavailable || selected?.unavailable || pinned?.unavailable;
    const got = unavailable ? "unavailable" : !selected.ok ? "fail" : pinned && !pinned.ok ? "pass-late" : "pass";
    const why = `${selected.why}${pinned ? `; pinned-zero: ${pinned.why}` : ""}`;
    results.push({ file: entry.file, expected: entry.expect, got, correct: got === entry.expect, why, humanReason: entry.why, inPoint, duration, source, selected, ...(pinned ? { pinned } : {}) });
    writeJSON(path.join(out, "results.json"), { manifest, results });
  }
  const correct = results.filter((r) => r.correct).length, wrong = results.filter((r) => !r.correct);
  const report = { manifest, duration: 1.6, results, correct, total: results.length, accuracy: correct / results.length, wrong };
  writeJSON(path.join(out, "results.json"), report);
  print(qcEvalTable(results));
  print(`Accuracy: ${correct}/${results.length} (${(report.accuracy * 100).toFixed(1)}%)`);
  print(`Wrong verdicts: ${wrong.length ? wrong.map((r) => `${r.file}: expected ${r.expected}, got ${r.got}`).join("; ") : "none"}`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await runQcEval(qcEvalOptions(process.argv.slice(2)));
    if (report.wrong.length) process.exitCode = 1;
  } catch (e) { warn(e.message); process.exitCode = 1; }
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spansFromScores, findReactions } from "../src/reactions.mjs";

const rows = (scores, kind = "applause", step = 0.75) => scores.map((score, i) => ({ t: i * step, [kind]: score }));

test("entry requires two successive windows at the per-class threshold", () => {
  for (const [kind, threshold] of [["applause", 0.75], ["laughter", 0.65], ["cheering", 0.75]]) {
    const high = spansFromScores(rows([threshold, threshold, 0], kind));
    assert.deepEqual(high, [{ kind, start: 0, end: 2.25, peak: threshold, confidence: "high" }]);
    assert.equal(spansFromScores(rows([threshold, threshold - 0.001], kind))[0].confidence, "review");
    assert.equal(spansFromScores(rows([threshold, 0.5, threshold], kind))[0].confidence, "review");
  }
});

test("review queue begins at .40; crowd alone is not a reaction", () => {
  assert.deepEqual(spansFromScores(rows([0.39, 0.39])), []);
  assert.deepEqual(spansFromScores(rows([0.4])), [{ kind: "applause", start: 0, end: 1.5, peak: 0.4, confidence: "review" }]);
  assert.deepEqual(spansFromScores([{ t: 0, crowd: 0.99 }, { t: 0.75, crowd: 0.99 }]), []);
  assert.equal(spansFromScores(rows([0.76]))[0].confidence, "review");
});

test("hysteresis holds to .35; a brief confidence dip does not split a reaction", () => {
  const list = spansFromScores(rows([0.8, 0.9, 0.36, 0.35, 0.1, 0.5, 0, 0, 0]));
  assert.deepEqual(list, [{ kind: "applause", start: 0, end: 5.25, peak: 0.9, confidence: "high" }]);
});

test("merge same-kind spans at <=.5s but preserve distinct kinds and longer gaps", () => {
  const list = spansFromScores([
    { t: 0, applause: 0.8, laughter: 0.7, duration: 0.5 },
    { t: 0.25, applause: 0.9, laughter: 0.8, duration: 0.5 },
    { t: 1.25, applause: 0.8, duration: 0.5 },
    { t: 1.5, applause: 0.8, duration: 0.5 },
    { t: 3, applause: 0.8, duration: 0.5 },
    { t: 3.25, applause: 0.8, duration: 0.5 },
  ]);
  assert.equal(list.length, 3);
  assert.deepEqual(list.filter((s) => s.kind === "applause").map((s) => [s.start, s.end]), [[0, 2], [3, 3.75]]);
  assert.equal(list.find((s) => s.kind === "laughter").end, 0.75);
});

test("supported window duration determines boundaries and adjacency; missing windows are not consecutive evidence", () => {
  const input = [{ t: 0, applause: 0.8, duration: 2 }, { t: 1, applause: 0.9, duration: 2 }];
  assert.equal(spansFromScores(input)[0].end, 3);
  assert.equal(spansFromScores(input)[0].confidence, "high");
  const missing = [{ t: 0, applause: 0.8 }, { t: 10, applause: 0.9 }];
  assert.deepEqual(spansFromScores(missing).map((s) => s.confidence), ["review", "review"]);
  assert.deepEqual(input, [{ t: 0, applause: 0.8, duration: 2 }, { t: 1, applause: 0.9, duration: 2 }]);
});

test("custom reaction thresholds, sorting, and invalid input", () => {
  assert.deepEqual(spansFromScores([]), []);
  assert.equal(spansFromScores(rows([0.5, 0.6]).reverse(), { enter: { applause: 0.5 } })[0].confidence, "high");
  assert.throws(() => spansFromScores([], { enter: { applause: 1.1 } }), /threshold/);
  assert.throws(() => spansFromScores([], { minWindows: 0 }), /threshold/);
  assert.throws(() => spansFromScores([], { review: 0.2 }), /threshold/);
  assert.throws(() => spansFromScores([{ t: NaN }]), /window/);
  assert.throws(() => spansFromScores([{ t: 0 }, { t: 0 }]), /window/);
  assert.throws(() => spansFromScores([{ t: 0, laughter: -1 }]), /laughter/);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reactions-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "original.mov");
  fs.writeFileSync(file, "fake media, only fake runners inspect it");
  return { dir, file, opts: { workDir: path.join(dir, "work"), cacheDir: path.join(dir, "bin"), key: "talk-a", sourceId: "talk-a" } };
}

test("fake runner compiles, decodes original audio without denoise, caches rows and spans per source", async (t) => {
  const { dir, file, opts } = fixture(t);
  const calls = [];
  const run = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "swiftc" || cmd === "ffmpeg") return { out: "", code: 0 };
    return { out: rows([0.8, 0.9]).map((r) => JSON.stringify(r)).join("\n") + "\n" };
  };
  const spans = await findReactions(file, { ...opts, run });
  assert.equal(spans[0].confidence, "high");
  assert.equal(spans[0].sourceId, "talk-a");
  assert.equal(spans[0].verified, undefined);
  const ffmpeg = calls.find((c) => c.cmd === "ffmpeg");
  assert.equal(ffmpeg.args[ffmpeg.args.indexOf("-i") + 1], file);
  assert.ok(!ffmpeg.args.includes("-af"));
  assert.ok(ffmpeg.args.includes("pcm_f32le"));
  const cache = JSON.parse(fs.readFileSync(path.join(dir, "work/index/talk-a.reactions.json")));
  assert.equal(cache.rows.length, 2);
  assert.equal(cache.settings.enter.laughter, 0.65);
  assert.equal(cache.settings.window, 1.5);
  const before = calls.length;
  assert.deepEqual(await findReactions(file, { ...opts, run }), spans);
  assert.equal(calls.length, before);
  await findReactions(file, { ...opts, run, force: true });
  assert.ok(calls.length > before);
  const next = calls.length;
  await findReactions(file, { ...opts, run, thresholds: { review: 0.45 } });
  assert.ok(calls.length > next);
  const again = calls.length;
  fs.appendFileSync(file, "changed source");
  await findReactions(file, { ...opts, run });
  assert.ok(calls.length > again);
  assert.equal(fs.readdirSync(dir).some((s) => s.startsWith("speaker-reactions-")), false);
});

test("framework, compile and malformed-output errors fail open with exactly one log line", async (t) => {
  const { file, opts } = fixture(t);
  for (const mode of ["compile", "framework", "malformed"]) {
    const logs = [];
    const run = async (cmd) => {
      if (cmd === "swiftc" && mode === "compile") throw new Error("Swift unavailable\nlong error");
      if (cmd === "swiftc" || cmd === "ffmpeg") return { out: "" };
      if (mode === "framework") throw new Error("SoundAnalysis failed");
      return { out: "not json" };
    };
    assert.deepEqual(await findReactions(file, { ...opts, run, force: true, log: (s) => logs.push(s) }), []);
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].includes("\n"));
  }
});

test("missing sources and unsafe cache keys are clear input errors", async (t) => {
  const { file, opts } = fixture(t);
  await assert.rejects(findReactions(`${file}-missing`, opts), /no such source/);
  await assert.rejects(findReactions(file, { ...opts, key: "../escape" }), /unsafe/);
});

test("client work directory is discovered from the manifest", async (t) => {
  const { dir, file, opts } = fixture(t);
  fs.writeFileSync(path.join(dir, "speaker-manifest.json"), "{}");
  const run = async (cmd) => ({ out: ["swiftc", "ffmpeg"].includes(cmd) ? "" : rows([0.8, 0.9]).map((r) => JSON.stringify(r)).join("\n") });
  await findReactions(file, { cacheDir: opts.cacheDir, key: "auto", run });
  assert.ok(fs.existsSync(path.join(dir, "work/index/auto.reactions.json")));
});

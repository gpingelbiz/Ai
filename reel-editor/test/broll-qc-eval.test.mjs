import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { qcEvalOptions, qcEvalTable, runQcEval } from "../scripts/broll-qc-eval.mjs";
import { DEFECT_QUESTIONS } from "../src/broll-qc.mjs";

const frameProbe = { out: JSON.stringify({ frames: Array.from({ length: 600 }, (_, i) => ({ best_effort_timestamp_time: String(i / 120) })) }) };
const root = fs.mkdtempSync(path.join(os.tmpdir(), "broll-qc-eval-"));
process.env.REEL_CACHE = root;
process.env.REEL_BROLL_RECENT = path.join(root, "recent.json");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const checks = Object.fromEntries(Object.keys(DEFECT_QUESTIONS).map((key) => [key, { yes: false, time: null, why: "compared timeline and crops; absent" }]));
const pass = { shows: true, action: true, dark: false, physicsPlausible: true, identityStable: true, artifacts: false, directionPlausible: true, humanFaces: false, readableText: false, eventType: "drop-land", onset: 0.2, contact: 0.7, completion: 1, checks, defects: [], why: "word-fitting movement" };

function fixture(entries) {
  const dir = fs.mkdtempSync(path.join(root, "case-")), manifest = path.join(dir, "manifest.json"), out = path.join(dir, "out");
  fs.mkdirSync(path.join(dir, "clips"));
  for (const e of entries) fs.writeFileSync(path.join(dir, e.file), "clip");
  fs.writeFileSync(manifest, JSON.stringify(entries));
  const calls = [], prompts = [], printed = [];
  const deps = {
    runFn: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "ffprobe") return args.includes("-show_frames") ? frameProbe : { out: "3.033333\n" };
      assert.equal(cmd, "ffmpeg");
      fs.writeFileSync(args.at(-1), args.at(-1).endsWith("landing.gray") ? Buffer.alloc(180 * 320 * 80, 220) : args.at(-1).endsWith(".gray") ? Buffer.concat([Buffer.alloc(4096), Buffer.alloc(4096, 10)]) : "frame");
    },
    claudeLook: async (prompt, { cwd }) => {
      prompts.push(prompt);
      assert.match(path.basename(cwd), /^clip-\d+$/);
      const name = path.basename(entries[Number(path.basename(cwd).slice(5)) - 1].file, ".mp4");
      assert.doesNotMatch(prompt, /HUMAN_LABEL_SENTINEL/);
      if (prompt.startsWith("Inspect the landing")) return JSON.stringify({ collar: false, objectPosition: "on sand beside an outward spray", why: "textured grains disperse away" });
      if (!prompt.startsWith("Used source")) return JSON.stringify({ seen: "an object moves", contact: name === "late" && prompt.includes("2.75s") ? 2.1 : 0.7, contactPoint: { x: 0.5, y: 0.8 } });
      if (name === "bad") return JSON.stringify({ ...pass, checks: { ...checks, contactArtifact: { yes: true, time: 0.7, why: "white halo at landing" } } });
      if (name === "late") {
        if (prompt.includes("full source for choosing")) return JSON.stringify({ ...pass, onset: 1.7, contact: 2.1, completion: 2.5 });
        if (prompt.startsWith("Used source interval: 0 to")) return JSON.stringify({ ...pass, onset: 1.4, contact: 1.5, completion: 1.55, why: "event starts too late at zero" });
      }
      return JSON.stringify(pass);
    },
    localClipCheck: async () => ({ ok: true }),
    log: (text) => printed.push(text),
  };
  return { manifest, out, deps, calls, prompts, printed };
}

const entry = (name, expect, change = {}) => ({ file: `clips/${name}.mp4`, expect, shows: "coconut", action: "The coconut falls", words: "a coconut hits me in the head", why: "HUMAN_LABEL_SENTINEL", ...change });

test("eval CLI requires a manifest and resolves its output without starting a process", () => {
  assert.throws(() => qcEvalOptions([]), /--manifest/);
  assert.throws(() => qcEvalOptions(["--manifest", "x", "--unknown"]), /Unknown option/);
  const result = qcEvalOptions(["--manifest", "labels.json", "--out", "evaluation"]);
  assert.equal(result.manifest, path.resolve("labels.json"));
  assert.equal(result.out, path.resolve("evaluation"));
  assert.equal(qcEvalOptions(["--manifest", "labels.json"]).out, path.resolve("broll-qc-eval"));
});

test("eval exercises real checks on selected pixels, and tests pass-late again pinned to zero", async () => {
  const f = fixture([entry("board", "pass", { shows: "two by four", words: "hold the two by four on the quicksand", action: "hands lower a board" }), entry("late", "pass-late"), entry("bad", "fail")]);
  const report = await runQcEval(f, f.deps);
  assert.equal(report.correct, 3, JSON.stringify(report.wrong.map((r) => ({ file: r.file, got: r.got, why: r.why }))));
  assert.equal(report.total, 3);
  assert.equal(report.accuracy, 1);
  assert.deepEqual(report.wrong, []);
  assert.deepEqual(report.results.map((r) => r.got), ["pass", "pass-late", "fail"]);
  assert.ok(Math.abs(report.results[1].inPoint - 1.433) < 0.001);
  assert.equal(report.results[1].duration, 1.6);
  assert.equal(report.results[1].selected.ok, true);
  assert.equal(report.results[1].pinned.ok, false);
  assert.match(report.results[2].why, /contactArtifact at 0.7s: white halo/);
  const trims = f.calls.filter(({ cmd, args }) => cmd === "ffmpeg" && args.at(-1).endsWith(".mp4"));
  assert.equal(trims.length, 3, "bad full-source review must not be rescued by trimming");
  assert.equal(trims[0].args[trims[0].args.indexOf("-i") + 1], path.join(path.dirname(f.manifest), "clips/board.mp4"));
  assert.equal(trims[1].args[trims[1].args.indexOf("-ss") + 1], "1.433");
  assert.equal(trims[2].args[trims[2].args.indexOf("-ss") + 1], "0");
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.out, "results.json"))).correct, 3);
  assert.match(f.printed.join("\n"), /file.*expected.*got.*check reasons/);
  assert.match(f.printed.join("\n"), /Accuracy: 3\/3 \(100.0%\)/);
  assert.match(f.printed.join("\n"), /Wrong verdicts: none/);
  assert.ok(f.prompts.some((p) => p.includes('Required subject: "two by four"') && p.includes("hold the two by four on the quicksand")));
});

test("unavailable checks count as wrong even on negative labels and do not stop the manifest", async () => {
  const f = fixture([entry("broken", "fail"), entry("good", "fail")]);
  const runFn = f.deps.runFn;
  f.deps.runFn = async (cmd, args) => {
    if (cmd === "ffprobe" && args.at(-1).endsWith("broken.mp4")) throw new Error("decoder unavailable");
    return runFn(cmd, args);
  };
  const report = await runQcEval(f, f.deps);
  assert.equal(report.total, 2);
  assert.equal(report.correct, 0);
  assert.deepEqual(report.wrong.map((r) => r.got), ["unavailable", "pass"]);
  assert.match(f.printed.at(-1), /broken.mp4: expected fail, got unavailable/);
  assert.match(f.printed.at(-1), /good.mp4: expected fail, got pass/);
});

test("pass-late is wrong when pinned-zero also passes; an ongoing action can fill a short window", async () => {
  const f = fixture([entry("early", "pass-late"), entry("long", "pass")]);
  const look = f.deps.claudeLook;
  f.deps.claudeLook = async (prompt, options) => prompt.startsWith("Used source") && prompt.includes("full source for choosing") && options.cwd.endsWith("clip-02") ? JSON.stringify({ ...pass, eventType: "continuous", onset: 0.1, contact: null, completion: 3 }) : look(prompt, options);
  const report = await runQcEval(f, f.deps);
  assert.deepEqual(report.results.map((r) => r.got), ["pass", "pass"]);
  assert.equal(report.results[1].inPoint, 0);
  assert.ok(report.results[1].correct);
});

test("hop and ring answers carry rejection without settle, and each question is visible in the eval table", async () => {
  for (const keys of [["upwardOrTeleport"], ["contactArtifact"], ["upwardOrTeleport", "contactArtifact"]]) {
    const f = fixture([entry("defect", "fail")]);
    const look = f.deps.claudeLook;
    f.deps.claudeLook = async (prompt, options) => prompt.startsWith("Used source") ? JSON.stringify({
      ...pass, eventType: "drop-land", completion: null, defects: [],
      checks: { ...checks, ...Object.fromEntries(keys.map((key) => [key, { yes: true, time: key === "upwardOrTeleport" ? 0.8 : 1.6, why: key === "upwardOrTeleport" ? "coconut hops upward before falling" : "white ring at sand contact" }])) },
    }) : look(prompt, options);
    const report = await runQcEval(f, f.deps);
    assert.equal(report.correct, 1);
    const result = report.results[0];
    assert.equal(result.got, "fail");
    assert.deepEqual(result.source.defects.length, keys.length);
    assert.ok(result.source.shows && result.source.action && result.source.physicsPlausible, "only the independent defect answers veto approval");
    assert.ok(!f.calls.some(({ args }) => args.at(-1).endsWith(".mp4") && args.includes("-t")), "source defects cannot be rescued by trimming");
    const table = qcEvalTable(report.results);
    for (const key of Object.keys(DEFECT_QUESTIONS)) assert.ok(table.includes(`${key}=${keys.includes(key) ? "YES at" : "no"}`), key);
    for (const key of keys) assert.match(result.why, new RegExp(`${key} at`));
    assert.match(table, /source:/);
    assert.doesNotMatch(table, /settle/);
  }
});

test("invalid manifest labels and durations are rejected before any process or look", async () => {
  for (const change of [{ expect: "maybe" }, { duration: -1 }, { words: "" }]) {
    const f = fixture([entry("clip", "pass", change)]);
    await assert.rejects(runQcEval(f, f.deps), /Manifest needs/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.prompts, []);
  }
});

test("a manifest duration overrides the default used window", async () => {
  const f = fixture([entry("clip", "pass", { duration: 1.3 })]);
  const report = await runQcEval(f, f.deps);
  assert.equal(report.correct, 1);
  assert.equal(report.results[0].duration, 1.3);
  const trim = f.calls.find(({ cmd, args }) => cmd === "ffmpeg" && args.at(-1).endsWith(".mp4"));
  assert.equal(trim.args[trim.args.indexOf("-t") + 1], "1.3");
});

test("dedicated collar verdicts keep ring and hop failures while ledge, palm and late drops pass", async () => {
  const f = fixture([entry("ring", "fail"), entry("hop", "fail"), entry("ledge", "pass"), entry("palm", "pass"), entry("late", "pass-late")]);
  const look = f.deps.claudeLook, runner = f.deps.runFn;
  f.deps.claudeLook = async (prompt, options) => {
    const clip = path.basename(options.cwd);
    if (clip === "clip-01" && prompt.startsWith("Inspect the landing")) return JSON.stringify({ collar: true, objectPosition: "coconut sits inside the collar", why: "a symmetrical bright cotton-like ring surrounds the base" });
    if (clip === "clip-02" && prompt.startsWith("Used source")) return JSON.stringify({ ...pass, checks: { ...checks, upwardOrTeleport: { yes: true, time: 0.5, why: "upward hop before falling" } } });
    if (clip === "clip-04") return JSON.stringify(prompt.startsWith("Used source") ? { ...pass, contact: null, completion: null } : { seen: "a coconut falls out of frame", contact: null, contactPoint: null });
    return look(prompt, options);
  };
  f.deps.runFn = async (cmd, args) => {
    const result = await runner(cmd, args);
    if (!args.at(-1).endsWith("landing.gray") && args.at(-1).endsWith(".gray") && args.at(-1).includes("clip-05")) fs.writeFileSync(args.at(-1), Buffer.concat([Buffer.alloc(4096), Buffer.alloc(4096, 2)]));
    return result;
  };
  const report = await runQcEval(f, f.deps);
  assert.equal(report.correct, 5, JSON.stringify(report.wrong));
  assert.deepEqual(report.results.map((r) => r.got), ["fail", "fail", "pass", "pass", "pass-late"]);
  assert.match(report.results[0].why, /landing collar.*coconut sits inside/);
  assert.match(report.results[1].why, /upwardOrTeleport/);
  assert.equal(report.results[2].source.landing.collar, false);
  assert.equal(report.results[3].source.landing, undefined, "a fall out of frame does not need a visible landing");
  assert.equal(report.results[4].source.motion.mean, 2, "drop events below the continuous floor retain their timeline check");
  assert.ok(report.results[4].inPoint > 0);
});

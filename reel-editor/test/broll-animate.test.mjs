import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBroll, PICKS_SCHEMA, checkPick, picksPrompt, planBrollOpen } from "../src/broll.mjs";
import { planShotBudget, runwayPicksPrompt } from "../src/broll-runway.mjs";
import { loadPreset } from "../src/presets.mjs";
import { applyTheme } from "../src/looks.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-animation-"));
process.env.REEL_CACHE = root;
process.env.RUNWAY_API_KEY = "unit-test";
process.env.REEL_BROLL_RECENT = path.join(root, "recent.json");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const folder = () => fs.mkdtempSync(path.join(root, "case-"));
const json = (body) => ({ ok: true, json: async () => body, arrayBuffer: async () => Buffer.alloc(2000, 7) });
const videoPass = { shows: true, action: true, dark: false, physicsPlausible: true, identityStable: true, artifacts: false, directionPlausible: true, humanFaces: false, readableText: false, onset: 0.2, contact: 0.7, completion: 1.1, defects: [] };
const stillPass = { shows: true, dark: false, detailReadable: true, actionAreaVisible: true, captionOcclusion: false, subjectLarge: true };
const groups = [
  { start: 0, text: "work feels wild" },
  { start: 6, text: "a coconut drops onto sand" },
  { start: 9, text: "then I keep walking" },
  { start: 17, text: "a snake slides down rocks" },
  { start: 20, text: "I keep moving forward" },
].map((g) => ({ ...g, words: g.text.split(" ").map((text, i) => ({ text, start: g.start + i * 0.4, end: g.start + i * 0.4 + 0.4 })) }));
function pick(line = 1) {
  return { line, shows: line === 1 ? "coconut" : "snake", scene: line === 1 ? "A large coconut on a sandy ledge in daylight." : "A large green snake on a broad jungle rock in daylight.",
    kind: "action", duration: 1.6, action: line === 1 ? "The coconut drops onto sand and settles." : "The snake slides down the rock.", motion: "Locked camera.",
    soundRole: "impact", sound: "a coconut thuds onto sand", file: `broll-${line}.png`,
    endsAt: { line, wordIndex: 4, text: groups[line].words[4].text }, endsBefore: { line: line + 1, wordIndex: 0, text: groups[line + 1].words[0].text },
  };
}

// Exercise the real journal, checks, trimming and HTTP wrappers without a CLI, network or local process.
function fixture({ picks = [pick()], checks = [], videoChecks = [], settings = {}, balance = 1000, redrawMissing = false, noImage = false } = {}) {
  const workDir = folder(), calls = { codex: [], video: [], sound: [], look: [], run: [], previews: [], ledger: [] }, tasks = new Map();
  let stillIndex = 0, videoIndex = 0;
  const fetchFn = async (url, init) => {
    if (url.endsWith("/v1/image_to_video") || url.endsWith("/v1/video_to_audio")) {
      const type = url.endsWith("image_to_video") ? "video" : "sound", body = JSON.parse(init.body);
      calls[type].push(body);
      const id = `${type}-${calls[type].length}`;
      tasks.set(id, { status: "SUCCEEDED", output: [`https://fake/${id}`] });
      return json({ id });
    }
    if (url.includes("/v1/tasks/")) return json(tasks.get(url.split("/").at(-1)));
    assert.match(url, /^https:\/\/fake\//, "Codex first frames must not buy a Runway image");
    return json({});
  };
  const runFn = async (cmd, args) => {
    calls.run.push({ cmd, args });
    if (cmd === "ffprobe") return { out: "3" };
    assert.equal(cmd, "ffmpeg");
    const out = args.at(-1);
    fs.writeFileSync(out, out.endsWith(".gray") ? Buffer.concat(Array.from({ length: 24 }, (_, i) => Buffer.alloc(4096, i % 2 ? 15 : 0))) : Buffer.alloc(2000, 5));
  };
  const deps = {
    hasCodex: () => true, codexPausedUntil: () => 0, hasRunway: () => true, hasClaude: () => true,
    claudeText: async () => { throw new Error("Codex owns planning"); },
    codexExec: async (prompt, { cwd, schema }) => {
      calls.codex.push(prompt);
      assert.equal(schema, PICKS_SCHEMA);
      const redraw = prompt.includes("Redraw only this opening frame:");
      if (redraw) {
        const name = prompt.match(/Save the new image as (.+\.png)\./)[1];
        if (!redrawMissing) fs.writeFileSync(path.join(cwd, name), Buffer.alloc(2000));
        return JSON.stringify({ picks: [{ ...picks[0], file: name }] });
      }
      if (!noImage) for (const p of picks) fs.writeFileSync(path.join(cwd, p.file), Buffer.alloc(2000));
      return JSON.stringify({ picks });
    },
    claudeLook: async (prompt) => {
      calls.look.push(prompt);
      if (prompt.startsWith("Used source interval:")) {
        const verdict = videoChecks[videoIndex++] || {};
        if (verdict instanceof Error) throw verdict;
        return JSON.stringify({ ...videoPass, ...verdict });
      }
      if (prompt.startsWith("Inspect the timestamped contact sheet")) return '{"seen":"a coconut drops and settles"}';
      if (prompt.includes('"seen":"..."')) return '{"seen":"a large coconut on sand in daylight"}';
      const verdict = checks[stillIndex++] || {};
      if (verdict instanceof Error) throw verdict;
      return JSON.stringify({ ...stillPass, ...verdict });
    },
    phonePreviews: async (file, shot, actualGroups, options) => {
      calls.previews.push({ file, shot, groups: actualGroups, ...options });
      assert.match(file, /\.input\.jpg$/);
      assert.ok(fs.existsSync(file));
      const preview = path.join(options.dir, "caption.png");
      fs.writeFileSync(preview, "preview");
      return [{ file: preview }];
    },
    localClipCheck: async () => ({ ok: true }),
    verifySound: async (_sfx, footage, shot, moves) => {
      assert.equal(footage, "speaker.mp4");
      assert.equal(shot.start, 6.4);
      assert.equal(moves.ok, true);
      return { ok: true, volume: 0.1 };
    },
    recordUsage: (entry) => calls.ledger.push(entry), organization: async () => ({ creditBalance: balance }),
    runFn, fetchFn, sleepFn: async () => {},
  };
  const args = { workDir, groups, duration: 40, footage: "speaker.mp4", caption: { top: 0.65, height: 0.18 }, settings: { animate: true, videoModel: "gen4.5", videoSeconds: 3, maxCreditsPerReel: 300, hardCreditsPerReel: 450, sfx: true, ...settings }, deps };
  return { calls, args, run: (overrides = {}) => makeBroll({ ...args, ...overrides }), plan: () => JSON.parse(fs.readFileSync(path.join(workDir, "broll", "broll.json"))) };
}

test("Codex first frames take the shared moving path, with captions, sound, seeds, ledger and cache", async () => {
  const f = fixture();
  const [shot] = await f.run();
  assert.match(shot.file, /\.mp4$/);
  assert.equal(shot.move, "none");
  assert.equal(shot.stillSource, "codex");
  assert.equal(shot.imageModel, "codex");
  assert.equal(shot.videoModel, "gen4.5");
  assert.equal(shot.start, 6.4);
  assert.equal(shot.duration, 1.6);
  assert.equal(shot.moves.ok, true);
  assert.equal(shot.moves.look, "pass");
  assert.ok(shot.inPoint >= 0);
  assert.ok(fs.existsSync(shot.sfx));
  assert.equal(f.calls.previews[0].caption, f.args.caption);
  assert.equal(f.calls.look.filter((p) => p.startsWith("Used source interval:")).length, 2, "full and selected intervals are inspected");
  const conformed = f.calls.run.find(({ args }) => args.includes("scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280"));
  assert.ok(conformed);
  assert.equal(f.calls.video[0].seed, shot.seed);
  assert.equal(f.calls.sound[0].seed, shot.seed);
  assert.equal(f.calls.video[0].model, "gen4.5");
  assert.match(f.calls.video[0].promptImage, /^data:image\/jpeg;/);
  assert.equal(f.plan().stillSource, "codex");
  assert.deepEqual(f.plan().tasks.map((t) => t.kind), ["video", "audio"]);
  assert.ok(f.plan().tasks.every((t) => t.state === "succeeded" && t.scope));
  assert.equal(f.calls.ledger[0].items.length, 2);
  assert.ok(fs.existsSync(path.join(f.args.workDir, "runway usage.txt")));
  assert.deepEqual(await f.run(), [shot]);
  assert.equal(f.calls.codex.length, 1);
  assert.equal(f.calls.video.length, 1);
});

test("one failed Codex still gets one redraw with the inspection reason before animation", async () => {
  for (const defect of [{ subjectLarge: false, why: "subject too small behind captions" }, { dark: true, why: "dangerous neck association" }]) {
    const f = fixture({ checks: [defect] });
    const [shot] = await f.run();
    assert.equal(f.calls.codex.length, 2);
    assert.ok(f.calls.codex[1].includes(defect.why));
    assert.equal(f.calls.video.length, 1);
    assert.equal(shot.check, "retry-pass");
  }
});

test("failed redraws, unavailable still checks and missing images never fall back to a still", async () => {
  for (const options of [
    { checks: [{ shows: false }, { shows: false }] },
    { checks: [{ shows: false }], redrawMissing: true },
    { checks: [new Error("offline"), new Error("offline")] },
    { noImage: true },
  ]) {
    const f = fixture(options);
    assert.deepEqual(await f.run(), []);
    assert.equal(f.calls.video.length, 0);
    assert.ok(f.calls.codex.length <= 2);
    assert.deepEqual(f.plan().shots, []);
  }
});

test("a new Codex plan cannot silently reuse an old drawing when its image tool fails", async () => {
  const f = fixture({ noImage: true });
  const dir = path.join(f.args.workDir, "broll");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "broll-1.png"), Buffer.alloc(2000));
  assert.deepEqual(await f.run(), []);
  assert.equal(f.calls.video.length, 0);
  assert.equal(f.plan().complete, true);
  assert.deepEqual(await f.run(), []);
  assert.equal(f.calls.codex.length, 1, "a missing drawing drops the shot instead of repeating a session");
});

test("unsafe and unbounded Codex picks are rejected before any Runway purchase", async () => {
  for (const change of [
    { shows: "knife", scene: "A knife on sand." },
    { scene: "A coconut on a hanging rope." },
    { action: "The coconut rolls towards a noose." },
    { endsAt: undefined },
    { endsBefore: { line: 2, wordIndex: 0, text: "wrong" } },
  ]) {
    const f = fixture({ picks: [{ ...pick(), ...change }] });
    assert.deepEqual(await f.run(), []);
    assert.equal(f.calls.video.length, 0);
    assert.equal(f.calls.look.length, 0);
    assert.equal(f.plan().tasks.length, 0);
  }
});

test("unavailable clip checks resume the purchased clip without another Codex or Runway purchase", async () => {
  const f = fixture({ videoChecks: [new Error("offline"), new Error("offline")] });
  assert.deepEqual(await f.run(), []);
  assert.equal(f.calls.video.length, 1);
  assert.equal(f.plan().complete, false);
  assert.equal((await f.run()).length, 1);
  assert.equal(f.calls.codex.length, 1);
  assert.equal(f.calls.video.length, 1);
  assert.equal(f.plan().tasks.filter((t) => t.kind === "video").length, 1);
});

test("a defective clip is reanimated with shared retries; a bad replacement is dropped", async () => {
  const defect = { artifacts: true, defects: ["subject morphs"], why: "subject morphs" };
  const f = fixture({ videoChecks: [defect] });
  const [shot] = await f.run();
  assert.equal(f.calls.codex.length, 1);
  assert.equal(f.calls.video.length, 2);
  assert.notEqual(f.calls.video[0].seed, f.calls.video[1].seed);
  assert.equal(f.calls.video[1].seed, shot.seed);
  const bad = fixture({ videoChecks: [defect, defect, defect] });
  assert.deepEqual(await bad.run(), []);
  assert.equal(bad.calls.video.length, 3);
  assert.equal(bad.calls.sound.length, 0);
});

test("Codex animation reserves video and sound only and respects both cap and account reserve", async () => {
  const settings = { stillSource: "codex", videoModel: "gen4.5", videoSeconds: 3, sfx: true };
  const budget = planShotBudget(pick(), 1.6, settings);
  assert.equal(budget.image, 0);
  assert.equal(budget.credits, 39.2);
  assert.equal(budget.reserve, 75.2);
  for (const options of [{ settings: { maxCreditsPerReel: 75 } }, { balance: 80, settings: { keepCredits: 5 } }]) {
    const f = fixture(options);
    assert.deepEqual(await f.run(), []);
    assert.equal(f.calls.video.length, 0);
  }
  const exact = fixture({ settings: { maxCreditsPerReel: budget.reserve } });
  assert.equal((await exact.run()).length, 1);
});

test("missing Runway credentials skip Codex and never reuse still plans when animation is requested", async () => {
  const f = fixture();
  const dir = path.join(f.args.workDir, "broll");
  fs.mkdirSync(dir);
  const image = path.join(dir, "old.png");
  fs.writeFileSync(image, Buffer.alloc(2000));
  fs.writeFileSync(path.join(dir, "broll.json"), JSON.stringify({ shots: [{ file: image }] }));
  assert.deepEqual(await f.run({ deps: { ...f.args.deps, hasRunway: () => false } }), []);
  assert.equal(f.calls.codex.length, 0);
  assert.equal(f.calls.video.length, 0);
});

test("Codex and Runway share rules, noun timing, rank, boundaries, gap and maximum", async () => {
  const valid = pick(3), invalid = { ...pick(), scene: "packing tape on a shelf" };
  const f = fixture({ picks: [valid, invalid, pick()], settings: { max: 1, sfx: false } });
  const [shot] = await f.run();
  assert.equal(shot.line, 3, "rank wins over time order");
  assert.equal(shot.start, 17.4);
  const prompt = f.calls.codex[0], runway = runwayPicksPrompt({ candidates: [], count: 1 });
  for (const line of runway.split("\n").filter((line) => /^(shows:|duration:|kind:|scene:|action:|motion:|sound:|Weapon lines|Every scene|Show named)/.test(line))) assert.ok(prompt.includes(line), line);
  assert.doesNotMatch(prompt, /Reply with JSON only\. Use no tools|muted, desaturated|scuffed|plain and dark/);
  for (const field of ["duration", "kind", "scene", "action", "motion", "sound", "soundRole", "endsAt", "endsBefore"]) assert.ok(PICKS_SCHEMA.properties.picks.items.properties[field]);
  const world = picksPrompt({ candidates: [], count: 1, world: "CLIENT SETTING" });
  assert.match(world, /CLIENT SETTING/);
  assert.match(world, /the named thing wins/);
  const adjacent = fixture({ picks: [pick(3), pick()], settings: { gap: 20, sfx: false } });
  assert.deepEqual((await adjacent.run()).map((s) => s.line), [3]);
  for (const change of [{ shows: "knife", scene: "a knife" }, { action: "The snake slides along a rope." }, { shows: "two by four", scene: "A two-by-four on sand" }]) {
    assert.match(checkPick({ ...pick(), ...change }, { start: 6 }, [{ start: 6, text: "coconut knife two by four" }]), /weapon|dark-read/);
  }
});

test("still mode uses the same picks and daylight, with no Runway or vision calls", async () => {
  const f = fixture({ settings: { animate: false } });
  const [shot] = await f.run({ deps: { ...f.args.deps, hasRunway: () => { throw new Error("still-only brand"); } } });
  assert.match(shot.file, /\.png$/);
  assert.equal(shot.motion, "in");
  assert.equal(shot.stillSource, "codex");
  assert.equal(shot.start, 6.4);
  assert.equal(f.calls.look.length, 0);
  assert.equal(f.calls.video.length, 0);
  assert.match(f.calls.codex[0], /Natural daylight and colour/);
  assert.deepEqual(await f.run(), [shot]);
  assert.equal(f.calls.codex.length, 1);
  assert.equal((await f.run({ settings: { ...f.args.settings, animate: true } }))[0].video, true, "a still cache cannot bypass animation");
});

test("moving-only b-roll cannot introduce a cold-open still, even when the brand requests one", () => {
  const shots = [{ file: "clip.mp4", still: "first.png", src: "assets/clip.mp4" }];
  assert.equal(planBrollOpen(shots, 30, { enabled: true }, { animate: true }), null);
  const still = [{ file: "first.png", src: "assets/first.png" }];
  assert.deepEqual(planBrollOpen(still, 30, { enabled: true }, { animate: false }), { duration: 0.6, file: "first.png", src: "assets/first.png" });
  assert.equal(planBrollOpen(still, 30, { enabled: false }), null);
});

test("Greg's presets inherit matching moving settings and still-only brands can opt out", () => {
  const codex = loadPreset("pingel-brand"), runway = loadPreset("pingel-runway");
  // Greg 2026-11-02: the Codex folder is the cheap one (no Runway credits); the Runway folder is the premium one.
  assert.equal(codex.broll.animate, false);
  assert.equal(runway.broll.animate, true);
  assert.equal(codex.broll.engine, "codex");
  for (const field of ["duration", "gap", "max", "maxWithGraphics", "every", "videoSeconds", "videoModel", "actionVideoModel", "retryVideoModel", "maxCreditsPerReel", "hardCreditsPerReel", "sfx"]) assert.equal(codex.broll[field], runway.broll[field], field);
  assert.equal(applyTheme(codex, "gregcard").broll.grade, false);
  assert.equal(codex.broll.focusPull, 0);
  const own = path.join(folder(), "brand-client.json");
  fs.writeFileSync(own, JSON.stringify({ name: "brand-client", extends: "pingel-brand", broll: { animate: false } }));
  assert.equal(loadPreset(own).broll.animate, false);

});

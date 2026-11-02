import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStockSearch, normaliseStock, stockContactSheet, conformStockClip, makeStockClip, stockCacheDir } from "../src/broll-stock.mjs";
import { libraryDir, readLibrary, saveLibraryClip, findLibraryClip, reviewMovingClip, writeBrollCredits } from "../src/broll-library.mjs";
import { makeBroll, picksPrompt } from "../src/broll.mjs";
import { makeRunwayBroll } from "../src/broll-runway.mjs";
import { loadPreset, CLIENT_BASE } from "../src/presets.mjs";
import { brandPreset } from "../src/brandkit.mjs";
import { writeJSON } from "../src/util.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "stock-tests-"));
process.env.REEL_CACHE = root;
process.env.REEL_BROLL_RECENT = path.join(root, "recent.json");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const folder = () => fs.mkdtempSync(path.join(root, "case-"));
const fail = () => { throw new Error("unexpected network, CLI or paid call"); };
const json = (body, status = 200, headers = {}) => ({ ok: status === 200, status, headers: new Headers(headers), json: async () => body, arrayBuffer: async () => Buffer.from("asset") });
const pexel = (id = 1, over = {}) => ({ id, url: `https://pexels.test/video/${id}`, user: { name: "Camera Person" }, duration: 6, width: 1080, height: 1920, image: `https://thumb.test/${id}.jpg`, video_files: [
  { link: `https://clip.test/${id}.mp4`, width: 720, height: 1280, fps: 25, file_type: "video/mp4" },
  { link: `https://clip.test/${id}-hd.mp4`, width: 1080, height: 1920, fps: 25, file_type: "video/mp4" },
], ...over });
const pixabay = (over = {}) => ({ id: 9, type: "film", pageURL: "https://pixabay.test/9", user: "Filmmaker", duration: 8, videos: { medium: { url: "https://clip.test/9.mp4", width: 1280, height: 720, thumbnail: "https://thumb.test/9.jpg" } }, ...over });
const groups = [
  { start: 0, text: "a day at work" }, { start: 6, text: "a coconut drops onto sand" }, { start: 9, text: "then I keep walking" },
].map((g) => ({ ...g, words: g.text.split(" ").map((text, i) => ({ text, start: g.start + i * 0.4, end: g.start + i * 0.4 + 0.4 })) }));
const pick = { line: 1, shows: "coconut", stockQuery: "coconut falling", scene: "A large coconut on a sandy ledge in daylight.", kind: "action", action: "The coconut drops onto sand and settles.", motion: "Locked camera.", duration: 1.6, file: "", endsAt: { line: 1, wordIndex: 4, text: "sand" }, endsBefore: { line: 2, wordIndex: 0, text: "then" } };
const shot = { line: 1, start: 6.4, duration: 1.6, text: groups[1].text, shows: pick.shows, scene: pick.scene };
const verdict = { ok: true, look: "pass", onset: 0.2, contact: 0.6, completion: 1.1 };
const choose = (choice = 1, over = {}) => JSON.stringify({ choice, shows: true, safe: true, humanFaces: false, readableText: false, logos: false, watermarks: false, ...over });
function fixture() {
  const dir = folder(), calls = { checks: [], downloads: [], looks: [], trims: [], runs: [] }, env = { REEL_CACHE: dir, PEXELS_API_KEY: "secret", PIXABAY_API_KEY: "secret-two" };
  const deps = {
    env, now: () => 1800000000000, hasCodex: () => true, codexPausedUntil: () => 0, hasClaude: () => true, hasRunway: fail,
    makeClip: fail, animateStill: fail, makeSound: fail, organization: fail, claudeText: fail,
    fetchFn: async (url) => { calls.downloads.push(url); return json({}); },
    runFn: async (cmd, args) => { calls.runs.push({ cmd, args }); if (cmd === "ffprobe") return { out: "6" }; fs.writeFileSync(args.at(-1), "frame"); return {}; },
    claudeLook: async (prompt) => { calls.looks.push(prompt); return prompt.includes('"seen":"..."') ? '{"seen":"a coconut above sand in daylight"}' : choose(); },
    checkRunwayVideo: async (args) => { calls.checks.push(args); return verdict; },
    trimRunwayClip: async (file, duration, options) => { calls.trims.push({ file, duration, options }); const full = file.replace(/\.mp4$/, ".full.mp4"); fs.copyFileSync(file, full); return { full, inPoint: 0.05 }; },
    stockContactSheet: async (_c, { dir }) => { const file = path.join(dir, "candidates.png"); fs.writeFileSync(file, "sheet"); return file; },
    conformStockClip: async (_input, file) => fs.writeFileSync(file, "moving"),
  };
  return { dir, env, calls, deps, args: { pick, shot, groups, workDir: dir, dir, settings: { stock: ["pexels"], library: true }, deps, search: async () => normaliseStock("pexels", { videos: [pexel(), pexel(2)] }) } };
}
function seed(f, workDir = "older-reel") {
  const file = path.join(f.dir, "approved.mp4"); fs.writeFileSync(file, "moving");
  return saveLibraryClip({ shot: { ...shot, file, video: true, moves: verdict }, pick, workDir: path.join(f.dir, workDir), duration: 6, source: "pexels", licence: { provider: "pexels", id: 1, pageUrl: "https://pexels.test/1", creator: "Camera Person", downloadedAt: "2026-11-02" }, env: f.env });
}
function ageLibrary(f) {
  const index = readLibrary(f.env);
  index.reels.push(...Array.from({ length: 10 }, (_, i) => path.join(f.dir, `intervening-${i}`)));
  writeJSON(path.join(libraryDir(f.env), "index.json"), index);
}

test("stock normalises documented variants, keeps film, filters duration/resolution and prefers portrait", () => {
  const [c] = normaliseStock("pexels", { videos: [pexel(), pexel(2, { duration: 2 }), pexel(3, { duration: 21 }), pexel(4, { video_files: [{ link: "small", width: 640, height: 1136, file_type: "video/mp4" }] })] });
  assert.deepEqual(c, { provider: "pexels", id: 1, pageUrl: "https://pexels.test/video/1", creator: "Camera Person", duration: 6, width: 1080, height: 1920, thumb: "https://thumb.test/1.jpg", files: [{ url: "https://clip.test/1.mp4", width: 720, height: 1280, fps: 25 }, { url: "https://clip.test/1-hd.mp4", width: 1080, height: 1920, fps: 25 }] });
  const [p] = normaliseStock("pixabay", { hits: [pixabay(), pixabay({ type: "animation" })] });
  assert.equal(p.thumb, "https://thumb.test/9.jpg"); assert.equal(p.creator, "Filmmaker"); assert.equal(p.files[0].fps, null);
  assert.equal(normaliseStock("pixabay", { hits: [pixabay({ videos: { small: { url: "small", width: 640, height: 360 } } })] }).length, 0);
});

test("search uses portrait then any, film on Pixabay, query then subject, dedupes and stops at six", async () => {
  const f = fixture(), urls = [];
  const search = createStockSearch({ env: f.env, fetchFn: async (url, init) => { const u = new URL(url); urls.push(u); if (u.hostname === "api.pexels.com") { assert.equal(init.headers.Authorization, "secret"); return json({ videos: u.searchParams.get("orientation") ? [] : [pexel()] }); } assert.equal(u.searchParams.get("key"), "secret-two"); assert.equal(u.searchParams.get("video_type"), "film"); return json({ hits: [pixabay()] }); } });
  assert.equal((await search(pick)).length, 2);
  assert.deepEqual(urls.map((u) => u.searchParams.get("orientation")), ["portrait", null, null, "portrait", null, null]);
  assert.deepEqual(urls.map((u) => u.searchParams.get("query") || u.searchParams.get("q")), ["coconut falling", "coconut falling", "coconut falling", "coconut", "coconut", "coconut"]);
  assert.equal((await search({ stockQuery: "gorilla walking", shows: "gorilla" })).length, 0, "one request budget covers the entire reel");
  const g = fixture(); let requests = 0;
  const enough = createStockSearch({ env: g.env, fetchFn: async () => { requests++; return json({ videos: Array.from({ length: 8 }, (_, i) => pexel(i)) }); } });
  assert.equal((await enough(pick)).length, 6); assert.equal(requests, 1);
});

test("search cache survives a new client for 24 hours and expires; disk never includes API keys", async () => {
  const f = fixture(); let clock = 1800000000000, requests = 0;
  const options = { env: f.env, now: () => clock, maxSearches: 1, fetchFn: async () => { requests++; return json({ videos: Array.from({ length: 6 }, (_, i) => pexel(i)) }); } };
  await createStockSearch(options)(pick, ["pexels"]);
  clock += 86400000 - 1; await createStockSearch(options)(pick, ["pexels"]); assert.equal(requests, 1);
  clock += 2; await createStockSearch(options)(pick, ["pexels"]); assert.equal(requests, 2);
  for (const file of fs.readdirSync(stockCacheDir(f.env))) assert.doesNotMatch(fs.readFileSync(path.join(stockCacheDir(f.env), file), "utf8"), /secret/);
});

test("missing keys warn once per provider and never fetch; errors do not reveal keys", async () => {
  const f = fixture(), warnings = [];
  const search = createStockSearch({ env: { REEL_CACHE: f.dir }, fetchFn: fail, warnFn: (s) => warnings.push(s) });
  await search(pick); await search(pick); assert.equal(warnings.length, 2);
  const broken = createStockSearch({ env: f.env, maxSearches: 1, fetchFn: async () => { throw new Error("key=secret-two"); }, warnFn: (s) => warnings.push(s) });
  await broken(pick); assert.doesNotMatch(warnings.join(" "), /secret/);
});

test("429 and exhausted response headers persist cooldowns without retrying", async () => {
  for (const provider of ["pexels", "pixabay"]) {
    for (const status of [200, 429]) {
      const f = fixture(); let clock = 1800000000000, requests = 0;
      const options = { env: f.env, now: () => clock, warnFn: () => {}, fetchFn: async () => { requests++; return json({}, status, { "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": provider === "pexels" ? String(clock / 1000 + 7200) : "120", "Retry-After": "90" }); } };
      await createStockSearch(options)(pick, [provider]);
      await createStockSearch(options)({ shows: "gorilla" }, [provider]); assert.equal(requests, 1);
      clock += provider === "pexels" ? 7200001 : 120001;
      await createStockSearch(options)({ shows: "snake" }, [provider]); assert.equal(requests, 2);
    }
  }
});

test("contact sheet downloads thumbnails only, numbers tiles and supports one or six candidates", async () => {
  for (const count of [1, 6]) {
    const f = fixture(), candidates = normaliseStock("pexels", { videos: Array.from({ length: count }, (_, i) => pexel(i)) });
    const sheet = await stockContactSheet(candidates, { dir: f.dir, deps: f.deps });
    assert.ok(fs.existsSync(sheet)); assert.equal(f.calls.downloads.length, count);
    assert.ok(f.calls.downloads.every((url) => url.startsWith("https://thumb.test/")));
    assert.ok(fs.existsSync(path.join(f.dir, `number-${count}.ppm`)));
    assert.match(f.calls.runs.at(-1).args.join(" "), count === 1 ? /null\[out\]/ : /xstack=inputs=6/);
  }
});

test("stock conform centre-crops portrait, mutes audio and sets 30 fps with seekable keyframes", async () => {
  const f = fixture(); await conformStockClip("in.mp4", path.join(f.dir, "out.mp4"), { runFn: f.deps.runFn });
  const args = f.calls.runs[0].args;
  assert.ok(args.includes("scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280"));
  assert.ok(args.includes("-an")); assert.equal(args[args.indexOf("-r") + 1], "30"); assert.equal(args[args.indexOf("-g") + 1], "30");
});

test("stock uses blind vision first, downloads only the chosen video, checks full and trimmed, saves licence", async () => {
  const f = fixture(), accepted = await makeStockClip(f.args);
  assert.equal(accepted.source, "pexels"); assert.equal(accepted.licence.id, 1); assert.equal(accepted.video, true);
  assert.doesNotMatch(f.calls.looks[0], /Required subject/); assert.match(f.calls.looks[1], /Required subject: "coconut"/);
  assert.deepEqual(f.calls.downloads, ["https://clip.test/1.mp4"]);
  assert.deepEqual(f.calls.checks.map((c) => c.shot.duration), [6, 1.6]); assert.equal(f.calls.checks[1].inPoint, 0.05);
  assert.equal(f.calls.trims[0].options.timeline, verdict);
  const [saved] = readLibrary(f.env).clips;
  assert.equal(saved.id, accepted.libraryId); assert.equal(saved.duration, 6); assert.equal(saved.stockQuery, "coconut falling");
  assert.deepEqual(saved.subjectWords, ["coconut"]); assert.deepEqual(saved.licence, accepted.licence); assert.equal(saved.usedIn.length, 1);
  writeBrollCredits(f.dir, [accepted]); const credit = fs.readFileSync(path.join(f.dir, "broll credits.txt"), "utf8");
  assert.match(credit, /pexels/); assert.match(credit, /ID: 1/); assert.match(credit, /Camera Person/); assert.match(credit, /https:\/\/pexels.test\/video\/1/);
});

test("failed clips allow exactly one different candidate and reuse the single contact sheet", async () => {
  for (const pass of [false, true]) {
    const f = fixture(); let choices = 0, checks = 0, sheets = 0;
    f.deps.stockContactSheet = async (_c, { dir }) => { sheets++; const sheet = path.join(dir, "one.png"); fs.writeFileSync(sheet, "sheet"); return sheet; };
    f.deps.claudeLook = async (p) => p.includes('"seen":"..."') ? '{"seen":"coconuts on sand"}' : choose(++choices);
    f.deps.checkRunwayVideo = async () => ++checks === 1 ? { ok: false } : pass ? verdict : { ok: false };
    const accepted = await makeStockClip(f.args);
    assert.equal(!!accepted, pass); assert.equal(sheets, 1); assert.equal(choices, 2);
    assert.deepEqual(f.calls.downloads, ["https://clip.test/1.mp4", "https://clip.test/2.mp4"]);
  }
});

test("none, uncertain replies, vision failures, faces, text, logos and watermarks fail closed", async () => {
  for (const answer of [choose("none"), choose(1, { shows: false }), choose(1, { safe: false }), choose(1, { humanFaces: true }), choose(1, { readableText: true }), choose(1, { logos: true }), choose(1, { watermarks: true }), '{"choice":1}', "not json"]) {
    const f = fixture(); f.deps.claudeLook = async (p) => p.includes('"seen":"..."') ? '{"seen":"an object"}' : answer;
    assert.equal(await makeStockClip(f.args), null); assert.equal(f.calls.downloads.length, 0);
  }
  const f = fixture(); f.deps.claudeLook = fail; assert.equal(await makeStockClip(f.args), null);
});

test("weapon, dark and wrong-subject picks never search stock or library", async () => {
  const f = fixture();
  for (const invalid of [{ ...pick, scene: "A coconut hanging from a rope" }, { ...pick, action: "A knife cuts the coconut" }, { ...pick, shows: "gorilla", scene: "A gorilla walking" }]) {
    assert.equal(await makeStockClip({ ...f.args, pick: invalid, search: fail }), null);
    assert.equal(await findLibraryClip({ ...f.args, pick: invalid }), null);
  }
});

test("review rejects incomplete events, unavailable checks and failed exact trims", async () => {
  for (const results of [[{ ...verdict, completion: 4 }], [{ ok: true, look: "unavailable" }], [verdict, { ok: false }], [verdict, { ...verdict, completion: 1.6 }]]) {
    const f = fixture(), file = path.join(f.dir, "clip.mp4"); fs.writeFileSync(file, "motion"); let i = 0;
    f.deps.checkRunwayVideo = async () => results[i++] || verdict;
    assert.equal(await reviewMovingClip({ ...f.args, file, duration: 6 }), null);
  }
});

test("library paths honour overrides; only approved motion is saved and duplicate uses are idempotent", () => {
  const f = fixture(); assert.equal(libraryDir({ REEL_BROLL_LIBRARY: "/custom" }), "/custom"); assert.equal(libraryDir(f.env), path.join(f.dir, "broll-library"));
  assert.equal(saveLibraryClip({ shot: { ...shot, file: "still.png", video: false }, pick, workDir: f.dir, env: f.env }), null);
  const clip = seed(f); seed(f); const index = readLibrary(f.env);
  assert.equal(index.clips.length, 1); assert.equal(index.clips[0].usedIn.length, 1); assert.ok(fs.existsSync(clip.file));
});

test("library enforces the previous ten reels, checks the new line, and records accepted reuse", async () => {
  const f = fixture(), clip = seed(f);
  assert.equal(await findLibraryClip(f.args), null); assert.equal(f.calls.checks.length, 0);
  ageLibrary(f);
  const accepted = await findLibraryClip(f.args);
  assert.equal(accepted.libraryId, clip.id); assert.equal(accepted.source, "library"); assert.deepEqual(accepted.licence, clip.licence);
  assert.deepEqual(f.calls.checks.map((c) => c.pick.action), [pick.action, pick.action]);
  assert.equal(readLibrary(f.env).clips[0].usedIn.length, 2);
  assert.equal(await findLibraryClip(f.args), null, "same clip cannot fill a second shot in the reel");
});

test("a recent library asset is not downloaded again from stock", async () => {
  const f = fixture(); seed(f);
  f.args.search = async () => normaliseStock("pexels", { videos: [pexel()] });
  assert.equal(await makeStockClip(f.args), null); assert.equal(f.calls.downloads.length, 0);
});

test("a library fit failure tries the next matching clip once and never accepts a failed review", async () => {
  const f = fixture(); seed(f); ageLibrary(f);
  f.deps.checkRunwayVideo = async () => ({ ok: false });
  assert.equal(await findLibraryClip(f.args), null);
  assert.equal(readLibrary(f.env).clips[0].usedIn.length, 1);
});

test("Codex folder plans without drawing; library wins before stock and never calls Runway", async () => {
  const f = fixture(); seed(f); ageLibrary(f); let codex = 0;
  f.deps.codexExec = async (prompt) => { codex++; assert.match(prompt, /Plan only/); assert.match(prompt, /stockQuery: 2-4/); return JSON.stringify({ picks: [pick] }); };
  f.deps.fetchFn = fail;
  const args = { workDir: f.dir, groups, duration: 20, settings: { animate: false, library: true, stock: ["pexels"] }, deps: f.deps };
  const [accepted] = await makeBroll(args);
  assert.equal(accepted.source, "library"); assert.equal(codex, 1); assert.equal(accepted.start, 6.4); assert.equal(accepted.duration, 1.6);
  assert.deepEqual(await makeBroll(args), [accepted]); assert.equal(codex, 1);
  assert.match(fs.readFileSync(path.join(f.dir, "broll", "broll.json"), "utf8"), /"licence"/);
});

test("Codex folder uses stock before drawing, with no paid sound even when sfx is configured", async () => {
  const f = fixture(); let codex = 0;
  f.deps.codexExec = async () => { codex++; return JSON.stringify({ picks: [pick] }); };
  f.deps.fetchFn = async (url) => { f.calls.downloads.push(url); return json(url.startsWith("https://api.pexels.com") ? { videos: Array.from({ length: 6 }, (_, i) => pexel(i + 1)) } : {}); };
  const [accepted] = await makeBroll({ workDir: f.dir, groups, duration: 20, settings: { animate: false, library: true, stock: ["pexels"], sfx: true }, deps: f.deps });
  assert.equal(accepted.source, "pexels"); assert.equal(codex, 1); assert.equal(accepted.sfx, undefined);
});

test("no keys or no stock fit draws today's Codex still as the last fallback", async () => {
  for (const noKeys of [true, false]) {
    const f = fixture(); let codex = 0;
    if (noKeys) f.deps.env = { REEL_CACHE: f.dir };
    f.deps.fetchFn = noKeys ? fail : async () => json({ videos: [] });
    f.deps.codexExec = async (prompt, { cwd }) => { codex++; if (codex === 2) { assert.match(prompt, /Draw this approved scene only/); fs.writeFileSync(path.join(cwd, "broll-1.png"), Buffer.alloc(2000)); } return JSON.stringify({ picks: [pick] }); };
    const [accepted] = await makeBroll({ workDir: f.dir, groups, duration: 20, settings: { animate: false, library: true, stock: ["pexels", "pixabay"] }, deps: f.deps });
    assert.match(accepted.file, /broll-1.png$/); assert.equal(accepted.stillSource, "codex"); assert.equal(codex, 2);
    assert.equal(f.calls.checks.length, 0);
  }
});

test("Runway folder reuses a library clip before credit checks, even without a Runway key", async () => {
  const f = fixture(); seed(f); ageLibrary(f);
  f.deps.hasRunway = () => false; f.deps.claudeText = async () => JSON.stringify({ picks: [pick] });
  f.deps.recordUsage = () => {}; f.deps.fetchFn = fail;
  const [accepted] = await makeRunwayBroll({ workDir: f.dir, groups, duration: 20, settings: { library: true, stock: [] }, deps: f.deps });
  assert.equal(accepted.source, "library"); assert.equal(accepted.video, true);
});

test("house presets enable free footage only on Codex; clients default to neither source", () => {
  assert.deepEqual(loadPreset("pingel-brand").broll.stock, ["pexels", "pixabay"]);
  assert.equal(loadPreset("pingel-brand").broll.library, true); assert.equal(loadPreset("pingel-brand").broll.animate, false);
  assert.deepEqual(loadPreset("pingel-runway").broll.stock, []); assert.equal(loadPreset("pingel-runway").broll.library, true);
  assert.deepEqual(CLIENT_BASE.broll, { animate: false, stock: [], library: false });
  const f = fixture(), own = path.join(f.dir, "brand.json");
  fs.writeFileSync(own, JSON.stringify({ name: "brand-example", extends: "pingel-brand" }));
  assert.deepEqual(loadPreset(own).broll.stock, []); assert.equal(loadPreset(own).broll.library, false);
  fs.writeFileSync(own, JSON.stringify({ name: "brand-example", extends: "pingel-brand", broll: { stock: ["pexels"], library: true } }));
  assert.deepEqual(loadPreset(own).broll.stock, ["pexels"]); assert.equal(loadPreset(own).broll.library, true);
  const client = brandPreset({ name: "Client", handle: "@client", brollEngine: "runway" });
  assert.deepEqual(client.broll.stock, []); assert.equal(client.broll.library, false);
});

test("Codex adds a literal stock query while retaining shared subject, weapon and daylight rules", () => {
  const prompt = picksPrompt({ candidates: [], count: 1 });
  assert.match(prompt, /stockQuery: 2-4/); assert.match(prompt, /Weapon lines stay on the speaker/); assert.match(prompt, /A jungle stays a jungle; a snake stays a snake/);
});


test("stock excludes a clip used in the tenth prior reel after current-reel registration", async () => {
  const f = fixture(); seed(f);
  const index = readLibrary(f.env);
  index.reels.push(...Array.from({ length: 9 }, (_, i) => path.join(f.dir, `intervening-${i}`)), path.resolve(f.dir));
  writeJSON(path.join(libraryDir(f.env), "index.json"), index);
  f.args.search = async () => normaliseStock("pexels", { videos: [pexel()] });
  assert.equal(await makeStockClip(f.args), null);
  assert.equal(f.calls.downloads.length, 0);
});

test("stock honours HTTP-date Retry-After and defaults cooldowns when reset headers are absent", async () => {
  for (const dateHeader of [false, true]) {
    const f = fixture(); let clock = 1800000000000, requests = 0;
    const options = { env: f.env, now: () => clock, warnFn: () => {}, fetchFn: async () => {
      requests++;
      return json({}, 429, dateHeader ? { "Retry-After": new Date(clock + 7200000).toUTCString() } : {});
    } };
    await createStockSearch(options)(pick, ["pexels"]);
    clock += 3600001;
    await createStockSearch(options)({ shows: "gorilla" }, ["pexels"]);
    assert.equal(requests, dateHeader ? 1 : 2);
  }
});

test("a bad downloaded duration rejects that candidate before video inspection", async () => {
  const f = fixture(); f.deps.runFn = async () => ({ out: "2" });
  let choices = 0;
  f.deps.claudeLook = async (p) => p.includes('"seen":"..."') ? '{"seen":"coconuts on sand"}' : choose(++choices);
  assert.equal(await makeStockClip(f.args), null);
  assert.equal(f.calls.checks.length, 0);
  assert.equal(f.calls.downloads.length, 2);
});

test("library refusal does not prevent the next matching clip from being checked", async () => {
  const f = fixture(); seed(f);
  const file = path.join(f.dir, "second.mp4"); fs.writeFileSync(file, "different motion");
  const second = saveLibraryClip({ shot: { ...shot, file, video: true, moves: verdict }, pick, workDir: path.join(f.dir, "older-reel"), duration: 6, licence: { provider: "pexels", id: 2 }, env: f.env });
  ageLibrary(f);
  let checked = 0; f.deps.checkRunwayVideo = async () => ++checked === 1 ? { ok: false } : verdict;
  const accepted = await findLibraryClip(f.args);
  assert.equal(accepted.libraryId, second.id);
  assert.equal(checked, 3);
});


test("Retry-After seconds defer the provider without imposing the fallback-hour cooldown", async () => {
  const f = fixture(); let clock = 1800000000000, requests = 0;
  const options = { env: f.env, now: () => clock, warnFn: () => {}, fetchFn: async () => { requests++; return json({}, 429, { "Retry-After": "2" }); } };
  await createStockSearch(options)(pick, ["pexels"]);
  clock += 1000; await createStockSearch(options)({ shows: "snake" }, ["pexels"]); assert.equal(requests, 1);
  clock += 1001; await createStockSearch(options)({ shows: "gorilla" }, ["pexels"]); assert.equal(requests, 2);
});

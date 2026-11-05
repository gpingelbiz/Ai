import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { updateClient, command } from "../src/client-update.mjs";
import { maintenanceAgents, installMaintenance } from "../scripts/client-maintenance.mjs";
import { studioHealth, stuckDrops, validPingURL, healthPing } from "../src/studio-health.mjs";
import { guideReady, clientStatus } from "../src/client-status.mjs";
import { withDefaults, initStudio, studioPaths, loadStudio, readPosts, logPost, checkStudio } from "../src/content-studio.mjs";
import { studioAgents } from "../src/studio-cli.mjs";
import { postInput, normalizeScheduled, metricoolCall } from "../src/studio-metricool.mjs";
import { reelSlot, trialSlotFor, scheduleReel } from "../src/studio-reels.mjs";
import { runDaily, openSlots, retryable, publishPost } from "../src/daily.mjs";
import { runStories, parseStory, storySpec, runFilmingPack, parseFilmingPack, filmingPrompt, storyPrompt, HOW_TO_FILM, sameAngle } from "../src/studio-extras.mjs";
import { lintSlideCopy } from "../src/slide-preflight.mjs";
import { normalizeSlideSpec, slideHTML } from "../src/slides.mjs";
import { PKG_ROOT } from "../src/util.mjs";

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "client-parity-")); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const NOW = new Date("2026-11-08T06:00:00Z"); // Sunday in UTC
function studio(t, config = {}) {
  const root = tmp(t);
  fs.cpSync(path.join(PKG_ROOT, "examples", "content-studio"), root, { recursive: true });
  const paths = studioPaths(root);
  const c = withDefaults({ client: "Example", timezone: "UTC", slots: [], daysAhead: 0, publish: { mode: "off" }, ...config });
  fs.writeFileSync(paths.config, JSON.stringify(c));
  fs.writeFileSync(paths.guide, "Window light. Wooden desk. Paper notebook. Open the door. Read the note. Put the phone away. Ask a clear question. Listen before speaking. Keep it simple.");
  return loadStudio(root, { publishing: false });
}
const pass = async () => ({ verdict: "schedule", slides: [], photoHashes: [] });
const game = { type: "ab", question: "Your pick?", left: "Read the note", right: "Put the phone away", action: "Reply with your pick" };
const pack = () => ({ prompts: ["Window light", "Wooden desk", "Paper notebook", "Open the door", "Read the note", "Put the phone away"].map((angle, i) => ({ angle, source: angle, kind: i === 0 ? "story" : "idea", opening: i === 0 ? "When did you notice the light?" : "Put your phone by the window", beats: i === 0 ? ["What did you see?", "What changed?", "What would you try?"] : ["Name the object", "Show the action", "Ask the question"], lastLine: i === 0 ? "What would you do again?" : "Try it on your next take", seconds: 35 })), broll: ["Wooden desk", "Paper notebook", "Open the door"].map((idea) => ({ idea, seconds: 7 })) });

function updater(t, { dirty = false, changed = true, packages = false, fail = "", dirtyAfter = false } = {}) {
  const root = tmp(t), app = path.join(root, "reel-editor"), state = path.join(root, "state");
  fs.mkdirSync(app); fs.writeFileSync(path.join(app, "package-lock.json"), "{}");
  const calls = [], notices = [];
  let pulled = false;
  const run = (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd });
    if (cmd === "git") {
      if (args[0] === "rev-parse") return args[1] === "--show-toplevel" ? root : pulled && changed ? "new" : "old";
      if (args[0] === "status") return dirty || pulled && dirtyAfter ? " M file" : "";
      if (args[0] === "pull") { if (fail === "pull") throw new Error("offline"); pulled = true; }
      if (args[0] === "diff") return packages ? "reel-editor/package-lock.json" : "";
    }
    if (cmd === process.execPath && fail === "smoke") throw new Error("smoke failed");
    if (cmd === "npm" && fail === "npm") throw new Error("install failed");
    return "";
  };
  return { app, state, run, notify: (...a) => notices.push(a), calls, notices };
}

test("updates: dirty trees skip without pulling or touching files and notify", async (t) => {
  const u = updater(t, { dirty: true });
  assert.equal((await updateClient(u)).status, "dirty");
  assert.ok(!u.calls.some((c) => ["pull", "reset"].includes(c.args[0])));
  assert.equal(u.notices.length, 1);
});
test("updates: no change logs quietly without dependencies or smoke", async (t) => {
  const u = updater(t, { changed: false });
  assert.equal((await updateClient(u)).status, "unchanged");
  assert.equal(u.notices.length, 0);
  assert.ok(u.calls.every((c) => c.cmd === "git"));
});
for (const packages of [false, true]) test(`updates: packages refreshed only when package files change (${packages})`, async (t) => {
  const u = updater(t, { packages });
  assert.equal((await updateClient(u)).status, "updated");
  assert.equal(u.calls.filter((c) => c.cmd === "npm").length, Number(packages));
  assert.ok(u.calls.some((c) => c.args[0]?.endsWith("client-smoke.mjs")));
  assert.equal(u.notices.length, 1);
});
test("updates: failed self-check restores previous commit and dependency version, leaving a note", async (t) => {
  const u = updater(t, { packages: true, fail: "smoke" });
  assert.equal((await updateClient(u)).status, "failed");
  assert.deepEqual(u.calls.find((c) => c.args[0] === "reset").args, ["reset", "--keep", "old"]);
  assert.equal(u.calls.filter((c) => c.cmd === "npm").length, 2);
  assert.match(fs.readFileSync(path.join(u.state, "Update needs attention.txt"), "utf8"), /Returned to old/);
});
test("updates: pull failure leaves existing code; new local edits prevent rollback", async (t) => {
  const u = updater(t, { fail: "pull" });
  assert.equal((await updateClient(u)).status, "failed");
  assert.ok(!u.calls.some((c) => c.args[0] === "reset"));
  const v = updater(t, { fail: "smoke", dirtyAfter: true });
  assert.match((await updateClient(v)).why, /new local changes appeared/);
  assert.ok(!v.calls.some((c) => c.args[0] === "reset"));
});
test("updates: only one updater can hold its lock", async (t) => {
  const u = updater(t); fs.mkdirSync(path.join(u.state, "update.lock"), { recursive: true });
  assert.equal((await updateClient(u)).status, "locked"); assert.equal(u.calls.length, 0);
});
test("agents: stable weekly update agent for both kits; editor-only gets drop health", (t) => {
  const home = tmp(t);
  const opts = { home, app: path.join(home, "app"), run: () => ({ status: 0 }) };
  const a = installMaintenance(opts), b = installMaintenance(opts);
  assert.deepEqual(a.map((x) => x.label), b.map((x) => x.label));
  assert.equal(fs.readdirSync(path.join(home, "Library/LaunchAgents")).length, 2);
  assert.match(a[0].plist, /Weekday/); assert.match(a[0].plist, /<integer>2<\/integer>/);
  installMaintenance({ ...opts, app: path.join(home, "moved-app"), studio: true });
  assert.equal(fs.readdirSync(path.join(home, "Library/LaunchAgents")).length, 1);
  assert.equal(maintenanceAgents({ ...opts, studio: true }).length, 1);
  const health = studioAgents(path.join(home, "Content Studio"), { home })[2];
  assert.match(health.plist, /<string>health<\/string>/);
  assert.equal((health.plist.match(/<key>Hour<\/key>/g) || []).length, 3);
});
test("installer: client opt-in preserves my-brand, and uses maintenance in either kit", () => {
  const sh = fs.readFileSync(path.join(PKG_ROOT, "install.sh"), "utf8");
  assert.match(sh, /cmp -s "\$CONF\/my-brand.json" "\$CONF\/.kit-my-brand.json"/);
  assert.match(sh, /my-brand.kit-new.json/);
  assert.match(sh, /if \[ "\$LOOK" = brand \]; then\n  MAINTENANCE_ARGS/);
  assert.match(sh, /status --porcelain --untracked-files=all/);
});

test("health: old raw and Publish videos alert; fresh videos and Done do not", (t) => {
  const s = studio(t); const old = new Date(NOW.getTime() - 90000000);
  fs.writeFileSync(path.join(s.paths.rawReels, "old.mov"), "v"); fs.utimesSync(path.join(s.paths.rawReels, "old.mov"), old, old);
  fs.writeFileSync(path.join(s.paths.rawReels, "fresh.mp4"), "v"); fs.utimesSync(path.join(s.paths.rawReels, "fresh.mp4"), NOW, NOW);
  fs.mkdirSync(path.join(s.paths.rawReels, "Done")); fs.writeFileSync(path.join(s.paths.rawReels, "Done", "old.mp4"), "v");
  fs.mkdirSync(path.join(s.paths.publish, "finished"), { recursive: true });
  const p = path.join(s.paths.publish, "finished", "old.mp4"); fs.writeFileSync(p, "v"); fs.utimesSync(p, old, old);
  assert.equal(stuckDrops([s.paths.rawReels, s.paths.publish], { now: NOW.getTime() }).length, 2);
});
test("health: missed daily run and disconnected Claude notify and write STATUS without telemetry", async (t) => {
  const s = studio(t), notices = [];
  clientStatus(s.paths, "filming", "Your guide is unfinished", NOW);
  const r = await studioHealth(s.paths.root, { now: new Date("2026-11-08T13:00Z"), deps: { claudeConnected: () => false, notify: (...a) => notices.push(a), healthPing: () => { throw new Error("must not ping"); } } });
  assert.equal(r.issues.length, 2); assert.equal(notices.length, 1);
  assert.match(fs.readFileSync(path.join(s.paths.root, "STATUS.txt"), "utf8"), /filming: Your guide is unfinished/);
});
test("health: successful empty daily run is recorded and clears missed-run alert", async (t) => {
  const s = studio(t); await runDaily(s.paths.root, { now: NOW, deps: { writeFilmingPack: async () => JSON.stringify(pack()) } });
  const r = await studioHealth(s.paths.root, { now: new Date("2026-11-08T13:00Z"), deps: { claudeConnected: () => true, notify: () => assert.fail("healthy run notified") } });
  assert.deepEqual(r.issues, []);
});
test("health: Metricool disconnection and post provider errors are visible", async (t) => {
  const s = studio(t, { publish: { mode: "schedule" }, metricool: { blogId: "1", connector: "Metricool" } });
  const deps = { claudeConnected: () => true, detectConnectors: async () => ({ metricool: { connected: false } }), notify: () => {} };
  assert.match((await studioHealth(s.paths.root, { now: NOW, deps })).message, /Metricool is disconnected/);
  const posts = normalizeScheduled({ data: [{ date: "2026-11-07T11:00", providers: [{ status: "ERROR", errorMessage: "Token expired" }] }] });
  const r = await studioHealth(s.paths.root, { now: NOW, deps: { ...deps, detectConnectors: async () => ({ metricool: { name: "Metricool", connected: true } }), scheduledPosts: async () => posts } });
  assert.match(r.message, /Metricool post failed.*Token expired/);
});
test("health: editor-only checks drops without touching Claude, Metricool or a ping", async (t) => {
  const root = tmp(t);
  const r = await studioHealth(root, { dropFolders: [], deps: { claudeConnected: () => assert.fail(), detectConnectors: () => assert.fail(), healthPing: () => assert.fail(), notify: () => assert.fail() } });
  assert.deepEqual(r.issues, []);
});
test("health: only an explicit https ping is sent, with /fail on problems and no content", async () => {
  for (const url of ["http://example.test/x", "https://user:pw@example.test/x", "not a url"]) assert.equal(validPingURL(url), false);
  let calls = [];
  const f = async (...a) => { calls.push(a); return { ok: true }; };
  await healthPing("", false, f); assert.equal(calls.length, 0);
  await healthPing("https://example.test/check?key=mine", true, f);
  assert.equal(calls[0][0], "https://example.test/check/fail?key=mine"); assert.equal(calls[0][1].body, undefined);
  await assert.rejects(healthPing("http://example.test", false, f), /https/);
});

test("trial: only new studios default to both; existing missing/false/true/both values survive", (t) => {
  const root = tmp(t); const p = initStudio(path.join(root, "new"));
  assert.equal(JSON.parse(fs.readFileSync(p.config)).reels.trial, "both");
  for (const value of [undefined, false, true, "both"]) {
    fs.writeFileSync(p.config, JSON.stringify({ reels: value === undefined ? {} : { trial: value } }));
    initStudio(p.root); assert.equal(JSON.parse(fs.readFileSync(p.config)).reels.trial, value ?? false);
  }
});
test("brand: re-running init keeps the client's own editable files", (t) => {
  const root = tmp(t), brand = path.join(root, "Brand"); fs.mkdirSync(brand);
  for (const file of ["voice.md", "brand-guide.md", "dictionary.json", "my-brand.json"]) fs.writeFileSync(path.join(brand, file), "kit");
  const p = initStudio(path.join(root, "studio"), { brandFrom: brand });
  for (const f of fs.readdirSync(brand)) fs.writeFileSync(path.join(p.brand, f), "mine");
  fs.writeFileSync(path.join(brand, "my-brand.json"), "kit v2");
  initStudio(p.root, { brandFrom: brand });
  for (const f of fs.readdirSync(brand)) assert.equal(fs.readFileSync(path.join(p.brand, f), "utf8"), "mine");
  assert.equal(fs.readFileSync(path.join(p.brand, "my-brand.kit-new.json"), "utf8"), "kit v2");
});
test("brand: an untouched my-brand.json takes the new kit's settings", (t) => {
  const root = tmp(t), brand = path.join(root, "Brand"); fs.mkdirSync(brand);
  fs.writeFileSync(path.join(brand, "my-brand.json"), "kit v1");
  const p = initStudio(path.join(root, "studio"), { brandFrom: brand });
  fs.writeFileSync(path.join(brand, "my-brand.json"), "kit v2");
  initStudio(p.root, { brandFrom: brand });
  assert.equal(fs.readFileSync(path.join(p.brand, "my-brand.json"), "utf8"), "kit v2");
  assert.equal(fs.existsSync(path.join(p.brand, "my-brand.kit-new.json")), false);
});
test("brand: a studio from before this change (no kit copy) takes the new kit's settings", (t) => {
  const root = tmp(t), brand = path.join(root, "Brand"); fs.mkdirSync(brand);
  fs.writeFileSync(path.join(brand, "my-brand.json"), "kit v1");
  const p = initStudio(path.join(root, "studio"), { brandFrom: brand });
  fs.rmSync(path.join(p.brand, ".kit-my-brand.json"));
  fs.writeFileSync(path.join(brand, "my-brand.json"), "kit v2");
  initStudio(p.root, { brandFrom: brand });
  assert.equal(fs.readFileSync(path.join(p.brand, "my-brand.json"), "utf8"), "kit v2");
});
test("trial: trial records never take a normal reel day; stories never block any feed slot", () => {
  const p = { day: "2026-11-08", time: "10:00", format: "trial", trial: true, status: "scheduled" };
  assert.equal(reelSlot({ now: NOW, tz: "UTC", posts: [p], scheduled: [{ day: p.day, hour: 12, minute: 0, type: "STORY" }] }).day, p.day);
  const config = withDefaults({ timezone: "UTC", daysAhead: 0, slots: [{ time: "10:00", format: "static" }] });
  assert.equal(openSlots({ config, now: NOW, posts: [{ ...p, format: "story", trial: false }], scheduled: [{ day: p.day, hour: 10, minute: 0, type: "STORY" }] }).length, 1);
  assert.notEqual(reelSlot({ now: NOW, tz: "UTC", posts: [{ ...p, format: "reel" }], reels: { trial: true } }).day, p.day, "existing trial-only installs retain one reel a day");
  const at = trialSlotFor({ now: NOW, tz: "UTC", posts: [{ ...p, format: "reel", trial: false }], scheduled: [{ day: p.day, hour: 8, minute: 0, type: "POST" }], from: p.day });
  assert.equal(at.hour, 12);
});
test("trial: both sends two independent records, only the normal copy to other networks; failed trial retries alone", async (t) => {
  const s = studio(t, { reels: { trial: "both" }, publish: { mode: "schedule" }, metricool: { connector: "Test", blogId: "1", networks: ["instagram", "tiktok"] } });
  const folder = path.join(s.paths.root, "delivered"); fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, "clip.mp4"), "v"); fs.writeFileSync(path.join(folder, "caption.txt"), "Ask a clear question.");
  const created = [];
  const deps = { notify: () => {}, scheduledPosts: async () => [], bestTimes: async () => [], hostFiles: async () => ({ urls: ["https://example.test/video"], close: async () => {} }), createPost: async (_, input) => { const info = JSON.parse(input.info); created.push(info); if (info.instagramData.type === "TRIAL_REEL") throw new Error("trial failed"); return { id: 1, plannerUrl: "" }; } };
  const r = await scheduleReel(s, { folder }, { now: NOW, deps });
  assert.equal(r.status, "scheduled"); assert.equal(r.trialCopy.status, "not-posted");
  assert.deepEqual(created.map((x) => x.instagramData.type), ["REEL", "TRIAL_REEL"]);
  assert.equal(created[0].providers.length, 2); assert.deepEqual(created[1].providers, [{ network: "instagram" }]);
  assert.ok(Math.abs(Number(r.time.slice(0, 2)) - Number(r.trialCopy.time.slice(0, 2))) >= 2);
  const retry = retryable(readPosts(s.paths), { tz: "UTC", now: NOW }); assert.equal(retry.length, 1); assert.equal(retry[0].format, "trial");
  await publishPost(s, retry[0], { deps: { ...deps, createPost: async (_, input) => { assert.equal(JSON.parse(input.info).instagramData.type, "TRIAL_REEL"); return { id: 2 }; } } });
  assert.equal(readPosts(s.paths).filter((p) => p.status === "scheduled").length, 2);
});

test("stories: disabled by default, and placeholder guide refuses every generation call", async (t) => {
  const s = studio(t); assert.equal(s.config.stories.enabled, false);
  assert.deepEqual(await runStories(s, { deps: { writeStory: () => assert.fail() } }), []);
  s.config.stories.enabled = true; s.guide = "NOT FILLED IN YET";
  assert.deepEqual(await runStories(s, { now: NOW, deps: { writeStory: () => assert.fail() } }), []);
  assert.match(fs.readFileSync(path.join(s.paths.root, "STATUS.txt"), "utf8"), /stories: OFF/);
  assert.equal(guideReady(" \n"), false);
});
test("stories: prompts use their brand; unsupported numbers, examples and never-say text are held", (t) => {
  const s = studio(t); const prompt = storyPrompt(s, { day: "2026-11-08", time: "08:00" }, []);
  assert.match(prompt, /Wooden desk/); assert.match(prompt, /Never a lesson/);
  assert.throws(() => parseStory(JSON.stringify({ ...game, left: "Invented client quote" }), s), /directly from your guide/);
  assert.throws(() => parseStory(JSON.stringify({ ...game, question: "Which earned 900 dollars?" }), s), /not supplied/);
  s.config.neverSay = ["pick"]; assert.throws(() => parseStory(JSON.stringify(game), s), /never say/);
});
test("stories: existing compare/body looks support 1080x1920 with the client's colors", (t) => {
  const s = studio(t); const spec = storySpec(parseStory(JSON.stringify(game), s));
  assert.equal(normalizeSlideSpec(spec).height, 1920);
  assert.deepEqual(lintSlideCopy(spec.slides[0], [], { index: 1 }), []);
  const html = slideHTML(spec.slides[0], s.tokens, { height: 1920 });
  assert.match(html, /height=1920/); assert.ok(html.includes(s.tokens.colors.accent));
  const input = JSON.parse(postInput({ blogId: "1", day: "2026-11-08", time: "08:00", tz: "UTC", text: "", media: [], kind: "story", networks: ["instagram", "tiktok"] }).info);
  assert.equal(input.instagramData.type, "STORY"); assert.deepEqual(input.providers, [{ network: "instagram" }]);
});
test("stories: preflight hold prevents hosting and publication", async (t) => {
  const s = studio(t, { stories: { enabled: true, slots: ["08:00"] } });
  const r = await runStories(s, { now: NOW, deps: { writeStory: async () => JSON.stringify(game), renderSlides: async () => [], preflightSlides: async () => ({ verdict: "hold", slides: [], photoHashes: [] }), hostFiles: () => assert.fail(), createPost: () => assert.fail() } });
  assert.equal(r[0].status, "held");
});
test("stories: own slots schedule once, independently from a feed post at the same time", async (t) => {
  const s = studio(t, { stories: { enabled: true, slots: ["08:00"] }, publish: { mode: "schedule" }, metricool: { blogId: "1", connector: "Test", networks: ["instagram", "tiktok"] } });
  logPost(s.paths, { id: "feed", day: "2026-11-08", time: "08:00", format: "static", status: "scheduled" });
  const file = path.join(s.paths.work, "frame.png"); fs.mkdirSync(s.paths.work, { recursive: true }); fs.writeFileSync(file, "png");
  let calls = 0;
  const deps = { writeStory: async () => JSON.stringify(game), renderSlides: async () => [file], preflightSlides: pass, hostFiles: async () => ({ urls: ["https://example.test/story.png"], close: async () => {} }), createPost: async (_, input) => { calls++; assert.equal(JSON.parse(input.info).instagramData.type, "STORY"); return { id: 3 }; } };
  assert.equal((await runStories(s, { now: NOW, deps }))[0].status, "scheduled");
  assert.deepEqual(await runStories(s, { now: NOW, deps }), []); assert.equal(calls, 1);
});

test("filming: only Sunday generates; unfinished brand guide leaves a STATUS note", async (t) => {
  const s = studio(t, { filming: { enabled: true } }); s.guide = "NOT FILLED IN YET";
  assert.equal((await runFilmingPack(s, { now: NOW, deps: { writeFilmingPack: () => assert.fail() } })).skipped, "brand guide");
  assert.match(fs.readFileSync(path.join(s.paths.root, "STATUS.txt"), "utf8"), /filming: Skipped/);
  assert.equal((await runFilmingPack(s, { now: new Date("2026-11-09T06:00Z"), deps: { writeFilmingPack: () => assert.fail() } })).skipped, "not Sunday");
});
test("filming: validates six short prompts, question-only stories and clip durations", (t) => {
  const s = studio(t, { filming: { enabled: true } }); assert.equal(parseFilmingPack(JSON.stringify(pack()), s).prompts.length, 6);
  const long = pack(); long.prompts[1].opening = "word ".repeat(13); assert.throws(() => parseFilmingPack(JSON.stringify(long), s), /short opening/);
  const story = pack(); story.prompts[0].beats[0] = "You saw a famous person"; assert.throws(() => parseFilmingPack(JSON.stringify(story), s), /ask questions/);
  const clip = pack(); clip.broll[0].seconds = 11; assert.throws(() => parseFilmingPack(JSON.stringify(clip), s), /5 to 10/);
  const claim = pack(); claim.prompts[1].lastLine = "I earned 900 dollars"; assert.throws(() => parseFilmingPack(JSON.stringify(claim), s), /not supplied/);
});
test("filming: recent angles reject duplicates and include guide/voice in the prompt", (t) => {
  const s = studio(t, { filming: { enabled: true } }); assert.throws(() => parseFilmingPack(JSON.stringify(pack()), s, ["Window light"]), /Repeated angle/);
  assert.equal(sameAngle("Put the phone away!", "put the phone away"), true);
  assert.match(filmingPrompt(s, "2026-11-09", ["Recent angle"]), /Recent angle/);
  assert.match(filmingPrompt(s, "2026-11-09", []), /Wooden desk/);
});
test("filming: Sunday writes Monday pack and identical filming box, re-run never rewrites it", async (t) => {
  const s = studio(t, { filming: { enabled: true } }); let calls = 0;
  const deps = { writeFilmingPack: async () => { calls++; return JSON.stringify(pack()); } };
  const r = await runFilmingPack(s, { now: NOW, deps });
  assert.equal(path.basename(r.file), "2026-11-09 filming pack.md");
  const md = fs.readFileSync(r.file, "utf8"); assert.equal((md.match(/^## \d/gm) || []).length, 6); assert.ok(md.includes(HOW_TO_FILM));
  assert.equal((await runFilmingPack(s, { now: NOW, deps })).skipped, "already made"); assert.equal(calls, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.paths.state, "filming-history.json"))).length, 6);
});
test("filming: recent posted and assigned angles are considered; older than 14 days are excluded", async (t) => {
  const s = studio(t, { filming: { enabled: true } }); logPost(s.paths, { id: "old", day: "2026-10-01", angle: "Window light", status: "scheduled" });
  logPost(s.paths, { id: "recent", day: "2026-11-01", angle: "Read the note", status: "scheduled" });
  const r = await runFilmingPack(s, { now: NOW, deps: { writeFilmingPack: async (prompt) => { assert.match(prompt, /Read the note/); return JSON.stringify(pack()); } } });
  assert.equal(r.status, "failed"); assert.match(r.why, /Repeated angle/);
});
test("filming: off for existing studios, on for new ones", async (t) => {
  const s = studio(t);
  assert.equal((await runFilmingPack(s, { now: NOW, deps: { writeFilmingPack: () => assert.fail() } })).skipped, "off");
  const p = initStudio(path.join(tmp(t), "new"));
  assert.equal(JSON.parse(fs.readFileSync(p.config)).filming.enabled, true);
});

// Mac bash 3.2 in a UTF-8 locale reads a non-ASCII character after $name as part of the name, so with set -u
// `$formula…` dies with "unbound variable" (a client's fresh Mac stopped at install.sh line 91). Write ${name}….
test("shell scripts never put a non-ASCII character right after a bare $variable", () => {
  const files = ["install.sh", "kit/Install Reel Editor.command", "kit/Install Reels.command", ...fs.readdirSync(path.join(PKG_ROOT, "scripts")).filter((f) => f.endsWith(".sh")).map((f) => `scripts/${f}`)];
  const bad = [];
  for (const f of files) fs.readFileSync(path.join(PKG_ROOT, f), "utf8").split("\n").forEach((line, i) => { if (/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/.test(line)) bad.push(`${f}:${i + 1}`); });
  assert.deepEqual(bad, []);
});

test("installer runs its $formula note under Mac bash in a UTF-8 locale", { skip: !fs.existsSync("/bin/bash") }, () => {
  const line = fs.readFileSync(path.join(PKG_ROOT, "install.sh"), "utf8").split("\n").find((l) => l.includes('note "installing ')).match(/note "installing [^"]*"/)[0];
  const r = spawnSync("/bin/bash", ["-c", `set -u; note() { echo "$1"; }; formula=ffmpeg; ${line}`], { encoding: "utf8", env: { ...process.env, LC_ALL: "en_US.UTF-8" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /installing ffmpeg/);
});

function fakeClaude(t, replies) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-"));
  t.after(() => { delete process.env.REEL_CLAUDE_BIN; fs.rmSync(dir, { recursive: true, force: true }); });
  const bin = path.join(dir, "claude"), count = path.join(dir, "count");
  fs.writeFileSync(path.join(dir, "replies.json"), JSON.stringify(replies));
  fs.writeFileSync(bin, `#!/usr/bin/env node\nconst fs=require("fs");const c=${JSON.stringify(count)};const n=fs.existsSync(c)?Number(fs.readFileSync(c,"utf8")):0;fs.writeFileSync(c,String(n+1));const r=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, "replies.json"))},"utf8"));process.stdout.write(r[Math.min(n,r.length-1)]);\n`);
  fs.chmodSync(bin, 0o755);
  process.env.REEL_CLAUDE_BIN = bin;
  return () => Number(fs.readFileSync(count, "utf8"));
}
const NOT_READY = JSON.stringify({ error: "Tool mcp__claude_ai_Metricool__getBrandSettings is not available in this session" });

test("a connector that is not ready yet is asked again, then the result comes back", async (t) => {
  const calls = fakeClaude(t, [NOT_READY, "The tool is not available in this session.", JSON.stringify({ data: [{ id: 1 }] })]);
  const r = await metricoolCall("Metricool", "getBrandSettings", {}, { notReadyWaits: [1, 1] });
  assert.deepEqual(r, { data: [{ id: 1 }] });
  assert.equal(calls(), 3);
});

test("a connector that never loads stops with what to do", async (t) => {
  const calls = fakeClaude(t, [NOT_READY]);
  await assert.rejects(metricoolCall("Metricool", "getBrandSettings", {}, { notReadyWaits: [1, 1] }), /\/mcp[\s\S]*Settings, Connectors/);
  assert.equal(calls(), 3);
});

test("a real Metricool error is never retried, so a post cannot double", async (t) => {
  const calls = fakeClaude(t, [JSON.stringify({ error: "Authorization Error" })]);
  await assert.rejects(metricoolCall("Metricool", "createScheduledPost", {}, { notReadyWaits: [1, 1] }), /Authorization Error/);
  assert.equal(calls(), 1);
});


test("legacy client studios keep raw intake and the legacy publisher by default", (t) => {
  const s = studio(t);
  assert.equal(s.config.reels.rawIntake, true);
  assert.equal(s.config.reels.publisher, "legacy");
  assert.equal(fs.existsSync(s.paths.rawReels), true);
  const source = fs.readFileSync(path.join(PKG_ROOT, "scripts", "client.mjs"), "utf8");
  assert.match(source, /publish: \{ mode: "off" \}/);
  assert.doesNotMatch(source, /publisher: "claude"|rawIntake: false/);
});

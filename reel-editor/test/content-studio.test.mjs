import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkStudio, withDefaults, parseTime, initStudio, loadStudio, studioPaths, readPosts, logPost, takeLock, photosDir, studioBrand } from "../src/content-studio.mjs";
import { parseMix, studioMix, pickJob, markdownTables } from "../src/mix.mjs";
import { badShot, photoScore, momentOf, pickPhotos, photoPool, takenMs, markUsed, PHOTO_RULES } from "../src/photos.mjs";
import { plainText, parseCopy, neverSaid, buildSpec, photoPlan, parsePhotoPicks, copyPrompt, captionText, faceY, buildAltText, shortenPrompt, applyShortenedSlides } from "../src/studio-copy.mjs";
import { connectorPrefix, parseConnectors, zonedISO, postInput, normalizeScheduled, toolPrompt, createdPost } from "../src/studio-metricool.mjs";
import { driveLink, dropboxDirect, fileServer } from "../src/studio-host.mjs";
import { openSlots, retryable, madeName, zonedNow, addDays, runDaily, proofScreenshots } from "../src/daily.mjs";
import { runStudioPreflight, preflightProblems } from "../src/studio-preflight.mjs";
import { waitingClips, reelSlot, normalizeBestTimes, reelEnv } from "../src/studio-reels.mjs";
import { studioAgents } from "../src/studio-cli.mjs";
import { personalizeStartHere, stripStudio } from "../src/brandkit.mjs";
import { legacyHeadSize } from "../src/slides.mjs";
import { buildPrompt } from "../scripts/write-caption.mjs";
import { protectedFolder } from "../scripts/studio-setup.mjs";
import { PKG_ROOT } from "../src/util.mjs";

const SAMPLE = path.join(PKG_ROOT, "examples", "content-studio");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "studio-test-"));

/** A fresh copy of the sample client's folder, set up so the daily run can be driven with stubs. */
function sampleCopy(over = {}) {
  const dir = path.join(tmp(), "Content Studio");
  fs.cpSync(SAMPLE, dir, { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "studio.json"), "utf8"));
  Object.assign(cfg, { metricool: { brand: "Test", blogId: "123", networks: ["instagram"], connector: "Metricool Social Media Management" } }, over);
  fs.writeFileSync(path.join(dir, "studio.json"), JSON.stringify(cfg));
  return dir;
}

/* ---------- studio.json ---------- */

test("studio: defaults are hands-off and valid once the client and Metricool brand are set", () => {
  const c = withDefaults({ client: "Jane", metricool: { blogId: "1" } });
  assert.deepEqual(c.slots.map((s) => s.format), ["carousel", "static"]);
  assert.equal(c.publish.mode, "schedule");
  assert.equal(c.hosting.route, "tunnel");
  assert.equal(c.ai.label, "auto");
  assert.deepEqual(checkStudio(c), []);
});

test("studio: every bad setting is named in words", () => {
  const problems = checkStudio({ client: "", timezone: "Mars/Base", slots: [{ time: "25:00", format: "reel" }, { time: "10:00", format: "carousel" }, { time: "11:00", format: "static" }], hosting: { route: "drive" }, ai: { label: "never" }, metricool: { blogId: "" } });
  const text = problems.join("\n");
  for (const want of ["client is missing", "Mars/Base", "25:00", "carousel\" or \"static", "less than 2 hours", "Google Drive folder", "blogId", "ai.label"]) assert.match(text, new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), want);
});

test("studio: times of day in 24h or am/pm", () => {
  assert.deepEqual(parseTime("10:00"), { h: 10, m: 0 });
  assert.deepEqual(parseTime("6:30 PM"), { h: 18, m: 30 });
  assert.deepEqual(parseTime("12 am"), { h: 0, m: 0 });
  assert.equal(parseTime("13 pm"), null);
  assert.equal(parseTime("24:00"), null);
});

test("studio: init makes the folder, copies the brand and keeps a client's edited voice on a re-run", () => {
  const dir = path.join(tmp(), "Content Studio");
  const brandFrom = path.join(SAMPLE, "brand");
  const p = initStudio(dir, { brandFrom, config: { client: "Jordan Example" } });
  for (const d of [p.rawReels, p.made, p.photos, p.state]) assert.ok(fs.existsSync(d), d);
  assert.ok(fs.existsSync(p.guide) && fs.existsSync(p.voice) && fs.existsSync(p.brandJson));
  fs.writeFileSync(p.voice, "edited by the client");
  initStudio(dir, { brandFrom, config: { daysAhead: 5 } });
  assert.equal(fs.readFileSync(p.voice, "utf8"), "edited by the client");
  const cfg = JSON.parse(fs.readFileSync(p.config, "utf8"));
  assert.equal(cfg.client, "Jordan Example");
  assert.equal(cfg.daysAhead, 5);
});

test("studio: the sample client's brand loads with its own fonts and colors, nothing of Greg's", () => {
  const dir = sampleCopy();
  const s = loadStudio(dir);
  assert.equal(s.tokens.identity.handle, "@jordanexample.coach");
  assert.equal(s.tokens.colors.accent, "#E8704A");
  assert.match(s.tokens.type.display.file, /DMSerifDisplay-Regular\.ttf$/);
  assert.ok(fs.existsSync(s.tokens.type.display.file));
  const all = JSON.stringify(s.tokens) + s.voice + s.guide + fs.readFileSync(path.join(dir, "studio.json"), "utf8");
  for (const greg of [/officialgregpingel/i, /Greg Pingel/i, /Ghost P&L/i, /Signet Gold/i, /#C8A24B/i, /voice\/greg\.md/, /brands\/pingel/]) assert.doesNotMatch(all, greg);
  assert.equal(photosDir(s.config, s.paths), path.join(dir, "Photos"));
});

test("studio: the post log keeps the latest line per post", () => {
  const p = studioPaths(tmp());
  logPost(p, { id: "a", status: "made", hook: "x" });
  logPost(p, { id: "b", status: "made" });
  logPost(p, { id: "a", status: "scheduled", plannerUrl: "u" });
  const posts = readPosts(p);
  assert.equal(posts.length, 2);
  const a = posts.find((x) => x.id === "a");
  assert.equal(a.status, "scheduled");
  assert.equal(a.hook, "x");
});

test("studio: one run at a time", () => {
  const p = studioPaths(tmp());
  const release = takeLock(p, "daily");
  assert.ok(release);
  assert.equal(takeLock(p, "reels"), null);
  release();
  const again = takeLock(p, "reels");
  assert.ok(again);
  again();
});

/* ---------- the mix ---------- */

test("mix: the pillar table in the client's brand guide sets the shares", () => {
  const mix = parseMix(fs.readFileSync(path.join(SAMPLE, "brand", "brand-guide.md"), "utf8"));
  assert.deepEqual(mix.map((m) => [m.name, m.share]), [["Retention", 0.4], ["Owner life", 0.3], ["Systems", 0.3]]);
});

test("mix: an agent-brief ratio line works too, and retired or total rows are dropped", () => {
  assert.deepEqual(parseMix("Pillar ratio: Teach 50% / Story 25% / Proof 25%").map((m) => m.name), ["Teach", "Story", "Proof"]);
  const md = "| Pillar | Share |\n|---|---|\n| Grow | 60% |\n| Retired thing (discontinued) | 10% |\n| Life | 40% |\n| Total | 100% |";
  assert.deepEqual(parseMix(md).map((m) => m.name), ["Grow", "Life"]);
  assert.equal(markdownTables(md)[0].length, 5);
});

test("mix: studio.json's own mix wins; no mix anywhere means an even split, never Greg's jobs", () => {
  assert.equal(studioMix({ mix: [{ name: "A", share: 3 }, { name: "B", share: 1 }] }, "").find((m) => m.name === "A").share, 0.75);
  const even = studioMix({}, "no table here");
  assert.equal(even.length, 3);
  assert.ok(!even.some((m) => /offer|sales|system/i.test(m.name)));
});

test("mix: the job furthest under its share goes next, never twice in a row while another is behind", () => {
  const mix = parseMix("Pillar ratio: Retention 40% / Owner life 30% / Systems 30%");
  assert.equal(pickJob(mix, [], { today: "2026-11-01" }).name, "Retention");
  const history = [{ date: "2026-10-30", job: "Retention" }];
  assert.notEqual(pickJob(mix, history, { today: "2026-11-01" }).name, "Retention");
  const old = [{ date: "2026-09-01", job: "Systems" }, { date: "2026-09-02", job: "Systems" }];
  assert.equal(pickJob(mix, old, { today: "2026-11-01" }).name, "Retention", "posts outside the 14 days do not count");
});

/* ---------- photos ---------- */

const report = (o = {}) => ({ file: "/p/a.jpg", width: 1080, height: 1350, light: 0.45, sharp: 0.015, camera: "iPhone", faces: [{ x: 0.3, y: 0.2, w: 0.2, h: 0.15, quality: 0.6 }], ...o });

test("photos: bad shots are skipped with a reason, good ones pass", () => {
  assert.equal(badShot(report()), "");
  assert.match(badShot(report({ width: 700, height: 900 })), /too small/);
  assert.equal(badShot(report({ screenshot: true })), "a screenshot");
  assert.equal(badShot(report({ file: "/p/IMG.png", camera: "", width: 1179, height: 2556 })), "looks like a screenshot");
  assert.equal(badShot(report({ light: 0.12 })), "too dark");
  assert.equal(badShot(report({ light: 0.91 })), "washed out");
  assert.equal(badShot(report({ sharp: 0.0001 })), "blurry");
  assert.match(badShot(report({ faces: [{ x: 0.3, y: 0.2, w: 0.25, h: 0.3, quality: 0.19 }] })), /blurry, turned away/);
  assert.match(badShot(report({ faces: [{ x: 0.85, y: 0.2, w: 0.2, h: 0.2, quality: 0.6 }] })), /cut off/);
  assert.equal(badShot(report({ faces: [{ x: 0.5, y: 0.4, w: 0.04, h: 0.05, quality: 0.2 }] })), "", "a wide shot's small face is not judged on quality");
  assert.equal(badShot({ error: "not an image this Mac can read" }), "not an image this Mac can read");
  assert.ok(PHOTO_RULES.minLight > 0.12 && PHOTO_RULES.maxLight < 0.91);
});

test("photos: a clear face scores above a photo with no one in it", () => {
  assert.ok(photoScore(report()) > photoScore(report({ faces: [] })));
});

test("photos: shots taken within ten minutes are one moment; a post never takes two", () => {
  assert.equal(takenMs("2026:10:12 09:14:03"), Date.UTC(2026, 9, 12, 9, 14, 3));
  const a = { key: "a", moment: momentOf({ taken: "2026:10:12 09:14:03" }) };
  const b = { key: "b", moment: momentOf({ taken: "2026:10:12 09:16:00" }) };
  const c = { key: "c", moment: momentOf({ taken: "2026:10:13 09:16:00" }) };
  assert.equal(a.moment, b.moment);
  assert.deepEqual(pickPhotos([a, b, c], 3).map((p) => p.key), ["a", "c"]);
  assert.notEqual(momentOf({ key: "x" }), momentOf({ key: "y" }), "no date: every photo is its own moment");
});

test("photos: the pool skips bad and used photos, and a renamed photo is still used", async () => {
  const dir = tmp();
  const write = (name, bytes) => fs.writeFileSync(path.join(dir, name), Buffer.from(bytes));
  write("good.jpg", "good-photo-bytes");
  write("other.jpg", "other-photo-bytes");
  write("dark.jpg", "dark-photo-bytes");
  fs.mkdirSync(path.join(dir, ".hidden"));
  write(".hidden/skip.jpg", "x");
  const state = tmp();
  const checksFile = path.join(state, "checks.json"), ledgerFile = path.join(state, "used.json");
  let calls = 0;
  const detect = async (files) => { calls++; return files.map((file) => report({ file, light: /dark/.test(file) ? 0.05 : 0.45 })); };
  let pool = await photoPool(dir, { checksFile, ledgerFile, detect });
  assert.equal(pool.all.length, 3, "hidden folders are skipped");
  assert.deepEqual(pool.skipped.map((p) => [p.rel, p.why]), [["dark.jpg", "too dark"]]);
  assert.equal(pool.usable.length, 2);
  markUsed(ledgerFile, [pool.usable.find((p) => p.rel === "good.jpg")], { post: "p1", date: "2026-11-01" });
  fs.renameSync(path.join(dir, "good.jpg"), path.join(dir, "renamed.jpg"));
  pool = await photoPool(dir, { checksFile, ledgerFile, detect });
  assert.deepEqual(pool.usable.map((p) => p.rel), ["other.jpg"]);
  assert.deepEqual(pool.used.map((p) => p.rel), ["renamed.jpg"]);
  await photoPool(dir, { checksFile, ledgerFile, detect });
  assert.equal(calls, 2, "unchanged photos come from the check cache");
});

/* ---------- copy ---------- */

const carouselReply = JSON.stringify({
  angle: "same-day check-ins", hook: "Your members leave on a Tuesday",
  slides: [
    { role: "cover", headline: "Your members *leave* on a Tuesday" },
    { role: "point", headline: "The first missed class — is the signal", body: "One text the same day; that is all it takes..." },
    { role: "list", headline: "What to send", items: ["Their name", "The class they missed"] },
    { role: "compare", headline: "Two gyms", left: { label: "Waits", value: "Three weeks" }, right: { label: "Texts", value: "Same day" } },
    { role: "point", headline: "Your coaches see it first", body: "They are on the floor." },
    { role: "point", headline: "Keep it *small*", body: "A quick text keeps it small." },
  ],
  caption: "Your members leave on a Tuesday — not in a month.\nText them the same day.", hashtags: ["gymowner", "#fitness business", "#gymlife", "#extra"],
});

test("copy: Claude's carousel reply is checked and cleaned", () => {
  const c = parseCopy(carouselReply, { format: "carousel", slides: [5, 8] });
  assert.equal(c.slides[0].role, "cover");
  assert.equal(c.slides.at(-1).role, "close", "the last point closes the carousel");
  assert.equal(c.slides[1].headline, "The first missed class, is the signal");
  assert.equal(c.slides[1].body, "One text the same day. that is all it takes.");
  assert.equal(c.slides[2].role, "point", "a list under 3 items becomes a point");
  assert.equal(c.slides[3].role, "compare");
  assert.deepEqual(c.hashtags, ["#gymowner", "#fitnessbusiness", "#gymlife"]);
  assert.doesNotMatch(c.caption, /—/);
  assert.match(captionText(c), /\n\n#gymowner #fitnessbusiness #gymlife$/);
});

test("copy: wrong shapes are refused so the run can ask again", () => {
  assert.throws(() => parseCopy("no json", { format: "static" }), /no JSON/);
  assert.throws(() => parseCopy(JSON.stringify({ slides: [{ role: "cover", headline: "A" }, { role: "close", headline: "B" }], caption: "c" }), { format: "carousel", slides: [5, 8] }), /5 to 8 slides/);
  assert.throws(() => parseCopy(JSON.stringify({ slides: [{ headline: "one two three four five six seven eight nine ten eleven twelve thirteen" }], caption: "c" }), { format: "static" }), /too long/);
  assert.throws(() => parseCopy(JSON.stringify({ slides: [{ headline: "Fine" }], caption: "" }), { format: "static" }), /no caption/);
});

test("copy: one accent phrase at most, plain punctuation", () => {
  assert.equal(plainText("Keep *this* one"), "Keep *this* one");
  assert.equal(plainText("Too *many* *stars*"), "Too many stars");
  assert.equal(plainText("Wait — then go; now..."), "Wait, then go. now.");
});

test("copy: the client's never-say words send a post to drafts", () => {
  const c = parseCopy(carouselReply, { format: "carousel", slides: [5, 8] });
  assert.equal(neverSaid(c, ["hustle"]), "");
  assert.equal(neverSaid({ ...c, caption: "Time to Hustle." }, ["hustle"]), "hustle");
  assert.equal(neverSaid({ ...c, caption: "unlocked" }, ["unlock"]), "", "whole words only");
});

test("copy: the prompt carries the client's guide and voice, never Greg's", () => {
  const guide = fs.readFileSync(path.join(SAMPLE, "brand", "brand-guide.md"), "utf8");
  const p = copyPrompt({ format: "carousel", job: { name: "Retention", what: "keep members" }, client: "Jordan Example", handle: "@j", guide, voice: "Jordan's voice", recent: ["2026-10-30 Retention: old hook"], cta: "", neverSay: ["hustle"], date: "2026-11-01" });
  assert.match(p, /Jordan Example/);
  assert.match(p, /Retention/);
  assert.match(p, /Full Floor Method|independent gym owners/);
  assert.match(p, /old hook/);
  assert.match(p, /hustle/);
  assert.doesNotMatch(p, /Greg|Ghost|officialgregpingel/);
});

test("copy: words never sit on a face, and slides without a photo are set as type", () => {
  const c = parseCopy(carouselReply, { format: "carousel", slides: [5, 8] });
  const high = { file: "/h.jpg", faces: [{ x: 0.4, y: 0.15, w: 0.2, h: 0.2 }] };
  const low = { file: "/l.jpg", faces: [{ x: 0.4, y: 0.65, w: 0.2, h: 0.2 }] };
  assert.equal(faceY(high), 0.25);
  const spec = buildSpec(c, [high, low, null, null, null, null], { format: "carousel", outDir: "/o" });
  assert.equal(spec.slides[0].kind, "photo", "face high: words at the bottom");
  assert.equal(spec.slides[0].pos, "center 25%");
  assert.equal(spec.slides[1].kind, "photosplit");
  assert.equal(spec.slides[3].kind, "compare");
  assert.equal(spec.slides[5].kind, "cta");
  const cover = buildSpec({ slides: [{ role: "cover", headline: "x" }] }, [low], { format: "carousel" });
  assert.equal(cover.slides[0].kind, "phototop", "face low: words at the top");
  const st = buildSpec({ slides: [{ role: "static", headline: "x", body: "short" }] }, [null], { format: "static" });
  assert.equal(st.slides[0].kind, "static");
});

test("copy: photos go to the cover first, then spread through the points", () => {
  const c = parseCopy(carouselReply, { format: "carousel", slides: [5, 8] });
  assert.deepEqual(photoPlan(c, 0), []);
  assert.deepEqual(photoPlan(c, 1), [0]);
  assert.equal(photoPlan(c, 3).length, 3);
  assert.equal(photoPlan(c, 3)[0], 0);
});

test("copy: Claude's photo picks are kept only when they are valid; vetoed photos are never used", () => {
  const r = parsePhotoPicks('{"picks":{"1":2,"2":2,"5":9,"3":4},"descriptions":{"2":"A person beside a whiteboard"},"never":[{"photo":4,"why":"a screenshot"}]}', { plan: [0, 1, 2], count: 5 });
  assert.deepEqual([...r.picks], [[0, 1]]);
  assert.equal(r.descriptions.get(1), "A person beside a whiteboard");
  assert.equal(r.never.get(3), "a screenshot");
});

test("copy: postcard, notes, story and supplied evidence validate into their built slide families", () => {
  const proofDir = path.join(tmp(), "Proof");
  fs.mkdirSync(proofDir);
  const proof = path.join(proofDir, "client-result.png");
  fs.writeFileSync(proof, "png");
  assert.deepEqual(proofScreenshots(path.dirname(proofDir)), [proof]);
  const parsed = parseCopy(JSON.stringify({
    hook: "Keep the signal close",
    slides: [
      { role: "cover", headline: "Keep the *signal* close" },
      { role: "postcard", postText: "A supplied thought in their voice." },
      { role: "notes", headline: "What changed", lines: ["One clear owner.", "One same day check."] },
      { role: "story", caption: "The coach checked the attendance list." },
      { role: "evidence", proofFile: "client-result.png", sourceLabel: "Client supplied result" },
      { role: "close", headline: "Make the check *small*" },
    ],
    caption: "Keep the signal close.", hashtags: ["#gymowner"],
  }), { format: "carousel", slides: [5, 8], evidenceFiles: [proof] });
  const real = { file: "/real.jpg", export: "/real-export.jpg", faces: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }] };
  const spec = buildSpec(parsed, [null, null, null, real, null, null], { format: "carousel", outDir: "/out" });
  assert.deepEqual(spec.slides.map((slide) => slide.kind), ["cover", "postcard", "notes", "story", "evidence", "cta"]);
  assert.deepEqual(spec.slides[3].focalPoint, { x: 0.35, y: 0.35 });
  assert.equal(spec.slides[4].image, proof);
  assert.throws(() => buildSpec(parsed, [], { format: "carousel" }), /story slide 4 needs a real photo/);
  assert.throws(() => parseCopy(JSON.stringify({ slides: [{ role: "cover", headline: "A" }, { role: "evidence", proofFile: "made-up.png", sourceLabel: "Proof" }, { role: "point", headline: "C" }, { role: "point", headline: "D" }, { role: "close", headline: "E" }], caption: "c" }), { format: "carousel", evidenceFiles: [] }), /does not name one supplied proof screenshot/);
});

test("alt text: gold markers are stripped, photo descriptions are never guessed, and entries cap at 300 characters", () => {
  const spec = { slides: [
    { kind: "photo", headline: "Keep *this* visible", sub: "Use the supplied words." },
    { kind: "photosplit", headline: "Words *only*", sub: "No literal description was supplied." },
    { kind: "body", headline: "Long", sub: "x".repeat(500) },
  ] };
  const alt = buildAltText(spec, [{ visualDescription: "A person beside a whiteboard" }, { file: "/photo-without-description.jpg" }, null]);
  assert.equal(alt.length, spec.slides.length);
  assert.match(alt[0], /^A person beside a whiteboard\. Text reads: Keep this visible/);
  assert.doesNotMatch(alt.join("\n"), /\*/);
  assert.equal(alt[1], "Words only. No literal description was supplied.");
  assert.doesNotMatch(alt[1], /photo|image|person/i, "no scene description is invented from a file name");
  assert.equal(alt[2].length, 300);
});

test("copy repair: only named slides can be shortened and their semantic role is fixed", () => {
  const copy = parseCopy(carouselReply, { format: "carousel", slides: [5, 8] });
  const prompt = shortenPrompt({ copy, indexes: [1], client: "Jordan Example", guide: "Guide", voice: "Voice" });
  assert.match(prompt, /about one quarter/);
  assert.match(prompt, /"index":2/);
  assert.doesNotMatch(prompt, /"index":1/);
  const repaired = applyShortenedSlides(copy, JSON.stringify({ slides: [{ index: 2, slide: { ...copy.slides[1], headline: "Missed class is the signal", body: "Text the same day." } }] }), [1]);
  assert.equal(repaired.slides[1].body, "Text the same day.");
  assert.deepEqual(repaired.slides[0], copy.slides[0]);
  assert.deepEqual(repaired.slides[2], copy.slides[2]);
  assert.throws(() => applyShortenedSlides(copy, JSON.stringify({ slides: [{ index: 2, slide: { role: "story", caption: "Changed" } }] }), [1]), /preserve slide 2's role/);
});

test("slide family validation names missing postcard, notes and story fields", () => {
  const reply = (middle) => JSON.stringify({ slides: [
    { role: "cover", headline: "A useful cover" }, middle,
    { role: "point", headline: "Third point" }, { role: "point", headline: "Fourth point" }, { role: "close", headline: "Useful close" },
  ], caption: "A useful cover." });
  assert.throws(() => parseCopy(reply({ role: "postcard" }), { format: "carousel" }), /postcard needs postText/);
  assert.throws(() => parseCopy(reply({ role: "notes", headline: "Notes", lines: ["Only one"] }), { format: "carousel" }), /notes needs at least 2 lines/);
  assert.throws(() => parseCopy(reply({ role: "story" }), { format: "carousel" }), /story needs a caption/);
});

test("shared preflight adapter fails closed and preserves plain-English problems", async () => {
  const result = await runStudioPreflight({ spec: { slides: [] }, files: ["/one.png"], brand: {}, history: null, options: {} }, async () => { throw new Error("Vision is unavailable"); });
  assert.equal(result.verdict, "hold");
  assert.deepEqual(preflightProblems(result).map((problem) => [problem.code, problem.fix]), [["preflight-unavailable", "none"]]);
  assert.match(preflightProblems(result)[0].message, /Vision is unavailable/);
});

/* ---------- Metricool ---------- */

test("metricool: the connector is found by its address, whatever the client named it", () => {
  const list = [
    "Checking MCP server health…",
    "claude.ai Metricool Social Media Management: https://ai.metricool.com/mcp - ✔ Connected",
    "claude.ai My Dropbox: https://mcp.dropbox.com/claude_app_mcp - ! Needs authentication",
    "claude.ai sandcastles: https://mcp.sandcastles.ai - ✔ Connected",
  ].join("\n");
  const c = parseConnectors(list);
  assert.deepEqual(c.metricool, { name: "Metricool Social Media Management", connected: true });
  assert.equal(c.dropbox.connected, false);
  assert.equal(c.sandcastles.name, "sandcastles");
  assert.equal(connectorPrefix(c.metricool.name), "mcp__claude_ai_Metricool_Social_Media_Management__");
});

test("metricool: dates carry the zone's own offset, across daylight saving", () => {
  assert.equal(zonedISO("2026-12-15", "03:00", "America/Phoenix"), "2026-12-15T03:00:00-07:00");
  assert.equal(zonedISO("2026-07-01", "10:00", "America/Chicago"), "2026-07-01T10:00:00-05:00");
  assert.equal(zonedISO("2026-12-01", "10:00", "America/Chicago"), "2026-12-01T10:00:00-06:00");
  assert.equal(zonedISO("2026-11-02", "18:30", "Europe/Berlin"), "2026-11-02T18:30:00+01:00");
});

test("metricool: the post input sets the draft, the AI label, alt text and each network's data", () => {
  const a = postInput({ blogId: 7, day: "2026-12-15", time: "05:00", tz: "America/Phoenix", text: "t", media: ["u1", "u2"], altText: ["first", "second"], kind: "carousel", ai: true, draft: true, networks: ["instagram", "linkedin"], title: "Hook" });
  const info = JSON.parse(a.info);
  assert.equal(a.blogId, "7");
  assert.equal(a.date, "2026-12-15T05:00:00-07:00");
  assert.equal(info.draft, true);
  assert.equal(info.instagramData.isAiGenerated, true);
  assert.equal(info.instagramData.type, "POST");
  assert.equal(info.linkedinData.publishImagesAsPDF, true);
  assert.deepEqual(info.mediaAltText, ["first", "second"]);
  assert.equal(info.mediaAltText.length, info.media.length);
  assert.deepEqual(info.publicationDate, { dateTime: "2026-12-15T05:00:00", timezone: "America/Phoenix" });
  const r = JSON.parse(postInput({ blogId: 7, day: "2026-12-15", time: "12:00", tz: "UTC", text: "t", media: ["v"], kind: "reel", coverMs: 1234.4 }).info);
  assert.equal(r.instagramData.type, "REEL");
  assert.equal(r.instagramData.isAiGenerated, false);
  assert.equal(r.videoCoverMilliseconds, 1234);
});

test("metricool: the scheduled list and the tool prompt", () => {
  const list = normalizeScheduled({ data: [{ id: 1, publicationDate: { dateTime: "2026-11-02T10:00:00" }, instagramData: { type: "REEL" }, draft: true }, { bad: 1 }] });
  assert.deepEqual(list, [{ day: "2026-11-02", hour: 10, minute: 0, type: "REEL", draft: true, text: "", id: 1 }]);
  assert.match(toolPrompt("mcp__x__y", { a: 1 }), /exactly once[\s\S]*\{"a":1\}/);
});

/* ---------- image routes ---------- */

test("hosting: Drive and Dropbox links Metricool can download", () => {
  assert.equal(driveLink("1AbC_d-23456789"), "https://drive.google.com/uc?export=download&id=1AbC_d-23456789");
  assert.equal(dropboxDirect("https://www.dropbox.com/scl/fi/x/a.png?rlkey=k&dl=0"), "https://www.dropbox.com/scl/fi/x/a.png?rlkey=k&raw=1");
});

test("hosting: the Mac serves only the post's own files, at random addresses", async () => {
  const dir = tmp();
  const f = path.join(dir, "Slide 1.png");
  fs.writeFileSync(f, Buffer.from("0123456789"));
  const { server, paths } = fileServer([f]);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.match(paths[0], /^\/[0-9a-f]{24}\.png$/);
    const ok = await fetch(base + paths[0]);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal(await ok.text(), "0123456789");
    const part = await fetch(base + paths[0], { headers: { range: "bytes=2-4" } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), "234");
    assert.equal((await fetch(`${base}/Slide%201.png`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 404);
  } finally {
    server.close();
  }
});

/* ---------- the daily run ---------- */

const NOW = new Date("2026-11-01T15:00:00Z"); // 08:00 in Phoenix (UTC-7)
const config = withDefaults({ client: "J", timezone: "America/Phoenix", daysAhead: 2, metricool: { blogId: "1" } });

test("daily: open slots skip today's close ones, logged ones and ones Metricool already has", () => {
  assert.deepEqual(zonedNow("America/Phoenix", NOW), { day: "2026-11-01", minutes: 480 });
  assert.equal(addDays("2026-11-01", 2), "2026-11-03");
  let slots = openSlots({ config, now: NOW });
  assert.deepEqual(slots.map((s) => `${s.day} ${s.time} ${s.format}`), ["2026-11-01 18:00 static", "2026-11-02 10:00 carousel", "2026-11-02 18:00 static", "2026-11-03 10:00 carousel", "2026-11-03 18:00 static"]);
  slots = openSlots({ config, now: NOW, posts: [{ day: "2026-11-02", time: "10:00", status: "scheduled" }, { day: "2026-11-02", time: "18:00", status: "failed" }], scheduled: [{ day: "2026-11-03", hour: 9, minute: 0, type: "POST" }, { day: "2026-11-03", hour: 18, minute: 0, type: "REEL" }] });
  assert.deepEqual(slots.map((s) => `${s.day} ${s.time}`), ["2026-11-01 18:00", "2026-11-02 18:00", "2026-11-03 18:00"]);
  assert.deepEqual(openSlots({ config, now: NOW, day: "2026-12-15" }).map((s) => `${s.day} ${s.time}`), ["2026-12-15 10:00", "2026-12-15 18:00"]);
  assert.deepEqual(openSlots({ config, now: NOW, day: "2026-10-01" }), [], "never a day in the past");
});

test("daily: made posts that never reached Metricool are retried while their time is ahead", () => {
  const posts = [
    { id: "a", day: "2026-11-01", time: "08:20", status: "not-posted", made: "/m" },
    { id: "b", day: "2026-11-01", time: "18:00", status: "not-posted", made: "/m" },
    { id: "c", day: "2026-11-02", time: "10:00", status: "scheduled", made: "/m" },
  ];
  assert.deepEqual(retryable(posts, { tz: "America/Phoenix", now: NOW }).map((p) => p.id), ["b"]);
  assert.equal(madeName({ day: "2026-11-02", time: "10:00", format: "carousel" }, "Stop *guessing*: your prices"), "2026-11-02 10.00 Carousel - Stop guessing your prices");
});

test("daily: a whole run with stubs: Made copy, ledger, log, draft gate, AI label and the caption prefix", async () => {
  const dir = sampleCopy({ timezone: "America/Phoenix", slots: [{ time: "10:00", format: "carousel" }, { time: "18:00", format: "static" }], publish: { mode: "schedule", captionPrefix: "HOLD TEST" }, ai: { label: "auto", broll: false }, neverSay: ["hustle"], daysAhead: 1, maxPerRun: 3 });
  const created = [];
  const deps = {
    scheduledPosts: async () => [],
    writeCopy: async (studio, slot) => (slot.format === "static"
      ? parseCopy(JSON.stringify({ hook: "Hustle less", slides: [{ role: "static", headline: "Hustle *less*", body: "Text the member." }], caption: "Hustle less.", hashtags: ["#gymowner"] }), { format: "static" })
      : parseCopy(carouselReply, { format: "carousel", slides: [5, 8] })),
    pickPhotos: false,
    renderSlides: async (spec, { outDir }) => { fs.mkdirSync(outDir, { recursive: true }); return spec.slides.map((s, i) => { const f = path.join(outDir, `${i + 1}.png`); fs.writeFileSync(f, `png ${s.kind}`); return f; }); },
    preflightSlides: async ({ files }) => ({ verdict: "schedule", slides: files.map((file, index) => ({ index, file, problems: [] })), photoHashes: [] }),
    hostFiles: async (files) => ({ urls: files.map((f, i) => `https://host/${i}`), close: async () => {} }),
    createPost: async (connector, input) => { created.push({ connector, input, info: JSON.parse(input.info) }); return { plannerUrl: `https://app.metricool.com/planner/${created.length}`, id: created.length }; },
  };
  const detectFake = async () => ({ usable: [], skipped: [], all: [], used: [] });
  deps.choosePhotos = async (studio, copy) => ({ bySlide: copy.slides.map(() => null), vetoed: [], pool: await detectFake() });
  const r = await runDaily(dir, { now: NOW, deps });
  assert.deepEqual(r.made.map((m) => `${m.day} ${m.time} ${m.format} ${m.status}`), ["2026-11-01 18:00 static draft", "2026-11-02 10:00 carousel scheduled", "2026-11-02 18:00 static draft"]);
  assert.equal(created.length, 3);
  assert.equal(created[0].connector, "Metricool Social Media Management");
  assert.equal(created[0].info.draft, true, "the never-say word sends it to drafts");
  assert.match(r.made[0].why, /hustle/);
  assert.equal(created[1].info.draft, false);
  assert.equal(created[1].info.media.length, 6);
  assert.equal(created[1].info.mediaAltText.length, created[1].info.media.length);
  assert.ok(created[1].info.mediaAltText.every(Boolean));
  assert.equal(created[1].info.instagramData.isAiGenerated, false, "real photos only: no AI label");
  assert.match(created[1].info.text, /^HOLD TEST\n\n/);
  const made = r.made[1].made;
  assert.deepEqual(fs.readdirSync(made).filter((f) => !f.startsWith(".")).sort(), ["Scheduled.txt", "Slide 1.png", "Slide 2.png", "Slide 3.png", "Slide 4.png", "Slide 5.png", "Slide 6.png", "caption.txt"]);
  assert.match(fs.readFileSync(path.join(made, "Scheduled.txt"), "utf8"), /planner\/2/);
  const again = await runDaily(dir, { now: NOW, deps });
  assert.deepEqual(again.made, [], "every slot is filled now");
});

test("daily: a failed schedule leaves the post in Made and the next run sends it", async () => {
  const dir = sampleCopy({ timezone: "America/Phoenix", slots: [{ time: "18:00", format: "static" }], daysAhead: 0, publish: { mode: "schedule" } });
  let fail = true;
  const deps = {
    scheduledPosts: async () => [],
    writeCopy: async () => parseCopy(JSON.stringify({ slides: [{ role: "static", headline: "A *b*" }], caption: "c", hashtags: [] }), { format: "static" }),
    choosePhotos: async (s, copy) => ({ bySlide: copy.slides.map(() => null), vetoed: [] }),
    renderSlides: async (spec, { outDir }) => { fs.mkdirSync(outDir, { recursive: true }); const f = path.join(outDir, "1.png"); fs.writeFileSync(f, "png"); return [f]; },
    preflightSlides: async ({ files }) => ({ verdict: "schedule", slides: files.map((file, index) => ({ index, file, problems: [] })), photoHashes: [] }),
    hostFiles: async () => ({ urls: ["u"], close: async () => {} }),
    createPost: async () => { if (fail) throw new Error("Metricool is down"); return { plannerUrl: "p", id: 1 }; },
  };
  const first = await runDaily(dir, { now: NOW, deps });
  assert.equal(first.made[0].status, "not-posted");
  assert.ok(fs.existsSync(path.join(first.made[0].made, "Not posted.txt")));
  fail = false;
  const second = await runDaily(dir, { now: NOW, deps });
  assert.deepEqual(second.made.map((m) => m.status), ["scheduled"]);
  assert.ok(!fs.existsSync(path.join(first.made[0].made, "Not posted.txt")));
});

async function gateRun(verdicts) {
  const dir = sampleCopy({ timezone: "America/Phoenix", slots: [{ time: "18:00", format: "static" }], daysAhead: 0, publish: { mode: "schedule" }, ai: { label: "auto", broll: false } });
  const calls = { render: 0, preflight: 0, host: 0, schedule: 0 };
  const deps = {
    scheduledPosts: async () => [],
    writeCopy: async () => parseCopy(JSON.stringify({ hook: "One useful check", slides: [{ role: "static", headline: "One *useful* check", body: "Use the words supplied." }], caption: "One useful check.", hashtags: [] }), { format: "static" }),
    choosePhotos: async (studio, copy) => ({ bySlide: copy.slides.map(() => null), vetoed: [], pool: { usable: [], skipped: [] } }),
    renderSlides: async (spec, { outDir }) => {
      calls.render++;
      fs.mkdirSync(outDir, { recursive: true });
      const file = path.join(outDir, "1.png");
      fs.writeFileSync(file, `png ${calls.render}`);
      return [file];
    },
    preflightSlides: async ({ files }) => {
      const verdict = verdicts[calls.preflight++] || "hold";
      const problems = verdict === "schedule" ? [] : [{ code: "crop", message: "The words overlap the subject.", fix: verdict === "retry" ? "recrop" : "none" }];
      return { verdict, slides: [{ index: 0, file: files[0], problems }], photoHashes: verdict === "schedule" ? [{ file: files[0], hash: `hash-${calls.preflight}` }] : [] };
    },
    hostFiles: async () => { calls.host++; return { urls: ["https://host/1"], close: async () => {} }; },
    createPost: async () => { calls.schedule++; return { plannerUrl: "https://app.metricool.com/planner/1", id: 1 }; },
  };
  const result = await runDaily(dir, { now: NOW, deps });
  return { dir, calls, result, record: result.made[0] };
}

test("daily gate: schedule continues to Made, hosting and Metricool, then records photo hashes", async () => {
  const run = await gateRun(["schedule"]);
  assert.equal(run.record.status, "scheduled");
  assert.deepEqual(run.calls, { render: 1, preflight: 1, host: 1, schedule: 1 });
  const history = JSON.parse(fs.readFileSync(path.join(run.dir, ".studio", "photo-history.json"), "utf8"));
  assert.deepEqual(history.photos.map((item) => [item.hash, item.date]), [["hash-1", "2026-11-01"]]);
});

test("daily gate: retry repairs and renders once more, then schedules on a pass", async () => {
  const run = await gateRun(["retry", "schedule"]);
  assert.equal(run.record.status, "scheduled");
  assert.deepEqual(run.calls, { render: 2, preflight: 2, host: 1, schedule: 1 });
});

test("daily gate: retry then hold writes only a HELD report and performs no publishing side effect", async () => {
  const run = await gateRun(["retry", "hold"]);
  assert.equal(run.record.status, "held");
  assert.deepEqual(run.calls, { render: 2, preflight: 2, host: 0, schedule: 0 });
  assert.ok(fs.existsSync(path.join(run.dir, "Made", "2026-11-01-18.00-HELD.md")));
  assert.ok(!fs.existsSync(path.join(run.dir, ".studio", "used-photos.json")));
});

test("daily gate: an immediate hold is not repaired, copied, hosted or scheduled", async () => {
  const run = await gateRun(["hold"]);
  assert.equal(run.record.status, "held");
  assert.deepEqual(run.calls, { render: 1, preflight: 1, host: 0, schedule: 0 });
  assert.deepEqual(fs.readdirSync(path.join(run.dir, "Made")), ["2026-11-01-18.00-HELD.md"]);
  assert.deepEqual(readPosts(studioPaths(run.dir)), [], "a held slot is not logged as filled, so the next run tries it again");
});

/* ---------- reels ---------- */

test("reels: clips wait until they stop changing and are done once", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "clip.mov"), "x");
  fs.writeFileSync(path.join(dir, "notes.txt"), "x");
  const now = Date.now();
  assert.equal(waitingClips(dir, {}, { now }).length, 0, "just dropped: still copying");
  const later = waitingClips(dir, {}, { now: now + 120000 });
  assert.equal(later.length, 1);
  assert.equal(waitingClips(dir, { [later[0].key]: { status: "edited" } }, { now: now + 120000 }).length, 0);
});

test("reels: the reel takes the first day without one, the best hour two hours from other posts", () => {
  const now = new Date("2026-11-01T14:00:00Z");
  const slot = reelSlot({ now, tz: "America/Phoenix", scheduled: [{ day: "2026-11-01", hour: 12, minute: 0, type: "REEL" }, { day: "2026-11-02", hour: 10, minute: 0, type: "POST" }], posts: [], best: { "2026-11-02": [11, 13, 9] }, reels: { earliest: 8, latest: 20, gapHours: 2 } });
  assert.deepEqual(slot, { day: "2026-11-02", hour: 13 });
  assert.deepEqual(normalizeBestTimes({ data: [{ dateTime: "2026-11-02T09:00:00", value: 2 }, { dateTime: "2026-11-02T13:00:00", value: 5 }] }), { "2026-11-02": [13, 9] });
});

test("reels: the reel job runs with the client's look, words, voice and folders only", () => {
  const dir = sampleCopy();
  const s = loadStudio(dir);
  const env = reelEnv(s, { sandcastles: false });
  assert.equal(env.REEL_CLIENT, "Jordan Example");
  assert.equal(env.REEL_CAPTION_VOICE, path.join(dir, "brand", "voice.md"));
  assert.equal(env.REEL_CAPTION_WATCHLIST, "0");
  assert.equal(env.REEL_CAPTION_SANDCASTLES, "0");
  assert.equal(env.REEL_PRESET, "clean", "no reel look in the sample: plain captions, never Greg's");
  for (const v of Object.values(env)) assert.doesNotMatch(String(v), /pingel|greg/i);
  assert.ok(env.REEL_WATCH_DONE.startsWith(dir));
});

test("reels: without Sandcastles the caption is written from the transcript alone", () => {
  const p = buildPrompt({ transcript: "t", hook: "h", voice: "v", cta: "", sandcastles: false });
  assert.doesNotMatch(p, /sandcastles|Sandcastles|winning pattern|outlier/);
  assert.match(p, /Write the caption from the transcript alone/);
  assert.match(buildPrompt({ transcript: "t", hook: "h", voice: "v", cta: "" }), /sandcastles top_hooks/, "Greg's default is unchanged");
});

/* ---------- installer and kit ---------- */

test("setup: Desktop, Documents, Downloads and iCloud are folders a background job cannot read", () => {
  assert.equal(protectedFolder("/Users/x/Desktop/Photos", "/Users/x"), true);
  assert.equal(protectedFolder("/Users/x/Documents", "/Users/x"), true);
  assert.equal(protectedFolder("/Users/x/Library/Mobile Documents/com~apple~CloudDocs/P", "/Users/x"), true);
  assert.equal(protectedFolder("/Users/x/Pictures/Brand", "/Users/x"), false);
  assert.equal(protectedFolder("/Users/x/Content Studio/Photos", "/Users/x"), false);
});

test("agents: a daily run every morning and a Raw Reels watcher, both on this studio only", () => {
  const [daily, reels] = studioAgents("/Users/x/Content Studio", { node: "/opt/homebrew/bin/node", home: "/Users/x" });
  assert.equal(daily.label, "com.pingel.content-studio.daily.content-studio");
  assert.match(daily.plist, /<string>daily<\/string><string>--studio<\/string><string>\/Users\/x\/Content Studio<\/string>/);
  assert.match(daily.plist, /<key>Hour<\/key><integer>6<\/integer>/);
  assert.match(daily.plist, /\/Users\/x\/\.local\/bin/);
  assert.match(reels.plist, /<key>WatchPaths<\/key><array><string>\/Users\/x\/Content Studio\/Raw Reels<\/string>/);
  assert.match(reels.plist, /<string>studio<\/string><string>reels<\/string>/);
});

test("kit: Start Here keeps the Content Studio section only in a Content Studio kit", () => {
  const html = fs.readFileSync(path.join(PKG_ROOT, "kit", "Start Here.html"), "utf8");
  assert.match(html, /<!-- studio -->/);
  const plain = personalizeStartHere(html, { name: "Jane" });
  assert.doesNotMatch(plain, /Content Studio|<!-- studio/);
  assert.match(plain, /Jane's Reel Editor/);
  const studio = personalizeStartHere(html, { name: "Jane" }, { studio: true });
  assert.match(studio, /Jane's Content Studio/);
  assert.match(studio, /Double-click <b>Install Content Studio\.command<\/b> in this folder/);
  for (const route of ["Straight from this Mac", "Google Drive", "Dropbox"]) assert.match(studio, new RegExp(route));
  assert.doesNotMatch(studio, /<!-- \/?studio -->/);
  assert.equal(stripStudio(html), stripStudio(stripStudio(html)));
  assert.ok(fs.statSync(path.join(PKG_ROOT, "kit", "Install Content Studio.command")).mode & 0o100, "the kit installer double-clicks");
});

test("slides: a long sentence-case headline is set smaller; a short one keeps its kind's size", () => {
  assert.equal(legacyHeadSize("photo", "A REAL PHOTO"), null);
  assert.equal(legacyHeadSize("phototop", "Catch the missed class text before it is a pattern"), null);
  const size = legacyHeadSize("photosplit", "This headline is far too long to sit in three lines at one hundred pixels wide, so it shrinks");
  assert.ok(size >= 56 && size < 100, String(size));
  assert.equal(legacyHeadSize("checklist", "x"), null);
});

test("studio brand: font files come from the client's own brand/fonts folder first", () => {
  const dir = sampleCopy();
  const p = studioPaths(dir);
  fs.mkdirSync(p.fonts, { recursive: true });
  fs.copyFileSync(path.join(PKG_ROOT, "assets", "fonts", "Anton-Regular.ttf"), path.join(p.fonts, "Display.ttf"));
  assert.equal(studioBrand(p).tokens.type.display.file, path.join(p.fonts, "Display.ttf"));
});

test("metricool: the planner link comes from the result, never a media file's address", () => {
  const r = { data: { id: 411340693, media: ["https://static.metricool.com/planner/202610/7372287-file-1.png"], plannerUrl: "https://app.metricool.com/planner?blogId=7372287&postId=411340693" } };
  assert.deepEqual(createdPost(r), { plannerUrl: "https://app.metricool.com/planner?blogId=7372287&postId=411340693", id: 411340693 });
  assert.deepEqual(createdPost({ data: [{ id: 5, media: ["https://static.metricool.com/planner/x.png"] }] }), { plannerUrl: "", id: 5 });
});

test("reels: an edited reel is filed in Made and scheduled; one stranded in delivered is picked up next run", async () => {
  const dir = sampleCopy({ timezone: "America/Phoenix", publish: { mode: "schedule" } });
  const s = loadStudio(dir);
  const clip = path.join(s.paths.rawReels, "clip.mov");
  fs.writeFileSync(clip, "video");
  fs.utimesSync(clip, new Date(Date.now() - 600000), new Date(Date.now() - 600000));
  const created = [];
  const deliver = (name) => {
    const folder = path.join(s.paths.reels, "delivered", name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "Stop chasing sign ups.mp4"), "mp4");
    fs.writeFileSync(path.join(folder, "caption.txt"), "Keep the members you have.\n\n#gymowner");
    fs.writeFileSync(path.join(folder, ".reel.json"), JSON.stringify({ isAiGenerated: false, preflight: "pass", coverMs: 900 }));
    return folder;
  };
  const deps = {
    editClip: async () => ({ folder: deliver("2026-11-01 Reel 1"), output: "", hook: "" }),
    scheduledPosts: async () => [],
    bestTimes: async () => ({ data: [{ dateTime: "2026-11-01T15:00:00", value: 9 }] }),
    hostFiles: async (files) => ({ urls: files.map(() => "https://host/v.mp4"), close: async () => {} }),
    createPost: async (connector, input) => { created.push(JSON.parse(input.info)); return { plannerUrl: "https://app.metricool.com/planner", id: 9 }; },
  };
  const { runReels } = await import("../src/studio-reels.mjs");
  const r = await runReels(dir, { now: NOW, deps });
  assert.deepEqual(r.map((x) => `${x.day} ${x.time} ${x.status} ${x.hook}`), ["2026-11-01 15:00 scheduled Stop chasing sign ups"]);
  assert.equal(created[0].instagramData.type, "REEL");
  assert.equal(created[0].videoCoverMilliseconds, 900);
  assert.ok(fs.existsSync(path.join(s.paths.rawReels, "Done", "clip.mov")));
  assert.ok(fs.existsSync(path.join(r[0].made, "Scheduled.txt")));
  deliver("2026-11-01 Reel 2");
  const next = await runReels(dir, { now: NOW, deps: { ...deps, editClip: async () => { throw new Error("no clips should be edited"); } } });
  assert.equal(next.length, 1, "the stranded reel is filed");
  assert.notEqual(next[0].day, "2026-11-01", "one reel a day");
});

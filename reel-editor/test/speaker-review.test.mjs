import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReview, reviewRows, reviewTime, parseComments, writeRevision } from "../src/speaker-review.mjs";
import { approve, deliver, reviewState, planHash, deliveryName } from "../src/speaker-deliver.mjs";

const passingQC = async () => ({ ok: true, checks: [{ level: "pass", code: "test", message: "Measured fixture" }] });
const frameGrab = async ({ file }) => fs.writeFileSync(file, "real-frame-placeholder-for-unit-test");
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-review-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const manifest = { schemaVersion: 1, clientId: "julee-gracey", identity: { name: "Julee Gracey", roleLine: "Speaker", bookingMode: "direct", bookingText: "Book Julee", bookingUrl: "https://example.com/speaking" },
    brand: { file: "brand.json" }, sources: [{ id: "stage", path: "footage/talk.mp4", rights: "r1" }, { id: "broll", path: "footage/room.mp4", rights: "r1" }],
    proof: [{ id: "quote", kind: "quote", text: "Real words <exactly>", attribution: { name: "Attendee", title: "Owner", org: "Company" }, rights: "r2" }],
    rights: [{ id: "r1", status: "approved" }, { id: "r2", status: "approved" }] };
  const plan = { schemaVersion: 1, clientId: "julee-gracey", version: "full", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 },
    items: [{ id: "i01", kind: "clip", sourceId: "stage", in: 100, out: 103, outputStart: 0, outputEnd: 3, role: "core" },
      { id: "i02", kind: "card", duration: 5, outputStart: 3, outputEnd: 8, role: "booking", card: { type: "booking" } }],
    overlays: [{ id: "o01", at: "i01", outputStart: 1, outputEnd: 2, card: { type: "quote", proofId: "quote" } }],
    cutaways: [{ id: "x01", over: "i01", sourceId: "broll", in: 10, out: 11, outputStart: 2, outputEnd: 3 }] };
  fs.mkdirSync(path.join(folder, "work", "full"), { recursive: true });
  fs.writeFileSync(path.join(folder, "speaker-manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(folder, "brand.json"), JSON.stringify({ name: "Julee Gracey", fonts: { display: "Playfair Display", body: "Montserrat" }, colors: { text: "#FFFFFF", accent: "#FFB27D", bg: "#111111", stroke: "#111111" } }));
  fs.writeFileSync(path.join(folder, "draft.mp4"), "approved-video-bytes");
  fs.writeFileSync(path.join(folder, "open.mp4"), "approved-open-video-bytes");
  fs.writeFileSync(path.join(folder, "work", "full", "words.json"), JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ sourceId: "stage", start: i / 20, end: (i + 1) / 20, text: `w${i}` }))));
  const build = (extra = {}) => buildReview(folder, { version: "full", video: { clean: path.join(folder, "draft.mp4"), open: path.join(folder, "open.mp4") }, resolvedPlan: plan, manifest, frameGrab, qc: passingQC, ...extra });
  return { folder, manifest, plan, build };
}
const approval = { by: "Julee Gracey", at: "2026-11-01T10:00:00-07:00", qc: passingQC };

test("speaker review time rounds across minute boundaries", () => {
  assert.equal(reviewTime(102.14), "1:42.1"); assert.equal(reviewTime(59.98), "1:00.0");
});

test("speaker review rows include every clip, card, overlay and cutaway in output order", async (t) => {
  const { folder, plan, manifest, build } = fixture(t);
  manifest.rights[1].status = "pending";
  const res = await build();
  assert.deepEqual(res.rows.map((r) => r.kind), ["clip", "overlay", "cutaway", "card"]);
  assert.deepEqual(res.rows.map((r) => r.code), ["FULL-i01", "FULL-o01", "FULL-x01", "FULL-i02"]);
  assert.equal(res.rows[0].source, "talk.mp4");
  assert.match(res.rows[0].transcript, /w24 … w30/);
  assert.equal(res.rows[1].rights, "pending");
  assert.match(res.rows[3].text, /Book Julee/);
  assert.equal(res.state.state, "draft");
  const html = fs.readFileSync(res.index, "utf8");
  assert.match(html, /Real words &lt;exactly&gt;/);
  assert.match(html, /Rights: pending/);
  assert.match(html, /Playfair Display/); assert.match(html, /Montserrat/);
  assert.match(html, /<track kind="captions"/); assert.doesNotMatch(html, /<script/);
  assert.equal(fs.readdirSync(path.join(res.dir, "frames")).length, 4);
  assert.match(fs.readFileSync(path.join(res.dir, "captions.vtt"), "utf8"), /^WEBVTT/);
  assert.equal(reviewRows(plan, manifest).length, 4);
  const broken = structuredClone(plan); broken.items[0].sourceId = "missing";
  assert.throws(() => reviewRows(broken, manifest), /i01.*missing/);
  broken.items[0].sourceId = "stage"; broken.overlays[0].id = "i01";
  assert.throws(() => reviewRows(broken, manifest), /duplicate/);
  assert.ok(fs.existsSync(path.join(folder, "review", "review.json")));
});

test("speaker comment parsing accepts codes, list bullets, timecodes and reports junk", (t) => {
  const { plan } = fixture(t);
  const result = parseComments("- FULL-i01: Cut the last sentence\n0:02 make this bigger\nfull-o01: exact quote\nFULL-i99: nope\n1:66 broken\n0:08 outside\nJunk\nSHORT-i01: wrong version", { resolvedPlan: plan });
  assert.equal(result.comments.length, 3); assert.equal(result.problems.length, 5);
  assert.deepEqual(result.comments[1], { code: "FULL-i01", itemId: "i01", at: 2, text: "make this bigger", alsoOnScreen: ["FULL-x01"] });
  assert.equal(parseComments("1:42 make the logo bigger").problems.length, 1);
  assert.deepEqual(parseComments("FULL-i07: cut the last sentence").comments[0], { code: "FULL-i07", itemId: "i07", at: null, text: "cut the last sentence" });
  const vertical = { ...plan, version: "vertical-1" };
  assert.equal(parseComments("vertical-1-i01: keep this", { resolvedPlan: vertical }).comments[0].code, "VERTICAL-1-i01");
  assert.deepEqual(parseComments("\n"), { comments: [], problems: [] });
});

test("speaker canonical plan hash ignores key order but binds editorial changes", () => {
  assert.equal(planHash({ b: [1, { y: 2, x: 3 }], a: 1 }), planHash({ a: 1, b: [1, { x: 3, y: 2 }] }));
  assert.notEqual(planHash({ items: [1, 2] }), planHash({ items: [2, 1] }));
});

test("speaker state records one included revision and flags the next, requiring a rebuilt review", async (t) => {
  const { folder, plan, build } = fixture(t);
  assert.equal(reviewState(folder, "full").state, "draft");
  await build();
  let state = writeRevision(folder, "full", "FULL-i01: shorten");
  assert.equal(state.state, "revision"); assert.equal(state.rounds[0].extraRevision, false); assert.ok(state.rounds[0].planHash);
  await assert.rejects(approve(folder, "full", approval), /cannot approve state revision/);
  plan.revision = 2; await build(); assert.equal(reviewState(folder, "full").state, "revised");
  await approve(folder, "full", approval);
  state = writeRevision(folder, "full", "0:01 change again\nplease fix this");
  assert.equal(state.state, "revision"); assert.equal(state.approval, null);
  assert.equal(state.rounds[1].warning, "extra revision (Greg's call)"); assert.equal(state.rounds[1].problems.length, 1);
  assert.throws(() => reviewState(folder, "../outside"), /invalid/);
});

test("speaker delivery refuses unapproved and QC-failing versions", async (t) => {
  const { folder, build } = fixture(t); await build();
  await assert.rejects(deliver(folder, "full", { qc: passingQC }), /requires approved/);
  await assert.rejects(approve(folder, "full", { ...approval, by: "" }), /approver/);
  await assert.rejects(approve(folder, "full", { ...approval, at: "invalid" }), /date/);
  await assert.rejects(approve(folder, "full", { ...approval, qc: async () => ({ ok: false, checks: [{ level: "fail", message: "too quiet" }] }) }), /QC failed.*too quiet/);
  await approve(folder, "full", approval);
  await assert.rejects(deliver(folder, "full", { qc: async () => ({ ok: false, checks: [{ level: "fail", message: "broken encode" }] }) }), /QC failed.*broken encode/);
  assert.equal(fs.existsSync(path.join(folder, "final")), false);
});

for (const change of ["plan", "video", "reviewed video", "caption", "poster", "brand", "manifest", "missing file"]) {
  test(`speaker approval is invalidated by changed ${change}`, async (t) => {
    const { folder, build } = fixture(t); const res = await build(); await approve(folder, "full", approval);
    const planFile = path.join(folder, "work", "full", "plan.resolved.json");
    if (change === "plan") { const p = JSON.parse(fs.readFileSync(planFile)); p.items[0].note = "new edit"; fs.writeFileSync(planFile, JSON.stringify(p)); }
    else if (change === "video") fs.appendFileSync(path.join(folder, "draft.mp4"), "changed");
    else if (change === "reviewed video") fs.appendFileSync(path.join(res.dir, "draft-clean.mp4"), "changed");
    else if (change === "missing file") fs.rmSync(path.join(res.dir, "captions.vtt"));
    else fs.appendFileSync(path.join(change === "brand" || change === "manifest" ? folder : res.dir, { caption: "captions.srt", poster: "poster.jpg", brand: "brand.json", manifest: "speaker-manifest.json" }[change]), change === "manifest" || change === "brand" ? " " : "changed");
    await assert.rejects(deliver(folder, "full", { qc: passingQC }), /requires approved/);
    assert.equal(reviewState(folder, "full").state, "revised");
    assert.equal(reviewState(folder, "full").approval, null);
    assert.equal(fs.existsSync(path.join(folder, "final")), false);
  });
}

test("speaker final rights gate blocks pending proof even after client approval", async (t) => {
  const { folder, manifest, build } = fixture(t);
  manifest.rights[1].status = "pending";
  fs.writeFileSync(path.join(folder, "speaker-manifest.json"), JSON.stringify(manifest));
  await build(); await approve(folder, "full", approval);
  await assert.rejects(deliver(folder, "full", { qc: passingQC }), /proof quote.*pending/);
  assert.equal(fs.existsSync(path.join(folder, "final")), false);
});

test("speaker delivery copies the approved bytes, captions, poster and package manifest", async (t) => {
  const { folder, build } = fixture(t); await build();
  const state = await approve(folder, "full", approval);
  assert.equal(state.state, "approved"); assert.equal(state.approval.by, "Julee Gracey");
  const result = await deliver(folder, "full", { qc: passingQC });
  assert.equal(result.files.length, 5);
  assert.equal(fs.readFileSync(path.join(result.dir, "julee-gracey-speaker_full_v1_16x9_1080p_clean.mp4"), "utf8"), "approved-video-bytes");
  assert.equal(fs.readFileSync(path.join(result.dir, "julee-gracey-speaker_full_v1_16x9_1080p_open.mp4"), "utf8"), "approved-open-video-bytes");
  assert.equal(reviewState(folder, "full").state, "delivered");
  const manifest = JSON.parse(fs.readFileSync(result.manifest));
  assert.equal(manifest.files.length, 5); assert.equal(manifest.files[0].bookingMode, "direct");
  assert.equal(manifest.files[0].sha256.length, 64); assert.equal(manifest.files[0].duration, 8);
  assert.equal(manifest.files[0].approvalDate, approval.at);
});

test("speaker delivery naming follows revision, aspect ratio and caption variant", () => {
  assert.equal(deliveryName({ clientId: "client", version: "vertical-1", revision: 2, width: 1080, height: 1920, variant: "open" }), "client-speaker_vertical-1_v2_9x16_1920p_open.mp4");
  assert.equal(deliveryName({ clientId: "client", version: "full", revision: 1, kind: "vtt" }), "client-speaker_full_v1_16x9_1080p.vtt");
  assert.throws(() => deliveryName({ clientId: "../bad", version: "full", revision: 1 }), /invalid/);
});

test("speaker review rejects leaked identity and missing brand before creating an approval", async (t) => {
  const { folder, plan, manifest, build } = fixture(t);
  plan.items[1].card.text = "Book Greg Pingel";
  await assert.rejects(build(), /forbidden Greg identity/);
  delete plan.items[1].card.text; delete manifest.brand.file;
  await assert.rejects(build(), /brand.file is required/);
  assert.equal(reviewState(folder, "full").state, "draft");
});

test("speaker plan edits require rebuilding the review before approval", async (t) => {
  const { folder, build } = fixture(t); await build();
  const file = path.join(folder, "work", "full", "plan.resolved.json");
  const plan = JSON.parse(fs.readFileSync(file)); plan.items[0].note = "unreviewed edit";
  fs.writeFileSync(file, JSON.stringify(plan));
  await assert.rejects(approve(folder, "full", approval), /build a new review/);
  await build({ resolvedPlan: plan });
  assert.equal((await approve(folder, "full", approval)).state, "approved");
});

test("speaker review's ffmpeg extractor makes actual 480px JPEGs without Chrome", async (t) => {
  const { folder, plan, manifest, build } = fixture(t);
  const { run } = await import("../src/util.mjs");
  const { probe } = await import("../src/probe.mjs");
  const video = path.join(folder, "tiny.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30", "-t", "0.6", "-c:v", "libx264", "-preset", "ultrafast", video], { capture: true });
  plan.items = [{ ...plan.items[0], out: 100.6, outputEnd: 0.6 }]; plan.overlays = []; plan.cutaways = [];
  const res = await buildReview(folder, { version: "full", video, resolvedPlan: plan, manifest, qc: passingQC });
  const frame = await probe(path.join(res.dir, "frames", "i01.jpg"));
  assert.equal(frame.width, 480); assert.equal(frame.height, 270);
});

test("speaker approval rejects files or feedback changed while QC is running", async (t) => {
  const { folder, build } = fixture(t); await build();
  await assert.rejects(approve(folder, "full", { ...approval, qc: async () => { fs.appendFileSync(path.join(folder, "draft.mp4"), "change during QC"); return passingQC(); } }), /files changed during approval/);
  await build();
  let recorded = false;
  await assert.rejects(approve(folder, "full", { ...approval, qc: async () => { if (!recorded) { writeRevision(folder, "full", "FULL-i01: new feedback"); recorded = true; } return passingQC(); } }), /review state changed during approval/);
  assert.equal(reviewState(folder, "full").state, "revision");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createDropbox, apiArg, isPublicLink } from "../src/dropbox.mjs";
import { createOpus } from "../src/opus.mjs";
import { runOnce, S, safeName, captionText, join } from "../src/pipeline.mjs";
import { fakeDropbox, fakeOpus } from "./fakes.mjs";

const noWait = () => Promise.resolve();

async function rig(over = {}) {
  const dbx = await fakeDropbox();
  const op = await fakeOpus();
  dbx.folder("/Unedited");
  dbx.folder("/Opus Clips");
  const c = {
    folders: { drop: "/Unedited", finished: "/Opus Clips", done: "Done", needsLook: "Needs a look" },
    opus: { apiKey: "opus-key", project: { brandTemplateId: "t1" } },
    dropbox: { appKey: "app", refreshToken: "refresh" },
    maxInFlight: 3, stuckHours: 24, notify: true,
    ...over,
  };
  const state = { items: {} };
  const notes = [];
  const logs = [];
  let clock = Date.parse("2026-11-04T12:00:00Z");
  const r = {
    dbx, op, c, state, notes, logs,
    tick: (ms) => { clock += ms; },
    run: () => runOnce({
      c, state,
      dropbox: createDropbox({ appKey: "app", refreshToken: "refresh", api: dbx.api, content: dbx.content, wait: noWait }),
      opus: createOpus({ apiKey: "opus-key", api: op.url, wait: noWait }),
      now: () => clock,
      notify: (t, m) => notes.push(`${t}: ${m}`),
      log: (event, f) => logs.push({ event, ...f }),
    }),
    item: (name) => Object.values(state.items).find((it) => it.name === name),
    close: () => { dbx.close(); op.close(); },
  };
  return r;
}

test("a dropped video goes to Opus and its clips come back into Dropbox", async () => {
  const r = await rig();
  try {
    r.dbx.put("/Unedited/Big Talk.mov");
    let rep = await r.run();
    assert.equal(rep.sent, 1);
    assert.equal(r.op.created.length, 1);
    assert.match(r.op.created[0].videoUrl, /^https:\/\/www\.dropbox\.com\/scl\/fi\//);
    assert.equal(r.op.created[0].brandTemplateId, "t1");
    assert.equal(r.item("Big Talk.mov").status, S.IN_OPUS);

    rep = await r.run(); // still in Opus: nothing new
    assert.equal(rep.sent, 0);
    assert.equal(rep.inOpus, 1);
    assert.equal(r.op.created.length, 1, "never sent twice");

    r.op.finish("P1");
    rep = await r.run();
    assert.equal(rep.delivered, 1);
    assert.deepEqual(r.dbx.names("/Opus Clips/Big Talk"), ["Clip 1 - Hook number 1 why.mp4", "Clip 1 - caption.txt", "Clip 2 - Hook number 2 why.mp4", "Clip 2 - caption.txt"]);
    assert.equal(r.dbx.text("/Opus Clips/Big Talk/Clip 1 - Hook number 1 why.mp4"), "bytes of /files/P1/1.mp4");
    assert.equal(r.dbx.text("/Opus Clips/Big Talk/Clip 2 - caption.txt"), "Hook number 2: why?\n\nDescription 2\n\n#one #two\n");
    assert.deepEqual(r.dbx.names("/Unedited"), ["Done"]);
    assert.deepEqual(r.dbx.names("/Unedited/Done"), ["Big Talk.mov"]);
    assert.equal(r.item("Big Talk.mov").status, S.DONE);
    assert.match(r.notes.at(-1), /2 clips from Big Talk\.mov are in \/Opus Clips\/Big Talk/);
  } finally { r.close(); }
});

test("a send that never got its answer is not sent again by itself", async () => {
  const r = await rig();
  try {
    const n = r.dbx.put("/Unedited/Half Sent.mp4");
    r.state.items[n.id] = { name: "Half Sent.mp4", path: "/Unedited/Half Sent.mp4", status: S.SENDING, seenAt: "x" };
    await r.run();
    assert.equal(r.op.created.length, 0);
    assert.equal(r.item("Half Sent.mp4").status, S.FAILED);
    assert.deepEqual(r.dbx.names("/Unedited/Needs a look"), ["Half Sent - what happened.txt", "Half Sent.mp4"]);
    assert.match(r.dbx.text("/Unedited/Needs a look/Half Sent - what happened.txt"), /may already be in your Opus projects/);

    // A person checked Opus and moved it back: now it goes.
    r.dbx.move(n.id, "/Unedited/Half Sent.mp4");
    const rep = await r.run();
    assert.equal(rep.sent, 1);
    assert.equal(r.item("Half Sent.mp4").tries, 2);
  } finally { r.close(); }
});

test("no API minutes left keeps videos waiting, with one notice", async () => {
  const r = await rig();
  try {
    r.dbx.put("/Unedited/A.mov");
    r.op.createError = { status: 403, message: "monthly cap reached" };
    let rep = await r.run();
    assert.equal(rep.sent, 0);
    assert.match(rep.blocked, /monthly cap/);
    assert.equal(r.item("A.mov").status, S.WAITING);
    assert.deepEqual(r.dbx.names("/Unedited"), ["A.mov"], "not filed as a failure");
    assert.equal(r.notes.length, 1);

    r.op.createError = { status: 403, message: "monthly cap reached" };
    await r.run();
    assert.equal(r.notes.length, 1, "no second notice within 12 hours");

    rep = await r.run(); // the cap lifted
    assert.equal(rep.sent, 1);
  } finally { r.close(); }
});

test("a video Opus will not take, or cannot finish, goes to Needs a look", async () => {
  const r = await rig();
  try {
    r.dbx.put("/Unedited/Bad.mov");
    r.op.createError = { status: 400, message: "unsupported video" };
    await r.run();
    assert.equal(r.item("Bad.mov").status, S.FAILED);
    assert.ok(r.dbx.names("/Unedited/Needs a look").includes("Bad.mov"));

    r.dbx.put("/Unedited/Stall.mov");
    await r.run();
    r.op.stall("P1", "import failed");
    await r.run();
    assert.equal(r.item("Stall.mov").status, S.FAILED);
    assert.match(r.dbx.text("/Unedited/Needs a look/Stall - what happened.txt"), /import failed/);
  } finally { r.close(); }
});

test("only maxInFlight videos sit in Opus at once; the rest wait their turn", async () => {
  const r = await rig({ maxInFlight: 2 });
  try {
    for (const n of ["1.mov", "2.mov", "3.mov", "4.mov", "5.mov"]) r.dbx.put(`/Unedited/${n}`);
    let rep = await r.run();
    assert.equal(rep.sent, 2);
    assert.equal(rep.waiting, 3);
    r.op.finish("P1");
    rep = await r.run();
    assert.equal(rep.delivered, 1);
    assert.equal(rep.sent, 0, "a slot frees up on the run after delivery is noted");
    rep = await r.run();
    assert.equal(rep.sent, 1);
  } finally { r.close(); }
});

test("videos there at setup are left alone; one taken out before sending is forgotten", async () => {
  const r = await rig();
  try {
    const old = r.dbx.put("/Unedited/Old.mov");
    r.state.items[old.id] = { name: "Old.mov", path: "/Unedited/Old.mov", status: S.EXISTING, seenAt: "x" };
    const gone = r.dbx.put("/Unedited/Gone.mov");
    r.state.items[gone.id] = { name: "Gone.mov", status: S.WAITING, seenAt: "x" };
    r.dbx.nodes.delete("/unedited/gone.mov");
    const rep = await r.run();
    assert.equal(rep.sent, 0);
    assert.equal(r.item("Old.mov").status, S.EXISTING);
    assert.equal(r.item("Gone.mov"), undefined);
  } finally { r.close(); }
});

test("an account that blocks public links sends a temporary download link instead", async () => {
  const r = await rig();
  try {
    r.dbx.blockPublic = true;
    r.dbx.put("/Unedited/Team.mov");
    await r.run();
    assert.match(r.op.created[0].videoUrl, /dl\.dropboxusercontent\.com\/temp\//);
    assert.equal(r.item("Team.mov").linkKind, "temporary");
  } finally { r.close(); }
});

test("an existing public link is reused", async () => {
  const r = await rig();
  try {
    const n = r.dbx.put("/Unedited/Linked.mov");
    r.dbx.links.set(n.id, "https://www.dropbox.com/scl/fi/existing/Linked.mov?dl=0");
    await r.run();
    assert.equal(r.op.created[0].videoUrl, "https://www.dropbox.com/scl/fi/existing/Linked.mov?dl=0");
  } finally { r.close(); }
});

test("when Dropbox cannot fetch a clip itself, the Mac downloads and uploads it", async () => {
  const r = await rig();
  try {
    r.dbx.failSaveUrl = true;
    r.op.clipCount = 1;
    r.dbx.put("/Unedited/Fallback.mov");
    await r.run();
    r.op.finish("P1");
    await r.run();
    assert.equal(r.dbx.text("/Opus Clips/Fallback/Clip 1 - Hook number 1 why.mp4"), "bytes of /files/P1/1.mp4");
    assert.ok(r.logs.some((l) => l.event === "save_url_failed"));
  } finally { r.close(); }
});

test("an interrupted delivery picks up where it stopped, with the same clip numbers", async () => {
  const r = await rig();
  try {
    r.op.clipCount = 3;
    r.dbx.put("/Unedited/Resume.mov");
    await r.run();
    r.op.finish("P1");
    r.dbx.failUploads = 1; // clip 1's video is saved, then its caption upload fails
    let rep = await r.run();
    assert.equal(rep.delivered, 0);
    assert.equal(r.item("Resume.mov").status, S.DELIVERING);
    assert.equal(r.item("Resume.mov").deliverErrors, 1);
    r.op.reverseClips = true; // Opus lists them in another order now
    rep = await r.run();
    assert.equal(rep.delivered, 1);
    const names = r.dbx.names("/Opus Clips/Resume");
    assert.deepEqual(names.filter((n) => n.endsWith(".mp4")), ["Clip 1 - Hook number 1 why.mp4", "Clip 2 - Hook number 2 why.mp4", "Clip 3 - Hook number 3 why.mp4"], "no duplicate clip 1");
    assert.equal(names.length, 6);
    assert.equal(r.dbx.text("/Opus Clips/Resume/Clip 3 - Hook number 3 why.mp4"), "bytes of /files/P1/3.mp4");
  } finally { r.close(); }
});

test("a second video with the same name gets its own clips folder", async () => {
  const r = await rig();
  try {
    r.op.clipCount = 1;
    r.dbx.put("/Unedited/IMG_0001.MOV");
    await r.run(); r.op.finish("P1"); await r.run();
    r.dbx.put("/Unedited/IMG_0001.MOV");
    await r.run(); r.op.finish("P2"); await r.run();
    assert.deepEqual(r.dbx.names("/Opus Clips"), ["IMG_0001", "IMG_0001 (1)"]);
    assert.deepEqual(r.dbx.names("/Unedited/Done"), ["IMG_0001 (1).MOV", "IMG_0001.MOV"]);
  } finally { r.close(); }
});

test("accents and emoji in names make it through Dropbox's ASCII-only header", async () => {
  const r = await rig();
  try {
    r.op.clipCount = 1;
    r.dbx.put("/Unedited/Café 🎬.mov");
    await r.run(); r.op.finish("P1"); await r.run();
    assert.equal(r.dbx.badArgHeaders, 0);
    assert.deepEqual(r.dbx.names("/Opus Clips/Café 🎬"), ["Clip 1 - Hook number 1 why.mp4", "Clip 1 - caption.txt"]);
  } finally { r.close(); }
});

test("a finished project with no clips listed yet is tried again before it fails", async () => {
  const r = await rig();
  try {
    r.op.clipCount = 0;
    r.dbx.put("/Unedited/Empty.mov");
    await r.run();
    r.op.finish("P1");
    for (let i = 0; i < 5; i++) await r.run();
    assert.equal(r.item("Empty.mov").status, S.DELIVERING);
    assert.equal(r.item("Empty.mov").deliverErrors, 5);
    await r.run();
    assert.equal(r.item("Empty.mov").status, S.FAILED);
    assert.match(r.dbx.text("/Unedited/Needs a look/Empty - what happened.txt"), /not listed any clips/);
  } finally { r.close(); }
});

test("the org id Opus gives with a project is sent when listing its clips", async () => {
  const r = await rig();
  try {
    r.op.clipCount = 1;
    r.dbx.put("/Unedited/Org.mov");
    await r.run();
    Object.assign(r.op.projects.get("P1"), { stage: "COMPLETE", orgId: "org-9" });
    await r.run();
    assert.equal(r.item("Org.mov").status, S.DONE);
    assert.equal(r.op.orgHeaders.at(-1), "org-9");
  } finally { r.close(); }
});

test("a project stuck in Opus gets one notice", async () => {
  const r = await rig();
  try {
    r.dbx.put("/Unedited/Slow.mov");
    await r.run();
    r.tick(25 * 3600 * 1000);
    await r.run();
    await r.run();
    assert.equal(r.notes.filter((n) => /long time/.test(n)).length, 1);
    assert.equal(r.item("Slow.mov").status, S.IN_OPUS);
  } finally { r.close(); }
});

test("team accounts send the root namespace with every call", async () => {
  const dbx = await fakeDropbox();
  try {
    dbx.folder("/Team Videos");
    const d = createDropbox({ appKey: "a", refreshToken: "r", pathRoot: "777", api: dbx.api, content: dbx.content, wait: noWait });
    await d.list("/Team Videos");
    assert.equal(dbx.calls.at(-1).pathRoot, '{".tag":"root","root":"777"}');
  } finally { dbx.close(); }
});

test("small helpers", () => {
  assert.equal(apiArg({ path: "/Café 🎬" }), '{"path":"/Caf\\u00e9 \\ud83c\\udfac"}');
  assert.equal(safeName('What: "is" this / that?'), "What is this that");
  assert.equal(safeName("   "), "Clip");
  assert.equal(safeName("x".repeat(100)).length, 80);
  assert.equal(join("/a/", "b", "c.mp4"), "/a/b/c.mp4");
  assert.equal(captionText({ title: "T", hashtags: "#a" }), "T\n\n#a\n");
  assert.ok(isPublicLink({ link_permissions: { resolved_visibility: { ".tag": "public" } } }));
  assert.ok(!isPublicLink({ link_permissions: { effective_audience: { ".tag": "team" } } }));
});

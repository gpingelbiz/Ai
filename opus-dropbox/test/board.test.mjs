import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { snapshot, boardPrompt, boardRoutine } from "../src/board.mjs";

const c = { opus: { apiKey: "secret-key", project: {} }, dropbox: { appKey: "app-key", refreshToken: "secret-refresh" }, folders: { drop: "/drop", finished: "/clips" }, stuckHours: 24 };
const fake = (n = 2, caption = "A caption") => ({
  opus: { templates: async () => [] },
  dropbox: {
    account: async () => ({ email: "a@b.c" }), exists: async () => true,
    list: async (p) => p === "/clips"
      ? [...Array.from({ length: n }, (_, i) => ({ ".tag": "folder", name: `2026-11-05 Reel ${i + 1}`, path_display: `/clips/2026-11-05 Reel ${i + 1}` })), { ".tag": "folder", name: "Other", path_display: "/clips/Other" }]
      : p === "/drop" ? [] : [{ ".tag": "file", name: "Title.mp4" }, { ".tag": "file", name: "caption.txt", path_display: p + "/caption.txt" }],
    downloadText: async () => caption,
  },
});
const state = { lastRun: new Date().toISOString(), items: {
  a: { name: "waiting.mov", status: "waiting", link: "https://www.dropbox.com/scl/fo/secret", sharedLink: "https://x" },
  b: { name: "bad.mov", status: "failed", error: "secret-key broke at https://www.dropbox.com/scl/fo/secret" },
  c: { name: "done.mov", status: "done", clips: 1, doneAt: "2026-11-05T00:00:00Z" },
} };

test("the snapshot holds reels newest first and never a key, a sign-in or a share link", async () => {
  const s = await snapshot({ c, state, clients: fake(), job: true });
  const text = JSON.stringify(s);
  for (const secret of ["secret-key", "secret-refresh", "app-key", "scl/fo", "sharedLink"]) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(s.reels.map((r) => r.number), [2, 1]);
  assert.equal(s.reels[0].title, "Title");
  assert.match(s.reels[0].url, /^https:\/\/www\.dropbox\.com\/home\/clips\/2026-11-05%20Reel%202$/);
  assert.equal(s.reelCount, 2);
  assert.deepEqual(s.videos.map((v) => v.name), ["waiting.mov", "bad.mov"]);
  assert.ok(s.problems.length);
});

test("the snapshot fits in an artifact document, and a read changes no state", async () => {
  const before = JSON.stringify(state);
  const s = await snapshot({ c, state, clients: fake(400, "x".repeat(9000)), job: true, limit: 400 });
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= 200 * 1024);
  assert.ok(s.reels.length && s.reels.every((r) => r.caption.length <= 1500));
  assert.equal(s.reelCount, 400);
  assert.equal(JSON.stringify(state), before);
});

test("a Dropbox failure shows as a problem instead of stopping the board", async () => {
  const clients = fake();
  clients.dropbox.list = async () => { throw new Error("down"); };
  const s = await snapshot({ c, state, clients, job: true });
  assert.deepEqual(s.reels, []);
  assert.ok(s.problems.includes("The finished folder could not be read."));
});

test("the prompts stay inside the board and the page renders data as text", () => {
  const cmd = (t) => `node tool ${t}`;
  const r = boardRoutine(cmd, "https://claude.ai/artifact/x");
  assert.match(r, /Never run send, recut, run, setup, stop, start or settings changes/);
  assert.match(r, /Never write to any other artifact/);
  assert.match(boardPrompt(cmd), /"write":"owner"/);
  const page = fs.readFileSync(new URL("../src/board-page.html", import.meta.url), "utf8");
  assert.ok(!page.includes("innerHTML"));
  assert.ok(!/recut|settings/i.test(page), "the board has no actions");
  assert.ok(page.includes('startsWith("https://www.dropbox.com/home/")'));
});

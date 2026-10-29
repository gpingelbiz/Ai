import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.REEL_WATCH_DONE = fs.mkdtempSync(path.join(os.tmpdir(), "fwd-desk-"));
process.env.REEL_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), "fwd-cache-"));
process.env.REEL_FORWARD_NOTIFY = "0";
const { plan, runForward, SENT } = await import("../scripts/publish-forward.mjs");

const old = (f) => { const d = new Date(Date.now() - 600000); fs.utimesSync(f, d, d); };
const mk = (...parts) => fs.mkdtempSync(path.join(os.tmpdir(), parts.join("-") + "-"));
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); old(f); };

test("forward: a loose video is bundled with the caption, meta and check note of its delivered folder, then filed as sent", () => {
  const root = mk("fwd-root"), dest = mk("fwd-dest"), desk = mk("fwd-delivered");
  write(path.join(desk, "2026-10-29 Reel 1", "my reel.mp4"), "VIDEO-BYTES");
  write(path.join(desk, "2026-10-29 Reel 1", "caption.txt"), "CAPTION\nNever send the PDF and hope.\n\nHASHTAGS\n#a #b #c\n");
  write(path.join(desk, "2026-10-29 Reel 1", ".reel.json"), JSON.stringify({ isAiGenerated: true }));
  write(path.join(desk, "2026-10-29 Reel 1", "check this reel.txt"), "OK\n");
  write(path.join(root, "my reel.mp4"), "VIDEO-BYTES"); // dragged in on its own: same name and size
  const res = runForward({ root, host: "", dest, sourceRoots: [desk], notify: false });
  assert.deepEqual(res.map((r) => [r.entry, r.ok]), [["my reel.mp4", true]]);
  const got = path.join(dest, "my reel");
  assert.deepEqual(fs.readdirSync(got).sort(), [".reel.json", "caption.txt", "check this reel.txt", "my reel.mp4"]);
  assert.match(fs.readFileSync(path.join(got, "caption.txt"), "utf8"), /Never send the PDF/);
  assert.equal(fs.existsSync(path.join(root, "my reel.mp4")), false, "the video left the folder");
  assert.equal(fs.readdirSync(path.join(root, SENT)).length, 1, "and was filed under Sent to the Mini");
  assert.equal(fs.existsSync(path.join(dest, ".incoming", fs.readdirSync(path.join(dest, ".incoming"))[0] || "x")), false, "no half-copy left behind");
});

test("forward: a dropped reel folder goes as it is; a copy still in progress waits; a name already waiting is never overwritten", () => {
  const root = mk("fwd-root"), dest = mk("fwd-dest");
  write(path.join(root, "Reel A", "Reel A.mp4"), "A");
  write(path.join(root, "Reel A", "caption.txt"), "Plain caption A.");
  fs.mkdirSync(path.join(root, "Reel B"));
  write(path.join(root, "Reel B", "Reel B.mp4"), "B"); write(path.join(root, "Reel B", "caption.txt"), "Plain caption B.");
  write(path.join(dest, "Reel B", "keep.txt"), "already on the Mini");
  fs.writeFileSync(path.join(root, "fresh.mp4"), "still being copied"); // just written: inside the 60 s settle window
  const p = plan({ root, host: "", dest, notify: false });
  assert.equal(p.find((x) => x.entry === "fresh.mp4").ready, false);
  const res = runForward({ root, host: "", dest, notify: false });
  assert.equal(res.find((r) => r.entry === "Reel A").ok, true);
  assert.deepEqual(fs.readdirSync(path.join(dest, "Reel A")).sort(), ["Reel A.mp4", "caption.txt"]);
  const b = res.find((r) => r.entry === "Reel B");
  assert.equal(b.ok, false);
  assert.match(b.why, /already waiting/);
  assert.equal(fs.readFileSync(path.join(dest, "Reel B", "keep.txt"), "utf8"), "already on the Mini", "not overwritten");
  assert.ok(fs.existsSync(path.join(root, "Reel B", "Reel B.mp4")), "and it stays here");
  assert.ok(fs.existsSync(path.join(root, "fresh.mp4")), "a file still copying is left alone");
});

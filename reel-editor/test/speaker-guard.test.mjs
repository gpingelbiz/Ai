import { test } from "node:test";
import assert from "node:assert/strict";
import { hasGregIdentity, identityLeaks, maskHome } from "../src/speaker-guard.mjs";
import { assertNoGreg } from "../src/speaker-intake.mjs";

test("speaker guard: a client's files under the operator's home folder are not Greg's identity", () => {
  assert.equal(hasGregIdentity("/Users/gregpingel/Clients/Julee Gracey/brand.json"), false);
  assert.equal(hasGregIdentity("file:///Users/gregpingel/Reels/speaker-clients/julee-gracey/proof/logo.png"), false);
  assert.equal(maskHome("/Users/gregpingel/Clients/Julee Gracey/brand.json"), "/Users/local/Clients/Julee Gracey/brand.json");
  // Only a value that is a path is masked: path-shaped words inside display copy are still checked.
  assert.equal(hasGregIdentity("download at /Users/pingel-speaks/doc.pdf"), true);
  const manifest = { brand: { file: "/Users/gregpingel/Clients/Julee Gracey/brand.json" }, identity: { name: "Julee Gracey" } };
  assert.equal(assertNoGreg(manifest, "manifest"), manifest);
});

test("speaker guard: Greg's name, handle and brand still fail anywhere in the copy", () => {
  for (const text of ["Greg Pingel", "greg  pingel", "@officialgregpingel", "pingel-brand look", "Book via Pingel Consulting"]) {
    assert.equal(hasGregIdentity(text), true, text);
  }
  assert.deepEqual(identityLeaks({ items: [{ card: { name: "Greg Pingel" } }] }, "plan"), ["plan.items.0.card.name"]);
  assert.throws(() => assertNoGreg({ identity: { tagline: "Coached by Greg Pingel" } }, "manifest"), /manifest.identity.tagline/);
});

test("speaker review fixes: attribution-matched proof counts for rights, rows show resolved text, bureau leaks are format-blind", async () => {
  const { usedAssets, rightsChecks } = await import("../src/speaker-qc.mjs");
  const { reviewRows } = await import("../src/speaker-review.mjs");
  const { leaksContact } = await import("../src/speaker-cards.mjs");
  const manifest = {
    identity: { name: "Jane Doe", roleLine: "Speaker", bookingUrl: "https://example.com/speaking", phone: "(555) 123-4567", email: "jane@example.com" },
    proof: [{ id: "q1", kind: "quote", text: "She was the best speaker we had", attribution: { name: "Ann Lee", title: "Director", org: "Acme" }, rights: "r1" }],
    rights: [{ id: "r1", status: "pending" }],
  };
  const quoteByName = { id: "i01", kind: "card", start: 0, end: 5, duration: 5, card: { type: "quote", name: "Ann Lee", title: "Director", org: "Acme", text: "She was the best speaker we had" } };
  assert.deepEqual(usedAssets({ items: [quoteByName] }, manifest).proofIds, ["q1"]);
  assert.ok(rightsChecks({ items: [quoteByName] }, manifest, true).some((c) => c.level === "fail" || c.status === "pending"));
  const made = { id: "i02", kind: "card", start: 5, end: 9, duration: 4, card: { type: "title", name: "COMPLETELY MADE UP", roleLine: "Invented" } };
  const [, row] = reviewRows({ version: "full", items: [quoteByName, made] }, manifest);
  assert.match(row.text, /^Jane Doe · Speaker/);
  assert.ok(row.problems.some((p) => /must exactly match/.test(p)));
  for (const text of ["call 5551234567", "visit example.com/speaking", "www.example.com/speaking/", "JANE@EXAMPLE.COM"]) assert.equal(leaksContact(text, manifest.identity), true, text);
  assert.equal(leaksContact("Book through Gravity Speakers", manifest.identity), false);
});

test("speaker cards: a brand on the default font family resolves the font file from the package", async () => {
  const { speakerCardsHTML } = await import("../src/speaker-cards.mjs");
  const fs = await import("node:fs");
  const tokens = { type: { display: { family: "Anton" }, body: { family: "Inter" } }, colors: { ink: "#111111", surface: "#FFFFFF", accent: "#FFB27D" } };
  const plan = { version: "full", canvas: { width: 1920, height: 1080, fps: 30 }, items: [{ id: "i01", kind: "card", start: 0, end: 4, duration: 4, card: { type: "topic", text: "Sales confidence" } }] };
  const out = speakerCardsHTML(plan, { manifest: { identity: { name: "Jane Doe", roleLine: "Speaker" } }, tokens, clientDir: "/tmp/no-such-client" });
  for (const asset of out.assets.filter((a) => a.font)) assert.ok(fs.existsSync(asset.source), asset.source);
});

test("speaker core fixes: a broken link does not stop init, and a word at a rounded clip edge keeps one frame", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const { initManifest } = await import("../src/speaker-intake.mjs");
  const { timelineWords } = await import("../src/speaker-compile.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-fix-"));
  fs.mkdirSync(path.join(dir, "footage"), { recursive: true });
  fs.writeFileSync(path.join(dir, "footage", "talk.mp4"), "x");
  fs.symlinkSync(path.join(dir, "gone.mp4"), path.join(dir, "footage", "broken-link.mp4"));
  const result = initManifest(dir, {});
  const manifest = result.manifest || result;
  assert.ok(JSON.stringify(manifest).includes("footage/talk.mp4"));
  assert.ok(!JSON.stringify(manifest).includes("broken-link"));
  const resolved = { canvas: { fps: 30 }, items: [{ kind: "clip", id: "i01", sourceId: "s", in: 0, out: 0.98, start: 0, end: 29 / 30 }] };
  const index = { sources: { s: { words: [{ text: "end", start: 0.97, end: 0.975 }] } } };
  const words = timelineWords(resolved, index);
  assert.equal(words.length, 1);
  assert.ok(words[0].end > words[0].start && words[0].end <= 29 / 30 + 1e-9);
});

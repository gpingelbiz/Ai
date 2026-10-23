import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOKS, LOOK_IDS, skinFor, looksPrompt, pickLook, skinHTML, skinsCSS, skinFonts } from "../src/looks.mjs";
import { sceneHTML } from "../src/graphics.mjs";

const statHTML = (v) => `<div class="g-stat g-in"><span class="g-count" data-to="1">${v}</span></div>`;

test("looks: every look maps every card type to a skin; the prompt lists them and steers off the last one", () => {
  for (const id of LOOK_IDS) for (const t of ["stat", "list", "quote", "headline", "steps", "compare", "bars", "message", "post", "chapter"]) assert.ok(typeof skinFor(id, t) === "string");
  assert.equal(skinFor("receipts", "stat"), "notify");
  assert.equal(skinFor("glass", "stat"), "glass");
  const p = looksPrompt(["phone", "receipts"]);
  assert.match(p, /receipts: Receipts, for money/);
  assert.match(p, /most recent last: phone, receipts\. Do not use any of the last three \(phone, receipts\)/);
});

test("pick: Claude's look when valid, else one from the topic words that is not the last reel's", () => {
  assert.equal(pickLook({ look: "fieldnotes", lookWhy: "a story" }).look, "fieldnotes");
  const fb = pickLook({ look: "neon" }, { transcript: "the price, the revenue, the profit and the deals", recent: [] });
  assert.equal(fb.look, "receipts");
  assert.notEqual(pickLook({}, { transcript: "price revenue profit", recent: ["receipts"] }).look, "receipts");
  const cool = pickLook({}, { transcript: "price revenue profit", recent: ["receipts", "phone", "press"] }).look;
  assert.ok(!["receipts", "phone", "press"].includes(cool), "none of the last three");
});

test("artifacts: a notification keeps the count-up, a receipt totals only numbers the speaker gave, the typewriter types", () => {
  const n = skinHTML({ type: "stat", eyebrow: "WHAT IT COST", value: "$10,000", sub: "one missed call" }, "notify", { statHTML });
  assert.match(n, /g-notify g-drop/);
  assert.match(n, /g-count/);
  assert.match(n, /What it cost/);
  const r = skinHTML({ type: "list", eyebrow: "RECEIPT", items: [{ text: "Slam the desk", state: "strike" }, { text: "Own it", state: "check" }] }, "receipt", { statHTML });
  assert.doesNotMatch(r, /r-total/, "no total on a list: nothing to add up");
  assert.match(r, /✕[\s\S]*✓/);
  const t = skinHTML({ type: "quote", eyebrow: "THE STANDARD", text: "your team copies *how you react*" }, "type", { statHTML });
  assert.match(t, /t-ch/);
  assert.match(t, /— the standard/);
  assert.equal(skinHTML({ type: "list", items: [] }, "paper", { statHTML }), null, "paper only restyles");
  assert.match(sceneHTML({ type: "stat", eyebrow: "X", value: "$5", skin: "notify" }), /g-notify/);
});

test("styles and fonts only for the skins in use", () => {
  const css = skinsCSS({ H: 1920, colors: { accent: "#C8A24B" }, skins: ["paper", "receipt"] });
  assert.match(css, /skin-paper/);
  assert.match(css, /skin-receipt/);
  assert.doesNotMatch(css, /skin-notify/);
  const f = skinFonts(["paper", "type", "glass"]);
  assert.deepEqual(f.files.sort(), ["CourierPrime-Bold.ttf", "CourierPrime-Regular.ttf", "PermanentMarker-Regular.ttf"]);
  assert.match(f.css, /Permanent Marker/);
});

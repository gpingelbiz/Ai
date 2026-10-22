import { test } from "node:test";
import assert from "node:assert/strict";
import { coverHTML, coverTime } from "../src/cover.mjs";

test("cover: hook at chest height inside the grid crop, gold phrase, handle, escaped", () => {
  const html = coverHTML({ frame: "assets/frame.png", hook: { text: "The 10 minutes after a bad number", words: [{ text: "The" }, { text: "10", key: true }, { text: "minutes", key: true }, { text: "after" }, { text: "a" }, { text: "bad" }, { text: "number" }] }, colors: { accent: "#C8A24B" }, handle: "@me <x>" });
  assert.match(html, /#title \{[^}]*top: 69%/);
  assert.match(html, /<span class="k">10<\/span> <span class="k">minutes<\/span>/);
  assert.match(html, /@me &lt;x&gt;/);
  assert.match(html, /data-composition-id="cover"/);
  assert.equal(coverTime({ hook: { start: 0, duration: 3 }, video: { duration: 60 } }), 0.8);
  assert.equal(coverTime({ hook: null, video: { duration: 60 } }), 0.5);
  assert.ok(coverTime({ hook: { start: 0, duration: 3 }, video: { duration: 0.5 } }) <= 0.4);
});

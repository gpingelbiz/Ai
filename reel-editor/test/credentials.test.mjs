import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCredit, parseCredits, brandCredit, scheduleCredits, youtubeReshowStarts, credentialDimensions } from "../src/credentials.mjs";
import { firstLongTurn } from "../src/speakers.mjs";
import { placeCredentialLowerThird } from "../src/placement.mjs";
import { credentialChecks } from "../src/preflight.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset, mergeOverrides } from "../src/presets.mjs";

test("credit input: pipes, missing trailing parts, source, verified and several speakers", () => {
  assert.deepEqual(parseCredit(" Ada Lovelace | Mathematician | Analytical Society "), {
    name: "Ada Lovelace", credential: "Mathematician", organisation: "Analytical Society", source: "", verified: false, at: null,
    input: { kind: "cli", text: "Ada Lovelace | Mathematician | Analytical Society" },
  });
  const short = parseCredit("Grace Hopper | Rear admiral");
  assert.equal(short.organisation, "");
  assert.equal(short.source, "");
  const sourced = parseCredit("Mae Jemison | Physician | NASA | Source: supplied bio, 2024 | verified", { at: "12.5" });
  assert.equal(sourced.source, "Source: supplied bio, 2024");
  assert.equal(sourced.verified, true);
  assert.equal(sourced.at, 12.5);
  const several = parseCredits(["A | Role A | Org A", "B | Role B"], ["4", "18"]);
  assert.deepEqual(several.map((credit) => [credit.name, credit.at]), [["A", 4], ["B", 18]]);
  assert.throws(() => parseCredits(["A | Role"], ["2", "3"]), /no matching --credit/);
});

test("creator credit comes only from resolved brand identity", () => {
  const preset = loadPreset("pingel-brand");
  const credit = brandCredit(preset.brand);
  assert.equal(credit.name, preset.brand.identity.name);
  assert.equal(credit.credential, preset.brand.identity.credential);
  assert.equal(credit.input.kind, "brand.identity");
  assert.equal(brandCredit({ identity: { name: "Name", credential: "" } }), null);
});

test("placement: a speaker's first long turn wins", () => {
  const turns = [{ start: 0, end: 2, person: 0 }, { start: 3, end: 7, person: 1 }, { start: 8, end: 14, person: 0 }];
  assert.deepEqual(firstLongTurn(turns, 0, { min: 3 }), turns[2]);
  const credit = parseCredit("A | Role | Org");
  const scheduled = scheduleCredits([credit], { turns, duration: 30, hold: 4 });
  assert.equal(scheduled.items[0].at, 8);
});

test("placement: credit windows never overlap the hook or a card", () => {
  const credit = parseCredit("A | Role | Org", { at: 1 });
  const hook = { start: 0, duration: 3 };
  const card = { start: 4, duration: 3 };
  const { items } = scheduleCredits([credit], { hook, cards: [card], duration: 20, hold: 4, fps: 30 });
  assert.equal(items.length, 1);
  const item = items[0];
  const overlaps = (a, b) => a.at < b.start + b.duration && a.at + a.duration > b.start;
  assert.equal(overlaps(item, hook), false);
  assert.equal(overlaps(item, card), false);
  assert.equal(item.at, 7.033);
});

test("automatic placement skips a blocked turn instead of leaving that speaker", () => {
  const turns = [
    { start: 3, end: 8, person: 0 },
    { start: 12, end: 18, person: 0 },
  ];
  const card = { start: 3, duration: 5 };
  const { items } = scheduleCredits([parseCredit("A | Role")], { turns, cards: [card], duration: 30, hold: 5 });
  assert.equal(items.length, 1);
  assert.equal(items[0].at, 12);
  assert.ok(items[0].at + items[0].duration <= turns[1].end);
});

test("YouTube re-shows a guest after a chapter only when they were away over three minutes", () => {
  const turns = [
    { start: 10, end: 20, person: 0 },
    { start: 230, end: 240, person: 0 },
    { start: 450, end: 460, person: 0 },
  ];
  const chapters = [{ start: 0 }, { start: 200 }, { start: 400 }];
  assert.deepEqual(youtubeReshowStarts(turns, chapters, { speaker: 0 }), [10, 230, 450]);
  assert.deepEqual(youtubeReshowStarts([...turns, { start: 358, end: 359, person: 0 }], chapters, { speaker: 0 }), [10, 230], "even a brief appearance resets the off-screen clock");
});

test("credential plate uses the brand scale and stays clear of a measured head and caption band", () => {
  const brand = loadPreset("pingel-brand").brand;
  const size = credentialDimensions(brand, parseCredit("A | Role | Org | Source: supplied"));
  const placement = placeCredentialLowerThird({ ...size, captionTop: 0.72, face: { cx: 0.72, cy: 0.5, w: 0.28, h: 0.3 } });
  assert.equal(placement.skip, undefined);
  assert.ok(placement.x >= 76 && placement.x + placement.w <= 940);
  assert.ok(placement.y + placement.h <= 0.72 * 1920);
});

function renderPlan(style, lowerThird) {
  return {
    name: "credit-test",
    canvas: { width: 1080, height: 1920 },
    style,
    video: { src: "/x/clean.mp4", duration: 20, hasAudio: true },
    captions: [], hook: null, cta: null, zooms: [], graphics: [], broll: [], slams: [], icons: [], audio: { tracks: [] },
    lowerThird,
  };
}

test("credential-off HTML is unchanged; credential-on HTML is escaped, token-driven and frame-timed", () => {
  const withOption = loadPreset("clean");
  const withoutOption = structuredClone(withOption);
  delete withoutOption.lowerThird.credential;
  const legacy = { name: "Legacy Name", handle: "@legacy", at: 4, duration: 5 };
  assert.equal(renderHTML(renderPlan(withOption, { ...legacy, credential: false }), "assets/footage.mp4"), renderHTML(renderPlan(withoutOption, legacy), "assets/footage.mp4"));

  const item = {
    ...parseCredit("A < B | Expert & teacher | Example Org | Source: supplied | verified", { at: 5 }),
    duration: 4,
    placement: { x: 76, y: 1050, w: 864, h: 210, captionTop: 1380 },
  };
  const html = renderHTML(renderPlan(withOption, { credential: true, items: [item] }), "assets/footage.mp4");
  assert.match(html, /A &lt; B/);
  assert.match(html, /Expert &amp; teacher/);
  assert.match(html, /aria-label="Verified"/);
  assert.match(html, /font-family: var\(--brand-display-font\)/);
  assert.match(html, /const enter = 8 \* frame, exit = 5 \* frame/);
});

test("preflight preserves provenance text and flags face or caption overlap", () => {
  const base = {
    ...parseCredit("A | Expert | Org | Source: supplied | verified", { at: 5 }), duration: 4,
    placement: { x: 76, y: 1000, w: 600, h: 200, captionTop: 1400 },
    head: { cx: 0.8, cy: 0.45, w: 0.2, h: 0.25 },
  };
  const plan = { canvas: { width: 1080, height: 1920 }, style: { captions: { position: 0.72 } }, lowerThird: { credential: true, items: [base] } };
  assert.deepEqual(credentialChecks(plan), []);
  const bad = structuredClone(plan);
  Object.assign(bad.lowerThird.items[0].placement, { x: 750, y: 700, w: 300, h: 800, captionTop: 1400 });
  bad.lowerThird.items[0].credential = "Invented role";
  const codes = credentialChecks(bad).map((item) => item.code);
  assert.ok(codes.includes("credential-grounding"));
  assert.ok(codes.includes("credential-face"));
  assert.ok(codes.includes("credential-caption"));
});

test("preset and flags keep credential mode switchable", () => {
  assert.equal(loadPreset("clean").lowerThird.credential, false);
  assert.equal(loadPreset("youtube").lowerThird.credential, true);
  assert.equal(loadPreset("youtube").brand.identity.credential, "Sales trainer");
  assert.equal(mergeOverrides(loadPreset("clean"), { credit: ["A | Role"] }).lowerThird.credential, true);
});

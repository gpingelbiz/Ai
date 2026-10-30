import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPreset } from "../src/presets.mjs";
import { resolveBrandTokens, upgradeBrandV1 } from "../src/brandtokens.mjs";
import { faceAwareObjectPosition, fitTextSize, slideHTML, typeBalanceEnabled } from "../src/slides.mjs";

test("text fit: a fitting size is untouched and overflow searches whole pixels down to the 70 percent floor", () => {
  assert.deepEqual(fitTextSize(100, () => true), { size: 100, shrunk: false, overflow: false });

  const measured = new Map(Array.from({ length: 31 }, (_, index) => {
    const size = 70 + index;
    return [size, { scrollWidth: size <= 83 ? 888 : 900, clientWidth: 888, contentBottom: size <= 83 ? 1100 : 1210, footerTop: 1160 }];
  }));
  const fits = (size) => {
    const box = measured.get(size);
    return box.scrollWidth <= box.clientWidth + 1 && box.contentBottom <= box.footerTop + 1;
  };
  assert.deepEqual(fitTextSize(100, fits), { size: 83, shrunk: true, overflow: false });
  assert.deepEqual(fitTextSize(100, (size) => size <= 60), { size: 70, shrunk: true, overflow: true });
});

test("type balance: client brands default on, Pingel brands default off, and an authored option wins", () => {
  const pingel = loadPreset("pingel-brand").brand;
  const client = resolveBrandTokens({ brand: upgradeBrandV1({
    name: "Client Coach",
    handle: "@clientcoach",
    colors: { text: "#F5F1E8", accent: "#C8A24B", stroke: "#000000", bg: "#0B0B0D" },
  }) });
  assert.equal(typeBalanceEnabled(pingel), false);
  assert.equal(typeBalanceEnabled({ identity: { name: "Pingel House", handle: "" }, type: {} }), false);
  assert.equal(typeBalanceEnabled(client), true);
  assert.equal(typeBalanceEnabled({ ...client, type: { ...client.type, balance: false } }), false);
  assert.equal(typeBalanceEnabled({ ...pingel, type: { ...pingel.type, balance: true } }), true);

  assert.doesNotMatch(slideHTML({ kind: "body", headline: "Same Pingel wrap" }, pingel), /class="slide body type-balance"/);
  const clientHTML = slideHTML({ kind: "body", headline: "Balanced client headline", sub: "Pretty body copy" }, client);
  assert.match(clientHTML, /class="slide body type-balance"/);
  assert.match(clientHTML, /data-fit-role="headline"/);
  assert.match(clientHTML, /data-fit-role="sub"/);
  assert.match(slideHTML({ kind: "body", headline: "Authored\nbreak" }, client), /data-explicit-break="1"/);
});

test("face crop: no face keeps the legacy fallback and one portrait face is moved toward the clear upper band", () => {
  const visible = { x: 0, y: 0, w: 1080, h: 1350 };
  const lowerText = { x: 0, y: 607.5, w: 1080, h: 742.5 };
  assert.equal(faceAwareObjectPosition({ width: 1200, height: 2000 }, [], visible, lowerText), null);
  assert.equal(faceAwareObjectPosition({ width: 1200, height: 2000 }, [{ x: 0.42, y: 0.45, w: 0.16, h: 0.15 }], visible, lowerText), "50% 100%");
});

test("face crop: a pair stays grouped and edge faces pull the crop to the matching edge", () => {
  const visible = { x: 0, y: 0, w: 1080, h: 1350 };
  const size = { width: 2000, height: 1200 };
  const two = faceAwareObjectPosition(size, [
    { x: 0.12, y: 0.2, w: 0.12, h: 0.18 },
    { x: 0.74, y: 0.22, w: 0.12, h: 0.18 },
  ], visible);
  assert.equal(two, "48.1% 50%");
  assert.equal(faceAwareObjectPosition(size, [{ x: 0.02, y: 0.2, w: 0.12, h: 0.18 }], visible), "0% 50%");
  assert.equal(faceAwareObjectPosition(size, [{ x: 0.86, y: 0.2, w: 0.12, h: 0.18 }], visible), "100% 50%");
});

test("face crop integration: explicit positions stay exact and only auto positions use the solver result", () => {
  const brand = loadPreset("pingel-brand").brand;
  const explicit = slideHTML({ kind: "photo", headline: "Supplied", photo: "photo.png", pos: "left 17%", __autoPosition: "90% 20%" }, brand);
  assert.match(explicit, /--slide-position:left 17%;/);
  const automatic = slideHTML({ kind: "photo", headline: "Supplied", photo: "photo.png", pos: "auto", __autoPosition: "90% 20%" }, brand);
  assert.match(automatic, /--slide-position:90% 20%;/);
});

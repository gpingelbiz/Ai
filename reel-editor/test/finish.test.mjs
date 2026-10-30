import { test } from "node:test";
import assert from "node:assert/strict";
import { finishFilter } from "../src/cuts.mjs";
import { loadPreset } from "../src/presets.mjs";

const options = {
  enabled: true,
  exposure: "auto",
  maxEv: 0.2,
  wb: "auto",
  maxKelvin: 300,
  contrast: 0.06,
  saturation: 0.94,
  denoise: "light",
  sharpen: "auto",
  grain: 0,
};

test("finish defaults are present and disabled", () => {
  assert.deepEqual(loadPreset("clean").finish, { ...options, enabled: false });
  assert.equal(finishFilter({ luma: 0.2, contrast: 0.1, saturation: 0.5, warmth: 0.2 }, { ...options, enabled: false }), "");
});

test("finishFilter lifts a dark, flat clip and sharpens only a soft sample", () => {
  const chain = finishFilter({ luma: 0.22, contrast: 0.14, saturation: 0.34, warmth: 0.03, sharpness: 0.02 }, options);
  assert.match(chain, /curves=/);
  assert.match(chain, /hqdn3d=/);
  assert.match(chain, /unsharp=/);
  assert.doesNotMatch(chain, /colorbalance=|hue=s=/);
});

test("finishFilter does not darken bright footage", () => {
  const chain = finishFilter({ luma: 0.52, contrast: 0.238, saturation: 0.339, warmth: 0.03, sharpness: 0.08 }, options);
  assert.equal(chain, "hqdn3d=0.8:0.6:3:2.5");
});

test("finishFilter cools warm footage and reduces excess saturation", () => {
  const chain = finishFilter({ luma: 0.388, contrast: 0.238, saturation: 0.48, warmth: 0.16, sharpness: 0.08 }, options);
  assert.match(chain, /colorbalance=rm=-0\.04:bm=0\.04:pl=1/);
  assert.match(chain, /hue=s=0\.94/);
});

test("finishFilter warms a cool clip without boosting low saturation", () => {
  const chain = finishFilter({ luma: 0.388, contrast: 0.238, saturation: 0.25, warmth: -0.07, sharpness: 0.08 }, options);
  assert.match(chain, /colorbalance=rm=0\.04:bm=-0\.04:pl=1/);
  assert.doesNotMatch(chain, /hue=s=/);
});

test("finishFilter leaves already-good tone and colour near identity", () => {
  const chain = finishFilter({ luma: 0.388, contrast: 0.238, saturation: 0.339, warmth: 0.03, sharpness: 0.08 }, options);
  assert.equal(chain, "hqdn3d=0.8:0.6:3:2.5");
});

test("lane 6 Greg medians produce the bounded corrective chain", () => {
  const chain = finishFilter({ luma: 0.307, contrast: 0.179, saturation: 0.455, warmth: 0.128 }, options);
  assert.equal(chain, "curves=all='0/0 0.18/0.1831 0.5/0.5372 0.82/0.8608 1/1',colorbalance=rm=-0.0392:bm=0.0392:pl=1,hue=s=0.94,hqdn3d=0.8:0.6:3:2.5");
});

test("finishFilter uses no GPL eq filter", () => {
  const chain = finishFilter({ luma: 0.2, contrast: 0.1, saturation: 0.6, warmth: 0.2, sharpness: 0.01 }, options);
  assert.doesNotMatch(chain, /(^|,)eq=/);
});

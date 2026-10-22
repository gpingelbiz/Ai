import { test } from "node:test";
import assert from "node:assert/strict";
import { peopleFrom, groupFraming, aimX, aimZooms, matchTracks } from "../src/group.mjs";
import { baseFraming, faceBox } from "../src/placement.mjs";

// Two people on a wide shot: A at 22%, B at 75%, faces about 6% x 10% of the frame.
const frames = Array.from({ length: 12 }, (_, i) => ({ t: i, faces: [{ x: 0.19, y: 0.58, w: 0.06, h: 0.1 }, { x: 0.72, y: 0.56, w: 0.06, h: 0.1 }] }));

test("group framing: both people stay in the frame where one-face framing would crop the second", () => {
  const people = peopleFrom({ frames });
  assert.equal(people.length, 2);
  assert.ok(people[0].cx < 0.3 && people[1].cx > 0.7, "left to right");
  const single = baseFraming(faceBox({ frames }), { target: 0.3, max: 1.3 });
  assert.equal(single.scale, 1.3);
  const g = groupFraming(people, { max: 1.3 });
  assert.ok(g.scale >= 1 && g.scale < single.scale, `group scale ${g.scale} is wider than the single-face scale`);
  const ox = parseFloat(g.origin) / 100;
  for (const p of people) {
    const x = ox + (p.cx - ox) * g.scale;
    assert.ok(x - (p.w / 2) * g.scale >= 0 && x + (p.w / 2) * g.scale <= 1, `person at ${p.cx} stays in the frame (${x})`);
  }
  // A face seen in only one frame is not a person.
  assert.equal(peopleFrom({ frames: [...frames, { t: 20, faces: [{ x: 0.45, y: 0.8, w: 0.04, h: 0.06 }] }] }).length, 2);
});

test("aim: punch-ins and jump cuts centre whoever is talking, never past the edge; base keys reset", () => {
  const people = peopleFrom({ frames });
  const ox = 0.48;
  const left = aimX(people[0], 1.5, ox), right = aimX(people[1], 1.5, ox);
  assert.ok(left > 0 && right < 0, `pans toward each person: ${left} / ${right}`);
  const lim = ox * 1.5 - ox; // the footage's left edge reaches the frame edge
  assert.ok(left <= lim * 100 + 1e-6, "no edge shows");
  assert.equal(aimX(people[0], 1, ox), 0);
  const out = aimZooms([{ t: 5, scale: 1.25 }, { t: 9, scale: 1 }, { t: 12, scale: 1.1, cut: true }], { people, base: 1.2, originX: ox, at: (t) => (t < 10 ? 1 : 0) });
  assert.ok(out[0].xPercent < 0 && out[0].who === 1, "talking right: pan right");
  assert.equal(out[1].xPercent, 0);
  assert.ok(out[2].xPercent > 0 && out[2].who === 0, "talking left: pan left");
  const unknown = aimZooms([{ t: 5, scale: 1.25 }], { people, base: 1.2, originX: ox, at: null });
  assert.equal(unknown[0].who, null);
});

test("tracks match people by position", () => {
  const people = peopleFrom({ frames });
  const tr = [{ samples: [{ cx: 0.74 }, { cx: 0.76 }] }, { samples: [{ cx: 0.21 }] }];
  assert.deepEqual(matchTracks(tr, people), [1, 0]);
});

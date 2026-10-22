import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSlides, markGold, titleSize, carouselHTML, carouselText, slidesPrompt } from "../src/carousel.mjs";

const stills = [{ scene: "a laptop with a falling chart" }, { scene: "a fist on a desk" }];

test("slides: stills used once, close has no image, missing scenes filled", () => {
  const s = normalizeSlides(
    [
      { title: "The *10 minutes* after a bad number", body: "", reuse: 1, scene: "" },
      { title: "Own it *first*", body: "Say it was on you.", reuse: 1, scene: "" },
      { title: "Ask *what happened*", body: "Then listen.", reuse: 0, scene: "" },
      { title: "Give the *next step*", body: "One clear move.", reuse: 2, scene: "" },
      { title: "They remember *this*", body: "", reuse: 2, scene: "a door" },
    ],
    { count: 6, stills },
  );
  assert.equal(s.length, 5);
  assert.equal(s[0].reuse, 1);
  assert.equal(s[1].reuse, 0);
  assert.match(s[1].scene, /Own it first/);
  assert.match(s[2].scene, /Ask what happened/);
  assert.equal(s[3].reuse, 2);
  assert.deepEqual([s[4].reuse, s[4].scene], [0, ""]);
});

test("slides: too few is an error, extra are cut", () => {
  assert.throws(() => normalizeSlides([{ title: "a" }, { title: "" }], { count: 6 }));
  const many = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, body: "", reuse: 0, scene: "x" }));
  assert.equal(normalizeSlides(many, { count: 6 }).length, 6);
});

test("gold marking and escaping", () => {
  assert.equal(markGold("Own the *bad number* <first>"), 'Own the <span class="k">bad number</span> &lt;first&gt;');
  assert.equal(markGold("stray * star"), "stray  star");
  assert.ok(titleSize("Short", "cover") > titleSize("A much longer cover title that keeps going", "cover"));
});

test("html: one 1-second scene per slide, counters, handle, no image on the close", () => {
  const html = carouselHTML(
    [{ title: "Cover *hook*", body: "", img: "assets/img/slide-1.png" }, { title: "Point", body: "Body", img: "assets/img/slide-2.png" }, { title: "Close", body: "", img: null }],
    { colors: { accent: "#C8A24B" }, handle: "@me" },
  );
  assert.match(html, /id="s0" class="slide clip cover has-img" data-start="0" data-duration="1"/);
  assert.match(html, /id="s2" class="slide clip close" data-start="2"/);
  assert.match(html, /<div class="count">2\/3<\/div>/);
  assert.match(html, /<div class="num">01<\/div>/);
  assert.equal((html.match(/class="handle"/g) || []).length, 3);
  assert.match(html, /data-duration="3"/);
});

test("prompt: no CTA unless given; text file lists every slide", () => {
  const p = slidesPrompt({ transcript: "t", hook: "h", voice: "v", count: 6, cta: "", stills });
  assert.match(p, /No call to action anywhere/);
  assert.match(p, /^1: a laptop with a falling chart$/m);
  assert.match(slidesPrompt({ transcript: "t", hook: "h", voice: "v", count: 6, cta: "Comment GHOST", stills: [] }), /word for word: Comment GHOST/);
  const txt = carouselText([{ title: "A *b*", body: "c" }, { title: "D", body: "" }], { hook: "" });
  assert.match(txt, /SLIDE 1\nA b\nc\n/);
  assert.match(txt, /SLIDE 2\nD\n/);
});

test("slides: at most maxNew fresh images, cover first; the rest become text cards", () => {
  const raw = Array.from({ length: 6 }, (_, i) => ({ title: `t${i}`, body: "", reuse: 0, scene: `scene ${i}` }));
  const s = normalizeSlides(raw, { count: 6, stills: [], maxNew: 2 });
  assert.deepEqual(s.map((x) => !!x.scene), [true, true, false, false, false, false]);
});

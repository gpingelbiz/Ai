import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RECEIPTS, alignTokens, cover, lineTimings, receiptsHTML, receiptsTimeline, splitSentences, statSlam, threadMarkup, tokenSpans } from "../src/receipts.mjs";
import { DEFAULT_CLOSE, loadSpecs, pickCards, proofData, runProof, specText, specsFile, validateScript, wallSpecs } from "../src/proof.mjs";
import { GATE_SAFE, rootLayers } from "../src/gate.mjs";
import { projectHTML } from "../src/compose.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "receipts-test-"));
const touch = (file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "x"); return file; };

// Reel 1 (2026-11-25): the script and the voice as the editor heard it (reel time, after the pause cuts).
const DATA = {
  version: 1, name: "proof-test", label: "Real text",
  hook: "Salespeople send me messages like this every week.",
  close: DEFAULT_CLOSE,
  items: [
    { setup: "A client sent me this months after we first talked.", quote: "my sales percentage went from 8% to a little over 35%",
      messages: [{ who: "them", text: "Just thank you a thousand times. In the time since I bought this, my sales percentage went from 8% to a little over 35% I just found out." }], redact: [] },
    { setup: "Another client sent me this one.", quote: "I just led the company in gross for the first time",
      messages: [{ who: "them", text: "I just led the company in gross for the first time! That's because of you and Andy!" }, { who: "them", text: "But my gratitude is to you and Andy. I deeply appreciate both of you and I mean that!" }], redact: ["Andy"] },
    { setup: "Someone I coach sent this out of nowhere one day.", quote: "I really want to come out and meet you guys and maybe tell an audience how much you changed my life",
      messages: [{ who: "them", text: "Man, I really want to come out and meet you guys and maybe tell an audience how much you changed my life Greg." }], redact: [] },
  ],
  wall: [{ label: "Sales coaching", messages: [{ who: "them", text: "Thanks Andy, best week yet" }, { who: "greg", text: "Proud of you" }], redact: ["Andy"] }],
};
const HEARD_TEXT = "Salespeople@0.127 send@0.667 me@0.827 messages@0.947 like@1.387 this@1.567 every@1.807 week.@2.067 A@2.833 client@2.953 sent@3.353 me@3.553 this@3.713 months@4.253 after@4.593 we@4.813 first@4.973 talked.@5.233 My@5.553 sales@6.553 percentage@6.853 went@7.413 from@7.593 8%@7.933 to@8.593 a@8.733 little@8.853 over@9.173 35%.@9.873 Another@11.519 client@11.879 sent@12.179 me@12.339 this@12.479 one.@12.719 I@12.879 just@13.959 led@14.219 the@14.379 company@14.539 in@14.899 gross@15.058 for@15.419 the@15.539 first@15.679 time.@15.939 Someone@16.373 I@16.653 coached@16.773 sent@17.113 this@17.333 out@17.513 of@17.633 nowhere@17.753 one@18.353 day.@18.533 I@19.133 really@19.373 want@19.653 to@19.753 come@19.893 out@20.073 and@20.213 meet@20.393 you@20.593 guys@20.733 and@21.133 maybe@21.313 tell@21.613 an@21.773 audience@21.993 how@22.773 much@22.933 you@23.113 changed@23.253 my@23.553 life.@23.713 These@24.253 aren't@24.573 my@24.813 wins.@25.033 They're@25.893 theirs.@26.113 I@27.253 gave@27.373 them@27.553 the@27.693 plays.@27.813 They@28.273 put@28.493 in@28.673 the@28.773 reps.@28.913";
const HEARD = HEARD_TEXT.split(" ").map((x) => { const [text, t] = x.split("@"); return { text, start: Number(t), end: Number(t) + 0.2 }; });

test("script words take the times the voice said them, through a misheard word and a dropped one", () => {
  const at = alignTokens(["a", "rep", "i", "coach", "sent", "this"], [
    { text: "A", start: 1, end: 1.1 }, { text: "rep", start: 1.2, end: 1.4 }, { text: "I", start: 1.5, end: 1.6 },
    { text: "coached", start: 1.7, end: 2 }, { text: "this", start: 2.4, end: 2.6 },
  ]);
  assert.deepEqual(at.map((x) => x.start), [1, 1.2, 1.5, 1.7, at[4].start, 2.4]);
  assert.ok(at[4].start > 2 && at[4].start < 2.4, "the word the transcript dropped sits between its neighbours");
  const lines = lineTimings([{ kind: "hook", text: DATA.hook }, { kind: "setup", text: DATA.items[0].setup }], HEARD);
  assert.equal(lines[0].start, 0.127);
  assert.equal(lines[1].start, 2.833);
  assert.equal(lines[1].words.at(-1).text, "talked.");
  assert.deepEqual(tokenSpans("Don't, 35%!").map((t) => t.text), ["don't", "35"]);
});

test("the number slam uses only the two numbers the quote says, never money and never a drop", () => {
  assert.deepEqual(statSlam("my sales percentage went from 8% to a little over 35%"), { label: "SALES PERCENTAGE", from: "8%", to: "35%", toIndex: 10 });
  assert.equal(statSlam("my close rate went from 20% to 40% in a month").label, "CLOSE RATE");
  assert.equal(statSlam("went from $5,000 to $10,000 a month"), null);
  assert.equal(statSlam("from 30% to 20%"), null);
  assert.equal(statSlam("from 8% to 35"), null, "a percent never slams against a plain number");
  assert.equal(statSlam("I just led the company in gross"), null);
  assert.deepEqual(statSlam("from 3 to 12 deals a week"), { label: "", from: "3", to: "12", toIndex: 3 });
});

test("a thread marks each quoted word for the marker and covers names with pills", () => {
  const { bubbles, marked } = threadMarkup(DATA.items[1].messages, DATA.items[1].quote, ["Andy"], "t1");
  assert.equal(marked, 11);
  assert.match(bubbles[0].html, /^<span class="qw" id="t1-q0"><i class="hl"><\/i>I<\/span> <span class="qw" id="t1-q1">/);
  assert.match(bubbles[0].html, /id="t1-q10"><i class="hl"><\/i>time<\/span>! That&#39;s|id="t1-q10"><i class="hl"><\/i>time<\/span>! That's/);
  assert.doesNotMatch(bubbles.map((b) => b.html).join(""), /Andy/);
  assert.equal((bubbles[1].html.match(/class="red"/g) || []).length, 1);
  // A quote that runs from one bubble into the next is marked in both.
  const two = threadMarkup([{ who: "them", text: "Best week ever." }, { who: "them", text: "Closed three deals today." }], "best week ever closed three deals", [], "x");
  assert.equal(two.marked, 6);
  assert.match(two.bubbles[1].html, /id="x-q3"><i class="hl"><\/i>Closed/);
  assert.equal(cover("ANDY and andyman", ["Andy"]), '<span class="red"></span> and andyman');
  assert.deepEqual(splitSentences("These aren't my wins. They're theirs.").map((s) => s.first), [0, 4]);
});

test("receipts timing: one thing on screen at a time, hook gone before the first text, text gone under the number card", () => {
  const T = receiptsTimeline(DATA, HEARD, 29.4);
  const [a, b, c] = T.threads;
  assert.ok(T.hook.end <= a.into + 0.01, "the hook is gone before the first text arrives");
  assert.ok(a.slam && a.slam.at >= 9.873 && a.slam.at < 10.1, "the slam lands as 35% is said");
  assert.equal(a.gone, Math.round((a.slam.at + 0.2) * 1000) / 1000, "the text is put away under the number card");
  assert.ok(b.into >= a.out + 0.2 && c.into >= b.out + 0.2, "a text leaves before the next one rises");
  assert.ok(b.gone <= c.into + 0.001);
  assert.ok(c.gone < T.close.start - 0.1, "the last text is gone before the closer");
  assert.ok(b.pops.at(-1) <= b.qa - 0.2, "every bubble is up before its quote is read");
  assert.equal(b.typing, null, "a short setup gets the text straight away");
  assert.ok(a.typing != null && c.typing != null);
  assert.deepEqual(T.close.sentences.map((s) => s.at), [24.253, 25.893, 27.253, 28.273]);
  T.setups.forEach((s, i) => assert.ok(s.show >= T.threads[i].into, `setup ${i + 1} shows once its text is in`));
  assert.equal(T.threads[1].quote.length, 11);
});

test("receipts page: no dates, wall marked as a backdrop, layers inside the Instagram safe zone", () => {
  const html = receiptsHTML({ data: DATA, heard: HEARD, duration: 29.4, footageMarkup: '<video id="footage" src="assets/footage.mp4" data-start="0" data-duration="29.4" data-track-index="0" data-has-audio="true"></video>' });
  const shown = html.slice(0, html.indexOf("<script>", html.indexOf("<body>")));
  const date = shown.match(/\b20\d\d\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/);
  assert.equal(date, null, `no dates on screen (found ${date?.[0]})`);
  assert.ok(!/Andy/.test(html), "covered names never reach the page");
  assert.ok(html.includes('Salespeople send me messages like this <span class="g">every week</span>'), "the last two hook words go gold, no sentence period");
  const layers = rootLayers(html);
  assert.equal(layers.find((l) => l.id === "wall").backdrop, true);
  assert.ok(layers.filter((l) => l.text && !l.backdrop).every((l) => l.duration > 0), "every text layer is timed for the gate");
  const R = RECEIPTS, W = 1080, H = 1920;
  const grow = (R.threadWidth * (R.push - 1)) / 2;
  assert.ok(R.threadLeft - grow >= GATE_SAFE.left && R.threadLeft + R.threadWidth + grow <= GATE_SAFE.iconRight, "a pushed-in text stays clear of the buttons");
  assert.ok(R.capLeft >= GATE_SAFE.left && R.capLeft + R.capWidth <= GATE_SAFE.iconRight);
  assert.ok(R.textLeft >= GATE_SAFE.left && R.textLeft + R.textWidth <= GATE_SAFE.iconRight);
  assert.ok(R.capTop + 2 * 60 * 1.18 <= GATE_SAFE.bottom * H && R.threadTop >= GATE_SAFE.top * H && W === 1080);
  // The photo footage only carries the voice.
  assert.ok(html.includes("#video-wrap{position:absolute;inset:0;opacity:0}") && html.includes('data-has-audio="true"'), "the footage is hidden and carries the voice");
});

test("compose draws the receipts look only for a proof plan that carries proof data", () => {
  const plan = { proofReel: true, proofData: DATA, words: HEARD, video: { duration: 29.4, hasAudio: true }, audio: { tracks: [{ id: "music", src: "assets/music.m4a", start: 0, duration: 29.4, volume: 0.1 }] }, style: { render: { fps: 30 } } };
  const html = projectHTML(plan, "assets/footage.mp4");
  assert.match(html, /id="wall"/);
  assert.match(html, /<audio id="music" src="assets\/music\.m4a"/);
  assert.match(html, /data-fx-chain=/);
  assert.match(html, /<video id="footage" src="assets\/footage\.mp4"/);
});

test("card specs: names become [name], quotes never run over one, the wall skips held and split cards", () => {
  const dir = tmp();
  const specsPath = path.join(dir, "Social", "lib-specs.json");
  touch(specsPath);
  const spec = (rel, text, redact = []) => ({ out: `/x/Testimonials/Cards.new/${rel}`, label: "Sales coaching", date: "2025-10-01", redact, messages: [{ who: "them", text }] });
  fs.writeFileSync(specsPath, JSON.stringify([
    spec("1-strongest/005-sam-s5.png", "I just led the company in gross for the first time! That's because of you and Andy!", ["Andy"]),
    spec("1-strongest/007-x-p1.png", "split card"),
    spec("1-strongest/not-using/008-y.png", "held"),
    spec("2-strong/with-dollar-amounts/009-z.png", "$4k commission"),
    spec("2-strong/010-w.png", "Best month yet"),
  ]));
  assert.equal(specsFile({ from: path.join(dir, "Cards"), env: {} }), specsPath);
  assert.equal(specsFile({ from: "/a/Cards", env: { REEL_PROOF_SPECS: specsPath } }), specsPath);
  const specs = loadSpecs(specsPath);
  assert.equal(specs.size, 5);
  assert.equal(specText(specs.get("1-strongest/005-sam-s5.png")), "I just led the company in gross for the first time! That's because of you and [name]!");
  assert.deepEqual(wallSpecs(specs).map((w) => w.messages[0].text), ["I just led the company in gross for the first time! That's because of you and Andy!", "Best month yet"]);
  const card = { file: "/c/5.png", text: specText(specs.get("1-strongest/005-sam-s5.png")) };
  const script = (quote) => ({ hook: "Salespeople send me texts like this.", items: [{ card: 1, setup: "A rep sent me this one.", quote }], close: DEFAULT_CLOSE });
  assert.deepEqual(validateScript(script("I just led the company in gross for the first time"), [card]), []);
  assert.match(validateScript(script("That's because of you and name"), [card]).join(" "), /runs over a covered name/);
  assert.match(validateScript(script("because of you and [name]"), [card]).join(" "), /covered name/);
  // Picking: only cards the library knows when specs are loaded.
  const from = path.join(dir, "Cards");
  touch(path.join(from, "1-strongest", "005-sam-s5.png"));
  touch(path.join(from, "1-strongest", "006-unknown.png"));
  assert.deepEqual(pickCards({ from, count: 3, specs }).map((f) => path.basename(f)), ["005-sam-s5.png"]);
});

test("runProof with the card library: proof.json for the receipts look, no card images dropped", async () => {
  const home = tmp();
  const from = path.join(home, "Testimonials", "Cards");
  const c1 = touch(path.join(from, "1-strongest", "005-sam-s5.png"));
  const photo = touch(path.join(home, "photos", "p.jpg"));
  fs.mkdirSync(path.join(home, "Testimonials", "Social"), { recursive: true });
  fs.writeFileSync(path.join(home, "Testimonials", "Social", "lib-specs.json"), JSON.stringify([
    { out: "/old/Testimonials/Cards.new/1-strongest/005-sam-s5.png", label: "Sales coaching", date: "2025-10-01", redact: ["Andy"], messages: [{ who: "them", text: "I just led the company in gross for the first time! That's because of you and Andy!" }] },
  ]));
  const ocrCalls = [];
  const deps = {
    env: { HOME: home, REEL_PROOF_CARDS: from, REEL_PROOF_PHOTOS: path.join(home, "photos") },
    now: () => new Date("2026-11-25T17:00:00Z"),
    ocrBinary: async () => "ocr",
    run: async (cmd, args) => {
      if (cmd === "ocr") { ocrCalls.push(args[0]); return { out: JSON.stringify({ width: 2362, height: 1329, lines: [], faces: [] }) }; }
      if (cmd === "ffmpeg") touch(args.at(-1));
      return { out: "" };
    },
    probe: async () => ({ duration: 2 }),
    speak: async ({ out }) => { touch(out); return out; },
    claudeText: async (prompt) => {
      assert.match(prompt, /\[name\] in a card marks a name that is covered/);
      assert.match(prompt, /because of you and \[name\]!/);
      return JSON.stringify({ hook: "Salespeople send me texts like this.", items: [{ card: 1, setup: "A rep sent me this one.", quote: "I just led the company in gross for the first time" }] });
    },
  };
  const dropDir = path.join(home, "drop");
  const r = await runProof({ drop: dropDir }, deps);
  assert.equal(r.receipts, true);
  assert.deepEqual(ocrCalls, [photo], "the card is read from the library, only the photo goes through OCR (for the face)");
  assert.deepEqual(fs.readdirSync(dropDir).filter((f) => !f.startsWith(".")), [path.basename(r.dropped)], "only the clip is dropped");
  const data = JSON.parse(fs.readFileSync(path.join(home, "Reels", "proof", r.stem, "proof.json"), "utf8"));
  assert.equal(data.items[0].messages[0].text, "I just led the company in gross for the first time! That's because of you and Andy!");
  assert.deepEqual(data.items[0].redact, ["Andy"]);
  assert.equal(data.close, DEFAULT_CLOSE);
  assert.equal(data.wall.length, 1);
  assert.doesNotMatch(JSON.stringify(data), /2025-10-01|"date"/, "no dates travel to the reel");
  assert.equal(c1, r.script.cards[0]);
  assert.deepEqual(proofData({ stem: "s", script: { hook: "h", close: "c", items: [{ setup: "s", quote: "q" }] }, cards: [{ spec: { messages: [], redact: [] } }], specs: null }).wall, []);
});

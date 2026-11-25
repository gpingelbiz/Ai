import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CARD_LABEL, DEFAULT_CLOSE, dropNames, lineTimes, narrationLines, photoCrop, pickCards, pickPhoto, runProof, scriptPrompt, validateScript, writeScript } from "../src/proof.mjs";
import { pairEvidenceFiles, parseEvidenceSpec } from "../src/evidence.mjs";
import { isVoiceStudioVoice, parseVoice, speak } from "../src/voicestudio.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "proof-test-"));
const touch = (file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "x"); return file; };

const cards = [
  { file: "/c/1.png", text: "Build feedback\nThe confirmation emails ended up in my main\ninbox and not in the promo folder or spam" },
  { file: "/c/2.png", text: "Phase 4 now. This whole thing is a little crazy..\nI don't know how you learned all this so fast!!" },
];
const good = {
  hook: "Your coaching offer sells. Here's what the fixes look like.",
  items: [
    { card: 1, setup: "A coaching client's launch emails were landing in spam. We fixed that.", quote: "The confirmation emails ended up in my main inbox" },
    { card: 2, setup: "Another coaching client, four phases into the fixes.", quote: "This whole thing is a little crazy" },
  ],
  close: DEFAULT_CLOSE,
};

test("a script passes only when every quote is copied word for word from its own card", () => {
  assert.deepEqual(validateScript(good, cards), []);
  const changed = structuredClone(good); changed.items[0].quote = "The confirmation emails went to my main inbox";
  assert.match(validateScript(changed, cards).join("|"), /item 1: quote is not copied word for word/);
  const swapped = structuredClone(good); swapped.items.reverse(); swapped.items.forEach((item, i) => { item.card = i + 1; });
  assert.match(validateScript(swapped, cards).join("|"), /quote is not copied word for word from card 1/);
  const curly = structuredClone(good); curly.items[1].quote = "I don’t know how you learned all this so fast";
  assert.deepEqual(validateScript(curly, cards), []);
});

test("scripts stay anonymous, in Greg's voice and short", () => {
  const named = structuredClone(good); named.items[0].setup = "Jason from Phoenix Motors sent me this.";
  assert.match(validateScript(named, cards).join("|"), /may name someone or something \("Phoenix"\)/);
  const dashed = structuredClone(good); dashed.hook = "Real texts — from real coaches.";
  assert.match(validateScript(dashed, cards).join("|"), /hook uses a dash/);
  const yo = structuredClone(good); yo.items[1].setup = "Yo, look at this one.";
  assert.match(validateScript(yo, cards).join("|"), /says "Yo"/);
  const long = structuredClone(good); long.hook = "one two three four five six seven eight nine ten eleven twelve thirteen";
  assert.match(validateScript(long, cards).join("|"), /hook has 13 words/);
  const missing = structuredClone(good); missing.items.pop();
  assert.match(validateScript(missing, cards).join("|"), /2 items? for 2 cards|1 items for 2 cards/);
  const greg = structuredClone(good); greg.items[0].setup = "A coach told me we fixed how her launch sells.";
  assert.deepEqual(validateScript(greg, cards), []);
});

test("proof reels are for coaches and follow Brand Guide v11: no reps, no AI, no kill-list words, the v11 closer", () => {
  assert.equal(DEFAULT_CLOSE, "I build the sales system under the offer you already have.");
  const rep = structuredClone(good); rep.items[0].setup = "A rep I coach sent me this after week one.";
  assert.match(validateScript(rep, cards).join("|"), /says "rep"; this reel is for coaches/);
  const sales = structuredClone(good); sales.hook = "Salespeople send me texts like this.";
  assert.match(validateScript(sales, cards).join("|"), /hook says "Salespeople"/);
  const ai = structuredClone(good); ai.items[1].setup = "Our AI fixed her whole funnel.";
  assert.match(validateScript(ai, cards).join("|"), /says "AI"/);
  const hype = structuredClone(good); hype.items[1].setup = "This fix was a game changer for her.";
  assert.match(validateScript(hype, cards).join("|"), /"game changer" \(Brand Guide v11 kill list\)/);
  const short = [{ file: "/c/9.png", text: "First purchase!!" }];
  assert.deepEqual(validateScript({ hook: good.hook, items: [{ card: 1, setup: "I built a coach's launch and run her reels.", quote: "First purchase" }], close: DEFAULT_CLOSE }, short), [], "a two-word text is a whole quote");
  assert.match(validateScript({ hook: good.hook, items: [{ card: 1, setup: "I built a coach's launch.", quote: "Purchase" }], close: DEFAULT_CLOSE }, short).join("|"), /quote has 1 words \(2 to 24\)/);
  const clumsy = structuredClone(good); clumsy.items[0].setup = "I coached a coach on how to close and engage on her own launch.";
  assert.match(validateScript(clumsy, cards).join("|"), /"coached a coach"; that sounds clumsy/);
  const twice = structuredClone(good); twice.items[0].setup = "Another coach told me his coach never followed up.";
  assert.match(validateScript(twice, cards).join("|"), /sounds clumsy/);
  const greg = structuredClone(good); greg.items[0].setup = "She'd done hundreds of webinars and never pitched on one. We worked on her close.";
  assert.deepEqual(validateScript(greg, cards).filter((e) => /clumsy/.test(e)), []);
  assert.match(scriptPrompt(cards), /never \\"I coached a coach\\"|never "I coached a coach"/);
  const withPronoun = scriptPrompt([{ ...cards[0], context: "Greg built a content system.", pronoun: "he" }, cards[1]]);
  assert.match(withPronoun, /Card 1 sender: he\n/);
  assert.match(withPronoun, /Card 2 sender: they\n/);
  assert.match(withPronoun, /no needs, motives, steps or timing the note does not say/);
  const crm = structuredClone(good); crm.items[1].setup = "I built a DM flow that puts every reply in her CRM.";
  assert.deepEqual(validateScript(crm, cards), [], "DM and CRM are plain words, not names");
  const az = structuredClone(good); az.close = "I build it A to Z so it runs without you.";
  assert.match(validateScript(az, cards).join("|"), /"A to Z"/);
  // A client's own words stay word for word, even a word Greg would never write.
  const theirWords = [{ file: "/c/3.png", text: "This is a game changer for my coaching business" }];
  assert.deepEqual(validateScript({ hook: good.hook, items: [{ card: 1, setup: "A coach ran the scorecard we built.", quote: "This is a game changer" }], close: DEFAULT_CLOSE }, theirWords), []);
  const prompt = scriptPrompt([{ ...cards[0], context: "Greg set up a coaching client's launch emails." }, cards[1]]);
  assert.match(prompt, /for coaches/);
  assert.match(prompt, /Card 1 note \(what was built or fixed\): Greg set up a coaching client's launch emails\./);
  assert.match(prompt, /Card 2 note \(what was built or fixed\): none on file/);
  assert.match(prompt, /never the words salespeople, salesperson, sales reps or reps, and never AI/);
  assert.doesNotMatch(prompt, /salesperson stop scrolling/);
});

test("the writer retries with the broken rules and always keeps Greg's closer", async () => {
  const prompts = [];
  const replies = [
    JSON.stringify({ ...good, items: [{ ...good.items[0], quote: "made up words here now" }, good.items[1]], close: "Book a call — today" }),
    `Here you go:\n${JSON.stringify({ ...good, close: "anything" })}`,
  ];
  const script = await writeScript(cards, { deps: { claudeText: async (p) => { prompts.push(p); return replies.shift(); } } });
  assert.equal(script.close, DEFAULT_CLOSE);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /item 1: quote is not copied word for word/);
  assert.match(scriptPrompt(cards), /Card 2 text:\nPhase 4 now/);
  await assert.rejects(writeScript(cards, { attempts: 1, deps: { claudeText: async () => "no json" } }), /no script passed/);
});

test("narration lines, pauses and start times", () => {
  const lines = narrationLines(good);
  assert.deepEqual(lines.map((l) => l.kind), ["hook", "setup", "quote", "setup", "quote", "close"]);
  const timed = lineTimes(lines, [2, 2.5, 4, 1.5, 3.5, 5]);
  assert.equal(timed[0].start, 0.15);
  assert.equal(timed[1].start, 2.6);
  assert.equal(timed[2].start, 5.4);
  assert.equal(timed.at(-1).duration, 5);
});

test("cards: strongest folders first, never set-aside, money or split cards, never reused", () => {
  const root = tmp();
  touch(path.join(root, "2-strong", "010-a.png"));
  touch(path.join(root, "1-strongest", "002-tyler-p1.png"));
  touch(path.join(root, "1-strongest", "004-jason.png"));
  touch(path.join(root, "1-strongest", "with-dollar-amounts", "001-money.png"));
  touch(path.join(root, "not-using", "003-critic.png"));
  touch(path.join(root, "new-from-comb", "check-flags", "x.png"));
  touch(path.join(root, "new-from-comb", "n1.png"));
  assert.deepEqual(pickCards({ from: root, count: 5 }).map((f) => path.relative(root, f)), ["1-strongest/004-jason.png", "2-strong/010-a.png", "new-from-comb/n1.png"]);
  assert.deepEqual(pickCards({ from: root, count: 1, ledger: { cards: { "1-strongest/004-jason.png": { at: "x" } } } }).map((f) => path.relative(root, f)), ["2-strong/010-a.png"]);
});

test("photos rotate, least recently used first", () => {
  const dir = tmp();
  touch(path.join(dir, "a.jpg")); touch(path.join(dir, "b.jpg"));
  assert.equal(path.basename(pickPhoto({ dir })), "a.jpg");
  assert.equal(path.basename(pickPhoto({ dir, ledger: { photos: { "a.jpg": "2026-11-25" } } })), "b.jpg");
  assert.equal(pickPhoto({ dir: path.join(dir, "none") }), null);
});

test("photo crop keeps 9:16, puts the face a little above the middle and stays inside the photo", () => {
  const stage = photoCrop({ width: 2362, height: 1329, face: { x: 0.436, y: 0.143, w: 0.051, h: 0.091 } });
  assert.equal(stage.h, 1328);
  assert.ok(Math.abs(stage.w / stage.h - 9 / 16) < 0.01);
  assert.ok(stage.x >= 0 && stage.x + stage.w <= 2362);
  assert.ok(Math.abs(stage.fx - 0.5) < 0.05);
  const portrait = photoCrop({ width: 1448, height: 2172, face: { x: 0.35, y: 0.2, w: 0.3, h: 0.18 } });
  assert.ok(portrait.y >= 0 && portrait.y + portrait.h <= 2172);
  assert.equal(portrait.y, 0, "a head near the top of the photo stays as low as the photo allows");
  assert.ok(portrait.fy <= 0.42);
  const roomy = photoCrop({ width: 4000, height: 3000, face: { x: 0.48, y: 0.5, w: 0.04, h: 0.06 } });
  assert.ok(Math.abs(roomy.fy - 0.42) < 0.02);
  assert.ok(roomy.h < 3000, "zoomed in until the face is about 12% of the frame wide");
  const none = photoCrop({ width: 2000, height: 1000 });
  assert.equal(none.x, Math.round((2000 - none.w) / 2));
});

test("drop names pair with the watcher and carry the hook, the AI tag and the card label", () => {
  const names = dropNames({ stem: "proof-2026-11-25-1", hook: "Read the texts: my clients sent me!", count: 2 });
  assert.equal(names.clip, "proof-2026-11-25-1__Read the texts my clients sent me #aivoice #proof.mp4");
  assert.deepEqual(pairEvidenceFiles(names.clip, [...names.cards, "other proof 1.png"]), names.cards);
  assert.equal(names.cards[0], `proof-2026-11-25-1 proof 1 - ${CARD_LABEL}.png`);
  const stem = path.basename(names.cards[0], ".png");
  assert.deepEqual(parseEvidenceSpec(`/x/${names.cards[0]}|${stem.slice(stem.indexOf(" - ") + 3)}`).label, CARD_LABEL);
});

test("runProof writes the script, renders through the voice and drops cards before the clip", async () => {
  const home = tmp();
  const from = path.join(home, "Cards");
  const c1 = touch(path.join(from, "1-strongest", "004-jason.png"));
  const c2 = touch(path.join(from, "1-strongest", "005-sam.png"));
  const photo = touch(path.join(home, "photos", "p.jpg"));
  const texts = { [c1]: cards[0].text, [c2]: cards[1].text };
  const calls = [], order = [];
  const deps = {
    env: { HOME: home, REEL_PROOF_CARDS: from, REEL_PROOF_PHOTOS: path.join(home, "photos") },
    now: () => new Date("2026-11-25T17:00:00Z"),
    ocrBinary: async () => "ocr",
    run: async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === "ocr") {
        if (args[0] === photo) return { out: JSON.stringify({ width: 2362, height: 1329, lines: [], faces: [{ box: { x: 0.44, y: 0.14, w: 0.05, h: 0.09 } }] }) };
        return { out: JSON.stringify({ width: 1080, height: 1350, lines: texts[args[0]].split("\n").map((text) => ({ text, box: { x: 0, y: 0, w: 1, h: 0.05 } })) }) };
      }
      if (cmd === "ffmpeg" && args.includes("crop=iw:ih-110:0:0,cropdetect=limit=0.1:round=2:reset=0")) return { out: "", err: "[Parsed_cropdetect_0] x1:72 crop=936:1172:72:114\n" };
      if (cmd === "ffmpeg") touch(args.at(-1));
      return { out: "" };
    },
    probe: async () => ({ duration: 2 }),
    speak: async ({ voice, out }) => { assert.equal(voice, "vs:Greg"); touch(out); return out; },
    claudeText: async () => JSON.stringify(good),
  };
  const dropDir = path.join(home, "drop");
  const r = await runProof({ drop: dropDir, from }, { ...deps, run: async (...a) => { order.push(a[0]); return deps.run(...a); } });
  assert.equal(r.stem, "proof-2026-11-25-1");
  assert.equal(fs.readdirSync(dropDir).filter((f) => f.endsWith(".png")).length, 2);
  const trim = calls.find((c) => c[0] === "ffmpeg" && c.some((a) => String(a).startsWith("crop='")));
  assert.match(trim.join(" "), /crop='min\(968,iw\)':'min\(1204,ih\)':'max\(56,0\)':'max\(98,0\)'/, "cards lose their empty border, 16 px kept");
  assert.ok(fs.existsSync(r.dropped));
  assert.match(path.basename(r.dropped), /__Your coaching offer sells\. Here's what the fixes look like #aivoice #proof\.mp4$/);
  const ledger = JSON.parse(fs.readFileSync(path.join(home, "Reels", "proof", "used.json"), "utf8"));
  assert.deepEqual(Object.keys(ledger.cards).sort(), ["1-strongest/004-jason.png", "1-strongest/005-sam.png"]);
  assert.equal(ledger.photos["p.jpg"], "2026-11-25T17:00:00.000Z");
  const footage = calls.find((c) => c[0] === "ffmpeg" && c.includes("-loop"));
  assert.match(footage.join(" "), /zoompan=z='1\+0\.10\*\(1-exp\(-on\/36\)\)\+0\.04\*on\/\d+'/);
  const again = await runProof({ drop: dropDir, dryRun: true, from }, deps).catch((e) => e);
  assert.match(String(again.message || again), /no unused cards left/);
});

test("VoiceStudio voices: vs: names, commercial engines only, cached renders", async () => {
  assert.equal(isVoiceStudioVoice("vs:Greg"), true);
  assert.equal(isVoiceStudioVoice("iP95p4xoKVk53GoZ742B"), false);
  assert.deepEqual(parseVoice("vs:Greg"), { name: "Greg", engine: "cosyvoice" });
  assert.deepEqual(parseVoice("vs:Greg Pingel@VoxCPM2"), { name: "Greg Pingel", engine: "voxcpm2" });
  assert.throws(() => parseVoice("vs:Greg@omnivoice"), /not cleared for posts/);
  assert.throws(() => parseVoice("vs:"), /no VoiceStudio voice name/);
  const home = tmp();
  const env = { HOME: home, REEL_VOICE_CACHE: path.join(home, "cache") };
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const out = cmd === "ffmpeg" ? args.at(-1) : args[args.indexOf("-o") + 1];
    fs.writeFileSync(out, Buffer.alloc(2000));
    return { out: "" };
  };
  let ensured = 0;
  const deps = { run, ensure: async () => { ensured++; } };
  await speak({ text: "-dash first text", voice: "vs:Greg", out: path.join(home, "a.wav"), env, deps });
  await speak({ text: "-dash first text", voice: "vs:Greg", out: path.join(home, "b.mp3"), env, deps });
  const vs = calls.filter((c) => c.includes("speak"));
  assert.equal(vs.length, 1);
  assert.equal(ensured, 1);
  assert.ok(vs[0].includes("--text-file") && vs[0].includes("cosyvoice"));
  assert.ok(!vs[0].includes("-dash first text"));
  assert.equal(calls.at(-1)[0], "ffmpeg");
  await assert.rejects(speak({ text: " ", voice: "vs:Greg", out: path.join(home, "c.wav"), env, deps }), /nothing to say/);
});

test("proof-reel evidence: up only while its quote is read, five words to match, whole card above the captions", async () => {
  const { evidenceTiming, layoutGeometry } = await import("../src/evidence.mjs");
  const { loadPreset, mergeOverrides } = await import("../src/presets.mjs");
  const ocrLines = [{ text: "since we talked the first time" }, { text: "I just led the company in" }, { text: "gross for the first time!" }];
  const transcript = [
    { i: 0, text: "Another client sent me this one.", start: 10, end: 11.6 },
    { i: 1, text: "I just led the company", start: 12, end: 13.1 },
    { i: 2, text: "in gross for the first time", start: 13.1, end: 14.4 },
    { i: 3, text: "Someone I coach sent this", start: 15, end: 16.2 },
  ];
  const loose = evidenceTiming({ ocrLines, transcript });
  assert.equal(loose.quoted.length, 3, "the default three-word match also lights up 'the first time' on another line");
  const proof = evidenceTiming({ ocrLines, transcript, until: "quote", minQuoteWords: 5 });
  assert.deepEqual(proof.quoted.map((m) => m.ocr), [1, 2]);
  assert.equal(proof.start, 12);
  assert.equal(proof.start + proof.duration < 15, true, "gone before the next setup");
  assert.ok(Math.abs(proof.start + proof.duration - 14.733) < 0.04);
  const p = mergeOverrides(loadPreset("pingel-pro"), { proofReel: true });
  assert.equal(p.graphics.enabled, false);
  assert.equal(p.slams.enabled, false);
  assert.equal(p.broll.enabled, false);
  const { masterPlanningRules } = await import("../src/master-check.mjs");
  const proPlan = { preset: "pingel-pro", style: { ...p, broll: { enabled: true } }, video: { duration: 30 }, canvas: { width: 1080, height: 1920 }, proGraphics: [], broll: [] };
  const rules = (plan) => Object.fromEntries(masterPlanningRules(plan, 30).map((r) => [r.id, r.ok]));
  const normal = rules(proPlan), proofRules = rules({ ...proPlan, proofReel: true });
  assert.equal(proofRules["card-floor"], true, "the supplied texts are a proof reel's cards");
  assert.equal(proofRules["broll-present"], true);
  assert.equal(normal["card-floor"], false, "an ordinary pro reel still needs its teaching cards");
  assert.equal(normal["broll-present"], false);
  assert.equal(p.captions.position, 0.72);
  assert.equal(p.captions.proBase, 0.72);
  assert.equal(p.hook.proPosition, 0.5);
  assert.deepEqual([p.evidence.layout, p.evidence.zoom, p.evidence.until, p.evidence.minQuoteWords], ["focus", false, "quote", 5]);
  assert.equal(mergeOverrides(loadPreset("pingel-pro"), { proofReel: true, captionPosition: "0.7" }).captions.proBase, undefined);
  const { placeProCaptions } = await import("../src/pro-captions.mjs");
  const g = [{ thought: 1, start: 0, end: 1, lines: ["a"] }];
  assert.equal(placeProCaptions(g, [])[0].y, 1248);
  assert.ok(Math.abs(placeProCaptions(g, [], { base: 0.74 })[0].y - 0.74 * 1920) < 1);
  const item = { layout: "focus", ocr: { width: 1080, height: 1350, lines: [{ box: { x: 0.1, y: 0.4, w: 0.8, h: 0.05 } }] }, timing: { quoted: [{ ocr: 0 }] } };
  const tokens = p.brand;
  const zoomed = layoutGeometry(item, { W: 1080, H: 1920, captionTop: 1171, tokens });
  const whole = layoutGeometry(item, { W: 1080, H: 1920, captionTop: 1171, tokens, zoom: false });
  assert.ok(zoomed.imageBox.y + zoomed.y + zoomed.imageBox.h * zoomed.zoom > 1171, "the default full-width focus card runs into the caption band");
  assert.equal(whole.zoom, 1);
  assert.equal(whole.y, 0);
  assert.ok(whole.imageBox.y + whole.imageBox.h <= 1171, "the whole card ends above the caption band");
});

test("a proof card stays from the quote's first word to its last, across card line breaks and a heard-differently word", async () => {
  const { evidenceTiming, quoteSpan } = await import("../src/evidence.mjs");
  const ocrLines = [
    { text: "Just thank you a thousand" }, { text: "times. In the time since I" }, { text: "bought this, my sales" },
    { text: "percentage went from 8% to" }, { text: "a little over 35% I just found" }, { text: "out. How long has it been" },
  ];
  const transcript = [
    { i: 0, text: "A client sent me this", start: 3, end: 4.2 },
    { i: 1, text: "months after we first talked.", start: 4.2, end: 5.6 },
    { i: 2, text: "My sales percentage", start: 6.4, end: 7.3 },
    { i: 3, text: "went from eight percent", start: 7.3, end: 8.4 },
    { i: 4, text: "to a little over", start: 8.4, end: 9.3 },
    { i: 5, text: "35%.", start: 9.3, end: 10 },
    { i: 6, text: "Another client sent me this one.", start: 10.6, end: 12 },
  ];
  assert.deepEqual(quoteSpan(ocrLines, transcript, 5), { startLine: 2, endLine: 5, words: 10, ocr: [2, 3, 4] });
  const t = evidenceTiming({ ocrLines, transcript, until: "quote", minQuoteWords: 5 });
  assert.equal(t.start, 6.4);
  assert.deepEqual(t.quoted.map((m) => m.ocr), [2, 3, 4], "the highlight covers the read lines, 'my sales' through '35%'");
  assert.ok(Math.abs(t.start + t.duration - 10.35) < 0.04, "ends just after '35%', before the next setup");
  assert.equal(quoteSpan([{ text: "nothing like this" }], transcript, 5), null);
});

test("a timed-out claude that ignores SIGTERM is killed and its pipes let go", async () => {
  const { stopHard } = await import("../src/claude.mjs");
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((r) => setTimeout(r, 150));
  const closed = new Promise((r) => child.on("close", (code, signal) => r(signal)));
  stopHard(child, { graceMs: 200 });
  assert.equal(await closed, "SIGKILL");
});

test("the render reviewer knows a proof reel's still photo is the design", async () => {
  const { watchPrompt } = await import("../src/watch.mjs");
  const base = { sheets: [{ file: "a.jpg", times: [0.5] }], exp: { plan: [], said: [] }, name: "x" };
  assert.match(watchPrompt(base), /a still that reads as a mistake/);
  const proof = watchPrompt({ ...base, proof: true });
  assert.match(proof, /narrated proof reel/);
  assert.match(proof, /the still photo of the speaker is the design, never a dead frame/);
  const receipts = watchPrompt({ ...base, proof: true, receipts: true });
  assert.match(receipts, /the caption and the text above it belong together/);
  assert.match(receipts, /Never report the caption and the text above it as a mismatch/);
  assert.doesNotMatch(receipts, /still photo/);
});

test("the pro hook moves to proPosition (reel proof) and stays at 176 px otherwise", async () => {
  const { proCSS } = await import("../src/pro-text.mjs");
  assert.match(proCSS({ hook: true }), /#pro-title \{ position: absolute; top: 176px;/);
  assert.match(proCSS({ hook: true, hookTop: 960 }), /#pro-title \{ position: absolute; top: 960px;/);
});

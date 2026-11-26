import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLONE_MODEL, isCloneVoice, parseCloneVoice, speakClone } from "../src/elevenlabs.mjs";
import { parseVoice, speak } from "../src/voice.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
const ID = "TestVoice0123456789x";

test("el: voices name Greg's ElevenLabs clone, Eleven v4 unless a model is picked", () => {
  assert.equal(isCloneVoice(`el:${ID}`), true);
  assert.equal(isCloneVoice("vs:Greg"), false);
  assert.equal(isCloneVoice(ID), false, "a bare id stays a stock ElevenLabs voice");
  assert.deepEqual(parseCloneVoice(`el:${ID}`), { voiceId: ID, model: CLONE_MODEL });
  assert.equal(CLONE_MODEL, "eleven_v4");
  assert.deepEqual(parseCloneVoice(`EL:${ID}@eleven_multilingual_v2`), { voiceId: ID, model: "eleven_multilingual_v2" });
  assert.throws(() => parseCloneVoice("el:"), /not an ElevenLabs voice id/);
  assert.throws(() => parseCloneVoice(`el:${ID}@gpt`), /not an ElevenLabs model/);
  assert.deepEqual(parseVoice(`el:${ID}`), { kind: "elevenlabs", voiceId: ID, model: "eleven_v4" });
  assert.deepEqual(parseVoice("vs:Greg"), { kind: "voicestudio", name: "Greg", engine: "cosyvoice" });
  assert.throws(() => parseVoice("Greg"), /unknown voice "Greg"/);
});

test("speakClone: one request per line with the seed, the lines either side and a 48 kHz WAV back", async () => {
  const dir = tmp();
  const prev = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-key";
  try {
    const sent = [];
    const fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, arrayBuffer: async () => new Uint8Array(4000).buffer }; };
    const out = path.join(dir, "01-hook.wav");
    await speakClone({ text: " We worked on her close. ", voice: `el:${ID}`, out, seed: 2511 + 101, previousText: "She'd done hundreds of webinars.", nextText: "We got 41 lives", deps: { fetch } });
    assert.equal(fs.statSync(out).size, 4000);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, `https://api.elevenlabs.io/v1/text-to-speech/${ID}?output_format=wav_48000`);
    assert.equal(sent[0].init.headers["xi-api-key"], "test-key");
    assert.deepEqual(sent[0].body, {
      text: "We worked on her close.", model_id: "eleven_v4", seed: 2612,
      voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
      previous_text: "She'd done hundreds of webinars.", next_text: "We got 41 lives",
    });
    // "random" leaves the seed out; an .mp3 out is converted by ffmpeg from the WAV.
    const runs = [];
    const run = async (cmd, args) => { runs.push([cmd, ...args]); fs.writeFileSync(args.at(-1), Buffer.alloc(10)); return { out: "" }; };
    await speakClone({ text: "First purchase", voice: `el:${ID}`, out: path.join(dir, "a.mp3"), seed: "random", deps: { fetch, run } });
    assert.equal("seed" in sent[1].body, false);
    assert.equal("previous_text" in sent[1].body, false);
    assert.equal(runs[0][0], "ffmpeg");
    assert.ok(!fs.existsSync(path.join(dir, "a.mp3.part.wav")));
    await assert.rejects(speakClone({ text: " ", voice: `el:${ID}`, out, deps: { fetch } }), /nothing to say/);
    const bad = async () => ({ ok: false, status: 401, text: async () => '{"detail":{"status":"missing_permissions"}}' });
    await assert.rejects(speakClone({ text: "hi", voice: `el:${ID}`, out, deps: { fetch: bad } }), /text-to-speech failed: HTTP 401/);
    const empty = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(10).buffer });
    await assert.rejects(speakClone({ text: "hi", voice: `el:${ID}`, out, deps: { fetch: empty } }), /returned no audio/);
  } finally {
    if (prev === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = prev;
  }
});

test("speak sends el: voices to ElevenLabs and vs: voices to VoiceStudio", async () => {
  const got = [];
  const deps = { speakClone: async (o) => { got.push(["el", o]); return o.out; }, speakStudio: async (o) => { got.push(["vs", o]); return o.out; } };
  await speak({ text: "a", voice: `el:${ID}`, out: "/x/a.wav", seed: 7, previousText: "p", nextText: "n", env: {}, deps });
  await speak({ text: "b", voice: "vs:Greg", out: "/x/b.wav", seed: 7, previousText: "p", env: {}, deps });
  assert.deepEqual(got.map(([k, o]) => [k, o.text, o.seed]), [["el", "a", 7], ["vs", "b", 7]]);
  assert.equal(got[0][1].previousText, "p");
  assert.equal(got[0][1].nextText, "n");
  assert.equal("previousText" in got[1][1], false, "VoiceStudio gets no context lines");
});

test("renderNarration hands every take the lines before and after it", async () => {
  const { renderNarration } = await import("../src/proof.mjs");
  const dir = tmp();
  const takes = [];
  const touch = (f) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); };
  const deps = {
    speak: async (o) => { takes.push(o); touch(o.out); return o.out; },
    run: async (cmd, args) => { if (cmd === "ffmpeg") touch(args.at(-1)); return { out: "" }; },
    probe: async () => ({ duration: 1 }),
  };
  const script = { hook: "Your offer sells.", items: [{ setup: "We worked on her close.", quote: "First purchase" }], close: "I build the sales system under the offer you already have." };
  await renderNarration(script, { voice: `el:${ID}`, dir, deps, env: {}, check: false });
  assert.deepEqual(takes.map((t) => [t.previousText, t.text, t.nextText]), [
    ["", "Your offer sells.", "We worked on her close."],
    ["Your offer sells.", "We worked on her close.", "First purchase"],
    ["We worked on her close.", "First purchase", "I build the sales system under the offer you already have."],
    ["First purchase", "I build the sales system under the offer you already have.", ""],
  ]);
  assert.ok(takes.every((t) => t.voice === `el:${ID}`));
});

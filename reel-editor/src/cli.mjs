import { parseArgs } from "node:util";
import path from "node:path";
import { runEdit, buildProject, renderProject, batchEdit } from "./pipeline.mjs";
import { transcribe, applyCorrections } from "./transcribe.mjs";
import { listPresets, loadPreset, loadDictionary } from "./presets.mjs";
import { hyperframesBin } from "./render.mjs";
import { doctor } from "./doctor.mjs";
import { makeCarousel } from "./carousel.mjs";
import { writeJSON, log } from "./util.mjs";

const USAGE = `reel: self-hosted reel editor (HyperFrames + Whisper + ElevenLabs)

Usage
  reel edit <video> [options]       transcribe -> cut silence/bad takes -> captions, hook, zooms -> render
  reel build <workdir> [--no-render] rebuild the HyperFrames project from an edited plan.json (then render)
  reel render <workdir> [-o out.mp4] render the project in <workdir> again
  reel transcribe <video> [-o words.json] [--engine auto|faster-whisper|elevenlabs|hyperframes] [--model large-v3-turbo]
  reel batch <folder> [options]     edit every video in a folder that has no render yet
  reel carousel <workdir> [--out <dir>] [--slides 6] [--images 2] [--force]
                                    IG carousel from a finished reel: Codex writes the slides and draws the images
                                    (reusing the reel's b-roll), the editor sets the words; 1080x1350 PNGs
  reel presets                      list presets
  reel doctor                       check ffmpeg, whisper, hyperframes, chrome, keys

Options (edit / batch)
  --out <dir>              work dir (default videos/<name>)
  --preset <name|path>     default: $REEL_PRESET (set by install.sh), else pingel-brand
  --transcript <file>      skip ASR and use this words json / srt
  --engine <e>             auto (default: ElevenLabs Scribe when ELEVENLABS_API_KEY is set, else Whisper) | faster-whisper | elevenlabs | hyperframes
  --model <m>              whisper model: large-v3-turbo (default), small (fast, mis-hears more), large-v3
  --no-verify              skip the second-opinion transcript and review.txt
  --language <code>        default en
  --hook "<text>"          hook title for the first 3s (default: the opening phrase)   --no-hook
  --title-style <s>        headline (brand default: words rise on a soft scrim, one gold phrase, gold rule) |
                           gold | outline (Bone text, black outline) | box (Bone on Obsidian backing)
                           Mark the gold phrase by hand with asterisks: --hook "The *10 minutes* after a bad number"
  --hook-position <0-1>    hook height from the top (default 0.22); 0.40 clears the head on wide shots
  --no-auto-keywords       gold only on dictionary terms, numbers and power words (no automatic picks)
  --cta "<text>"           pop-up call to action, e.g. "Comment GHOST" (Signet Gold pill at chest level)
  --cta-last <s>           show the CTA for the last N seconds (default 3)   --cta-at <s> --cta-duration <s>
  --cta-style <s>          pill (default) | box | text          --cta-position <0-1>  default 0.62
  --silence <pace>         off | slow | medium | fast (preset default)
  --no-bad-takes           keep restarted phrases          --no-fillers    keep um/uh
  --no-cuts                keep every frame                --no-zooms      no magic zooms
  --no-captions            no captions                     --active-word   karaoke pop on the spoken word
  --words-per-line <n>     captions words per line (preset default 3)
  --canvas <c>             auto (default) | portrait | landscape | square | source
  --music <file>           music bed, looped to length     --music-volume <0-1>  default 0.12
  --no-clean-audio         skip noise reduction + loudness normalization
  --sfx                    ElevenLabs whoosh on zoom-ins and pop on the hook (needs ELEVENLABS_API_KEY)
  --voiceover <script.txt> ElevenLabs narration track      --voice <id>    --replace-audio (mute footage)
  --quality <q>            draft | looks (default) | delivery        --fps <n>  default 30
  --broll                  Codex b-roll: 1-3 generated stills cut in after the hook, slow push-in, voice and captions
                           keep going (needs the Codex CLI signed in). --no-broll turns a preset's b-roll off,
                           --new-broll draws fresh stills instead of reusing the saved ones
  --no-render              stop after writing the project  --force    redo the transcript
  --title <name>           output name
  --dictionary <file>      terms / corrections / power words json (default: dictionary.json)

Environment
  ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, REEL_PYTHON (python with faster-whisper),
  REEL_BROWSER_PATH (Chrome/Chromium binary for rendering), REEL_SFX_CACHE, REEL_DEBUG=1
`;

const EDIT_OPTIONS = {
  out: { type: "string" },
  preset: { type: "string" }, // no default here: loadPreset falls back to REEL_PRESET, then pingel-brand
  transcript: { type: "string" },
  engine: { type: "string" },
  "no-verify": { type: "boolean" },
  model: { type: "string" },
  language: { type: "string" },
  hook: { type: "string" },
  "no-hook": { type: "boolean" },
  "title-style": { type: "string" },
  "hook-position": { type: "string" },
  "no-auto-keywords": { type: "boolean" },
  cta: { type: "string" },
  "cta-last": { type: "string" },
  "cta-at": { type: "string" },
  "cta-duration": { type: "string" },
  "cta-style": { type: "string" },
  "cta-position": { type: "string" },
  silence: { type: "string" },
  "no-bad-takes": { type: "boolean" },
  "no-fillers": { type: "boolean" },
  "no-cuts": { type: "boolean" },
  "no-zooms": { type: "boolean" },
  "no-captions": { type: "boolean" },
  "active-word": { type: "boolean" },
  "words-per-line": { type: "string" },
  canvas: { type: "string" },
  music: { type: "string" },
  "music-volume": { type: "string" },
  "no-clean-audio": { type: "boolean" },
  sfx: { type: "boolean" },
  voiceover: { type: "string" },
  voice: { type: "string" },
  "replace-audio": { type: "boolean" },
  quality: { type: "string" },
  fps: { type: "string" },
  broll: { type: "boolean" },
  "no-broll": { type: "boolean" },
  "new-broll": { type: "boolean" },
  "no-render": { type: "boolean" },
  "no-check": { type: "boolean" },
  force: { type: "boolean" },
  title: { type: "string" },
  dictionary: { type: "string" },
  output: { type: "string", short: "o" },
  help: { type: "boolean", short: "h" },
};

const camel = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));

function parse(args, options = EDIT_OPTIONS) {
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true });
  return { opts: camel(values), positionals };
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return console.log(USAGE);
  switch (cmd) {
    case "edit": {
      const { opts, positionals } = parse(rest);
      if (opts.help || !positionals[0]) return console.log(USAGE);
      const r = await runEdit(positionals[0], opts);
      if (r.output) console.log(r.output);
      return;
    }
    case "batch": {
      const { opts, positionals } = parse(rest);
      if (opts.help || !positionals[0]) return console.log(USAGE);
      const rs = await batchEdit(positionals[0], opts);
      log(`batch done: ${rs.length} edited`);
      return;
    }
    case "build": {
      const { opts, positionals } = parse(rest);
      const r = await buildProject(positionals[0] || ".", opts);
      if (r.output) console.log(r.output);
      return;
    }
    case "carousel": {
      const { opts, positionals } = parse(rest, { out: { type: "string" }, slides: { type: "string" }, images: { type: "string" }, force: { type: "boolean" }, help: { type: "boolean", short: "h" } });
      if (opts.help || !positionals[0]) return console.log(USAGE);
      const files = await makeCarousel(positionals[0], opts);
      console.log(path.dirname(files[0]));
      return;
    }
    case "render": {
      const { opts, positionals } = parse(rest);
      console.log(await renderProject(positionals[0] || ".", opts));
      return;
    }
    case "transcribe": {
      const { opts, positionals } = parse(rest);
      if (!positionals[0]) return console.log(USAGE);
      const input = path.resolve(positionals[0]);
      const out = path.resolve(opts.output || `${path.basename(input, path.extname(input))}.words.json`);
      const preset = loadPreset(opts.preset);
      const dict = loadDictionary(opts.dictionary);
      let words = await transcribe(input, {
        engine: opts.engine || preset.transcribe.engine,
        model: opts.model || preset.transcribe.model,
        language: opts.language || preset.transcribe.language,
        prompt: (dict.terms || []).slice(0, 40).join(", "),
        out,
        hyperframesBin: hyperframesBin(),
      });
      words = applyCorrections(words, dict.corrections);
      writeJSON(out, { source: input, words });
      log(`${words.length} words → ${out}`);
      return;
    }
    case "presets": {
      for (const p of listPresets()) {
        const x = loadPreset(p);
        console.log(`  ${p.padEnd(14)} captions ${x.captions.enabled ? `${x.captions.wordsPerLine}/line @${x.captions.position}` : "off"}, hook ${x.hook.enabled ? "on" : "off"}, zooms ${x.zooms.enabled ? "on" : "off"}, silence ${x.cuts.silence}, bad takes ${x.cuts.badTakes ? "on" : "off"}`);
      }
      return;
    }
    case "doctor":
      return doctor();
    default:
      console.log(USAGE);
      throw new Error(`unknown command: ${cmd}`);
  }
}

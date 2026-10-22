import { parseArgs } from "node:util";
import path from "node:path";
import { runEdit, buildProject, renderProject, batchEdit } from "./pipeline.mjs";
import { transcribe, applyCorrections } from "./transcribe.mjs";
import { listPresets, loadPreset, loadDictionary } from "./presets.mjs";
import { hyperframesBin } from "./render.mjs";
import { doctor } from "./doctor.mjs";
import { makeCarousel } from "./carousel.mjs";
import { makeClips } from "./clips.mjs";
import { makeCover } from "./cover.mjs";
import { readJSON } from "./util.mjs";
import { renderHookVariants } from "./pipeline.mjs";
import { writeJSON, log } from "./util.mjs";

const USAGE = `reel: self-hosted reel editor (HyperFrames + Whisper + ElevenLabs)

Usage
  reel edit <video> [options]       transcribe -> cut silence/bad takes -> captions, hook, zooms -> render
  reel build <workdir> [--no-render] rebuild the HyperFrames project from an edited plan.json (then render)
  reel render <workdir> [-o out.mp4] render the project in <workdir> again
  reel transcribe <video> [-o words.json] [--engine auto|faster-whisper|elevenlabs|hyperframes] [--model large-v3-turbo]
  reel batch <folder> [options]     edit every video in a folder that has no render yet
  reel youtube <long video> [edit options]  the whole video for YouTube: cuts, chapters with title cards, re-hooks,
                                    sparse cards and b-roll, 112% punch-ins, end-screen-safe ending, and the package
                                    (description with chapters, titles, captions.srt, thumbnails, endscreen.json,
                                    edit.v3.json). Captions off by default (--captions burns them in)
  reel usage                        what the paid generations (Runway b-roll) cost this month and last, and the balance
  reel clips <long video> [--count 5] [--plan-only] [--replan] [--no-layout] [edit options]
                                    one long recording into several reels: Claude picks 30-90 s windows with a
                                    hook and a score, each is cut out and edited (clips.json lists them)
  reel hooks <workdir> "hook A" "hook B"  the first 4 s rendered once per hook, into <workdir>/hooks/
  reel cover <workdir>              the cover image again (cover.png: a hook-window frame with the hook at chest height)
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
  --caption-position <0-1> caption height from the top; by default they sit just under the chin (0.56-0.76)
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
  --music <file>           music bed, normalized and trimmed to length   --music-volume <0-1>  default 0.10
  --music-dir <folder>     pick the bed from a folder of "<Mood> - Title - Artist.mp3" files by the mood of what
                           is said (Claude, headless); "Signature ..." tracks come back more often
  --music-want <text>      with --music-dir: the track whose file name contains this    --no-duck  flat level
  --no-clean-audio         skip noise reduction + loudness normalization
  --sfx                    ElevenLabs whoosh on zoom-ins and pop on the hook (needs ELEVENLABS_API_KEY)
  --voiceover <script.txt> ElevenLabs narration track      --voice <id>    --replace-audio (mute footage)
  --quality <q>            draft | looks (default) | delivery        --fps <n>  default 30
  --check                  run the HyperFrames lint/layout check before rendering (off by default; slow)
  --broll                  Codex b-roll: 1-3 generated stills cut in after the hook, slow push-in, voice and captions
                           keep going (needs the Codex CLI signed in). --no-broll turns a preset's b-roll off,
                           --new-broll draws fresh stills instead of reusing the saved ones
  --graphics               designed cards cut in to show what you say: a number, a checklist, a highlighted
                           quote, the key line, a step diagram. Claude writes them from the transcript, the
                           editor sets them in the brand colors (needs the Claude Code CLI). --no-graphics off,
                           --new-graphics replans them. With cards on, --broll adds at most 2 photos in the gaps
  --caption-style <s>      pop (Anton, black outline) | reveal (heavy Inter, each word lights up as it is said)
  --slams                  climax words: a gold word slams in big in the top third for a second as it is said
                           (at most 5, 8 s apart, never under a card). --no-slams off
  --annotate               a hand-drawn marker underlines (circles a number) the gold word in each caption line
                           as it is spoken. --no-annotate off
  --zoom-style <s>         camera (creator punch-in: push, slight tilt, edge defocus) | snap (hard cut-in zoom)
  --broll-cut <s>          hard (default) | flash (a white editorial flash on the cut) | blur (the still arrives from a blur)
  --broll-engine <e>       codex (stills drawn by Codex) | runway (generated video clips via the Runway API; needs
                           RUNWAY_API_KEY, about 30 credits = $0.30 per 5-second clip; every clip goes in the usage ledger)
  --no-cadence             no cut cadence (the frame otherwise cuts between two framings every 2.5-4.5 s)
  --cold-open              with b-roll: frame 0 shows a still under the hook for 0.6 s, then flashes to you. --no-cold-open off
  --sounds                 small CC0 sounds on the edits: card lands, word slam, camera move, flash, marker. --no-sounds off
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
  "caption-position": { type: "string" },
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
  captions: { type: "boolean" },
  "active-word": { type: "boolean" },
  "words-per-line": { type: "string" },
  canvas: { type: "string" },
  music: { type: "string" },
  "music-dir": { type: "string" },
  "music-want": { type: "string" },
  "no-duck": { type: "boolean" },
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
  graphics: { type: "boolean" },
  "no-graphics": { type: "boolean" },
  "new-graphics": { type: "boolean" },
  "caption-style": { type: "string" },
  slams: { type: "boolean" },
  "no-slams": { type: "boolean" },
  annotate: { type: "boolean" },
  "no-annotate": { type: "boolean" },
  "zoom-style": { type: "string" },
  "broll-cut": { type: "string" },
  "broll-engine": { type: "string" },
  "no-cadence": { type: "boolean" },
  "cold-open": { type: "boolean" },
  "no-cold-open": { type: "boolean" },
  sounds: { type: "boolean" },
  "no-sounds": { type: "boolean" },
  "no-render": { type: "boolean" },
  "no-check": { type: "boolean" },
  check: { type: "boolean" },
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
    case "youtube": {
      const { opts, positionals } = parse(rest);
      if (opts.help || !positionals[0]) return console.log(USAGE);
      const { makeYouTube } = await import("./youtube.mjs");
      const r = await makeYouTube(positionals[0], opts);
      if (r.output) console.log(r.output);
      return;
    }
    case "usage": {
      const { readUsage, usageReport } = await import("./usage.mjs");
      process.stdout.write(usageReport(readUsage()));
      return;
    }
    case "clips": {
      const { opts, positionals } = parse(rest, { ...EDIT_OPTIONS, count: { type: "string" }, "plan-only": { type: "boolean" }, replan: { type: "boolean" }, "auto-hook": { type: "boolean" }, "no-layout": { type: "boolean" } });
      if (opts.help || !positionals[0]) return console.log(USAGE);
      const r = await makeClips(positionals[0], opts);
      for (const c of r.clips) if (c.output) console.log(c.output);
      return;
    }
    case "cover": {
      const { positionals } = parse(rest, { help: { type: "boolean", short: "h" } });
      const wd = path.resolve(positionals[0] || ".");
      const plan = readJSON(path.join(wd, "plan.json"));
      console.log(await makeCover(wd, plan, { handle: plan.style?.carousel?.handle || "" }));
      return;
    }
    case "hooks": {
      const { opts, positionals } = parse(rest, { seconds: { type: "string" }, quality: { type: "string" }, help: { type: "boolean", short: "h" } });
      if (opts.help || positionals.length < 2) return console.log(USAGE);
      const outs = await renderHookVariants(positionals[0], positionals.slice(1), { seconds: parseFloat(opts.seconds || 4), quality: opts.quality || "draft" });
      outs.forEach((o) => console.log(o));
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
      // Same shape the pipeline saves, so a later `reel edit --transcript` keeps the engine and the source check.
      let sourceStat = null;
      try { const st = (await import("node:fs")).statSync(input); sourceStat = { size: st.size, mtimeMs: Math.round(st.mtimeMs) }; } catch {}
      let engine = null;
      try { engine = JSON.parse((await import("node:fs")).readFileSync(out, "utf8")).engine || null; } catch {}
      writeJSON(out, { source: input, sourceStat, engine, words });
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

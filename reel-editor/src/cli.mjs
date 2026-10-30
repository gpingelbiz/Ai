import { parseArgs } from "node:util";
import fs from "node:fs";
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
import { resolveBrandTokens, tokensCSS, validateBrand } from "./brandtokens.mjs";

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
                                    --families / --no-families allows or forbids semantic slide families
  reel slides <spec.json> [--brand brands/x.json] [--out <dir>]
                                    render the content-engine slide JSON; prints one PNG path per line
  reel slides --sample [--out <dir>] render every kind for Greg and the calm fixture for visual review
  reel photo-finish <files...> --out-dir <dir> [--grade none|muted-editorial|bw|warm]
                                    [--intensity 0..1] [--grain 0..0.03] [--json]
                                    finish one carousel with one shared target luma; unavailable Swift copies through
  reel photo-score <files...> [--json]
                                    Apple Vision aesthetics, utility, face count, sharpness and luma for photo picking
  reel preflight <spec.json> [--dir <png dir>] [--brand <brand.json|preset>] [--history <file.json>] [--json]
                                    fail-closed rendered-slide checks; exits 0 only when the verdict is schedule
  reel photos | daily | studio ...  the Content Studio (a client's folder that makes and schedules their posts):
                                    reel studio help for the commands
  reel brand [preset|brand.json] [--css] [--check]
                                    resolved brand tokens as JSON, reusable CSS, or validation problems
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
  --premise "<text>"       persistent premise after the hook (truth-checked against the transcript)
                           --no-premise turns preset/automatic premise planning off; #premise enables auto in a dropped file
  --evidence <file>[@s][|label]
                           real supplied screenshot, DM, email or receipt; repeat for more than one
  --evidence-layout <s>    auto (default) | card | focus | over          --no-evidence disables supplied evidence
  --redact "word,word"    additionally cover supplied private words; repeatable
  --no-redact              render the supplied image without automatic privacy bars (prints a warning)
  --title-style <s>        headline (brand default: words rise on a soft scrim, one gold phrase, gold rule) |
                           gold | outline (Bone text, black outline) | box (Bone on Obsidian backing)
                           Mark the gold phrase by hand with asterisks: --hook "The *10 minutes* after a bad number"
  --hook-position <0-1>    hook height from the top (default 0.22); 0.40 clears the head on wide shots
  --hook-seconds <n|reel>  how long the hook stays up (default 3); reel = the whole reel (one-liners, podcast titles)
  --credit "Name | Credential | Organisation [| Source | verified]"
                           credential lower third from supplied facts; repeat once per person
  --credit-at <seconds>    when that person is on screen; repeat in the same order. Needed when two or more people
                           are on camera (names are never guessed); a one-person clip uses their first long turn.
                           --credit-self uses the brand identity (#credit in a file name)
  --caption-position <0-1> caption height from the top; by default they sit just under the chin (0.56-0.76)
  --no-auto-keywords       gold only on dictionary terms, numbers and power words (no automatic picks)
  --cta "<text>"           pop-up call to action supplied for this reel (brand accent pill at chest level)
  --cta-last <s>           show the CTA for the last N seconds (default 3)   --cta-at <s> --cta-duration <s>
  --cta-style <s>          pill (default) | box | text          --cta-position <0-1>  default 0.62
  --silence <pace>         off | slow | medium | fast | tight (preset default)
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
  --no-room-tone           fade jump cuts to silence instead of laying a quiet room bed underneath them
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
  --persistent-graphics    allow one spoken 3-7 item checklist to stay beside the head   --no-persistent-graphics off
  --ladder                 allow a persistent ladder of spoken numeric levels            --no-ladder off
  --premise-icons          allow validated Lucide section icons in the premise strip      --no-premise-icons off
  --time-labels            show exact spoken story times after the hook                    --no-time-labels off
  --caption-style <s>      pop (Anton, black outline) | reveal (heavy Inter, each word lights up as it is said)
  --slams                  climax words: a gold word slams in big in the top third for a second as it is said
                           (at most 5, 8 s apart, never under a card). --no-slams off
  --annotate               a hand-drawn marker underlines (circles a number) the gold word in each caption line
                           as it is spoken. --no-annotate off
  --zoom-style <s>         camera (creator punch-in: push, slight tilt, edge defocus) | snap (hard cut-in zoom)
  --broll-cut <s>          hard (default) | flash | blur | whip (a horizontal slide with directional blur)
  --broll-engine <e>       codex (stills drawn by Codex) | runway (generated video clips via the Runway API; needs
                           RUNWAY_API_KEY, about 30 credits = $0.30 per 5-second clip; every clip goes in the usage ledger)
  --no-cadence             no cut cadence (the frame otherwise cuts between two framings every 2.5-4.5 s)
  --cold-open              with b-roll: frame 0 shows a still under the hook for 0.6 s, then flashes to you. --no-cold-open off
  --sounds                 small CC0 sounds on the edits: card lands, word slam, camera move, flash, marker. --no-sounds off
  --no-studio              skip studio sound (DeepFilterNet denoise + phrase leveler + de-click; on when the
                           deep-filter binary is installed, see scripts/install-deepfilter.sh)
  --no-fix-words           skip the caption word fix (Claude corrects mis-heard brand terms and names from the
                           dictionary, text only; the words are then re-timed against the audio)
  --align                  always re-time every word with ElevenLabs forced alignment (default: only after a fix,
                           or when the transcript came from faster-whisper). --no-align never
  --no-preflight           skip the preflight check on the finished file (loudness, dead or static open, silence,
                           captions over the face, Instagram safe zones); the report is preflight.txt either way
  --behind                 the hook sits behind you: Apple Vision cuts you out so the text runs behind your head
                           and shoulders. --no-behind off (on in the pingel-brand and pingel-runway presets)
  --cover-style <s>        frame (scored rendered frame) | archetypes (five brand-token cover families) |
                           designed (compatibility alias for archetypes)
  --no-review              skip the render reviewer (Claude looks at frames of the finished reel and notes what
                           looks wrong, with times, in preflight.txt; it never changes the reel)
  --look <id>              the look for this reel (cards, hook, gold-word marker, slams, b-roll grade and cut, camera move):
                           receipts | phone | fieldnotes | gregcard | briefing | press | shopfloor | blueprint |
                           casefile | redline | glass;
                           auto (default) lets Claude pick it from the topic, never the same as the last reel.
                           #look:receipts in a dropped file name does the same
  --no-signature           hide this brand's edge rule, corner mark or title plate for this reel. --signature on
  --no-house-looks         let auto use the full look catalog for this reel. --house-looks restores the brand set;
                           an explicit --look always wins either way
  --pace fast              the measured short-form pacing on top of the look: shots of 1.1-1.4 s (never over 2.8),
                           the first cut by 1 s, no dead air over 0.2 s, 1-2 word captions that hard-swap two
                           frames early (presets/pace-fast.json). #fast in a dropped file name does the same
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
  premise: { type: "string" },
  "premise-mode": { type: "string" },
  "no-premise": { type: "boolean" },
  evidence: { type: "string", multiple: true },
  "evidence-layout": { type: "string" },
  "no-evidence": { type: "boolean" },
  redact: { type: "string", multiple: true },
  "no-redact": { type: "boolean" },
  "title-style": { type: "string" },
  "hook-position": { type: "string" },
  "hook-seconds": { type: "string" },
  credit: { type: "string", multiple: true },
  "credit-at": { type: "string", multiple: true },
  "credit-self": { type: "boolean" },
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
  "room-tone": { type: "boolean" },
  "no-room-tone": { type: "boolean" },
  quality: { type: "string" },
  fps: { type: "string" },
  broll: { type: "boolean" },
  "no-broll": { type: "boolean" },
  "new-broll": { type: "boolean" },
  graphics: { type: "boolean" },
  "no-graphics": { type: "boolean" },
  "new-graphics": { type: "boolean" },
  "persistent-graphics": { type: "boolean" },
  "no-persistent-graphics": { type: "boolean" },
  ladder: { type: "boolean" },
  "no-ladder": { type: "boolean" },
  "premise-icons": { type: "boolean" },
  "no-premise-icons": { type: "boolean" },
  "time-labels": { type: "boolean" },
  "no-time-labels": { type: "boolean" },
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
  studio: { type: "boolean" },
  "no-studio": { type: "boolean" },
  "fix-words": { type: "boolean" },
  "no-fix-words": { type: "boolean" },
  align: { type: "boolean" },
  "no-align": { type: "boolean" },
  "no-preflight": { type: "boolean" },
  behind: { type: "boolean" },
  pace: { type: "string" },
  look: { type: "string" },
  signature: { type: "boolean" },
  "no-signature": { type: "boolean" },
  "house-looks": { type: "boolean" },
  "no-house-looks": { type: "boolean" },
  "no-review": { type: "boolean" },
  "no-behind": { type: "boolean" },
  "cover-style": { type: "string" },
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

function preflightBrand(target) {
  if (!target) return loadPreset("pingel-brand").brand;
  if (!fs.existsSync(target) || !target.endsWith(".json")) return loadPreset(target).brand;
  const raw = readJSON(path.resolve(target));
  const isBrand = raw.schemaVersion === 2 || raw.identity || raw.handle || (raw.colors?.text && raw.look);
  if (!isBrand) return loadPreset(path.resolve(target)).brand;
  const tokens = resolveBrandTokens({ brand: raw });
  if (Array.isArray(raw.neverSay)) tokens.neverSay = raw.neverSay;
  return tokens;
}

function preflightFiles(spec, dir) {
  const root = path.resolve(dir || spec.out_dir || spec.outDir || ".");
  const all = fs.existsSync(root)
    ? fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".png")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  return spec.slides.map((_, index) => {
    const names = [`${String(index + 1).padStart(2, "0")}.png`, `${index + 1}.png`];
    const found = names.find((name) => fs.existsSync(path.join(root, name))) || all[index] || names[0];
    return path.join(root, found);
  });
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
      const { opts, positionals } = parse(rest, { out: { type: "string" }, slides: { type: "string" }, images: { type: "string" }, families: { type: "boolean" }, "no-families": { type: "boolean" }, force: { type: "boolean" }, help: { type: "boolean", short: "h" } });
      if (opts.help || !positionals[0]) return console.log(USAGE);
      if (opts.noFamilies) opts.families = false;
      const files = await makeCarousel(positionals[0], opts);
      console.log(path.dirname(files[0]));
      return;
    }
    case "slides": {
      const { opts, positionals } = parse(rest, { brand: { type: "string" }, out: { type: "string" }, sample: { type: "boolean" }, help: { type: "boolean", short: "h" } });
      if (opts.help || (!opts.sample && !positionals[0])) return console.log(USAGE);
      const { renderSlides, renderSlideSamples } = await import("./slides.mjs");
      const files = opts.sample
        ? await renderSlideSamples(opts.out || "slides-samples")
        : await renderSlides(readJSON(path.resolve(positionals[0])), { brand: opts.brand, outDir: opts.out });
      files.forEach((file) => console.log(file));
      return;
    }
    case "photo-finish": {
      const { parsePhotoFinishArgs, finishPhotoSet } = await import("./photo-finish.mjs");
      const opts = parsePhotoFinishArgs(rest);
      if (opts.help || !opts.files.length || !opts.outDir) return console.log(USAGE);
      const result = await finishPhotoSet(opts.files.map((file) => path.resolve(file)), {
        outDir: path.resolve(opts.outDir), grade: opts.grade, intensity: opts.intensity, grain: opts.grain,
      });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else result.outputs.forEach((file) => console.log(file));
      return;
    }
    case "photo-score": {
      const { parsePhotoScoreArgs, photoScoreRows } = await import("./photo-finish.mjs");
      const { detectPhotos } = await import("./photos.mjs");
      const opts = parsePhotoScoreArgs(rest);
      if (opts.help || !opts.files.length) return console.log(USAGE);
      const rows = photoScoreRows(await detectPhotos(opts.files.map((file) => path.resolve(file))));
      if (opts.json) console.log(JSON.stringify(rows, null, 2));
      else for (const row of rows) console.log(`${row.file}\toverall ${row.overall ?? "unavailable"}\tutility ${row.utility}\tfaces ${row.faceCount}\tsharpness ${row.sharpness ?? "unavailable"}\tluma ${row.luma ?? "unavailable"}`);
      return;
    }
    case "preflight": {
      const { opts, positionals } = parse(rest, { dir: { type: "string" }, brand: { type: "string" }, history: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } });
      if (opts.help || !positionals[0]) return console.log(USAGE);
      const specFile = path.resolve(positionals[0]);
      const spec = readJSON(specFile);
      const history = opts.history ? readJSON(path.resolve(opts.history)) : null;
      const { preflightSlides } = await import("./preflight.mjs");
      const result = await preflightSlides({
        spec,
        files: preflightFiles(spec, opts.dir || (!spec.out_dir && !spec.outDir ? path.dirname(specFile) : undefined)),
        brand: preflightBrand(opts.brand),
        history,
        options: { specDir: path.dirname(specFile) },
      });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else {
        for (const slide of result.slides) for (const item of slide.problems) console.log(`slide ${slide.index}: ${item.code}: ${item.message}`);
        console.log(`verdict: ${result.verdict}`);
      }
      if (result.verdict !== "schedule") process.exitCode = 1;
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
      const { opts, positionals } = parse(rest, { ...EDIT_OPTIONS, count: { type: "string" }, "plan-only": { type: "boolean" }, replan: { type: "boolean" }, "auto-hook": { type: "boolean" }, "no-layout": { type: "boolean" }, picker: { type: "string" } });
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
    case "brand": {
      const { opts, positionals } = parse(rest, { css: { type: "boolean" }, check: { type: "boolean" }, help: { type: "boolean", short: "h" } });
      if (opts.help) return console.log(USAGE);
      const target = positionals[0];
      let authored = null;
      let tokens;
      if (target && fs.existsSync(target) && target.endsWith(".json")) {
        const raw = readJSON(path.resolve(target));
        const isBrand = raw.schemaVersion === 2 || raw.identity || raw.handle || (raw.colors?.text && raw.look);
        if (isBrand) { authored = raw; tokens = resolveBrandTokens({ brand: raw }); }
        else tokens = loadPreset(path.resolve(target)).brand;
      } else tokens = loadPreset(target).brand;
      if (opts.check) console.log(JSON.stringify(validateBrand(authored || tokens), null, 2));
      else if (opts.css) console.log(tokensCSS(tokens));
      else console.log(JSON.stringify(tokens, null, 2));
      return;
    }
    case "photos": {
      const { photosCommand } = await import("./studio-cli.mjs");
      return photosCommand(rest);
    }
    case "daily": {
      const { dailyCommand } = await import("./studio-cli.mjs");
      return dailyCommand(rest);
    }
    case "studio": {
      const { studioCommand } = await import("./studio-cli.mjs");
      return studioCommand(rest);
    }
    case "doctor":
      return doctor();
    default:
      console.log(USAGE);
      throw new Error(`unknown command: ${cmd}`);
  }
}

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadManifest, initManifest, assertNoGreg, assetPath } from "./speaker-intake.mjs";
import { speakerPreset } from "./brandkit.mjs";
import { resolveBrandTokens, tokensCSS } from "./brandtokens.mjs";
import { indexSources, loadSourceIndex, probeSource } from "./speaker-index.mjs";
import { compileVersion, resolvePlan, planUsage } from "./speaker-compile.mjs";
import { measureLoudness } from "./preflight.mjs";
import { readJSON, writeJSON, ensureDir, log } from "./util.mjs";

import { composeSpeakerProject } from "./speaker-compose.mjs";
import { render } from "./render.mjs";
import { normalizeDelivery } from "./pipeline.mjs";
import { speakerQC, writeQC } from "./speaker-qc.mjs";
import { buildReview, writeRevision } from "./speaker-review.mjs";
import { approve, deliver } from "./speaker-deliver.mjs";
import { findCandidates, writeCandidates, describeCandidates } from "./speaker-moments.mjs";
import { findReactions } from "./reactions.mjs";
import { shotCandidates } from "./shots.mjs";
import { writeStarterPlan } from "./speaker-plan.mjs";
import { speakerStatus } from "../scripts/speaker-status.mjs";

export const SPEAKER_HELP = `reel speaker: build and review a client's landscape speaker reel

  reel speaker init <folder> [--add-new]
  reel speaker index <folder> [--engine auto|faster-whisper|elevenlabs|hyperframes] [--model name] [--language en]
  reel speaker candidates <folder> [--source id]
  reel speaker reactions <folder> [--source id]
  reel speaker plan <folder> --version full|short|teaser [--replan]
  reel speaker draft <folder> --version v [--captions] [--render-only]
  reel speaker comments <folder> --version v <file>
  reel speaker approve <folder> --version v --by "Client name"
  reel speaker deliver <folder> --version v
  reel speaker status <folder>
  reel speaker <folder> [--version full] [--plan file] [--plan-only] [--render-only] [--draft] [--captions]

The Desktop flag form --version v --draft also compiles, composes, renders and builds review.
Clean video is default. --captions (or plan.captions:true) burns verbatim captions; SRT/VTT always exist.
--plan-only validates without ASR/rendering. --render-only reuses a fresh saved index.
--draft permits visibly warned pending/unknown rights; final delivery requires approved rights.
Plans in work/plans/ stay editable. Nothing publishes automatically.
`;

function errors(problems) {
  const fatal = problems.filter((p) => p.level === "error");
  if (fatal.length) throw new Error(fatal.map((p) => `${p.id}: ${p.message}`).join("\n"));
}

/** The empty-plan call remains a base-path query for older composition-hook callers. */
export async function composeSpeaker(workDir, resolvedPlan, options = {}) {
  if (!options.manifest && !resolvedPlan.items) {
    assertNoGreg({ resolvedPlan, ...options }, "speaker composition");
    return { base: path.join(workDir, "base.mp4") };
  }
  return composeSpeakerProject(workDir, resolvedPlan, options);
}

export function planSummary(resolved, manifest) {
  const usage = planUsage(resolved, manifest), roles = {};
  for (const i of resolved.items) roles[i.role] = (roles[i.role] || 0) + i.frames / resolved.canvas.fps;
  return { version: resolved.version, items: resolved.items.length, duration: resolved.duration, frames: resolved.frames, roles, ...usage, problems: resolved.problems };
}

/** No plan selection, publish routes or client approval state is inferred here. */
export async function runSpeaker(folder, opts = {}, { index: indexImpl = indexSources, compile: compileImpl = compileVersion, compose: composeImpl = composeSpeaker, loudness: loudnessImpl = measureLoudness, render: renderImpl = render, normalize: normalizeImpl = normalizeDelivery, qc: qcImpl = speakerQC, review: reviewImpl = buildReview, print = log } = {}) {
  folder = path.resolve(folder);
  const { manifest, problems } = loadManifest(folder);
  errors(problems);
  assertNoGreg(manifest, "manifest");
  const brandFile = assetPath(folder, manifest.brand.file);
  let brand;
  try { brand = readJSON(brandFile); }
  catch (e) { throw new Error(`speaker brand ${brandFile}: ${e.message}`); }
  assertNoGreg(brand, "brand");
  if (opts.planOnly && opts.renderOnly) throw new Error("choose either --plan-only or --render-only");
  // Indexing only needs the brand's names and corrections, so it runs before the brand's fonts are settled.
  if (opts.indexOnly) return indexImpl(folder, manifest, { brand, engine: opts.engine, language: opts.language, model: opts.model, print });
  const preset = speakerPreset(brand);
  const tokens = resolveBrandTokens({ preset, brand });
  assertNoGreg(tokens, "resolved speaker brand");
  const planDir = path.join(folder, "work", "plans");
  const files = opts.plan ? [path.resolve(folder, opts.plan)] : fs.existsSync(planDir)
    ? fs.readdirSync(planDir).filter((f) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/.test(f) && (!opts.version || f === `${opts.version}.json`)).sort().map((f) => path.join(planDir, f)) : [];
  if (!files.length) throw new Error(`no speaker plan found${opts.version ? ` for ${opts.version}` : ""}; create work/plans/full.json or pass --plan <file>`);
  const plans = files.map((file) => {
    if (!fs.existsSync(file)) throw new Error(`plan file not found: ${file}`);
    const plan = readJSON(file);
    if (opts.version && plan.version !== opts.version) throw new Error(`${file}: plan.version does not match --version ${opts.version}`);
    return plan;
  });
  if (new Set(plans.map((p) => p.version)).size !== plans.length) throw new Error("duplicate plan versions would overwrite the same output folder");
  for (const plan of plans) assertNoGreg(plan, "plan");
  let index;
  if (opts.renderOnly) index = loadSourceIndex(folder, manifest, { brand });
  else if (opts.planOnly) {
    index = { sources: {} };
    for (const source of manifest.sources) index.sources[source.id] = await probeSource(assetPath(folder, source.path));
  } else index = await indexImpl(folder, manifest, { brand, engine: opts.engine, language: opts.language, model: opts.model, print });
  // Validate all versions before compiling any, so a bad second plan cannot leave a misleading first draft.
  const resolvedPlans = plans.map((p) => resolvePlan(p, { manifest, index, draft: opts.draft === true }));
  const results = [];
  for (const [n, resolved] of resolvedPlans.entries()) {
    const summary = planSummary(resolved, manifest);
    print(`${summary.version}: ${summary.items} items, ${summary.frames} frames (${summary.duration.toFixed(2)}s); roles ${Object.entries(summary.roles).map(([r, d]) => `${r} ${d.toFixed(2)}s`).join(", ")}; sources ${summary.sourceIds.join(", ") || "none"}; proof ${summary.proofIds.join(", ") || "none"}`);
    for (const p of summary.problems) print(`WARNING ${p.id}: ${p.message}`);
    if (opts.planOnly) { results.push({ summary, resolvedPlan: resolved }); continue; }
    const workDir = ensureDir(path.join(folder, "work", resolved.version));
    writeJSON(path.join(workDir, "preset.resolved.json"), preset);
    writeJSON(path.join(workDir, "brand.resolved.json"), tokens);
    fs.writeFileSync(path.join(workDir, "brand.css"), tokensCSS(tokens));
    const compiled = await compileImpl(folder, plans[n], { manifest, index, preset, tokens, draft: opts.draft === true });
    const loudness = await loudnessImpl(compiled.base);
    print(`${resolved.version}: base ${compiled.base}; ${compiled.resolvedPlan.duration.toFixed(2)}s; ${loudness.i ?? "unmeasurable"} LUFS, ${loudness.tp ?? "unmeasurable"} dBTP`);
    writeJSON(path.join(workDir, "loudness.json"), loudness);
    const reviewDir = ensureDir(path.join(folder, "review"));
    const warnings = compiled.resolvedPlan.problems.filter((p) => p.level === "warn");
    writeJSON(path.join(reviewDir, `${resolved.version}.warnings.json`), { version: resolved.version, draft: opts.draft === true, warnings });
    fs.writeFileSync(path.join(reviewDir, `${resolved.version}.warnings.txt`), warnings.length ? "DRAFT — NOT CLEARED FOR DELIVERY\n" + warnings.map((p) => `WARNING ${p.id}: ${p.message}`).join("\n") + "\n" : "No rights or compilation warnings. Client approval and final QC are still required.\n");
    // Guard the editable input as well as the resolved plan when approval is recorded.
    fs.copyFileSync(files[n], path.join(workDir, "speaker-plan.json"));
    const composition = await composeImpl(workDir, compiled.resolvedPlan, { manifest, preset, tokens, captions: opts.captions, print });
    for (const warning of composition.warnings || []) compiled.resolvedPlan.problems.push(warning);
    let output, qc, review;
    if (composition.projectDir) {
      compiled.resolvedPlan.composition = { captions: composition.captions, cardProblems: composition.cardProblems || [] };
      output = path.join(workDir, "draft.mp4");
      print(`${resolved.version}: rendering client cards${composition.captions ? " and captions" : ""}`);
      await renderImpl(composition.projectDir, output, { quality: "delivery", fps: resolved.canvas.fps });
      if (!await normalizeImpl(output)) print("WARNING delivery loudness normalization failed; check QC before approval");
      qc = await qcImpl(output, { resolvedPlan: compiled.resolvedPlan, manifest, captionFiles: { srt: path.join(workDir, "captions.srt"), vtt: path.join(workDir, "captions.vtt") } });
      writeQC(workDir, qc);
      print(`${resolved.version}: quality checks ${qc.ok ? "passed" : "need attention"}`);
      review = await reviewImpl(folder, { version: resolved.version, video: { [composition.captions ? "open" : "clean"]: output }, resolvedPlan: compiled.resolvedPlan, manifest, qc: qcImpl });
      // Changes to the original hand-edited plan must invalidate approval, too.
      const { registerReview } = await import("./speaker-deliver.mjs");
      registerReview(folder, resolved.version, { planPath: path.join(workDir, "plan.resolved.json"), revision: resolved.revision,
        files: [...review.state.files, { path: path.relative(folder, files[n]), kind: "guard", delivery: false }] });
      print(`Review page: ${review.index}`);
    }
    results.push({ ...compiled, composition, output, qc, review, loudness, summary });
  }
  return results;
}

export function parseSpeakerArgs(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: "boolean", short: "h" }, "add-new": { type: "boolean" }, version: { type: "string" }, plan: { type: "string" },
    "plan-only": { type: "boolean" }, "render-only": { type: "boolean" }, draft: { type: "boolean" }, captions: { type: "boolean" },
    engine: { type: "string" }, language: { type: "string" }, model: { type: "string" }, source: { type: "string" }, replan: { type: "boolean" }, by: { type: "string" },
  } });
  if (values.help || !positionals.length) return { help: true };
  const commands = ["init", "index", "candidates", "reactions", "plan", "draft", "comments", "approve", "deliver", "status"];
  // "reel speaker plan" with no other argument is the client folder ./plan when it exists, not the command.
  const explicit = commands.includes(positionals[0]) && !(positionals.length === 1 && fs.existsSync(positionals[0]));
  const command = explicit ? positionals.shift() : "draft";
  if (positionals.length !== (command === "comments" ? 2 : 1)) throw new Error(`speaker ${command} requires one client folder${command === "comments" ? " and one comments file" : ""}; use reel speaker --help`);
  if (values.version && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(values.version)) throw new Error("speaker --version must be a safe folder name");
  if (["plan", "comments", "approve", "deliver"].includes(command) && !values.version) throw new Error(`speaker ${command} requires --version`);
  if (command === "approve" && !values.by?.trim()) throw new Error("speaker approve requires --by with the client's approver name");
  for (const [flag, allowed] of [["add-new", ["init"]], ["source", ["candidates", "reactions"]], ["replan", ["plan"]], ["by", ["approve"]]]) {
    if (values[flag] != null && !allowed.includes(command)) throw new Error(`--${flag} is only available with reel speaker ${allowed.join(" or ")}`);
  }
  if (values["plan-only"] && values["render-only"]) throw new Error("choose either --plan-only or --render-only");
  return { command, folder: positionals[0], file: positionals[1], options: { ...values, draft: explicit && command === "draft" || values.draft === true,
    indexOnly: command === "index", planOnly: values["plan-only"], renderOnly: values["render-only"] } };
}

/** Detectors only suggest; neither shots nor reaction scores create editorial truth. */
export async function analyzeSpeaker(folder, { source, reactionsOnly = false } = {}, { reactions: react = findReactions, shots = shotCandidates, candidates = findCandidates, print = log, ask } = {}) {
  folder = path.resolve(folder);
  const { manifest, problems } = loadManifest(folder); errors(problems); assertNoGreg(manifest, "manifest");
  const brand = readJSON(assetPath(folder, manifest.brand.file)); assertNoGreg(brand, "brand");
  const index = loadSourceIndex(folder, manifest, { brand });
  const selected = manifest.sources.filter((s) => !source || s.id === source);
  if (!selected.length) throw new Error(`speaker: unknown sourceId ${source}`);
  const words = {}, lines = {}, envelope = {}, reactions = {}, sourceShots = {}, sources = [];
  const rights = new Map(manifest.rights.map((r) => [r.id, r.status]));
  for (const s of selected) {
    const row = index.sources[s.id], file = assetPath(folder, s.path);
    reactions[s.id] = row.hasAudio && s.audio === "ok" ? await react(file, { sourceId: s.id, workDir: path.join(folder, "work"), key: row.key, log: print }) : [];
    print(`${s.id}: ${reactions[s.id].length} reaction suggestions; verify each in context`);
    if (reactionsOnly) continue;
    let observations = [];
    if (row.hasVideo) observations = await shots(file, { meta: row, log: print });
    sourceShots[s.id] = observations;
    writeJSON(path.join(folder, "work", "index", `${row.key}.shots.json`), { sourceId: s.id, shots: observations });
    words[s.id] = row.words.map((w, i) => ({ ...w, id: `${s.id}-w${i}`, sourceId: s.id }));
    lines[s.id] = row.lines; envelope[s.id] = row.envelope;
    sources.push({ ...s, duration: row.duration, rightsStatus: rights.get(s.rights) });
  }
  if (reactionsOnly) return reactions;
  const list = await candidates({ sources, words, lines, envelope, reactions, brief: manifest.brief, ...(ask ? { ask } : {}) });
  for (const c of list) for (const entry of [c, ...(c.alternates || [])]) {
    entry.shots = (sourceShots[entry.sourceId] || []).filter((shot) => shot.start < entry.out && shot.end > entry.in);
  }
  // A --source refresh preserves the other talks' candidates.
  const allFile = path.join(folder, "work", "candidates", "all.json");
  const prior = source && fs.existsSync(allFile) ? readJSON(allFile).flatMap((c) => [c, ...(c.alternates || [])]).filter((c) => c.sourceId !== source).map((c) => ({ ...c, alternates: [] })) : [];
  const file = writeCandidates(folder, [...prior, ...list]);
  if (list.length) print(describeCandidates(list));
  print(`${list.length} candidates saved: ${file}`);
  return list;
}

export async function speakerMain(argv, deps = {}) {
  const parsed = parseSpeakerArgs(argv), print = deps.print || log;
  if (parsed.help) return print(SPEAKER_HELP);
  const { command, folder, file, options } = parsed;
  if (command === "init") {
    const result = (deps.init || initManifest)(folder, { addNew: options["add-new"] === true });
    print(`speaker manifest: ${result.added} files added; ${result.file}`); return result;
  }
  if (command === "status") { const result = (deps.status || speakerStatus)(path.resolve(folder)); print(result); return result; }
  if (command === "candidates" || command === "reactions") return (deps.analyze || analyzeSpeaker)(folder, { source: options.source, reactionsOnly: command === "reactions" }, deps);
  if (command === "plan") {
    const { manifest, problems } = loadManifest(folder); errors(problems); assertNoGreg(manifest, "manifest");
    const candidateFile = path.join(folder, "work", "candidates", "all.json");
    const result = (deps.plan || writeStarterPlan)(folder, manifest, fs.existsSync(candidateFile) ? readJSON(candidateFile) : [], options);
    print(`Editable plan: ${result.file}`); for (const note of result.plan.notes) print(note); return result;
  }
  if (command === "comments") {
    const result = (deps.comments || writeRevision)(folder, options.version, fs.readFileSync(file, "utf8"));
    print(`${options.version}: comments recorded; edit the plan and build a revised draft`); return result;
  }
  if (command === "approve") {
    const result = await (deps.approve || approve)(folder, options.version, { by: options.by, at: new Date().toISOString() });
    print(`${options.version}: approved by ${options.by}`); return result;
  }
  if (command === "deliver") {
    const result = await (deps.deliver || deliver)(folder, options.version);
    print(`Approved files delivered: ${result.dir}`); return result;
  }
  return (deps.run || runSpeaker)(folder, options, deps);
}

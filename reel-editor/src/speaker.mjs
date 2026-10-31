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

export const SPEAKER_HELP = `reel speaker: assemble a client's speaker reel from an explicit multi-recording plan

  reel speaker init <folder> [--add-new]
  reel speaker index <folder> [--engine auto|faster-whisper|elevenlabs|hyperframes] [--language en]
  reel speaker <folder> [--version full] [--plan <file>] [--plan-only] [--render-only] [--draft]

Plans live at work/plans/<version>.json. Without --version, compile every plan found there.
--plan-only validates and prints a summary without ASR or rendering.
--render-only uses the saved source index and makes no transcription calls.
--draft permits pending/unknown rights and writes conspicuous review warnings.
Without --draft, every used source and proof item must have approved rights.
Outputs stay under work/ and review/. This command never delivers or publishes.
Card composition, music and final review/QC plug into composeSpeaker(); base compilation is available now.
`;

function errors(problems) {
  const fatal = problems.filter((p) => p.level === "error");
  if (fatal.length) throw new Error(fatal.map((p) => `${p.id}: ${p.message}`).join("\n"));
}

/** Clear integration boundary: the card/composition builder can replace this or inject its implementation. */
export async function composeSpeaker(workDir, resolvedPlan, { preset, tokens } = {}) {
  assertNoGreg({ resolvedPlan, preset, tokens }, "speaker composition");
  return { base: path.join(workDir, "base.mp4") };
}

export function planSummary(resolved, manifest) {
  const usage = planUsage(resolved, manifest), roles = {};
  for (const i of resolved.items) roles[i.role] = (roles[i.role] || 0) + i.frames / resolved.canvas.fps;
  return { version: resolved.version, items: resolved.items.length, duration: resolved.duration, frames: resolved.frames, roles, ...usage, problems: resolved.problems };
}

/** No plan selection, publish routes or client approval state is inferred here. */
export async function runSpeaker(folder, opts = {}, { index: indexImpl = indexSources, compile: compileImpl = compileVersion, compose: composeImpl = composeSpeaker, loudness: loudnessImpl = measureLoudness, print = log } = {}) {
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
    ? fs.readdirSync(planDir).filter((f) => f.endsWith(".json") && (!opts.version || f === `${opts.version}.json`)).sort().map((f) => path.join(planDir, f)) : [];
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
    const composition = await composeImpl(workDir, compiled.resolvedPlan, { preset, tokens });
    results.push({ ...compiled, composition, loudness, summary });
  }
  return results;
}

export async function speakerMain(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: "boolean", short: "h" }, "add-new": { type: "boolean" }, version: { type: "string" }, plan: { type: "string" },
    "plan-only": { type: "boolean" }, "render-only": { type: "boolean" }, draft: { type: "boolean" },
    engine: { type: "string" }, language: { type: "string" }, model: { type: "string" },
  } });
  if (values.help || !positionals.length) return console.log(SPEAKER_HELP);
  const sub = ["init", "index"].includes(positionals[0]) ? positionals.shift() : null;
  if (positionals.length !== 1) throw new Error("speaker requires exactly one client folder; use reel speaker --help");
  if (sub === "init") {
    const result = initManifest(positionals[0], { addNew: values["add-new"] === true });
    log(`speaker manifest: ${result.added} files added; ${result.file}`);
    return result;
  }
  if (values["add-new"]) throw new Error("--add-new is only available with reel speaker init");
  return runSpeaker(positionals[0], { ...values, indexOnly: sub === "index", planOnly: values["plan-only"], renderOnly: values["render-only"] });
}

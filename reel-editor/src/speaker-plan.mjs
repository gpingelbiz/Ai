import fs from "node:fs";
import path from "node:path";
import { writeJSON, ensureDir } from "./util.mjs";
import { audioQualityRank } from "./speaker-audio-quality.mjs";

/** Equivalent performances keep the editorial score within ten points before audio breaks the tie. */
export function preferredAudioCandidates(candidates, eligible = () => true) {
  const compare = (a, b) => audioQualityRank(b.audioQuality) - audioQualityRank(a.audioQuality) || (b.score || 0) - (a.score || 0) || a.sourceId.localeCompare(b.sourceId) || a.in - b.in || String(a.id).localeCompare(String(b.id));
  return candidates.flatMap((c) => {
    const group = [c, ...(c.alternates || [])].filter((a) => a.audioQuality?.label !== "reject" && eligible(a));
    const best = Math.max(...group.map((a) => a.score || 0));
    const chosen = group.filter((a) => (a.score || 0) >= best - 10).sort(compare)[0];
    return chosen ? [chosen] : [];
  }).sort(compare);
}

export const SECTION_BUDGETS = {
  // Lane 12 (Max Partain benchmark): a 2-minute core, a quick opening and identity, 6 readable booking seconds.
  full: { opening: 10, identity: 8, proof: 20, core: 120, room: 40, close: 6, booking: 6 },
  short: { opening: 5, identity: 4, proof: 6, core: 30, room: 6, close: 3, booking: 6 },
  teaser: { opening: 3, identity: 3, proof: 4, core: 12, room: 0, close: 3, booking: 5 },
};

/** Budgets select complete source passages; they never authorize shortening a story or padding a reel. */
export function starterPlan(manifest, candidates = [], { version = "full" } = {}) {
  const budgets = SECTION_BUDGETS[version];
  if (!budgets) throw new Error(`speaker plan: unsupported starter version ${version}`);
  const plan = { schemaVersion: 1, clientId: manifest.clientId, version, revision: 1,
    canvas: { width: 1920, height: 1080, fps: 30 }, sectionBudgets: { ...budgets },
    targetSeconds: Object.values(budgets).reduce((a, b) => a + b, 0), items: [], overlays: [], cutaways: [], notes: [] };
  const sources = new Map(manifest.sources.map((s) => [s.id, s]));
  const rights = new Map(manifest.rights.map((r) => [r.id, r.status]));
  const eligible = (c) => sources.get(c.sourceId)?.audio === "ok"
    && Number.isFinite(c.in) && Number.isFinite(c.out) && c.in >= 0 && c.out > c.in;
  const used = [];
  const free = (c) => !used.some((u) => u.sourceId === c.sourceId && u.in < c.out && u.out > c.in);
  const add = (item) => { const result = { id: `i${String(plan.items.length + 1).padStart(2, "0")}`, ...item }; plan.items.push(result); return result; };
  const clip = (c, role) => { used.push(c);
    if (c.audioQuality?.label === "weak") plan.notes.push(`${role}: weak audio from ${c.sourceId} (${c.id}); audition and review cleaner performances.`);
    return add({ kind: "clip", sourceId: c.sourceId, in: c.in, out: c.out, role, fit: "contain", audio: "source", protect: ["core", "room", "testimonial"].includes(role), note: `Candidate ${c.id}; verify source context.` }); };
  // A complete core story may run past its budget (Renée's runs 140 s); it is never cut to fit.
  const limit = (role) => role === "core" && version === "full" ? Math.max(budgets.core, 150) : budgets[role];
  const pick = (role, kinds) => preferredAudioCandidates(candidates, (c) => eligible(c) && free(c) && kinds.includes(c.kind) && c.out - c.in <= limit(role) + 1e-6)[0];
  // Reserve the best complete core before choosing a potentially overlapping opening.
  const core = pick("core", ["story", "origin", "teaching", "demonstration", ...(version === "full" ? [] : ["one_liner"])]);
  if (core) used.push(core);
  const opening = pick("opening", ["one_liner"]);
  if (opening) clip(opening, "opening"); else plan.notes.push("opening omitted: no unused complete one-liner fits the section budget.");
  add({ kind: "card", duration: Math.min(4, budgets.identity), role: "identity", card: { type: "title" } });
  // Put the supplied name on screen within the first three seconds even with a longer opening.
  if (opening) plan.overlays.push({ id: "o-title", at: plan.items[0].id, offset: 0, duration: Math.min(4, opening.out - opening.in), card: { type: "title" } });
  const testimonialBudget = budgets.room || budgets.proof;
  // Manifest testimonials can share an exact measured candidate range; do not bypass a measured reject.
  const measuredProof = (p) => ({ ...p, audioQuality: p.audioQuality || candidates.flatMap((c) => [c, ...(c.alternates || [])]).find((c) => c.sourceId === p.sourceId && c.in === p.in && c.out === p.out)?.audioQuality });
  const testimonial = (manifest.proof || []).map(measuredProof).find((p) => p.kind === "testimonial-video" && p.audioQuality?.label !== "reject" && p.attribution?.name && rights.get(p.rights) === "approved"
    && rights.get(sources.get(p.sourceId)?.rights) === "approved" && sources.get(p.sourceId)?.audio === "ok" && Number.isFinite(p.in) && Number.isFinite(p.out)
    && p.in >= 0 && p.out - p.in >= 4 && p.out - p.in <= testimonialBudget && free(p));
  const addTestimonial = (role) => {
    const item = clip(testimonial, role); item.proofId = testimonial.id;
    plan.overlays.push({ id: "o-testimonial", at: item.id, offset: 0, duration: Math.min(4, testimonial.out - testimonial.in), card: { type: "testimonial-name", proofId: testimonial.id } });
  };
  const quote = (manifest.proof || []).find((p) => p.kind === "quote" && rights.get(p.rights) === "approved" && p.attribution?.name && p.text?.trim() && p.text.trim().split(/\s+/).length <= 25);
  if (!budgets.room && testimonial) addTestimonial("proof");
  else if (quote && budgets.proof >= 5) add({ kind: "card", duration: Math.min(8, budgets.proof), role: "proof", card: { type: "quote", proofId: quote.id } });
  else plan.notes.push("proof omitted: no approved attributed proof fits; add cleared proof by hand.");
  if (core) clip(core, "core"); else plan.notes.push("core omitted: no complete story or teaching passage fits; select a complete shorter passage by hand.");
  if (budgets.room && testimonial) addTestimonial("testimonial");
  else if (!testimonial) plan.notes.push("room/testimonial omitted: no approved named testimonial fits; reactions stay with their original moment and require manual verification.");
  const close = pick("close", ["one_liner"]);
  if (close) clip(close, "close"); else plan.notes.push("close omitted: no unused complete closing line fits.");
  add({ kind: "card", duration: budgets.booking, role: "booking", card: { type: "booking" } });
  return plan;
}

export function writeStarterPlan(folder, manifest, candidates, { version = "full", replan = false } = {}) {
  const plan = starterPlan(manifest, candidates, { version });
  const dir = ensureDir(path.join(folder, "work", "plans")), file = path.join(dir, `${version}.json`);
  if (fs.existsSync(file)) {
    if (!replan) throw new Error(`speaker plan ${version} already exists; edit it or use --replan`);
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    let n = Number.isInteger(old.revision) ? old.revision : 1;
    while (fs.existsSync(path.join(dir, `${version}.r${n}.json`))) n++;
    fs.copyFileSync(file, path.join(dir, `${version}.r${n}.json`));
    plan.revision = n + 1;
  }
  writeJSON(file, plan);
  return { file, plan };
}

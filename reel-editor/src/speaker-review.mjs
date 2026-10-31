import fs from "node:fs";
import path from "node:path";
import { run, readJSON, writeJSON, PKG_ROOT } from "./util.mjs";
import { resolveBrandTokens, tokensCSS } from "./brandtokens.mjs";
import { srtText } from "./chapters.mjs";
import { outputSpan, planDuration, usedAssets, rightsChecks, identityProblems, speakerQC, writeQC } from "./speaker-qc.mjs";
import { registerReview, recordRevision, reviewState } from "./speaker-deliver.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeVersion = (v) => { if (!/^[a-z0-9][a-z0-9_-]*$/i.test(v || "")) throw new Error(`speaker version: invalid ${v}`); return v; };
const codeFor = (version, id) => `${version.toUpperCase()}-${id}`;

export function reviewTime(seconds) {
  const ticks = Math.round(seconds * 10);
  return `${Math.floor(ticks / 600)}:${String(Math.floor(ticks % 600 / 10)).padStart(2, "0")}.${ticks % 10}`;
}

function cardText(card = {}, manifest) {
  const identity = manifest.identity || {}, proof = (manifest.proof || []).find((p) => p.id === card.proofId);
  switch (card.type) {
    case "title": return [card.name ?? identity.name, card.roleLine ?? identity.roleLine, card.tagline ?? identity.tagline].filter(Boolean).join(" · ");
    case "booking": {
      const bureau = (card.mode || identity.bookingMode) === "bureau";
      return [card.name ?? identity.name, card.roleLine ?? identity.roleLine, card.text ?? identity.bookingText,
        ...(bureau ? [card.bureauName ?? identity.bureau?.name, card.url ?? identity.bureau?.url] : [card.url ?? identity.bookingUrl, card.email ?? identity.email, card.phone ?? identity.phone])].filter(Boolean).join(" · ");
    }
    case "testimonial-name": return Object.values(proof?.attribution || { name: card.name, title: card.title, org: card.org }).filter(Boolean).join(" · ");
    case "quote": return [proof?.text ?? card.text, ...Object.values(proof?.attribution || { name: card.name, title: card.title, org: card.org })].filter(Boolean).join(" · ");
    case "logo-wall": return [card.heading, ...(card.logos || [])].filter(Boolean).join(" · ");
    default: return card.text || "";
  }
}

/** A row for every timeline event, including picture-only cutaways and overlays which add no duration. */
export function reviewRows(plan, manifest, words = []) {
  const rows = [];
  for (const [kind, entries] of [["item", plan.items || []], ["overlay", plan.overlays || []], ["cutaway", plan.cutaways || []]]) {
    for (const item of entries) {
      if (!/^[a-z0-9_-]+$/i.test(item.id || "")) throw new Error(`speaker item: invalid ID ${item.id}`);
      if (item.sourceId && (!Number.isFinite(item.in) || !Number.isFinite(item.out) || item.in < 0 || item.out <= item.in)) throw new Error(`speaker item ${item.id}: invalid source in/out`);
      const { start, end } = outputSpan(item), parent = plan.items.find((i) => i.id === (item.at || item.over));
      const source = (manifest.sources || []).find((s) => s.id === item.sourceId);
      if (item.sourceId && !source) throw new Error(`speaker item ${item.id}: unknown sourceId ${item.sourceId}`);
      const proof = item.card?.proofId ? (manifest.proof || []).find((p) => p.id === item.card.proofId) : null;
      const found = words.filter((w) => w.start >= start && w.start < end && (!item.sourceId || w.sourceId === item.sourceId)).map((w) => w.text ?? w.word ?? "");
      const excerpt = found.length > 35 ? `${found.slice(0, 25).join(" ")} … ${found.slice(-10).join(" ")}` : found.join(" ");
      const rowRights = rightsChecks({ items: [item] }, manifest);
      const status = rowRights.some((r) => r.status === "unknown" || r.level === "fail") ? "unknown" : rowRights.some((r) => r.status !== "approved") ? "pending" : "approved";
      rows.push({ id: item.id, code: codeFor(plan.version, item.id), kind: kind === "item" ? item.kind : kind, start, end,
        role: item.role || parent?.role || kind, sourceId: item.sourceId || proof?.sourceId || null,
        source: source ? path.basename(source.path) : "", sourceIn: item.in, sourceOut: item.out,
        text: item.card ? cardText(item.card, manifest) : "", transcript: item.kind === "clip" ? excerpt : "", rights: status });
    }
  }
  if (new Set(rows.map((r) => r.code.toLowerCase())).size !== rows.length) throw new Error("speaker review: duplicate comment codes");
  return rows.sort((a, b) => a.start - b.start || a.code.localeCompare(b.code));
}

/** Returns {comments, problems}. Pass the plan to resolve timestamps and reject unknown event codes. */
export function parseComments(text, { version, resolvedPlan } = {}) {
  const plan = resolvedPlan, comments = [], problems = [];
  version ||= plan?.version;
  const entries = plan ? [...plan.items, ...(plan.overlays || []), ...(plan.cutaways || [])] : null;
  for (const [index, raw] of String(text || "").split(/\r?\n/).entries()) {
    const line = raw.trim().replace(/^[-*]\s+|^\d+[.)]\s+/, "");
    if (!line) continue;
    const problem = (reason) => problems.push({ line: index + 1, text: raw, reason });
    const coded = line.match(/^([a-z0-9_-]+)-([a-z][a-z0-9_-]*)\s*:\s*(.+)$/i);
    const timed = line.match(/^((?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?)\s*[:\-]?\s+(.+)$/);
    if (coded) {
      // Prefer the known prefix, since versions and IDs can both contain hyphens.
      let id = coded[2], code = `${coded[1].toUpperCase()}-${id}`;
      if (version && line.toLowerCase().startsWith(`${version.toLowerCase()}-`)) {
        id = line.slice(version.length + 1, line.indexOf(":")).trim(); code = codeFor(version, id);
      } else if (version) { problem("code belongs to another version"); continue; }
      const item = entries?.find((i) => i.id.toLowerCase() === id.toLowerCase());
      if (entries && !item) { problem(`unknown comment code ${code}`); continue; }
      comments.push({ code: item ? codeFor(version, item.id) : code, itemId: item?.id || id, at: item ? outputSpan(item).start : null, text: coded[3].trim() });
    } else if (timed) {
      const parts = timed[1].split(":").map(Number);
      if (parts.at(-1) >= 60 || (parts.length === 3 && parts[1] >= 60)) { problem("invalid timecode"); continue; }
      const at = parts.reduce((sum, n) => sum * 60 + n, 0);
      const item = plan?.items.find((i) => { const span = outputSpan(i); return at >= span.start && at < span.end; });
      if (!item) { problem(plan ? "timecode outside the timeline" : "timecode requires a resolved plan"); continue; }
      comments.push({ code: codeFor(version, item.id), itemId: item.id, at, text: timed[2].trim() });
    } else problem("expected VERSION-item: comment or m:ss comment");
  }
  return { comments, problems };
}

export function writeRevision(folder, version, comments) {
  safeVersion(version);
  const planFile = path.join(folder, "work", version, "plan.resolved.json");
  const plan = readJSON(planFile);
  const parsed = typeof comments === "string" ? parseComments(comments, { version, resolvedPlan: plan }) : Array.isArray(comments) ? { comments, problems: [] } : comments;
  if (!parsed?.comments || !Array.isArray(parsed.problems || [])) throw new Error(`speaker ${version}: expected parsed comments or text`);
  return recordRevision(folder, version, parsed.comments, parsed.problems || []);
}

async function grabFrame({ video, time, file, width = 480 }) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(time), "-i", video, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3", file], { capture: true });
  if (!fs.existsSync(file)) throw new Error(`speaker review: no frame at ${time}s in ${video}`);
}

function reviewBrand(folder, manifest, dir) {
  if (!manifest.brand?.file) throw new Error("speaker review: client brand.file is required");
  const file = path.resolve(folder, manifest.brand.file), brand = readJSON(file);
  if (!(brand.type?.display || brand.fonts?.display) || !(brand.type?.body || brand.fonts?.body) || !(brand.colors?.ink || brand.colors?.text) || !(brand.colors?.surface || brand.colors?.bg) || !brand.colors?.accent) throw new Error("speaker review: client brand must supply display/body fonts and ink/surface/accent colours");
  const tokens = resolveBrandTokens({ brand });
  const bad = identityProblems(tokens);
  if (bad.length) throw new Error(`speaker review: forbidden Greg identity in brand at ${bad.join(", ")}`);
  // Copy installed local fonts. Named fonts without a local file keep their authored family and browser fallback.
  for (const [name, role] of Object.entries(tokens.type || {})) {
    if (!role?.file) continue;
    const found = [path.resolve(path.dirname(file), role.file), path.resolve(folder, role.file), path.resolve(PKG_ROOT, role.file)].find((p) => fs.existsSync(p));
    if (!found) { console.log(`[reel] speaker review: optional ${name} font unavailable`); role.file = null; continue; }
    const rel = `fonts/${name}${path.extname(found)}`;
    fs.mkdirSync(path.join(dir, "fonts"), { recursive: true });
    fs.copyFileSync(found, path.join(dir, rel)); role.file = rel;
  }
  return tokensCSS(tokens).replace(/<\/style/gi, "<\\/style");
}

/** video is a clean path or {clean, open}; onScreen may supply the open-caption render path. */
export async function buildReview(folder, { version, video, resolvedPlan, manifest, onScreen, frameGrab = grabFrame, qc = speakerQC } = {}) {
  folder = path.resolve(folder); safeVersion(version);
  const plan = typeof resolvedPlan === "string" ? readJSON(resolvedPlan) : resolvedPlan;
  manifest = typeof manifest === "string" ? readJSON(manifest) : manifest || readJSON(path.join(folder, "speaker-manifest.json"));
  if (plan.clientId && manifest.clientId !== plan.clientId) throw new Error(`speaker review: plan client ${plan.clientId} does not match manifest ${manifest.clientId}`);
  if (plan.version !== version) throw new Error(`speaker review: plan version ${plan.version} does not match ${version}`);
  if (!Number.isInteger(plan.revision) || plan.revision < 1) throw new Error("speaker review: positive integer revision required");
  const identity = [...identityProblems(plan), ...identityProblems(manifest)];
  if (identity.length) throw new Error(`speaker review: forbidden Greg identity at ${identity.join(", ")}`);
  const dir = path.join(folder, "review", `${version}-r${plan.revision}`), work = path.join(folder, "work", version);
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const planPath = path.join(work, "plan.resolved.json");
  writeJSON(planPath, plan);
  const wordFile = path.join(work, "words.json"), wordData = fs.existsSync(wordFile) ? readJSON(wordFile) : [];
  const words = Array.isArray(wordData) ? wordData : wordData.words || [];
  const rows = reviewRows(plan, manifest, words), css = reviewBrand(folder, manifest, dir), files = [];
  const variants = typeof video === "string" ? { clean: video, ...(typeof onScreen === "string" ? { open: onScreen } : {}) } : video;
  if (!variants?.clean && !variants?.open) throw new Error(`speaker ${version}: a rendered draft video is required`);
  for (const [variant, input] of Object.entries(variants)) {
    if (!["clean", "open"].includes(variant) || !input) continue;
    const original = path.resolve(folder, input), dest = path.join(dir, `draft-${variant}.mp4`);
    if (original !== dest) fs.copyFileSync(original, dest);
    files.push({ path: path.relative(folder, dest), kind: "video", variant, delivery: true });
    if (original !== dest) files.push({ path: path.relative(folder, original), kind: "guard", delivery: false });
  }
  const primary = path.join(folder, files.find((f) => f.kind === "video").path);
  // Reuse existing corrected sidecars, otherwise derive them from output-time words without rewriting speech.
  const groups = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start).map((w) => ({ start: w.start, end: w.end, text: w.text ?? w.word ?? "", words: [w] }));
  const srt = fs.existsSync(path.join(work, "captions.srt")) ? fs.readFileSync(path.join(work, "captions.srt"), "utf8") : srtText(groups);
  for (const [kind, content] of [["srt", srt], ["vtt", `WEBVTT\n\n${srt.replace(/^(\d+)\s*$/gm, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2").trim()}\n`]]) {
    const source = path.join(work, `captions.${kind}`), dest = path.join(dir, `captions.${kind}`);
    fs.writeFileSync(dest, fs.existsSync(source) ? fs.readFileSync(source) : content);
    files.push({ path: path.relative(folder, dest), kind, delivery: true });
    if (fs.existsSync(source)) files.push({ path: path.relative(folder, source), kind: "guard", delivery: false });
  }
  for (const row of rows) {
    row.frame = `frames/${row.id}.jpg`;
    await frameGrab({ video: primary, time: (row.start + row.end) / 2, file: path.join(dir, row.frame), width: 480 });
  }
  const poster = path.join(dir, "poster.jpg");
  await frameGrab({ video: primary, time: (rows[0].start + rows[0].end) / 2, file: poster, width: plan.canvas.width });
  files.push({ path: path.relative(folder, poster), kind: "poster", delivery: true });
  const result = await qc(primary, { resolvedPlan: plan, manifest, captionFiles: { srt: path.join(dir, "captions.srt"), vtt: path.join(dir, "captions.vtt") } });
  writeQC(dir, result);
  const used = usedAssets(plan, manifest), roles = {};
  for (const item of plan.items) roles[item.role] = (roles[item.role] || 0) + 1;
  const warnings = [...result.checks.filter((c) => c.level !== "pass"), ...rightsChecks(plan, manifest).filter((c) => c.level !== "pass")];
  const warningsUnique = [...new Set(warnings.map((c) => c.message))];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(manifest.identity.name)} — ${esc(version)} review</title><style>
${css}
*{box-sizing:border-box}body{margin:0;padding:20px;background:var(--brand-surface);color:var(--brand-ink);font:16px/1.5 var(--brand-body-font)}main{max-width:1100px;margin:auto}h1,h2{font-family:var(--brand-display-font)}a{color:var(--brand-accent)}video{width:100%;max-height:70vh}article{display:grid;grid-template-columns:minmax(200px,36%) 1fr;gap:20px;padding:22px 0;border-top:1px solid var(--brand-muted)}img{width:100%;height:auto}code{font-weight:bold;color:var(--brand-accent)}.flag{color:#ff6666;font-weight:bold}.meta{color:var(--brand-muted)}p{overflow-wrap:anywhere}li{margin-bottom:8px}@media(max-width:650px){body{padding:14px}article{grid-template-columns:1fr;gap:8px}}
</style></head><body><main><h1>${esc(manifest.identity.name)} — ${esc(version)} r${plan.revision}</h1>
<p>Send one consolidated list using a comment code or timecode: <code>${esc(version.toUpperCase())}-i07: cut the last sentence</code> or <code>1:42 make the logo bigger</code>.</p>
${files.filter((f) => f.kind === "video").map((f) => `<h2>${esc(f.variant)} captions</h2><video controls playsinline preload="metadata" poster="poster.jpg"><source src="${esc(path.basename(f.path))}" type="video/mp4"><track kind="captions" src="captions.vtt" srclang="en" label="English" default></video>`).join("\n")}
<h2>Summary</h2><p>${reviewTime(planDuration(plan))} · ${plan.items.length} items · ${used.sourceIds.length} sources · ${used.proofIds.length} proof items · ${warningsUnique.length} warnings</p><p>${esc(Object.entries(roles).map(([r, n]) => `${r}: ${n}`).join(" · "))}</p><p>Sources: ${esc(used.sourceIds.join(", ") || "none")}<br>Proof: ${esc(used.proofIds.join(", ") || "none")}</p>
${warningsUnique.length ? `<ul class="flag">${warningsUnique.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
<h2>Timeline</h2>${rows.map((row) => `<article id="${esc(row.code)}"><a href="${esc(row.frame)}"><img src="${esc(row.frame)}" loading="lazy" alt="Frame at ${reviewTime((row.start + row.end) / 2)}"></a><div><code>${esc(row.code)}</code><p>${reviewTime(row.start)}–${reviewTime(row.end)} · ${esc(row.role)} · ${esc(row.kind)}</p>${row.source ? `<p class="meta">${esc(row.source)} · source ${reviewTime(row.sourceIn)}–${reviewTime(row.sourceOut)}</p>` : ""}${row.text ? `<p>${esc(row.text)}</p>` : ""}${row.transcript ? `<p>${esc(row.transcript)}</p>` : ""}<p class="${row.rights === "approved" ? "meta" : "flag"}">Rights: ${esc(row.rights)}</p></div></article>`).join("\n")}
<h2>Quality checks — ${result.ok ? "passed" : "needs attention"}</h2><ul>${result.checks.map((c) => `<li class="${c.level === "fail" ? "flag" : ""}">${esc(c.level.toUpperCase())}: ${esc(c.message)}</li>`).join("")}</ul></main></body></html>`;
  const index = path.join(dir, "index.html");
  fs.writeFileSync(index, html);
  registerReview(folder, version, { planPath, revision: plan.revision, files });
  return { dir, index, rows, qc: result, state: reviewState(folder, version) };
}

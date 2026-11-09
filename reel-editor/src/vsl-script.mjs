import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GRAPHICS_SCHEMA, normalizeScene, sceneDuration } from "./graphics.mjs";
import { LOOKS, skinFor, lookExclusions } from "./looks.mjs";
import { ensureDir, r3, warn, writeJSON } from "./util.mjs";

const tidy = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const tokens = (text) => String(text ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").match(/[\p{L}\p{N}]+/gu) || [];
const STOP = new Set("a an the and or of to in on at for with is it this that i you we my our your".split(" "));
const content = (text) => tokens(text).filter((word) => !STOP.has(word));

// Cues may be nested or unfinished. An unfinished cue consumes the rest of that SAY line.
function withoutCues(text) {
  let depth = 0, out = "";
  for (const char of text) {
    if (char === "[") { depth++; out += " "; }
    else if (char === "]" && depth) depth--;
    else if (!depth) out += char;
  }
  return tidy(out);
}

/** Parse CONTRACT.md's line-start labels; no client-specific vocabulary or YAML dependency. */
export function parseVslScript(markdown) {
  const lines = String(markdown).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const frontMatter = {};
  const sections = [], skippedScreens = [];
  let at = 0;
  if (lines[0]?.trim() === "---") {
    at = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (at < 0) throw new Error("VSL script has unfinished front matter");
    for (const line of lines.slice(1, at)) {
      const match = line.match(/^([\w-]+):\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2].replace(/^(["'])(.*)\1$/, "$2");
      if (/^\d+(?:\.\d+)?$/.test(value)) value = Number(value);
      frontMatter[match[1]] = value;
    }
    at++;
  }
  let section = null, fence = false;
  for (; at < lines.length; at++) {
    const line = lines[at];
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const heading = line.match(/^##\s+(S\d+[a-z]*)\s+(.+?)\s*$/i);
    if (heading) {
      section = { id: heading[1], title: heading[2], job: "", say: [], screen: [], evidence: [], notes: [] };
      sections.push(section);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) section = null;
    if (!section) continue;
    const label = line.match(/^(JOB|SAY|SCREEN|EVIDENCE|NOTE):\s*(.*)$/);
    if (!label) continue;
    const [, kind, raw] = label;
    const text = tidy(raw);
    if (kind === "SAY") section.say.push({ text: withoutCues(raw), line: at + 1 });
    else if (kind === "SCREEN" && text) {
      if (text.includes("[")) skippedScreens.push({ sectionId: section.id, line: at + 1, reason: "SCREEN contains a bracket cue or unconfirmed text" });
      else section.screen.push({ text, line: at + 1 });
    } else if (kind === "JOB") section.job = text;
    else if (kind === "NOTE") section.notes.push(text);
    else if (kind === "EVIDENCE") section.evidence.push(...text.split(/\s*,\s*/).filter(Boolean));
  }
  return { frontMatter, sections, skippedScreens };
}

function near(a, b) {
  if (a === b) return 0;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return 1;
  // A single transcription typo / inflection costs less than a replacement word.
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return 1;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1 ? 0.25 : 1;
}

// Semi-global edit distance: a SAY may start anywhere, with insertions, omissions and small misreads.
function lineCandidates(needle, heard) {
  if (!needle.length || !heard.length) return [];
  let row = heard.map((_, j) => ({ cost: 0, start: j + 1, matched: 0 }));
  row.unshift({ cost: 0, start: 0, matched: 0 });
  for (let i = 1; i <= needle.length; i++) {
    const next = [{ cost: i, start: 0, matched: 0 }];
    for (let j = 1; j <= heard.length; j++) {
      const distance = near(needle[i - 1], heard[j - 1].token);
      const options = [
        { cost: row[j - 1].cost + distance, start: row[j - 1].start, matched: row[j - 1].matched + (distance < 1 ? 1 : 0) },
        { ...row[j], cost: row[j].cost + 1 },
        { ...next[j - 1], cost: next[j - 1].cost + 0.8 },
      ];
      options.sort((a, b) => a.cost - b.cost || b.matched - a.matched || a.start - b.start);
      next.push(options[0]);
    }
    row = next;
  }
  const found = [];
  for (let end = 1; end < row.length; end++) {
    const match = row[end], score = 1 - match.cost / needle.length;
    if (score < (needle.length <= 2 ? 0.9 : 0.5) || match.matched < Math.ceil(needle.length * 0.5) || end <= match.start) continue;
    found.push({ from: match.start, to: end, score, start: heard[match.start].start, end: heard[end - 1].end });
  }
  found.sort((a, b) => b.score - a.score || b.from - a.from);
  // Keep distinct tellings, not twenty partial windows around the same telling.
  const distinct = [];
  for (const match of found) {
    if (!distinct.some((other) => match.from < other.to && match.to > other.from)) distinct.push(match);
    if (distinct.length === 24) break;
  }
  return distinct;
}

/** Monotonic SAY alignment on the final edited timeline. Skipped lines never consume later anchors. */
export function alignVslScript(script, words, { duration = Math.max(0, ...words.map((word) => word.end)) } = {}) {
  const heard = words.flatMap((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end > word.start && word.start < duration
    ? tokens(word.text).map((token) => ({ token, start: word.start, end: Math.min(duration, word.end) })) : []);
  const lines = script.sections.flatMap((section) => section.say);
  let beam = [{ to: 0, score: 0, path: [] }];
  for (const line of lines) {
    const candidates = lineCandidates(tokens(line.text), heard);
    const next = beam.flatMap((state) => [
      { ...state, score: state.score - 0.35, path: [...state.path, null] },
      ...candidates.filter((match) => match.from >= state.to).map((match) => ({ to: match.to, score: state.score + match.score, path: [...state.path, match] })),
    ]).sort((a, b) => b.score - a.score || b.to - a.to);
    const seen = new Set();
    beam = next.filter((state) => !seen.has(state.to) && seen.add(state.to)).slice(0, 64);
  }
  let index = 0;
  const aligned = script.sections.map((section) => {
    const say = section.say.map((line) => ({ ...line, ...(beam[0]?.path[index++] || { start: null, end: null, score: 0 }) }));
    const first = say.find((line) => line.start != null);
    return { ...section, say, start: first?.start ?? null };
  });
  // Entire skipped/reworded sections get an explicit estimated chapter boundary between real anchors.
  for (let i = 0; i < aligned.length; i++) {
    if (aligned[i].start != null) continue;
    const from = i - 1;
    let until = i;
    while (until < aligned.length && aligned[until].start == null) until++;
    const left = from >= 0 ? aligned[from].start : 0;
    const right = until < aligned.length ? aligned[until].start : duration;
    const weight = (section) => Math.max(1, section.say.reduce((n, line) => n + tokens(line.text).length, 0));
    const total = aligned.slice(Math.max(0, from), until).reduce((n, section) => n + weight(section), 0);
    let used = from >= 0 ? weight(aligned[from]) : 0;
    for (let j = i; j < until; j++) {
      aligned[j].start = left + (right - left) * used / total;
      aligned[j].estimated = true;
      used += weight(aligned[j]);
    }
    i = until - 1;
  }
  return aligned.map((section, i) => ({ ...section, start: r3(section.start), end: r3(aligned[i + 1]?.start ?? duration) }));
}

/** Map approved SCREEN copy to schema 2's existing card types, preserving all printed copy. */
export function screenToVslCards(text, { line = 0 } = {}) {
  text = tidy(text);
  if (!text || text.includes("[")) return [];
  const base = { source: "script", line };
  let raw;
  const items = text.split(/\s+\|\s+/);
  const quote = text.match(/^["“]([\s\S]+?)["”]\s+(?:[-–—]\s*)?(.+)$/);
  const amount = text.match(/\$\s*\d[\d,]*(?:\.\d+)?(?:[kKmMbB])?/);
  if (quote) raw = [{ ...base, type: "quote", text: quote[1], eyebrow: quote[2] }];
  else if (amount && text.split(/\s+/).length <= 6) {
    raw = [{ ...base, type: "stat", value: amount[0], sub: tidy(text.replace(amount[0], "").replace(/^\s*\|\s*|\s*\|\s*$/g, "")), motion: "reveal" }];
  } else if (items.length >= 2) {
    const numbered = items.every((item) => /^\d+\.\s+/.test(item));
    const type = numbered ? "steps" : "list";
    // Five rows fit the existing renderer. Longer lists split into balanced cards (no lost sixth row).
    const chunks = Math.ceil(items.length / 5), size = Math.ceil(items.length / chunks);
    raw = Array.from({ length: chunks }, (_, i) => ({ ...base, type, items: items.slice(i * size, (i + 1) * size).map((item) => ({ text: numbered ? item.replace(/^\d+\.\s+/, "") : item })) }));
  } else raw = [{ ...base, type: "headline", text }];
  return raw.map((card) => normalizeScene(card)).filter(Boolean);
}

function overlap(a, b) {
  const left = new Set(content(a)), right = new Set(content(b));
  if (!left.size || !right.size) return 0;
  return [...left].filter((word) => right.has(word)).length / Math.sqrt(left.size * right.size);
}

/** Pure script planner; clipping to another card/section is allowed to make a hold shorter than 3 s. */
export function planVslGraphics({ script, words, duration, groups = [], settings = {} }) {
  if (typeof script === "string") script = parseVslScript(script);
  if (!script.sections.length) throw new Error("VSL script has no ## S1 Title sections");
  const aligned = alignVslScript(script, words, { duration });
  const sections = aligned.map(({ id, title, start, end }) => ({ id, title, start, end }));
  const diagnostics = [...script.skippedScreens.map((item) => ({ ...item, code: "screen-bracket" }))];
  const excluded = lookExclusions(settings);
  const look = [settings.look, ...(settings.houseLooks || []), "glass"].find((id) => LOOKS[id] && !excluded.includes(id)) || "glass";
  const pending = [];
  for (const section of aligned) {
    if (section.estimated) diagnostics.push({ code: "section-estimated", sectionId: section.id, reason: "no SAY match; section timing estimated between transcript anchors" });
    for (const screen of section.screen) {
      const ranked = section.say.map((line) => ({ ...line, overlap: overlap(screen.text, line.text) })).sort((a, b) => b.overlap - a.overlap);
      const best = ranked[0];
      // A skipped best SAY falls back to the section, never to an unrelated spoken line.
      const cue = best?.overlap > 0 && best.start != null ? best.start : section.start;
      let start = Math.max(2, cue);
      const line = Math.max(0, groups.findLastIndex((group) => group.start <= start));
      for (const card of screenToVslCards(screen.text, { line })) {
        const hold = Math.min(7, Math.max(3, sceneDuration(card)));
        pending.push({ ...card, sectionId: section.id, scriptLine: screen.line, skin: skinFor(look, card.type), start, duration: hold, sectionEnd: section.end });
        start += hold;
      }
    }
  }
  pending.sort((a, b) => a.start - b.start || a.scriptLine - b.scriptLine);
  // Several screens may share a SAY or the section fallback. Divide the available interval for ties;
  // never move a later, distinct SAY anchor backward or leave the timeline out of order.
  for (let i = 0; i < pending.length; i++) {
    let until = i + 1;
    while (until < pending.length && pending[until].start === pending[i].start && pending[until].sectionId === pending[i].sectionId) until++;
    const end = Math.min(pending[i].sectionEnd, duration - 2.5, pending[until]?.start ?? Infinity);
    const slot = Math.max(0, (end - pending[i].start) / (until - i));
    const start = pending[i].start;
    let offset = 0;
    for (let j = i; j < until; j++) {
      pending[j].start = start + offset;
      pending[j].duration = Math.min(pending[j].duration, slot);
      offset += pending[j].duration;
    }
    i = until - 1;
  }
  const scenes = pending.flatMap((card, i) => {
    const end = Math.min(card.start + card.duration, card.sectionEnd, duration - 2.5, pending[i + 1]?.start ?? Infinity);
    if (end <= card.start) {
      diagnostics.push({ code: "screen-no-room", sectionId: card.sectionId, line: card.scriptLine, reason: "no room before the next section or protected ending" });
      return [];
    }
    const { sectionEnd, ...scene } = card;
    return [{ ...scene, start: r3(card.start), duration: r3(end - card.start) }];
  });
  scenes.schema = GRAPHICS_SCHEMA;
  return { schema: GRAPHICS_SCHEMA, source: "script", look, scenes, sections, diagnostics };
}

/** Always re-read/replan: an edited --script must replace any cached automatic or script plan. */
export function makeVslGraphics({ scriptPath, workDir, ...options }) {
  const script = parseVslScript(fs.readFileSync(scriptPath, "utf8"));
  const plan = planVslGraphics({ ...options, script });
  ensureDir(workDir);
  writeJSON(path.join(workDir, "graphics.json"), { schema: plan.schema, source: "script", script: path.resolve(scriptPath), look: plan.look, scenes: plan.scenes });
  writeJSON(path.join(workDir, "vsl-sections.json"), plan.sections);
  for (const item of plan.diagnostics) warn(`VSL ${item.sectionId}${item.line ? ` line ${item.line}` : ""}: ${item.reason}`);
  return plan;
}

// ---- Drop-folder lookup (watch-reel.sh)

const directories = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return []; }
};
const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

/** Find a VSL Builder script by project id in a dropped filename; ambiguous/missing projects return null. */
export function findVslScript(fileName, env = process.env) {
  const home = env.HOME || os.homedir();
  const configured = env.REEL_VSL_PROJECTS || path.join(home, "Clients");
  const root = configured.replace(/^~(?=\/|$)/, home);
  const name = path.basename(String(fileName || ""), path.extname(String(fileName || ""))).toLowerCase();
  const tagged = name.match(/#vsl-([a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[^a-z0-9-])/);
  const matches = [];
  for (const client of directories(root)) {
    const projects = path.join(root, client, "vsl", "projects");
    for (const id of directories(projects)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) continue;
      const at = name.indexOf(id);
      const bounded = at >= 0 && (at === 0 || !/[a-z0-9]/.test(name[at - 1])) && (at + id.length === name.length || !/[a-z0-9]/.test(name[at + id.length]));
      if (tagged ? tagged[1] === id : bounded) matches.push({ id, project: path.join(projects, id) });
    }
  }
  // Prefer the most specific id when a filename contains both a project and its prefix.
  const longest = matches.filter((m) => m.id.length === Math.max(...matches.map((x) => x.id.length)));
  if (longest.length !== 1) return null;
  const project = longest[0].project;
  const scripts = path.join(project, "04-script");
  let approvals = [];
  try { approvals = fs.readFileSync(path.join(project, "approvals.jsonl"), "utf8").split(/\r?\n/).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); } catch {}
  const final = approvals.findLast((a) => a?.stage === "final_script");
  if (typeof final?.file === "string") {
    const approved = path.resolve(project, final.file);
    // Approval paths must stay in this project's script folder.
    if (path.dirname(approved) === scripts && /^script\.v\d+\.md$/.test(path.basename(approved)) && isFile(approved)) return approved;
  }
  let versions = [];
  try { versions = fs.readdirSync(scripts).filter((f) => /^script\.v\d+\.md$/.test(f) && isFile(path.join(scripts, f))); } catch {}
  versions.sort((a, b) => Number(b.match(/v(\d+)/)[1]) - Number(a.match(/v(\d+)/)[1]));
  return versions.length ? path.join(scripts, versions[0]) : null;
}

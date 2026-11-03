import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStockSearch, makeStockClip, previewStockCandidates, stockRelevance } from "./broll-stock.mjs";
import { libraryDir, libraryClipPath, readLibrary, writeBrollCredits } from "./broll-library.mjs";
import { checkPick, subjectWords } from "./broll.mjs";
import { readJSON, log } from "./util.mjs";

export const BROLL_FILL_HELP = `Usage: reel broll-fill [--subjects <file>] [--max-new N] [--dry-run]
  --subjects <file>  JSON array of { shows, scene, action } objects or subject strings
                    (required; Pixabay and Pexels terms forbid bulk or systematic copying,
                    so fill only the subjects an upcoming reel needs)
  --max-new N        maximum new approved clips per run (default: 20)
  --dry-run          search and list preview candidates; no Claude or full downloads
`;

export function fillSubjects(value) {
  if (!Array.isArray(value)) throw new Error("subjects must be a JSON array");
  return value.map((s) => {
    const subject = typeof s === "string" ? { shows: s, scene: `A ${s} in natural daylight.`, action: `The ${s} moves gently.` } : s;
    if (!subject || ["shows", "scene", "action"].some((k) => typeof subject[k] !== "string" || !subject[k].trim())) throw new Error("each subject needs shows, scene and action");
    return { ...subject, stockQuery: subject.stockQuery || subject.shows, stockSynonyms: [], kind: "action", line: 0 };
  });
}

/** Fill uses the reel's stock inspections, but does not register a reel or change scene history. A subject tops up to 3 clips. */
export async function fillBrollLibrary({ subjects, subjectsFile, maxNew = 20, dryRun = false, settings = {}, deps = {} } = {}) {
  if (!Number.isInteger(maxNew) || maxNew < 1) throw new Error("max-new must be a positive integer");
  if (!subjects && !subjectsFile) throw new Error("broll-fill needs --subjects <file>: stock terms forbid bulk copying, so fill only what a reel needs");
  const picks = fillSubjects(subjects ?? readJSON(subjectsFile));
  const env = deps.env || process.env, logger = deps.logFn || log;
  const search = deps.search || createStockSearch({ env, fetchFn: deps.fetchFn, now: deps.now, warnFn: deps.warnFn, maxSearches: settings.stockMaxSearches ?? 20, stockCandidates: settings.stockCandidates ?? 12 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-broll-fill-")), approved = [], results = [];
  try {
    for (const pick of picks) {
      if (approved.length >= maxNew) break;
      const subject = subjectWords(pick.shows, pick.scene), bank = readLibrary(env);
      const held = bank.clips.filter((c) => libraryClipPath(c, env) && fs.existsSync(libraryClipPath(c, env)) && stockRelevance({ tags: (c.subjectWords || []).join(" ") }, subject) === "match");
      const shot = { line: 0, start: 0, duration: 1.6, text: pick.shows, shows: pick.shows, scene: pick.scene }, groups = [{ start: 0, text: pick.shows }];
      const why = held.length >= 3 ? "library already has 3 approved clips" : checkPick(pick, shot, groups, { len: shot.duration });
      if (why) {
        results.push({ shows: pick.shows, found: 0, approved: 0, skipped: why });
        logger(`broll-fill: ${pick.shows}: skipped: ${why}`);
        continue;
      }
      const found = await search(pick, settings.stock || ["pexels", "pixabay"]);
      const candidates = found.filter((c) => !bank.clips.some((l) => l.licence?.provider === c.provider && String(l.licence.id) === String(c.id)));
      let added = [], previews = [];
      if (dryRun) {
        previews = await previewStockCandidates(candidates, { pick, dir, settings, deps });
      } else if (candidates.length) {
        added = await makeStockClip({ pick, shot, groups, workDir: dir, dir, settings: { ...settings, library: true }, search: async () => candidates, fill: true, maxNew: Math.min(maxNew - approved.length, 3 - held.length), deps }) || [];
        const stored = readLibrary(env);
        approved.push(...added.map((s) => stored.clips.find((c) => c.id === s.libraryId)));
      }
      const reason = dryRun ? `dry run: ${previews.map((c) => `${c.provider}:${c.id} (motion ${c.previewMotion ?? "unknown"})`).join(", ") || "no eligible previews"}` : !candidates.length ? "no new candidates (budget/cooldown or no match)" : !added.length ? "no candidate passed inspection" : "saved to library";
      results.push({ shows: pick.shows, found: found.length, approved: added.length, reason });
      logger(`broll-fill: ${pick.shows}: found ${found.length}, approved ${added.length}, ${reason}`);
    }
    if (approved.length) writeBrollCredits(libraryDir(env), readLibrary(env).clips.map((c) => ({ ...c, start: 0 })));
    return { approved, subjects: results };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

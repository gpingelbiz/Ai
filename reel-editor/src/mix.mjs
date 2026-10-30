/**
 * The content mix: which job (pillar) the next post does, from the share each pillar gets in the client's own brand
 * guide (section 6 "Pillars" table of a Brand & Messaging Guide, or the Agent Brief's "pillar ratio" line). Never
 * Greg's mix: a client with no mix in their guide gets an even split of whatever pillars studio.json names.
 */

const clean = (s) => String(s ?? "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
const pct = (s) => { const m = String(s).match(/(\d{1,3}(?:\.\d+)?)\s*%/); return m ? Number(m[1]) : null; };

/** Markdown tables as arrays of row cells (header first). */
export function markdownTables(md) {
  const tables = [];
  let cur = null;
  for (const line of String(md || "").split("\n")) {
    const t = line.trim();
    if (t.startsWith("|") && t.endsWith("|") && t.length > 2) {
      const cells = t.slice(1, -1).split("|").map(clean);
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // the |---|---| rule
      (cur ||= []).push(cells);
    } else if (cur) { tables.push(cur); cur = null; }
  }
  if (cur) tables.push(cur);
  return tables;
}

/** Shares summed to 1, names kept as written, zero and duplicate rows dropped. */
export function normalizeMix(rows) {
  const seen = new Set();
  const list = rows.filter((r) => r.name && r.share > 0 && !seen.has(r.name.toLowerCase()) && seen.add(r.name.toLowerCase()));
  const total = list.reduce((a, r) => a + r.share, 0);
  return total > 0 ? list.map((r) => ({ ...r, share: Math.round((r.share / total) * 1000) / 1000 })) : [];
}

/**
 * The mix in a brand guide: the first table with a "pillar" or "job" column and a percentage in its rows, else a
 * "Pillar ratio: Offer 30% / Story 30% / ..." line. [] when the guide has neither.
 */
export function parseMix(md) {
  for (const table of markdownTables(md)) {
    const [head, ...rows] = table;
    const lower = head.map((h) => h.toLowerCase());
    const nameCol = lower.findIndex((h) => /\b(pillar|job|bucket|theme)\b/.test(h));
    if (nameCol < 0) continue;
    const shareCol = lower.findIndex((h) => /share|%|mix|ratio|weight/.test(h));
    const parsed = rows.map((r) => {
      const share = shareCol >= 0 ? pct(r[shareCol]) : r.map(pct).find((x) => x != null);
      const what = r.filter((_, i) => i !== nameCol && i !== shareCol).join(" · ");
      return { name: clean(r[nameCol]).replace(/\s*\(.*?\)\s*$/, ""), share: share ?? 0, what };
    }).filter((r) => r.share > 0 && !/discontinued|retired|total/i.test(r.name));
    if (parsed.length >= 2) return normalizeMix(parsed);
  }
  const line = String(md || "").split("\n").find((l) => /pillar (ratio|mix)|content mix|job mix/i.test(l) && (l.match(/%/g) || []).length >= 2);
  if (line) {
    const rows = [...line.replace(/^.*?:/, "").matchAll(/([A-Za-z][A-Za-z &'/+-]*?)\s*[:=]?\s*(\d{1,3})\s*%/g)].map((m) => ({ name: clean(m[1]), share: Number(m[2]), what: "" }));
    if (rows.length >= 2) return normalizeMix(rows);
  }
  return [];
}

/** The mix for a run: studio.json's own "mix" first (the client's override), then the guide, then an even split. */
export function studioMix(config, guide) {
  const own = Array.isArray(config?.mix) ? config.mix.map((m) => (typeof m === "string" ? { name: m, share: 1 } : { name: clean(m?.name), share: Number(m?.share) || 0, what: clean(m?.what) })) : [];
  if (own.length) return normalizeMix(own);
  const fromGuide = parseMix(guide);
  if (fromGuide.length) return fromGuide;
  return normalizeMix([{ name: "Teach", share: 1, what: "one useful idea for the buyer" }, { name: "Story", share: 1, what: "a real moment and the lesson in it" }, { name: "Proof", share: 1, what: "what changed for a real client, only what is documented" }]);
}

/**
 * The job for the next post: the pillar furthest under its share over the last `days` days of posts, never the same
 * pillar as the previous post while another is under its share. `history` = [{date: "YYYY-MM-DD", job}].
 */
export function pickJob(mix, history = [], { today, days = 14 } = {}) {
  if (!mix.length) return null;
  const since = today ? new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10) : null;
  const recent = history.filter((h) => h?.job && (!since || String(h.date) >= since)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const n = recent.length + 1;
  const count = (name) => recent.filter((h) => h.job.toLowerCase() === name.toLowerCase()).length;
  const scored = mix.map((m, i) => ({ ...m, i, deficit: m.share * n - count(m.name) }));
  const last = recent.at(-1)?.job?.toLowerCase();
  scored.sort((a, b) => b.deficit - a.deficit || b.share - a.share || a.i - b.i);
  const fresh = scored.find((m) => m.name.toLowerCase() !== last && m.deficit > 0);
  return fresh || scored[0];
}

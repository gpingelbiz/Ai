import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Greg's rule book (policy/content-policy.json, 2026-10-31): the phrases that may never appear in his posts. One file
 * for the reel caption gate, the slide gate and `reel policy`, so the rules can't drift apart again. REEL_POLICY
 * points at another file (tests, or a client's own rule book later).
 */
export const POLICY_FILE = process.env.REEL_POLICY || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "policy", "content-policy.json");

let cached = null;
export function loadPolicy(file = POLICY_FILE) {
  if (cached && cached.file === file) return cached.policy;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const policy = { ...raw, rules: (raw.rules || []).map((r) => ({ ...r, res: (r.patterns || []).map((p) => new RegExp(p, "iu")) })) };
  cached = { file, policy };
  return policy;
}

/** Every rule the text breaks, in rule-book order: [{ id, reason }]. `slides` keeps only the rules marked for slides. */
export function policyProblems(text, { policy = loadPolicy(), slides = false } = {}) {
  const s = String(text || "");
  return policy.rules.filter((r) => (!slides || r.slides) && r.res.some((re) => re.test(s))).map((r) => ({ id: r.id, reason: r.reason }));
}

/** Does this brand follow Greg's rule book? (his handle; client brands keep their own never-say lists). */
export function policyApplies(brand = {}, policy = loadPolicy()) {
  const handle = String(brand?.identity?.handle || brand?.handle || "").toLowerCase();
  return !!handle && (policy.handles || []).map((h) => h.toLowerCase()).includes(handle);
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir } from "./util.mjs";

/**
 * Paid-API usage, kept per month so Greg can see what the reels cost: one line per generation (service, model,
 * seconds, credits, dollars, which reel), a running total per month, and the account balance when the service
 * reports one. ~/.cache/reel-editor/usage.json; `reel usage` prints it.
 */
export const usageFile = (env = process.env) => env.REEL_USAGE_FILE || path.join(os.homedir(), ".cache", "reel-editor", "usage.json");

export function readUsage(file = usageFile()) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { months: {} }; }
}

const month = (d = new Date()) => d.toISOString().slice(0, 7);

/** Record one or more generations. `items`: [{service, model, kind, seconds, credits, dollars, ok}]. */
export function recordUsage({ reel = "", items = [], balance = null, file = usageFile(), at = new Date() } = {}) {
  const u = readUsage(file);
  const m = (u.months[month(at)] ||= { credits: 0, dollars: 0, generations: 0, failed: 0, reels: {}, lines: [] });
  for (const it of items) {
    const credits = Number(it.credits) || 0, dollars = Number(it.dollars) || 0;
    m.lines.push({ t: at.toISOString(), reel, service: it.service || "runway", model: it.model || "", kind: it.kind || "", seconds: it.seconds ?? null, credits, dollars, ok: it.ok !== false });
    if (it.ok !== false) { m.credits += credits; m.dollars += dollars; m.generations += 1; } else m.failed += 1;
    const r = (m.reels[reel || "(none)"] ||= { credits: 0, dollars: 0, generations: 0 });
    if (it.ok !== false) { r.credits += credits; r.dollars += dollars; r.generations += 1; }
  }
  m.dollars = Math.round(m.dollars * 1000) / 1000;
  if (balance != null) u.balance = { credits: balance, at: at.toISOString() };
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(u, null, 2) + "\n");
  return u;
}

/** A short text report: this month, the last months, the balance, the most expensive reels. */
export function usageReport(u = readUsage(), { now = new Date() } = {}) {
  const lines = [];
  const months = Object.keys(u.months).sort().reverse();
  if (!months.length) return "No paid generations recorded yet.\n";
  const cur = u.months[month(now)];
  if (u.balance) lines.push(`Runway balance: ${u.balance.credits} credits (as of ${u.balance.at.slice(0, 16).replace("T", " ")})`);
  if (cur) lines.push(`This month: ${cur.generations} generations, ${Math.round(cur.credits)} credits ≈ $${cur.dollars.toFixed(2)}${cur.failed ? `, ${cur.failed} failed` : ""}`);
  for (const k of months.slice(0, 6)) {
    const m = u.months[k];
    lines.push(`${k}: ${m.generations} generations, ${Math.round(m.credits)} credits ≈ $${m.dollars.toFixed(2)}`);
  }
  if (cur) {
    const top = Object.entries(cur.reels).sort((a, b) => b[1].credits - a[1].credits).slice(0, 5);
    if (top.length) lines.push("", "This month by reel:", ...top.map(([r, v]) => `  ${Math.round(v.credits)} credits ≈ $${v.dollars.toFixed(2)}  ${r}`));
  }
  return lines.join("\n") + "\n";
}

/** The note that goes next to a reel: what it cost. */
export function reelUsageNote(items, { balance = null } = {}) {
  const ok = items.filter((i) => i.ok !== false);
  const credits = ok.reduce((s, i) => s + (Number(i.credits) || 0), 0), dollars = ok.reduce((s, i) => s + (Number(i.dollars) || 0), 0);
  return [
    `Runway: ${ok.length} generation${ok.length === 1 ? "" : "s"}, ${Math.round(credits)} credits ≈ $${dollars.toFixed(2)}${items.length > ok.length ? ` (${items.length - ok.length} failed, not charged)` : ""}`,
    ...ok.map((i) => `  ${i.kind || i.model}${i.seconds ? ` ${i.seconds}s` : ""}: ${Math.round(i.credits)} credits`),
    balance != null ? `Balance after: ${balance} credits` : "",
    "Monthly totals: reel usage",
  ].filter(Boolean).join("\n") + "\n";
}

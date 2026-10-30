import { spawn } from "node:child_process";
import os from "node:os";
import { firstJSON } from "./claude.mjs";

/**
 * The client's Metricool, reached through the Metricool connector on the client's own claude.ai account (their
 * Claude login on their Mac; nothing of Greg's). Every call is headless Claude Code with exactly ONE Metricool tool
 * allowed and everything else denied, told to call it once with the JSON the code built and hand back the raw result.
 * The code decides every field; Claude only carries the call.
 */

const DENY = ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit", "TodoWrite"];

/** "claude.ai Metricool Social Media Management" -> the tool prefix Claude Code gives that connector. */
export const connectorPrefix = (name) => `mcp__claude_ai_${String(name).trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}__`;

/**
 * The claude.ai connectors `claude mcp list` shows, by what they connect to: {metricool, sandcastles, dropbox,
 * drive} -> {name, connected}. A connector the client renamed is still found by its address.
 */
export function parseConnectors(listOutput) {
  const out = {};
  const kinds = [["metricool", /metricool\.com/i], ["sandcastles", /sandcastles\.ai/i], ["dropbox", /dropbox\.com/i], ["drive", /drivemcp\.googleapis\.com/i]];
  for (const line of String(listOutput || "").split("\n")) {
    const m = line.match(/^claude\.ai (.+?): (\S+)\s+-\s+(.*)$/);
    if (!m) continue;
    for (const [kind, re] of kinds) if (re.test(m[2]) && !out[kind]) out[kind] = { name: m[1], connected: /connected/i.test(m[3]) && !/needs|fail/i.test(m[3]) };
  }
  return out;
}

function runClaude(args, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.REEL_CLAUDE_BIN || "claude", args, { stdio: ["ignore", "pipe", "pipe"], cwd: os.tmpdir() });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(-400)}`)); });
  });
}

/** The connectors on this Mac's Claude login. */
export async function detectConnectors() {
  const out = await runClaude(["mcp", "list"], { timeoutMs: 90000 });
  return parseConnectors(out);
}

/** The prompt for one tool call. Pure, so it can be tested. */
export function toolPrompt(tool, input) {
  return [
    `Call the tool ${tool} exactly once, with exactly this input (do not change, add or drop any field or character):`,
    JSON.stringify(input),
    "",
    "Do not call any other tool and do not retry. Then reply with only the tool's result, unchanged, as JSON (if the tool returned an error, reply {\"error\": \"<the exact error text>\"}). No prose, no code fence.",
  ].join("\n");
}

/** One Metricool tool call. Returns the parsed result; throws on an error result. */
export async function metricoolCall(connector, tool, input, { timeoutMs } = {}) {
  if (!connector) throw new Error("no Metricool connector name in studio.json (run the installer again)");
  const name = `${connectorPrefix(connector)}${tool}`;
  const reply = await runClaude(["-p", toolPrompt(name, input), "--allowedTools", name, "--disallowedTools", DENY.join(","), "--output-format", "text"], { timeoutMs });
  let result;
  try { result = firstJSON(reply); } catch { throw new Error(`Metricool ${tool}: no result came back (${reply.trim().slice(0, 200)})`); }
  if (result && typeof result === "object" && result.error) throw new Error(`Metricool ${tool}: ${typeof result.error === "string" ? result.error : JSON.stringify(result.error)}`);
  return result;
}

/** The Metricool brands on the account: [{id, label, timezone, networks}]. */
export async function metricoolBrands(connector) {
  const r = await metricoolCall(connector, "getBrandSettings", {});
  const list = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [];
  return list.map((b) => ({ id: String(b.id), label: b.label || b.name || String(b.id), timezone: b.timezone || "", networks: Object.keys(b.networksData || {}).map((k) => k.replace(/Data$/, "")) }));
}

/** ISO date with the zone's offset for a wall-clock time there: ("2026-11-02", "10:00", "America/Chicago"). */
export function zonedISO(day, time, tz) {
  const [h, m] = String(time).split(":").map(Number);
  const guess = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h, m || 0);
  const offsetMin = (at) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return Math.round((wall - at) / 60000);
  };
  let off = offsetMin(guess);
  off = offsetMin(guess - off * 60000);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${day}T${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Scheduled posts between two days: [{day, hour, minute, type, draft, text}] in the brand's zone. */
export async function scheduledPosts(connector, { blogId, from, to, tz }) {
  const r = await metricoolCall(connector, "getScheduledPosts", { brandId: String(blogId), fromDate: zonedISO(from, "00:00", tz), toDate: zonedISO(to, "23:59", tz), timezone: tz, extendedRange: false });
  return normalizeScheduled(r);
}

/** Pure: Metricool's scheduled-post list as {day, hour, minute, type, draft}. */
export function normalizeScheduled(r) {
  const list = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : Array.isArray(r?.posts) ? r.posts : [];
  return list.map((p) => {
    const dt = String(p.publicationDate?.dateTime || p.publicationDate || p.date || "");
    const m = dt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    return { day: m[1], hour: Number(m[2]), minute: Number(m[3]), type: String(p.instagramData?.type || p.type || "POST").toUpperCase(), draft: !!p.draft, text: String(p.text || "").slice(0, 80), id: p.id ?? p.uuid ?? null };
  }).filter(Boolean);
}

/**
 * The createScheduledPost input for one post. `kind` = carousel | static | reel. Instagram's AI label goes on when
 * `ai` is true (a carousel carries one flag for the whole post).
 */
export function postInput({ blogId, day, time, tz, text, media, kind, ai = false, draft = false, networks = ["instagram"], title = "", coverMs = null }) {
  const reel = kind === "reel";
  const providers = networks.map((network) => ({ network }));
  const info = {
    autoPublish: true,
    descendants: [],
    draft: !!draft,
    firstCommentText: "",
    hasNotReadNotes: false,
    media,
    mediaAltText: media.map(() => null),
    providers,
    publicationDate: { dateTime: `${day}T${time}:00`, timezone: tz },
    shortener: false,
    smartLinkData: { ids: [] },
    text,
  };
  if (reel && Number.isFinite(coverMs)) info.videoCoverMilliseconds = Math.max(0, Math.round(coverMs));
  if (networks.includes("instagram")) info.instagramData = { autoPublish: true, type: reel ? "REEL" : "POST", showReelOnFeed: true, isAiGenerated: !!ai };
  if (networks.includes("facebook")) info.facebookData = { type: reel ? "REEL" : "POST" };
  if (networks.includes("linkedin")) info.linkedinData = kind === "carousel" ? { documentTitle: title.slice(0, 100), publishImagesAsPDF: true, previewIncluded: true, type: "post" } : { previewIncluded: true, type: "post" };
  if (networks.includes("tiktok")) info.tiktokData = { isAigc: !!ai };
  if (networks.includes("threads")) info.threadsData = {};
  return { blogId: String(blogId), date: zonedISO(day, time, tz), info: JSON.stringify(info) };
}

/** The first value under `key` anywhere in a tool result. */
export function findKey(value, key) {
  if (!value || typeof value !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key) && value[key] != null && value[key] !== "") return value[key];
  for (const v of Object.values(value)) { const hit = findKey(v, key); if (hit !== undefined) return hit; }
  return undefined;
}

/** The planner link and post id in a createScheduledPost result (never a media file's address). */
export function createdPost(r) {
  const flat = JSON.stringify(r ?? "");
  const plannerUrl = findKey(r, "plannerUrl") || flat.match(/https:\/\/app\.metricool\.com\/[^"\s\\]*/)?.[0] || "";
  const id = findKey(r, "id") ?? findKey(r, "uuid") ?? null;
  return { plannerUrl: String(plannerUrl), id };
}

/** Schedule one post. Returns {plannerUrl, id, raw}. */
export async function createPost(connector, input) {
  const r = await metricoolCall(connector, "createScheduledPost", input, { timeoutMs: 420000 });
  return { ...createdPost(r), raw: r };
}

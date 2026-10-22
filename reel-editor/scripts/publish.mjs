#!/usr/bin/env node
/**
 * Hand a finished reel to Metricool for approval (never auto-posts). Metricool takes media as a public URL
 * (a Dropbox or Google Drive link is uploaded for you), so:
 *
 *   node scripts/publish.mjs <work dir> --media-url <url> [--date 2026-10-22T09:00:00-07:00] [--trial] [--reviewer you@x.com]
 *
 * writes <work dir>/post.json (caption, hashtags, flags) and, with --media-url, runs Claude Code headless with ONLY the
 * Metricool "create post for review" tool allowed to schedule it for review. Without a URL it stops after post.json
 * and prints the hand-off. Reels with AI stills carry isAiGenerated=true, as Instagram requires.
 * Needs the Claude Code CLI signed in and the Metricool connector on claude.ai.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const TOOL = "mcp__claude_ai_metricool__createScheduledPostForReview";
const SETTINGS = "mcp__claude_ai_metricool__getBrandSettings";
const DENY = ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit"];

export function buildPost(workDir, { mediaUrl = "", date = "", trial = false } = {}) {
  const plan = JSON.parse(fs.readFileSync(path.join(workDir, "plan.json"), "utf8"));
  let caption = null;
  try { caption = JSON.parse(fs.readFileSync(path.join(workDir, "caption.json"), "utf8")); } catch {}
  const text = caption ? [caption.caption, "", (caption.hashtags || []).slice(0, 5).join(" ")].join("\n").trim() : (plan.hook?.text || plan.name);
  const ai = !!(plan.broll && plan.broll.length);
  return {
    text,
    hook: plan.hook?.text || "",
    mediaUrl,
    date,
    instagramType: trial ? "TRIAL_REEL" : "REEL",
    isAiGenerated: ai,
    aiNote: ai ? "This reel has AI-generated b-roll stills, so the post is flagged as AI-altered (Instagram's disclosure rule)." : "",
    coverMs: Math.round(((plan.hook?.start ?? 0) + 0.5) * 1000),
  };
}

export function publishPrompt(post, { reviewer, blogHint = "" }) {
  return [
    "Schedule ONE Instagram post for review in Metricool, then stop. Use the brand settings tool first to find the blogId and timezone" + (blogHint ? ` (brand: ${blogHint})` : "") + ", then the create-for-review tool exactly once.",
    `Reviewer: ${reviewer}. approvalSystem: "any". notify: true.`,
    `date: ${post.date || "the best Instagram time tomorrow in the brand's timezone"}.`,
    "info JSON: providers [{\"network\":\"instagram\"}], instagramData {\"type\":\"" + post.instagramType + "\",\"showReelOnFeed\":true,\"isAiGenerated\":" + post.isAiGenerated + "}, media [the URL below], videoCoverMilliseconds " + post.coverMs + ", autoPublish true, draft false, text exactly as given below (do not edit it).",
    "",
    "media URL: " + post.mediaUrl,
    "",
    "text:",
    post.text,
    "",
    "Reply with the plannerUrl from the tool's result, or the exact error.",
  ].join("\n");
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.REEL_CLAUDE_BIN || "claude", ["-p", prompt, "--allowedTools", `${SETTINGS},${TOOL}`, "--disallowedTools", DENY.join(","), "--output-format", "text"], { stdio: ["ignore", "pipe", "pipe"], cwd: process.env.TMPDIR || "/tmp" });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("timed out after 240s")); }, 240000);
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${err.slice(-300)}`)); });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const workDir = args[0];
  if (!workDir) { console.error("usage: publish.mjs <work dir> [--media-url <url>] [--date <iso>] [--trial] [--reviewer <email>]"); process.exit(2); }
  const opt = (k) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : ""; };
  const post = buildPost(workDir, { mediaUrl: opt("--media-url"), date: opt("--date"), trial: args.includes("--trial") });
  fs.writeFileSync(path.join(workDir, "post.json"), JSON.stringify(post, null, 2) + "\n");
  console.log(`post: ${path.join(workDir, "post.json")}${post.aiNote ? "\n" + post.aiNote : ""}`);
  if (!post.mediaUrl) { console.log("No --media-url: upload the reel to Dropbox or Google Drive, then run again with its public link to send it for review."); return; }
  const reviewer = opt("--reviewer") || process.env.REEL_PUBLISH_REVIEWER || "";
  if (!reviewer) { console.log("No reviewer: pass --reviewer you@example.com or set REEL_PUBLISH_REVIEWER."); return; }
  const reply = await runClaude(publishPrompt(post, { reviewer, blogHint: process.env.REEL_PUBLISH_BRAND || "" }));
  console.log(reply.trim());
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });

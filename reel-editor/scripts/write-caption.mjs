#!/usr/bin/env node
/**
 * Post copy for a finished reel: caption, hashtags and three hook-text options, modeled on what Sandcastles shows
 * is winning for the reel's topic. Runs Claude Code headless (`claude -p`) with ONE allowed tool family, the
 * Sandcastles hook/format lookups; it cannot read or write files or run commands.
 *
 *   node scripts/write-caption.mjs <work dir> [out.txt]
 *
 * Voice: REEL_CAPTION_VOICE (a .md file), else voice/greg.md for the pingel-brand preset, else voice/default.md.
 * CTA: REEL_WATCH_CTA (empty = no call to action in the caption).
 * Needs the Claude Code CLI signed in and the Sandcastles connector added on claude.ai. Exits 0 with a note when
 * either is missing, so a reel is never held up by its caption.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS = ["mcp__claude_ai_sandcastles__top_hooks", "mcp__claude_ai_sandcastles__top_formats"];
const DENY = ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit"];

export function voiceFile(plan, env = process.env) {
  if (env.REEL_CAPTION_VOICE && fs.existsSync(env.REEL_CAPTION_VOICE)) return env.REEL_CAPTION_VOICE;
  return path.join(ROOT, "voice", plan?.style?.name === "pingel-brand" ? "greg.md" : "default.md");
}

/** The prompt Claude gets. Pure, so it can be tested. */
export function buildPrompt({ transcript, hook, voice, cta, auto = false }) {
  return [
    "You write the Instagram post copy for one finished talking-head reel.",
    "",
    "1. Call the sandcastles top_hooks tool with scope \"all\" and a query naming this reel's topic in a few words. You may also call top_hooks with scope \"watchlist\", and top_formats. Use at most 3 calls.",
    "2. From the results, find the hook patterns (spoken_hook_category + madlib) and caption habits winning for this topic.",
    "3. Write the copy in the speaker's voice, reusing their own words from the transcript wherever you can.",
    "",
    "Rules:",
    "- Caption: 1 or 2 short lines in the speaker's own point of view: the point they are making. No emojis. No invented numbers, results or stories: only what the transcript says.",
    "- When the speaker quotes someone else or acts out a message, call or line (\"text me: hey, I messed up\"), never present those words as the speaker's own.",
    "- Hashtags: exactly 3, matching the content.",
    cta
      ? `- End the caption with an offer built around this call to action: ${cta}. Phrase it as something the reader gets ("Want the exact words? ${cta} and I'll send them."), never as a bare instruction on its own: Instagram does not recommend posts that only ask people to comment a word.`
      : "- No call to action of any kind (no comment/DM/follow/share/save asks).",
    auto
      ? "- Hook options: 3, each 4 to 8 words, true to what the speaker says, strongest first: option 1 goes on the finished reel as its on-screen hook, so it must stop the scroll on its own and never be a greeting. Each option models a different winning pattern; never copy another creator's wording."
      : "- Hook options: 3, each 4 to 8 words, true to what the speaker says. Option 1 is the hook already in the reel, exactly as given. Options 2 and 3 each model a different winning pattern; never copy another creator's wording.",
    auto
      ? "- For each hook option, name its pattern and cite one Sandcastles example as @handle, views, and outlier score (e.g. 153x)."
      : "- For each hook option, name its pattern and cite one Sandcastles example as @handle, views, and outlier score (e.g. 153x). Option 1 may cite none.",
    "",
    "Voice:",
    voice.trim(),
    "",
    auto ? `The reel has no written hook yet; it opens on the speaker's first words: ${hook}` : `Hook in the reel: ${hook || "(none)"}`,
    "",
    "Transcript of the finished reel:",
    transcript,
    "",
    'Reply with JSON only, no prose and no code fence: {"topic":"...","caption":"line 1\\nline 2","hashtags":["#a","#b","#c"],"hooks":[{"text":"...","pattern":"...","example":"@handle, 2.4M views, 153x"}],"trend":"one sentence on what is winning for this topic"}',
  ].join("\n");
}

/** Pull the first JSON object out of Claude's reply and check its shape. */
export function parseReply(text) {
  const s = String(text);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in the reply");
  const j = JSON.parse(s.slice(start, end + 1));
  if (!j.caption || !Array.isArray(j.hashtags) || !Array.isArray(j.hooks) || !j.hooks.length) throw new Error("reply is missing caption, hashtags or hooks");
  j.hashtags = j.hashtags.slice(0, 3).map((h) => (String(h).startsWith("#") ? String(h) : `#${h}`).replace(/\s+/g, ""));
  j.hooks = j.hooks.slice(0, 3);
  return j;
}

export function formatCaptionFile(j, { title, cta, date = new Date().toISOString().slice(0, 10) }) {
  const lines = [
    String(title || "Reel").toUpperCase(),
    `Post copy from what is winning on Sandcastles (${date}). Works for every version of this clip.`,
    "",
    "CAPTION",
    ...String(j.caption).split(/\n+/).map((l) => l.trim()).filter(Boolean),
    "",
    "HASHTAGS",
    j.hashtags.join(" "),
    "",
    "HOOK TEXT (on screen, first 3 seconds) - pick one",
  ];
  j.hooks.forEach((h, i) => {
    lines.push(`${i + 1}. ${h.text}`);
    const why = [h.pattern, h.example].filter(Boolean).join("; ");
    if (why) lines.push(`   (${i === 0 ? "in the reel now; " : ""}${why.replace(/[()]/g, "")})`);
  });
  if (j.trend) lines.push("", `WHAT'S WINNING: ${j.trend}`);
  lines.push("", cta ? `CTA: ${cta}` : "NO CTA.");
  return lines.join("\n") + "\n";
}

function runClaude(prompt, { timeoutMs = 240000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--allowedTools", TOOLS.join(","), "--disallowedTools", DENY.join(","), "--output-format", "text"];
    const child = spawn(process.env.REEL_CLAUDE_BIN || "claude", args, { stdio: ["ignore", "pipe", "pipe"], cwd: process.env.TMPDIR || "/tmp" });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${err.slice(-300)}`)); });
  });
}

async function main() {
  const [workDir, outArg] = process.argv.slice(2);
  if (!workDir) { console.error("usage: write-caption.mjs <work dir> [out.txt]"); process.exit(2); }
  const plan = JSON.parse(fs.readFileSync(path.join(workDir, "plan.json"), "utf8"));
  const transcript = (plan.captions || []).map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
  if (!transcript) { console.log("caption: no transcript in this reel, skipped"); return; }
  const cta = process.env.REEL_WATCH_CTA || "";
  const hook = plan.hook?.text || "";
  const auto = !!(hook && plan.hook?.auto);
  const out = outArg || path.join(workDir, "caption.txt");
  const prompt = buildPrompt({ transcript, hook, voice: fs.readFileSync(voiceFile(plan), "utf8"), cta, auto });
  let reply;
  try {
    reply = await runClaude(prompt);
  } catch (e) {
    console.log(`caption: skipped (${String(e.message).split("\n")[0]})`);
    return;
  }
  let j;
  try {
    j = parseReply(reply);
  } catch (e) {
    console.log(`caption: skipped, unusable reply (${e.message})`);
    fs.writeFileSync(path.join(workDir, "caption-raw.txt"), reply);
    return;
  }
  if (auto) {
    // The strongest written option becomes the reel's hook (the watcher re-edits with it); the opening words are not an option.
    j.hooks = j.hooks.filter((h) => h.text && h.text.trim().toLowerCase() !== hook.trim().toLowerCase()).slice(0, 3);
    j.best = j.hooks[0]?.text || "";
    j.bestIsWritten = !!j.best;
  } else if (hook && j.hooks[0]?.text !== hook) j.hooks = [{ text: hook, pattern: "the hook in the reel" }, ...j.hooks.filter((h) => h.text !== hook)].slice(0, 3);
  fs.writeFileSync(out, formatCaptionFile(j, { title: (auto && j.best) || hook || plan.name, cta }));
  fs.writeFileSync(path.join(workDir, "caption.json"), JSON.stringify(j, null, 2) + "\n");
  console.log(`caption: ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

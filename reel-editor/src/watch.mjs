import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { run, r3, PKG_ROOT } from "./util.mjs";
import { firstJSON, hasClaude } from "./claude.mjs";

/**
 * Render reviewer: Claude watches the finished reel as frames. The first 2.5 s are sampled densely (that is where a
 * viewer decides), then one frame just after every picture change and one every few seconds between, laid out on
 * labelled contact sheets. Claude reports only what it can point at in a frame, and answers as a cold viewer: keep
 * watching after 3 s, and where would they stop. Video models hallucinate (herk-edit-kit, agentic-video-editor), so
 * nothing is changed automatically: every finding goes into the reel's check note with its time, to look at.
 */

export function sampleTimes(plan, duration, { dense = 2.5, denseStep = 0.25, every = 4, maxFrames = 36 } = {}) {
  const t = new Set();
  for (let x = 0.05; x < Math.min(dense, duration); x += denseStep) t.add(r3(x));
  const changes = [];
  for (const z of plan?.zooms || []) changes.push(z.t);
  for (const g of plan?.graphics || []) {
    if (g.type === "progress") { for (const p of g.pulses || []) if (!p.hidden) changes.push(p.at, p.at + 1.4); }
    else changes.push(g.start, g.start + g.duration);
  }
  for (const b of plan?.broll || []) changes.push(b.start, b.start + b.duration);
  for (const sl of plan?.slams || []) changes.push(sl.t + 0.2);
  for (const c of changes) if (c + 0.15 < duration - 0.1) t.add(r3(c + 0.15));
  for (let x = dense; x < duration - 0.2; x += every) t.add(r3(x));
  t.add(r3(Math.max(0, duration - 0.3)));
  let out = [...t].filter((x) => x >= 0 && x < duration).sort((a, b) => a - b);
  if (out.length > maxFrames) {
    const head = out.filter((x) => x < dense);
    const rest = out.filter((x) => x >= dense);
    const keep = Math.max(1, maxFrames - head.length);
    out = [...head, ...rest.filter((_, i) => i % Math.ceil(rest.length / keep) === 0)];
  }
  return out;
}

/** What the reel is supposed to show, for Claude to hold the frames against. */
export function expectations(plan) {
  const lines = [];
  const st = plan.style || {};
  // The house look, so intended effects are not reported as faults.
  if (st.captions?.style === "reveal") lines.push("Look: captions reveal word by word, so the words not yet spoken show dimmed on purpose; a line holds on screen until the next one.");
  if (plan.slams?.length) lines.push("Look: a slam word stamps in big at the top while the same word is in the caption below, holds about a second and then whips up out of the top of the frame; the repeat and the exit (letters leaving past the top edge) are on purpose.");
  if ((plan.graphics || []).length) lines.push("Look: cards and their items animate in over about half a second (a panel can be empty or half-wiped in a frame just after it appears); judge a card on its later frames.");
  if (st.captions?.annotate) lines.push("Look: a hand-drawn marker underlines or circles the gold word in a caption on purpose.");
  if (plan.zooms?.some((z) => z.cut)) lines.push("Look: the frame jumps between a wide and a tighter framing of the speaker on purpose (jump cuts).");
  const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  if (plan.hook) lines.push(`Hook title ${fmt(plan.hook.start)}-${fmt(plan.hook.start + plan.hook.duration)}: "${String(plan.hook.text).replace(/\*/g, "")}"${plan.behind ? " (runs behind the speaker's head on purpose)" : ""}`);
  for (const g of plan.graphics || []) lines.push(`Card ${fmt(g.start)}-${fmt(g.start + g.duration)} (${g.type}): ${JSON.stringify(g.title || g.text || g.value || g.items || g.quote || "").slice(0, 160)}`);
  for (const b of plan.broll || []) lines.push(`Cutaway ${fmt(b.start)}-${fmt(b.start + b.duration)}: ${b.scene || b.prompt || b.what || "a picture for the line"}${b.text ? ` (said: "${b.text}")` : ""}`);
  for (const sl of plan.slams || []) lines.push(`Slam word ${fmt(sl.t)}: "${sl.text}"`);
  const said = (plan.captions?.length ? plan.captions : plan.lines || []).map((g) => `${fmt(g.start)} ${g.text}`);
  return { plan: lines, said: said.slice(0, 220) };
}

export function watchPrompt({ sheets, exp, name }) {
  return [
    "You are the last check on a talking-head reel before it is posted, and also a cold viewer scrolling Instagram. Look at every contact sheet below with the Read tool. Each sheet is a grid of frames read left to right, top to bottom; the times of its frames, in that order, are listed next to it. An empty slot at the end of the last sheet is padding.",
    "Report ONLY problems you can see in a specific frame, with that frame's time. Do not guess about audio or motion you cannot see. Problem kinds:",
    "- face-covered: text or a graphic over the speaker's mouth, chin or eyes (the hook running behind the top of the head on purpose is fine)",
    "- subject-cut: a person cropped awkwardly, half out of frame, or the wrong person on screen",
    "- text-error: on-screen text misspelled, garbled, cut off at an edge, or saying something the transcript does not",
    "- wrong-picture: a cutaway or card that does not fit what is being said at that time",
    "- collision: two overlays on top of each other, or text where Instagram puts its caption and buttons (bottom sixth, right edge)",
    "- dead-frame: black, blank, frozen-looking, or a still that reads as a mistake",
    "Severity: high only when a viewer would notice it in one watch. When unsure, leave it out.",
    "Then judge as a cold viewer: after the first 3 seconds (the first sheet), keep watching or swipe, and why; and the one moment you would most likely stop watching, if any.",
    "",
    `Reel: ${name}`,
    "What the edit intends to show:",
    ...(exp.plan.length ? exp.plan : ["(no overlays planned)"]),
    "",
    "What is said (time, words):",
    ...exp.said,
    "",
    "Contact sheets:",
    ...sheets.map((s) => `- ${s.file}: frames at ${s.times.map((t) => `${t.toFixed(2)}s`).join(", ")}`),
    "",
    'Reply with JSON only: {"issues":[{"t":<seconds>,"kind":"face-covered","severity":"high|low","note":"what you see"}],"viewer":{"first3s":"keep|swipe","why":"...","dropAt":<seconds or null>,"dropWhy":"..."}}',
  ].join("\n");
}

/**
 * Frames tiled into contact sheets of 4x3, read left to right, top to bottom. Returns [{file, times}]. (The Homebrew
 * ffmpeg has no drawtext, so the times travel in the prompt instead of on the frames.)
 */
export async function contactSheets(video, times, dir, { cols = 4, rows = 3, width = 360 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  for (let i = 0; i < times.length; i++) {
    const out = path.join(dir, `f${String(i).padStart(3, "0")}.png`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(times[i]), "-i", video, "-frames:v", "1", "-vf", `scale=${width}:-2`, out]);
    frames.push(out);
  }
  const per = cols * rows;
  const sheets = [];
  for (let s = 0; s * per < frames.length; s++) {
    const list = path.join(dir, `sheet-${s + 1}.txt`);
    fs.writeFileSync(list, frames.slice(s * per, (s + 1) * per).map((f) => `file '${f}'`).join("\n"));
    const out = path.join(dir, `sheet-${s + 1}.png`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `tile=${cols}x${rows}:padding=6:color=0x222222`, "-frames:v", "1", out]);
    fs.rmSync(list, { force: true });
    sheets.push({ file: out, times: times.slice(s * per, (s + 1) * per) });
  }
  for (const f of frames) fs.rmSync(f, { force: true });
  return sheets;
}

/** Claude with only the Read tool, for looking at images in one folder. */
function claudeLook(prompt, { timeoutMs = 300000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--tools", "Read", "--allowedTools", "Read", "--strict-mcp-config", "--output-format", "text"];
    if (process.env.REEL_CLAUDE_MODEL) args.push("--model", process.env.REEL_CLAUDE_MODEL);
    const child = spawn(process.env.REEL_CLAUDE_BIN || "claude", args, { stdio: ["ignore", "pipe", "pipe"], cwd: cwd || os.tmpdir() });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(-300)}`)); });
  });
}

const KINDS = new Set(["face-covered", "subject-cut", "text-error", "wrong-picture", "collision", "dead-frame"]);

/** Keep findings that name a real kind and a time inside the reel. */
export function cleanFindings(reply, duration) {
  const issues = (reply?.issues || [])
    .map((i) => ({ t: r3(Number(i.t)), kind: String(i.kind || ""), severity: i.severity === "high" ? "high" : "low", note: String(i.note || "").trim() }))
    .filter((i) => Number.isFinite(i.t) && i.t >= 0 && i.t <= duration + 0.5 && KINDS.has(i.kind) && i.note);
  const v = reply?.viewer || {};
  const viewer = { first3s: v.first3s === "swipe" ? "swipe" : "keep", why: String(v.why || "").trim(), dropAt: Number.isFinite(Number(v.dropAt)) && v.dropAt != null ? r3(Number(v.dropAt)) : null, dropWhy: String(v.dropWhy || "").trim() };
  return { issues, viewer };
}

/** Watch one render. Returns {issues, viewer, sheets} or {error}. */
export async function watchRender(video, plan, { workDir, duration }) {
  if (!hasClaude()) return { error: "Claude Code CLI not found" };
  const dir = path.join(workDir, "watch");
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    const times = sampleTimes(plan, duration);
    const sheets = await contactSheets(video, times, dir);
    const reply = await claudeLook(watchPrompt({ sheets, exp: expectations(plan), name: plan.name }), { cwd: dir });
    const res = { ...cleanFindings(firstJSON(reply), duration), sheets: sheets.map((x) => x.file), frames: times.length };
    fs.writeFileSync(path.join(workDir, "watch.json"), JSON.stringify(res, null, 2));
    return res;
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
}

/** Findings as preflight items (warnings to look at, never blockers). */
export function watchItems(res) {
  if (!res || res.error) return [];
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.round((s % 1) * 10)).slice(0, 1)}`;
  const items = res.issues.map((i) => ({ level: "warn", code: `seen-${i.kind}`, message: `Claude saw at ${fmt(i.t)} (${i.kind.replace("-", " ")}${i.severity === "high" ? ", obvious" : ""}): ${i.note}` }));
  if (res.viewer.first3s === "swipe") items.push({ level: "warn", code: "seen-swipe", message: `as a cold viewer Claude would swipe in the first 3 s: ${res.viewer.why}` });
  return items;
}

export function describeWatch(res) {
  if (!res || res.error) return `watched: skipped (${res?.error || "no result"})`;
  const high = res.issues.filter((i) => i.severity === "high").length;
  return `watched: ${res.frames} frames, ${res.issues.length} thing${res.issues.length === 1 ? "" : "s"} to check${high ? ` (${high} obvious)` : ""}; a cold viewer would ${res.viewer.first3s} after 3 s${res.viewer.dropAt != null ? `, likely stop at ${res.viewer.dropAt}s` : ""}`;
}

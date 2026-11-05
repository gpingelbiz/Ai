/** Claude routine and attended instructions. No credentials belong in these files. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const quote = (s) => `'${String(s).replace(/'/g, `'"'"'`)}'`;
export const command = ({ node, script }, tail) => `${quote(node)} ${quote(script)} ${tail}`;
export function routine(opts) {
  return `# Opus watch\n\nExecute this exact command as a single Bash command:\n\n${command(opts, "watch --notify")}\n\nReport one short line per problem and per newly done video, or "All good".\nNever run send, recut, run, setup, stop, start or settings changes. Never read config.json or state.json. Never send messages. Stop after the report.\n`;
}
export function attended(opts) {
  return `---\nname: opus-dropbox\ndescription: Check Opus clips, change settings, or request an attended re-cut of a finished video.\n---\n\nOpen the command center at http://127.0.0.1:53690.\n\nShow settings first:\n${command(opts, "settings")}\n\nAvailable commands:\n${["status", "check", "templates", "settings template <number>", "settings length <number>", 'recut "<file name>" --yes', "watch", "watch --notify"].map((s) => command(opts, s)).join("\n")}\n\nSettings changes run once the person asks. Settings apply only to new sends. Template numbering starts at 0 for Opus's default. Clip length numbers are 0 for Opus picks, 1 for under 30 seconds, 2 for 30 to 60 seconds, 3 for 60 to 90 seconds, and 4 for 90 seconds to 3 minutes.\nBefore a re-cut, state the video and that it costs at least 10 Opus credits. Get a clear yes in the conversation for that video, then run recut with --yes once. Old clips stay and new clips get a new folder. Never loop re-cuts. Never read config.json or state.json. Never edit tool files.\n`;
}
export function allowRules(opts) {
  return ["status", "check", "settings", "templates", "watch", "watch --notify", "snapshot"].map((s) => `Bash(${command(opts, s)})`);
}
export function setupPrompt(text) {
  return `Create a scheduled task with id opus-watch and cron "7 7-21 * * *" using create_scheduled_task, with the following SKILL.md text as its prompt. Then confirm the task is enabled and say so in one line.\n\n${text}`;
}
export function mergeSettings(settings, rules) {
  return { ...settings, permissions: { ...settings.permissions, allow: [...new Set([...(settings.permissions?.allow || []), ...rules])] } };
}
export function install({ script, node = process.execPath, home = process.env.HOME, say = console.log, copy = (text) => spawnSync("pbcopy", [], { input: text, timeout: 10000 }) }) {
  const opts = { script: fs.realpathSync(script), node: fs.realpathSync(node) };
  const root = path.join(home, ".claude");
  const text = routine(opts);
  // The routine's own file is written by create_scheduled_task in the app, from the prompt below.
  const dest = path.join(root, "skills/opus-dropbox/SKILL.md");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, attended(opts), { mode: 0o600 });
  const file = path.join(root, "settings.json");
  let settings = {}, valid = true, original;
  if (fs.existsSync(file)) {
    original = fs.readFileSync(file, "utf8");
    try {
      settings = JSON.parse(original);
      if (!settings || Array.isArray(settings) || typeof settings !== "object" || (settings.permissions && (typeof settings.permissions !== "object" || Array.isArray(settings.permissions))) || (settings.permissions?.allow && !Array.isArray(settings.permissions.allow))) throw new Error("invalid settings shape");
    } catch { valid = false; say("Claude settings could not be parsed. The file was left alone."); }
  }
  const merged = valid ? mergeSettings(settings, allowRules(opts)) : null;
  if (valid && JSON.stringify(merged) !== JSON.stringify(settings)) {
    if (original !== undefined) fs.copyFileSync(file, `${file}.${Date.now()}.${process.pid}.bak`);
    fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  }
  const prompt = setupPrompt(text);
  say("Paste this prompt in the Claude app Code tab:");
  say(prompt);
  const copied = copy(prompt);
  if (copied?.status === 0) say("The prompt is copied. Paste it in the Claude app Code tab.");
  return { prompt, text };
}

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { studioPaths, loadStudio, photosDir } from "./content-studio.mjs";
import { writeJSON } from "./util.mjs";

export const ROUTINE_TASKS = Object.freeze([
  Object.freeze({ id: "reel-publish", schedule: "45 7-20 * * *" }),
  Object.freeze({ id: "daily-posts", schedule: "0 6,12 * * *" }),
]);
export const routineSetupFile = (root) => path.join(studioPaths(root).state, "routine-setup.json");
const read = (file, fallback) => {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  }
  catch (e) { if (e.code === "ENOENT") return fallback; throw new Error("The routine record could not be read. Open Reels setup and try again."); }
};
const readHeartbeat = (file) => {
  const state = read(file, { tasks: {} });
  if (!state.tasks || typeof state.tasks !== "object" || Array.isArray(state.tasks)) throw new Error("The routine record could not be read. Open Reels setup and try again.");
  return state;
};
const setupAt = (root) => {
  const setup = read(routineSetupFile(root), null);
  if (!setup?.nonce || !Array.isArray(setup.tasks) || !setup.tasks.length || setup.tasks.some((t) => !ROUTINE_TASKS.some((expected) => expected.id === t?.id))) throw new Error("Open Reels setup and copy the routine request first.");
  return setup;
};

// Separate task processes share this file. A busy writer must never erase another task's result.
function withHeartbeat(root, action) {
  const paths = studioPaths(root);
  fs.mkdirSync(paths.state, { recursive: true });
  const lock = path.join(paths.state, "heartbeat.lock");
  try { fs.mkdirSync(lock); }
  catch (e) { if (e.code === "EEXIST") throw new Error("A routine is saving its check. Try this command again in a moment."); throw e; }
  try { return action(paths); } finally { fs.rmdirSync(lock); }
}

/** Arm both tasks together. Until both finish, every run stays in discovery. */
export function checkHeartbeats(studioRoot, { now = new Date() } = {}) {
  return withHeartbeat(studioRoot, (paths) => {
    const setup = setupAt(paths.root);
    const check = { nonce: setup.nonce, id: randomUUID(), at: now.toISOString(), tasks: setup.tasks.map((t) => t.id) };
    const file = path.join(paths.root, "heartbeat.json");
    const state = readHeartbeat(file);
    for (const id of check.tasks) {
      // Invalidate in flight work and earlier proof when the person asks for a fresh check.
      state.tasks[id] = { status: "pending", nonce: setup.nonce, at: check.at };
    }
    // Arm first so an interrupted save still leaves the next run in discovery.
    writeJSON(path.join(paths.root, ".check-run"), check);
    writeJSON(file, state);
    return { checkRun: true, tasks: check.tasks };
  });
}

export function heartbeat(studioRoot, action, task, { reason = "", now = new Date() } = {}) {
  if (!["start", "done", "fail"].includes(action)) throw new Error("Choose start, done or fail for the routine check.");
  if (!ROUTINE_TASKS.some((t) => t.id === task)) throw new Error("Choose reel-publish or daily-posts for the routine check.");
  if (action === "fail" && (!reason.trim() || reason.length > 160 || /[\r\n]/.test(reason))) throw new Error("Use a short reason for the routine check.");
  return withHeartbeat(studioRoot, (paths) => {
    const setup = read(routineSetupFile(paths.root), null);
    const nonce = setup?.nonce || null;
    const marker = path.join(paths.root, ".check-run");
    const check = read(marker, null);
    if (check && (!nonce || check.nonce !== nonce)) throw new Error("Open Reels setup and start the routine check again.");
    const file = path.join(paths.root, "heartbeat.json");
    const state = readHeartbeat(file);
    const previous = state.tasks[task] || {};
    const at = now.toISOString();
    let record;
    if (action === "start") {
      record = { nonce, status: "started", at, startedAt: at, checkRun: !!check, checkId: check?.id || null };
      if (previous.checkDone?.nonce === nonce) record.checkDone = previous.checkDone;
    } else {
      if (previous.status !== "started" || previous.nonce !== nonce) throw new Error("Start the routine check before finishing it.");
      if (previous.checkRun && (!check || previous.checkId !== check.id)) throw new Error("Open Reels setup and start the routine check again.");
      if (action === "done" && previous.checkRun && !previous.discoveredAt) throw new Error("Finish discovery before marking the routine check done.");
      record = { ...previous, status: action, at };
      if (action === "fail") record.reason = reason.trim();
      if (action === "done" && previous.checkRun) record.checkDone = { nonce, id: check.id, at };
    }
    state.tasks[task] = record;
    writeJSON(file, state);
    if (check && check.tasks.every((id) => state.tasks[id]?.checkDone?.id === check.id)) fs.unlinkSync(marker);
    return { task, ...record };
  });
}

/** Local discovery cannot render, host media, run a model or call a posting service. */
export function discoverHeartbeat(studioRoot, task, { now = new Date() } = {}) {
  return withHeartbeat(studioRoot, (paths) => {
    const setup = setupAt(paths.root);
    const check = read(path.join(paths.root, ".check-run"), null);
    const file = path.join(paths.root, "heartbeat.json");
    const state = readHeartbeat(file);
    const record = state.tasks[task];
    if (!check || check.nonce !== setup.nonce || record?.status !== "started" || !record.checkRun || record.checkId !== check.id) throw new Error("Start the routine check before discovery.");
    const studio = loadStudio(paths.root);
    const brand = {};
    for (const name of ["brand.json", "voice.md", "brand-guide.md"]) {
      try { brand[name] = fs.readFileSync(path.join(paths.brand, name), "utf8"); }
      catch (e) { if (e.code !== "ENOENT" || name === "brand.json") throw new Error("The brand could not be read. Open Reels setup and check the Brand folder."); }
    }
    const folders = [...new Set([photosDir(studio.config, paths), paths.publish, paths.made])].map((folder) => ({ folder, entries: fs.readdirSync(folder) }));
    record.discoveredAt = now.toISOString();
    writeJSON(file, state);
    return { checkRun: true, brand, folders };
  });
}

/** Router entry point; kept here so the command router needs only one import. */
export function heartbeatCommand(args) {
  const { values, positionals } = parseArgs({ args, options: { studio: { type: "string" } }, allowPositionals: true, strict: true });
  const [action, task, ...rest] = positionals;
  let result;
  if (action === "check" && !task) result = checkHeartbeats(values.studio);
  else if (action === "discover" && task && !rest.length) result = discoverHeartbeat(values.studio, task);
  else if (["start", "done", "fail"].includes(action) && task && (action === "fail" ? rest.length === 1 : rest.length === 0)) result = heartbeat(values.studio, action, task, { reason: rest[0] });
  else throw new Error("Use heartbeat check, or heartbeat start, discover, done or fail with a task name.");
  console.log(JSON.stringify(result));
  return result;
}

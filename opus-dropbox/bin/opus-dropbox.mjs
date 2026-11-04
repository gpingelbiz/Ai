#!/usr/bin/env node
/**
 * Opus Dropbox: unedited videos dropped in a Dropbox folder go to Opus Clip, and the finished clips come back into
 * another Dropbox folder by themselves.
 *
 *   opus-dropbox setup          ask the setup questions and start the background job (re-run to change anything)
 *   opus-dropbox run            one pass (what the background job runs every 5 minutes)
 *   opus-dropbox status         what is waiting, in Opus, done or failed, and when it last ran
 *   opus-dropbox check          test the Opus key and the Dropbox sign-in and folders (changes nothing)
 *   opus-dropbox send <name>    send a video that setup left alone, or one that failed and is still in the drop folder
 *   opus-dropbox stop | start   pause or resume the background job
 *
 * Everything lives in ~/Library/Application Support/Opus Dropbox (see src/store.mjs).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDropbox } from "../src/dropbox.mjs";
import { createOpus } from "../src/opus.mjs";
import { runOnce, S, join } from "../src/pipeline.mjs";
import { home, loadConfig, loadState, saveState, missing, lock, log, notify, logPath } from "../src/store.mjs";
import * as agent from "../src/launchd.mjs";

const script = fileURLToPath(import.meta.url);
const appDir = path.dirname(path.dirname(script));
const [cmd = "help", ...args] = process.argv.slice(2);

// config.endpoints points the tool at other hosts (the tests' fake Dropbox and Opus); real installs never set it.
const clients = (c) => ({
  dropbox: createDropbox({ appKey: c.dropbox.appKey, refreshToken: c.dropbox.refreshToken, pathRoot: c.dropbox.pathRoot,
    ...(c.endpoints?.dropboxApi ? { api: c.endpoints.dropboxApi, content: c.endpoints.dropboxContent } : {}) }),
  opus: createOpus({ apiKey: c.opus.apiKey, orgId: c.opus.orgId, ...(c.endpoints?.opus ? { api: c.endpoints.opus } : {}) }),
});

async function run() {
  const c = loadConfig();
  const gaps = missing(c);
  if (gaps.length) { log("not_set_up", { missing: gaps }); console.log(JSON.stringify({ ok: false, missing: gaps })); return; }
  const unlock = lock();
  if (!unlock) { console.log(JSON.stringify({ ok: true, skipped: "another run is going" })); return; }
  const state = loadState();
  try {
    const report = await runOnce({ c, state, ...clients(c), log, notify: (t, m) => notify(c, t, m), save: () => saveState(state) });
    if (state.failingSince) { delete state.failingSince; saveState(state); }
    if (report.sent || report.delivered || report.failed) log("run", report);
    console.log(JSON.stringify({ ok: true, ...report }));
  } catch (e) {
    log("run_error", { error: e.message });
    // A whole run failing for half an hour (not a laptop waking up offline) needs a person: say so twice a day at most.
    state.failingSince ||= new Date().toISOString();
    const failingFor = Date.now() - Date.parse(state.failingSince);
    if (failingFor > 30 * 60000 && Date.now() - Date.parse(state.errorNotifiedAt || 0) > 12 * 3600 * 1000) {
      if (/Dropbox (400|401)/.test(e.message)) notify(c, "Dropbox needs signing in again", "Run the Opus Dropbox installer again and click Allow.");
      else if (/not_found/.test(e.message)) notify(c, "The Dropbox drop folder is gone", `${c.folders.drop} was moved or renamed. Run the installer again to pick it.`);
      else notify(c, "Opus Dropbox is not running right", e.message.slice(0, 120));
      state.errorNotifiedAt = new Date().toISOString();
    }
    saveState(state);
    console.log(JSON.stringify({ ok: false, error: e.message }));
    process.exitCode = 1;
  } finally {
    unlock();
  }
}

function status() {
  const c = loadConfig();
  const state = loadState();
  const gaps = missing(c);
  console.log(`Opus Dropbox (${home()})`);
  if (gaps.length) console.log(`Not set up yet: missing ${gaps.join(", ")}. Run setup.`);
  console.log(`Dropbox: ${c.dropbox.account || "not connected"}`);
  console.log(`Drop folder: ${c.folders.drop || "-"}   Finished clips: ${c.folders.finished || "-"}`);
  console.log(`Background job: ${agent.loaded() ? "on (every 5 minutes)" : "OFF"}`);
  console.log(`Last run: ${state.lastRun || "never"}${state.lastReport?.blocked ? `  (${state.lastReport.blocked})` : ""}`);
  const groups = [
    [S.SENDING, "Being sent"], [S.IN_OPUS, "In Opus"], [S.DELIVERING, "Clips going into Dropbox"], [S.WAITING, "Waiting to be sent"],
    [S.FAILED, "Needs a look"], [S.EXISTING, "Left alone at setup (opus-dropbox send <name> to send one)"],
  ];
  const all = Object.values(state.items || {});
  for (const [s, label] of groups) {
    const list = all.filter((it) => it.status === s);
    if (!list.length) continue;
    console.log(`\n${label} (${list.length}):`);
    for (const it of list.slice(0, 20)) {
      const extra = s === S.IN_OPUS ? `  ${it.stage || ""} since ${it.sentAt}` : s === S.FAILED ? `  ${it.error}` : s === S.DELIVERING ? `  ${(it.saved || []).length} saved` : "";
      console.log(`  ${it.name}${extra}`);
    }
  }
  const done = all.filter((it) => it.status === S.DONE).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  if (done.length) {
    console.log(`\nDone (${done.length}), latest:`);
    for (const it of done.slice(0, 5)) console.log(`  ${it.name}: ${it.clips} clips in ${it.dest} (${it.doneAt})`);
  }
  console.log(`\nLog: ${logPath()}`);
}

async function check() {
  const c = loadConfig();
  const gaps = missing(c);
  if (gaps.length) { console.log(`Not set up yet: missing ${gaps.join(", ")}. Run setup.`); process.exitCode = 1; return; }
  const { dropbox, opus } = clients(c);
  let ok = true;
  const line = async (label, fn) => {
    try { console.log(`ok    ${label}${(await fn()) || ""}`); }
    catch (e) { ok = false; console.log(`FAIL  ${label}: ${e.message}`); }
  };
  await line("Opus key", async () => { const t = await opus.templates(); return ` (${(t || []).length} brand templates)`; });
  await line("Dropbox sign-in", async () => { const a = await dropbox.account(); return ` (${a.email})`; });
  await line(`drop folder ${c.folders.drop}`, async () => { const n = (await dropbox.list(c.folders.drop)).filter((e) => e[".tag"] === "file").length; return ` (${n} files)`; });
  await line(`finished folder ${c.folders.finished}`, async () => { if (!(await dropbox.exists(c.folders.finished))) throw new Error("not there"); });
  await line("background job", async () => { if (!agent.loaded()) throw new Error("off (opus-dropbox start)"); });
  if (!ok) process.exitCode = 1;
}

function send(name) {
  const state = loadState();
  const hits = Object.values(state.items || {}).filter((it) => it.name === name);
  const it = hits.find((x) => x.status === S.EXISTING || (x.status === S.FAILED && !x.filed));
  if (!it) {
    console.log(hits.length ? `${name} is ${hits[0].status}. A failed video that was moved to Needs a look is sent again by moving it back into the drop folder.` : `No video called ${name} in the drop folder list. Run status to see the names.`);
    process.exitCode = 1;
    return;
  }
  Object.assign(it, { status: S.WAITING, error: null, seenAt: new Date().toISOString() });
  saveState(state);
  console.log(`${name} goes to Opus on the next run (within 5 minutes).`);
}

const commands = {
  setup: async () => (await import("../src/setup.mjs")).setup({ appDir, script }),
  run, status, check,
  send: () => send(args.join(" ")),
  stop: () => { agent.stop(); console.log("Background job stopped. opus-dropbox start turns it back on."); },
  start: () => { agent.start(); console.log("Background job is on (every 5 minutes)."); },
  help: () => console.log(`Usage: opus-dropbox setup | run | status | check | send <name> | stop | start\nVideos: <drop folder> -> Opus -> ${join("<finished folder>", "<video name>")}`),
};

Promise.resolve()
  .then(() => (commands[cmd] || commands.help)())
  .catch((e) => { console.error(e.message); process.exitCode = 1; });

/**
 * The setup questions, asked in Terminal by the installer (or `opus-dropbox setup` to change anything later; every
 * answer you leave blank keeps what was there).
 *
 *   1. The Opus API key (Opus: Settings, API). It is checked right away by listing the account's brand templates.
 *   2. Which brand template and clip length Opus uses.
 *   3. Dropbox sign-in: the browser opens Dropbox, the client clicks Allow, and Dropbox hands this Mac a long-lived
 *      sign-in (PKCE, so the kit carries no app secret).
 *   4. The drop folder and the finished folder.
 *   5. Videos already in the drop folder are left alone unless you say to send them (each one costs Opus credits).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { spawn } from "node:child_process";
import { API as DROPBOX_API, AUTHORIZE, createDropbox } from "./dropbox.mjs";
import { createOpus } from "./opus.mjs";
import { join, S, VIDEO } from "./pipeline.mjs";
import { home, loadConfig, loadState, saveConfig, saveState, log } from "./store.mjs";
import * as agent from "./launchd.mjs";

export const REDIRECT_PORT = 53682;
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The Dropbox sign-in page address plus what is needed to finish the sign-in afterwards. */
export function signInRequest(appKey, port = REDIRECT_PORT) {
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(16));
  const redirect = `http://localhost:${port}/dropbox`;
  const url = `${AUTHORIZE}?${new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    token_access_type: "offline",
    redirect_uri: redirect,
    state,
  })}`;
  return { url, verifier, state, redirect };
}

/** Open Dropbox in the browser, wait for the Allow click to come back to this Mac, and trade it for a refresh token. */
export async function dropboxSignIn(appKey, { port = REDIRECT_PORT, api = DROPBOX_API, fetch = globalThis.fetch, say = console.log,
  openUrl = (url) => spawn("open", [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref() } = {}) {
  const req = signInRequest(appKey, port);
  const servers = [];
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no answer from Dropbox within 10 minutes")), 10 * 60000);
    const page = (res, status, text) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>Opus Dropbox</title><body style="font:18px -apple-system,sans-serif;margin:48px">${text}</body>`);
    };
    const handler = (rq, res) => {
      const u = new URL(rq.url, req.redirect);
      if (u.pathname !== "/dropbox") { res.writeHead(404); res.end(); return; }
      if (u.searchParams.get("state") !== req.state) { page(res, 400, "That sign-in link is old. Go back to Terminal and try again."); return; }
      if (u.searchParams.get("error")) {
        page(res, 200, "Dropbox was not connected. You can close this tab.");
        clearTimeout(timer);
        reject(new Error(`Dropbox said: ${u.searchParams.get("error_description") || u.searchParams.get("error")}`));
        return;
      }
      page(res, 200, "Dropbox is connected. You can close this tab and go back to Terminal.");
      clearTimeout(timer);
      resolve(u.searchParams.get("code"));
    };
    // The browser may send "localhost" to either the IPv4 or the IPv6 loopback, so listen on both (never the network).
    let failed = 0;
    for (const host of ["127.0.0.1", "::1"]) {
      const s = http.createServer(handler);
      s.on("error", () => { if (++failed === 2) reject(new Error(`port ${port} is busy; close the app using it and run setup again`)); });
      s.listen(port, host);
      servers.push(s);
    }
    say(`\nDropbox is opening in your browser. Sign in to the Dropbox account the videos are in.\nIf it says "Before you connect this app...", click Continue (the app is new). Then click Allow.\nIf nothing opens, paste this into the browser:\n${req.url}\n`);
    openUrl(req.url);
  }).finally(() => servers.forEach((s) => s.close()));

  const r = await fetch(`${api}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, grant_type: "authorization_code", client_id: appKey, code_verifier: req.verifier, redirect_uri: req.redirect }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw new Error(`Dropbox sign-in did not finish: ${j.error_description || j.error || r.status}`);
  return j.refresh_token;
}

/** Team accounts keep the team's folders under a root namespace; a personal account needs nothing extra. */
export function pathRootOf(account) {
  const r = account?.root_info;
  return r && r[".tag"] === "team" && r.root_namespace_id !== r.home_namespace_id ? r.root_namespace_id : "";
}

export const CLIP_LENGTHS = [
  ["Opus picks (up to 90 seconds)", null],
  ["Under 30 seconds", [[0, 30]]],
  ["30 to 60 seconds", [[30, 60]]],
  ["60 to 90 seconds", [[60, 90]]],
  ["90 seconds to 3 minutes", [[90, 180]]],
];

/** The kit's Dropbox app key, from kit.json next to the tool. */
export function kitAppKey(appDir) {
  try { return JSON.parse(fs.readFileSync(path.join(appDir, "kit.json"), "utf8")).dropboxAppKey || ""; } catch { return ""; }
}

export async function setup({ appDir, node = process.execPath, script }) {
  // readline echoes typed keys itself, so a key is hidden by muting its output while it is typed (stty is not enough).
  let muted = false;
  const output = new Writable({ write(chunk, enc, done) { if (!muted) process.stdout.write(chunk, enc); done(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  const ask = async (q, def = "") => (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def;
  const askSecret = async (q) => {
    process.stdout.write(`${q}: `);
    muted = true;
    try { return (await rl.question("")).trim(); } finally { muted = false; process.stdout.write("\n"); }
  };
  const c = loadConfig();
  try {
    console.log("\nOpus Dropbox setup. Press Enter on any question to keep what is shown in [brackets].\n");

    // 1) Opus key.
    let templates;
    for (;;) {
      const key = await askSecret(c.opus.apiKey ? "Opus API key (Enter keeps the saved one)" : "Opus API key (in Opus: Settings, API)");
      if (key) c.opus.apiKey = key;
      if (!c.opus.apiKey) { console.log("An Opus API key is needed. Opus gives one on the Pro plan and up."); continue; }
      try { templates = (await createOpus({ apiKey: c.opus.apiKey, orgId: c.opus.orgId }).templates()) || []; break; }
      catch (e) { console.log(`That key did not work: ${e.message}`); c.opus.apiKey = ""; }
    }
    console.log(`Opus key works (${templates.length} brand template${templates.length === 1 ? "" : "s"}).`);

    // 2) Template and clip length.
    if (templates.length) {
      const def = templates.find((t) => t.isDefault);
      console.log("\nWhich brand template should the clips use?");
      console.log(`  0) Opus's default${def ? ` (${def.name})` : ""}`);
      templates.forEach((t, i) => console.log(`  ${i + 1}) ${t.name}`));
      const now = templates.findIndex((t) => t.templateId === c.opus.project.brandTemplateId) + 1;
      const pick = Number(await ask("Number", String(now)));
      if (pick >= 1 && pick <= templates.length) c.opus.project.brandTemplateId = templates[pick - 1].templateId;
      else delete c.opus.project.brandTemplateId;
    }
    console.log("\nHow long should the clips be?");
    CLIP_LENGTHS.forEach(([label], i) => console.log(`  ${i}) ${label}`));
    const nowLen = Math.max(0, CLIP_LENGTHS.findIndex(([, d]) => JSON.stringify(d) === JSON.stringify(c.opus.project.curationPref?.clipDurations ?? null)));
    const len = CLIP_LENGTHS[Number(await ask("Number", String(nowLen)))] || CLIP_LENGTHS[0];
    if (len[1]) c.opus.project.curationPref = { ...c.opus.project.curationPref, clipDurations: len[1] };
    else if (c.opus.project.curationPref) { delete c.opus.project.curationPref.clipDurations; if (!Object.keys(c.opus.project.curationPref).length) delete c.opus.project.curationPref; }

    // 3) Dropbox sign-in.
    c.dropbox.appKey ||= kitAppKey(appDir);
    if (!c.dropbox.appKey) throw new Error("this kit has no Dropbox app key (kit.json is missing)");
    const again = c.dropbox.refreshToken ? (await ask(`\nDropbox is connected to ${c.dropbox.account || "an account"}. Connect a different account? (y/n)`, "n")).toLowerCase().startsWith("y") : true;
    if (again) c.dropbox.refreshToken = await dropboxSignIn(c.dropbox.appKey);
    let dropbox = createDropbox({ appKey: c.dropbox.appKey, refreshToken: c.dropbox.refreshToken });
    const account = await dropbox.account();
    c.dropbox.pathRoot = pathRootOf(account);
    c.dropbox.account = `${account.name?.display_name || ""} <${account.email || ""}>`.trim();
    dropbox = createDropbox({ appKey: c.dropbox.appKey, refreshToken: c.dropbox.refreshToken, pathRoot: c.dropbox.pathRoot });
    console.log(`Dropbox connected: ${c.dropbox.account}${c.dropbox.pathRoot ? " (team folders)" : ""}.`);

    // 4) Folders.
    const top = (await dropbox.list("")).filter((e) => e[".tag"] === "folder").map((e) => e.path_display).sort((a, b) => a.localeCompare(b));
    const pickFolder = async (label, current, { create }) => {
      console.log(`\n${label}`);
      top.forEach((p, i) => console.log(`  ${i + 1}) ${p}`));
      for (;;) {
        const a = await ask("Type a number, or a full path like /Videos/Unedited", current);
        const p = /^\d+$/.test(a) ? top[Number(a) - 1] : a && join(a);
        if (!p || p === "/") { console.log("Pick a folder (not the top of Dropbox)."); continue; }
        if (await dropbox.exists(p)) return p;
        if (create && (await ask(`${p} is not there. Make it? (y/n)`, "y")).toLowerCase().startsWith("y")) return dropbox.createFolder(p);
        console.log(`${p} is not in this Dropbox.`);
      }
    };
    c.folders.drop = await pickFolder("Which Dropbox folder do the unedited videos go in?", c.folders.drop, { create: true });
    c.folders.finished = await pickFolder("Which Dropbox folder should the finished clips go in?", c.folders.finished || "/Opus Clips", { create: true });
    if (c.folders.finished.toLowerCase() === c.folders.drop.toLowerCase()) throw new Error("the finished folder has to be a different folder from the drop folder");

    // 5) What is already in the drop folder.
    const state = loadState();
    state.items ||= {};
    const already = (await dropbox.list(c.folders.drop)).filter((e) => e[".tag"] === "file" && !e.name.startsWith(".") && VIDEO.test(e.name) && !state.items[e.id]);
    let sendOld = false;
    if (already.length) {
      console.log(`\n${already.length} video${already.length === 1 ? " is" : "s are"} already in ${c.folders.drop}:`);
      already.slice(0, 10).forEach((e) => console.log(`  ${e.name}`));
      if (already.length > 10) console.log(`  ...and ${already.length - 10} more`);
      sendOld = (await ask("Send these to Opus too? Each one uses Opus credits (at least 10). (y/n)", "n")).toLowerCase().startsWith("y");
    }
    const stamp = new Date().toISOString();
    for (const e of already) state.items[e.id] = { name: e.name, path: e.path_display, size: e.size, status: sendOld ? S.WAITING : S.EXISTING, seenAt: stamp };
    saveState(state);
    saveConfig(c);
    log("setup", { account: c.dropbox.account, drop: c.folders.drop, finished: c.folders.finished, existing: already.length, sendOld });

    agent.install({ node, script, home: home() });
    console.log(`
All set. Every 5 minutes while this Mac is awake:
  a video dropped in ${c.folders.drop} goes to Opus,
  its clips land in ${c.folders.finished}/<video name>/ with a caption file for each,
  and the original moves to ${join(c.folders.drop, c.folders.done)}.
A video that fails goes to ${join(c.folders.drop, c.folders.needsLook)} with a note.
`);
  } finally {
    rl.close();
  }
}

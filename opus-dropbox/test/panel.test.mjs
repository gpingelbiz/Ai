import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { serve } from "../src/panel.mjs";
import { page } from "../src/panel-page.mjs";
import { installPanel, uninstallPanel, panelPlistPath, shortcutPath } from "../src/launchd.mjs";
import { fakeDropbox, fakeOpus } from "./fakes.mjs";

test("panel security, read only loads, shared actions, isolated sections and capped reels", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-panel-"));
  const oldHome = process.env.OPUS_DROPBOX_HOME;
  process.env.OPUS_DROPBOX_HOME = home;
  let server, db, op;
  try {
    db = await fakeDropbox(); op = await fakeOpus();
    db.folder("/drop"); db.folder("/clips");
    db.put("/drop/Done/video.mp4");
    db.put("/clips/2026-11-05 Reel 1/<hostile>.mp4");
    db.put("/clips/2026-11-05 Reel 1/caption.txt", "x".repeat(70000));
    const c = { folders: { drop: "/drop", finished: "/clips" }, opus: { apiKey: "opus-key", project: {} },
      dropbox: { appKey: "hidden-app", refreshToken: "hidden-refresh" },
      endpoints: { opus: op.url, dropboxApi: db.api, dropboxContent: db.content } };
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(c));
    const stateFile = path.join(home, "state.json");
    fs.writeFileSync(stateFile, JSON.stringify({ watchedAt: "2026-01-01", items: {
      a: { name: 'video.mp4', path: "/drop/Done/video.mp4", status: "done", filed: true, link: "https://www.dropbox.com/scl/secret-share" },
      b: { name: '<img src=x onerror=alert(1)> hidden-refresh', status: "failed", error: "opus-key https://example.org/secret-share", link: "hidden-app" },
    } }));
    const bytes = fs.readFileSync(stateFile);
    let on = true;
    server = await serve({ port: 0, job: { loaded: () => on, stop: () => { on = false; }, start: () => { on = true; } } });
    assert.equal(server.address().address, "127.0.0.1");
    const base = "http://127.0.0.1:" + server.address().port;
    const html = await (await fetch(base)).text();
    const token = html.match(/const token = "([a-f0-9]+)"/)[1];
    const headers = { "Content-Type": "application/json", Origin: base, "X-Panel-Token": token };
    const post = (route, data, h = headers) => fetch(base + "/api/" + route, { method: "POST", headers: h, body: JSON.stringify(data) });
    for (const h of [
      { ...headers, "X-Panel-Token": "" }, { ...headers, Origin: "" },
      { ...headers, Origin: "https://foreign.example" }, { ...headers, "Content-Type": "text/plain" },
    ]) assert.equal((await post("settings", { kind: "length", value: 2 }, h)).status, 403);
    for (const route of ["/", "/api/health", "/api/videos", "/api/settings", "/missing"]) {
      const r = await fetch(base + route), text = await r.text();
      assert.doesNotMatch(text, /hidden-app|hidden-refresh|opus-key|secret-share/);
      assert.equal(r.headers.get("access-control-allow-origin"), null);
      assert.equal(r.headers.get("x-frame-options"), "DENY");
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
    }
    assert.deepEqual(fs.readFileSync(stateFile), bytes);
    assert.equal((await post("settings", { kind: "length", value: 2 })).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "config.json"))).opus.project.curationPref.clipDurations, [[30, 60]]);
    const configBytes = fs.readFileSync(path.join(home, "config.json"));
    assert.equal((await post("settings", { kind: "length", value: 1.2 })).status, 400);
    assert.deepEqual(fs.readFileSync(path.join(home, "config.json")), configBytes);
    assert.equal((await post("recut", { id: "a" })).status, 400);
    assert.equal((await post("recut", { id: "a", confirm: true })).status, 200);
    assert.equal((await post("recut", { id: "a", confirm: true })).status, 400);
    assert.equal(db.calls.filter((c) => c.route === "files/move_v2").length, 1);
    fs.mkdirSync(path.join(home, ".lock"));
    assert.match(await (await post("settings", { kind: "length", value: 1 })).text(), /Another run is going, try again shortly/);
    fs.rmdirSync(path.join(home, ".lock"));
    assert.equal((await post("job", { action: "pause" })).status, 400);
    assert.equal((await post("job", { action: "pause", confirm: true })).status, 200); assert.equal(on, false);
    assert.equal((await post("job", { action: "resume" })).status, 200); assert.equal(on, true);
    const reels = await (await post("reels", { limit: 30 })).json();
    assert.equal(reels.reels[0].caption.length, 65536);
    assert.equal(reels.reels[0].title, "<hostile>");
    assert.equal(reels.reels[0].url, "https://www.dropbox.com/home/clips/2026-11-05%20Reel%201");
    const listCalls = db.calls.length;
    await post("reels", { limit: 60 });
    assert.equal(db.calls.length, listCalls);
    c.endpoints.opus = "http://127.0.0.1:1";
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(c));
    assert.ok((await (await fetch(base + "/api/settings")).json()).error);
    assert.equal((await fetch(base + "/api/videos")).status, 200);
    assert.equal((await post("reels", { limit: 30 })).status, 200);
    assert.equal((await (await fetch(base + "/api/health")).json()).ok, false);
    assert.deepEqual(fs.readFileSync(stateFile), bytes);
    assert.equal((await post("settings", { padding: "x".repeat(17000) })).status, 400);
  } finally {
    await new Promise((resolve) => server ? server.close(resolve) : resolve());
    db?.close(); op?.close();
    if (oldHome === undefined) delete process.env.OPUS_DROPBOX_HOME; else process.env.OPUS_DROPBOX_HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("page renders hostile text through textContent with no HTML insertion", async () => {
  const html = page("test");
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document.write/);
  const elements = [];
  class Element {
    constructor() { this.children = []; elements.push(this); }
    append(el) { this.children.push(el); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
  }
  const ids = new Map();
  const document = { getElementById: (id) => { if (!ids.has(id)) ids.set(id, new Element()); return ids.get(id); }, createElement: () => new Element() };
  const hostile = "<img src=x onerror=alert(1)>";
  const responses = {
    health: { ok: true, problems: [], job: true, counts: {} },
    videos: { items: [{ name: hostile, status: "failed", error: hostile }] },
    settings: { folders: {}, templates: [], lengths: [], template: 0, length: 0 },
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document, Date, fetch: async (url) => ({ ok: true, json: async () => responses[url.split("/").at(-1)] }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(elements.some((el) => el.textContent === hostile));
});

test("panel install uses HOME, keeps run agent separate and is idempotent", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-panel-agent-")), previous = process.env.HOME;
  process.env.HOME = home;
  try {
    const calls = [], launch = (...args) => { calls.push(args); return { status: 0 }; };
    const opts = { node: "/node", script: "/app/bin/opus-dropbox.mjs", home };
    installPanel(opts, { launch });
    const before = fs.readFileSync(panelPlistPath(), "utf8");
    installPanel(opts, { launch });
    assert.equal(fs.readFileSync(panelPlistPath(), "utf8"), before);
    assert.match(before, /KeepAlive/); assert.match(before, /RunAtLoad/);
    assert.match(before, /<string>panel<\/string>/);
    assert.match(before, /panel.log/); assert.doesNotMatch(before, /StartInterval/);
    assert.match(fs.readFileSync(shortcutPath(), "utf8"), /http:\/\/127.0.0.1:53690/);
    assert.ok(calls.every((call) => !JSON.stringify(call).includes('com.pingel.opus-dropbox"')));
    uninstallPanel({ launch });
    assert.equal(fs.existsSync(panelPlistPath()), false); assert.equal(fs.existsSync(shortcutPath()), false);
  } finally {
    if (previous === undefined) delete process.env.HOME; else process.env.HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("direct handler enforces security and preserves state without setup or network access", async () => {
  const { panelHandler } = await import("../src/panel.mjs");
  const { Readable } = await import("node:stream");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-panel-handler-")), previous = process.env.OPUS_DROPBOX_HOME;
  process.env.OPUS_DROPBOX_HOME = home;
  try {
    const file = path.join(home, "state.json");
    fs.writeFileSync(file, JSON.stringify({ watchedAt: "unchanged", items: { a: { name: "<hostile>", status: "done", link: "https://example.org/share" } } }));
    const before = fs.readFileSync(file);
    const handler = panelHandler({ job: { loaded: () => false } });
    const request = async (url, method = "GET", data, headers = {}) => {
      const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
      Object.assign(req, { url, method, headers: { host: "127.0.0.1:53690", ...headers } });
      let status, responseHeaders, result;
      await handler(req, { writeHead: (s, h) => { status = s; responseHeaders = h; }, end: (text) => { result = text; } });
      return { status, headers: responseHeaders, text: result };
    };
    assert.equal((await request("/", "GET", undefined, { host: "bad.example" })).status, 403);
    const html = await request("/");
    const token = html.text.match(/const token = "([a-f0-9]+)"/)[1];
    const valid = { origin: "http://127.0.0.1:53690", "content-type": "application/json", "x-panel-token": token };
    for (const headers of [
      { ...valid, "x-panel-token": "" }, { ...valid, origin: "" },
      { ...valid, origin: "https://other.example" }, { ...valid, "content-type": "text/plain" },
    ]) assert.equal((await request("/api/settings", "POST", {}, headers)).status, 403);
    for (const route of ["/api/health", "/api/videos"]) {
      const r = await request(route);
      assert.equal(r.status, 200); assert.doesNotMatch(r.text, /example.org/);
    }
    assert.equal((await request("/api/settings", "POST", { kind: "length", value: 2 }, valid)).status, 200);
    assert.equal((await request("/api/settings", "POST", { kind: "length", value: -1 }, valid)).status, 400);
    assert.equal((await request("/api/recut", "POST", { id: "a" }, valid)).status, 400);
    const configFile = path.join(home, "config.json");
    const c = JSON.parse(fs.readFileSync(configFile));
    c.opus.apiKey = "secret-opus"; c.dropbox.appKey = "secret-app"; c.dropbox.refreshToken = "secret-refresh";
    c.endpoints = { opus: "http://127.0.0.1:1" };
    fs.writeFileSync(configFile, JSON.stringify(c));
    fs.writeFileSync(file, JSON.stringify({ watchedAt: "unchanged", items: { a: {
      name: "<hostile> secret-refresh", error: "secret-opus https://example.org/share", status: "failed",
      link: "secret-app", refreshToken: "secret-refresh", projectId: "secret-opus",
    } } }));
    const secretBytes = fs.readFileSync(file);
    for (const route of ["/api/health", "/api/videos", "/api/settings"]) {
      const r = await request(route);
      assert.equal(r.status, 200); assert.doesNotMatch(r.text, /secret-opus|secret-app|secret-refresh|example.org/);
    }
    assert.deepEqual(fs.readFileSync(file), secretBytes);
    fs.writeFileSync(file, before);
    fs.mkdirSync(path.join(home, ".lock"));
    assert.match((await request("/api/settings", "POST", { kind: "length", value: 1 }, valid)).text, /Another run is going, try again shortly/);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal((await request("/api/settings", "POST", { large: "x".repeat(17000) }, valid)).status, 400);
  } finally {
    if (previous === undefined) delete process.env.OPUS_DROPBOX_HOME; else process.env.OPUS_DROPBOX_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("caption downloads cancel at 64 KB without reading the remaining stream", async () => {
  const { createDropbox } = await import("../src/dropbox.mjs");
  let cancelled = false, reads = 0;
  const db = createDropbox({ appKey: "", refreshToken: "", fetch: async (url) => {
    if (url.endsWith("/oauth2/token")) return { ok: true, json: async () => ({ access_token: "hidden" }) };
    return { ok: true, body: { getReader: () => ({
      read: async () => { reads++; return { value: Buffer.alloc(100000, "a"), done: false }; },
      cancel: async () => { cancelled = true; },
    }) } };
  } });
  assert.equal((await db.downloadText("/caption.txt")).length, 65536);
  assert.equal(reads, 1); assert.equal(cancelled, true);
});

test("server binds IPv4 loopback and explains a busy port", async (t) => {
  const http = (await import("node:http")).default;
  let host, error;
  const stub = { once: (event, fn) => { error = fn; }, address: () => ({ port: 53690 }),
    listen: (port, address, done) => { host = address; done(); } };
  t.mock.method(http, "createServer", () => stub);
  assert.equal(await serve(), stub); assert.equal(host, "127.0.0.1");
  stub.listen = () => error(Object.assign(new Error("busy"), { code: "EADDRINUSE" }));
  await assert.rejects(serve(), /Port 53690 is busy/);
});

test("direct recut moves once, keeps state, and reels paginate newest first", async (t) => {
  const { panelHandler } = await import("../src/panel.mjs");
  const { Readable } = await import("node:stream");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-panel-recut-")), previous = process.env.OPUS_DROPBOX_HOME;
  process.env.OPUS_DROPBOX_HOME = home;
  let moved = false, moves = 0, listings = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "private-access" });
    const arg = JSON.parse(init.body || init.headers["Dropbox-API-Arg"]);
    if (url.endsWith("/files/get_metadata")) return moved ? Response.json({ error_summary: "path/not_found" }, { status: 409 }) : Response.json({});
    if (url.endsWith("/files/move_v2")) {
      moves++; moved = true;
      assert.equal(arg.from_path, "/drop/Done/video.mp4"); assert.equal(arg.to_path, "/drop/video.mp4");
      return Response.json({ metadata: { path_display: "/drop/video.mp4" } });
    }
    if (url.endsWith("/files/list_folder")) {
      listings++;
      const entries = arg.path === "/clips" ? Array.from({ length: 31 }, (_, n) => ({
        ".tag": "folder", name: "2026-11-05 Reel " + (n + 1), path_display: "/clips/2026-11-05 Reel " + (n + 1),
      })) : [
        { ".tag": "file", name: "<hostile>.mp4" },
        { ".tag": "file", name: "caption.txt", path_display: arg.path + "/caption.txt" },
      ];
      return Response.json({ entries, has_more: false });
    }
    if (url.endsWith("/files/download")) return new Response("Caption https://example.org/share");
    throw new Error("Service is down");
  });
  try {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({
      opus: { apiKey: "opus-key", project: {} }, dropbox: { appKey: "app-key", refreshToken: "refresh-key" },
      folders: { drop: "/drop", finished: "/clips" },
    }));
    const file = path.join(home, "state.json");
    fs.writeFileSync(file, JSON.stringify({ watchedAt: "untouched", items: {
      a: { name: "video.mp4", path: "/drop/Done/video.mp4", status: "done", filed: true, link: "https://example.org/share" },
    } }));
    const before = fs.readFileSync(file);
    const handler = panelHandler({ job: { loaded: () => true } });
    let token;
    const request = async (url, data) => {
      const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []);
      Object.assign(req, { url, method: data ? "POST" : "GET", headers: {
        host: "localhost:53690", origin: "http://localhost:53690", "content-type": "application/json", "x-panel-token": token,
      } });
      let status, text;
      await handler(req, { writeHead: (s) => { status = s; }, end: (s) => { text = s; } });
      return { status, text };
    };
    token = (await request("/")).text.match(/const token = "([a-f0-9]+)"/)[1];
    assert.equal((await request("/api/recut", { id: "a" })).status, 400); assert.equal(moves, 0);
    assert.equal((await request("/api/recut", { id: "a", confirm: true })).status, 200);
    assert.equal((await request("/api/recut", { id: "a", confirm: true })).status, 400);
    assert.equal(moves, 1);
    const first = JSON.parse((await request("/api/reels", { limit: 30 })).text);
    assert.equal(first.reels.length, 30); assert.equal(first.more, true);
    assert.equal(first.reels[0].name, "2026-11-05 Reel 31");
    assert.equal(first.reels[0].title, "<hostile>");
    assert.doesNotMatch(JSON.stringify(first), /example.org/);
    const calls = listings;
    const next = JSON.parse((await request("/api/reels", { limit: 60 })).text);
    assert.equal(next.reels.length, 31); assert.equal(next.more, false);
    assert.equal(listings, calls + 1);
    assert.ok(JSON.parse((await request("/api/settings")).text).error);
    assert.equal((await request("/api/videos")).status, 200);
    assert.deepEqual(fs.readFileSync(file), before);
  } finally {
    if (previous === undefined) delete process.env.OPUS_DROPBOX_HOME; else process.env.OPUS_DROPBOX_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

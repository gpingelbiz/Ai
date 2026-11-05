/** A loopback only command center. No remote values are HTML. */
import http from "node:http";
import crypto from "node:crypto";
import { loadConfig, loadState, lock } from "./store.mjs";
import { clients, changeSetting, recutVideo } from "./actions.mjs";
import { scrub, watchReport } from "./watch.mjs";
import { CLIP_LENGTHS, templateLines } from "./setup.mjs";
import { join } from "./pipeline.mjs";
import * as agent from "./launchd.mjs";
import { page } from "./panel-page.mjs";
import { dropboxLink, reelFolders, reelEntry } from "./board.mjs";

export const PORT = 53690;
const clean = (value, c) => JSON.parse(JSON.stringify(value, (k, v) => typeof v === "string" ? scrub(v, c) : v));
async function body(req) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 16384) throw new Error("Request is too large.");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString());
}

export function panelHandler({ getPort = () => PORT, job = agent } = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  let cache, cachedAt = 0, cacheKey;
  return async (req, res) => {
    const reply = (status, value, html = false) => {
      res.writeHead(status, {
        "Content-Type": html ? "text/html; charset=utf-8" : "application/json",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        "X-Frame-Options": "DENY", "Cache-Control": "no-store",
      });
      res.end(html ? value : JSON.stringify(value));
    };
    const actualPort = getPort();
    if (![ `127.0.0.1:${actualPort}`, `localhost:${actualPort}` ].includes(req.headers.host)) return reply(403, { error: "Host refused." });
    let c;
    try {
      if (req.method === "POST") {
        const supplied = Buffer.from(req.headers["x-panel-token"] || "");
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] || "") ||
          req.headers.origin !== `http://${req.headers.host}` ||
          supplied.length !== token.length || !crypto.timingSafeEqual(supplied, Buffer.from(token))) return reply(403, { error: "Request refused." });
      }
      if (req.method === "GET" && req.url === "/") return reply(200, page(token), true);
      c = loadConfig();
      const api = clients(c);
      if (req.method === "GET" && req.url === "/api/health") return reply(200, await watchReport({ c, state: loadState(), clients: api, job: job.loaded() }));
      if (req.method === "GET" && req.url === "/api/videos") {
        const items = Object.entries(loadState().items || {}).map(([id, it]) => ({
          id, name: it.name, status: it.status, stage: it.stage, sentAt: it.sentAt, error: it.error,
          clips: it.clips, filed: Boolean(it.filed), doneAt: it.doneAt, saved: (it.saved || []).length,
        }));
        return reply(200, clean({ items }, c));
      }
      if (req.method === "GET" && req.url === "/api/settings") {
        let ts = [], error;
        try { if (!c.opus.apiKey) throw new Error("Opus is not set up yet."); ts = await api.opus.templates(); } catch (e) { error = scrub(e.message, c); }
        return reply(200, clean({
          templates: templateLines(ts), template: c.opus.project.brandTemplateId ? (ts.some((t) => t.templateId === c.opus.project.brandTemplateId) ? ts.findIndex((t) => t.templateId === c.opus.project.brandTemplateId) + 1 : -1) : 0,
          lengths: CLIP_LENGTHS.map(([label]) => label),
          length: CLIP_LENGTHS.findIndex(([, d]) => JSON.stringify(d) === JSON.stringify(c.opus.project.curationPref?.clipDurations ?? null)),
          folders: { drop: c.folders.drop, finished: c.folders.finished }, error,
        }, c));
      }
      if (req.method === "POST" && req.url === "/api/reels") {
        const b = await body(req);
        const limit = Number(b.limit || 30);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error("Choose a listed number.");
        const key = JSON.stringify([c.folders.finished, c.dropbox]);
        if (!cache || cacheKey !== key || Date.now() - cachedAt >= 60000) {
          if (!c.folders.finished) throw new Error("The finished folder is not set up.");
          cache = await reelFolders(api.dropbox, c.folders.finished);
          cacheKey = key; cachedAt = Date.now();
        }
        const reels = [];
        for (const folder of cache.slice(0, limit)) {
          if (!folder.panel) {
            try {
              folder.panel = await reelEntry(api.dropbox, folder, c);
            } catch (e) { folder.panel = { day: folder.name.slice(0, 10), name: scrub(folder.name, c), error: scrub(e.message, c) }; }
          }
          reels.push({ ...folder.panel, url: dropboxLink(scrub(folder.path_display, c)) });
        }
        return reply(200, { reels, more: cache.length > limit });
      }
      if (req.method === "POST" && ["/api/settings", "/api/recut", "/api/job"].includes(req.url)) {
        const b = await body(req);
        let message;
        if (req.url === "/api/settings") message = await changeSetting(b.kind, b.value);
        if (req.url === "/api/recut") {
          if (b.confirm !== true || typeof b.id !== "string") throw new Error("Confirm the video and credit cost first.");
          message = await recutVideo({ id: b.id, confirm: true });
        }
        if (req.url === "/api/job") {
          if (!["pause", "resume"].includes(b.action) || (b.action === "pause" && b.confirm !== true)) throw new Error("Confirm pausing the background job first.");
          const unlock = lock();
          if (!unlock) throw new Error("Another run is going, try again shortly");
          try { b.action === "pause" ? job.stop() : job.start(); message = "Background job " + (b.action === "pause" ? "paused." : "is on."); }
          finally { unlock(); }
        }
        return reply(200, { message: scrub(message, c) });
      }
      reply(404, { error: "Page not found." });
    } catch (e) {
      const message = /Another run is going/.test(e.message) ? "Another run is going, try again shortly" : (c ? scrub(e.message, c).replaceAll("re-cut", "another cut") : "Settings could not be read. Run setup to check them.");
      reply(400, { error: message });
    }
  };
}

export async function serve({ port = PORT, job = agent } = {}) {
  const server = http.createServer(panelHandler({ getPort: () => server.address().port, job }));
  await new Promise((resolve, reject) => {
    server.once("error", (e) => reject(new Error(e.code === "EADDRINUSE" ? `Port ${port} is busy. Close the app using it and try panel again.` : e.message)));
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

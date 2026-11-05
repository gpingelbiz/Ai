/**
 * The few Dropbox calls the pipeline needs, on plain fetch (no SDK). Signs in with a refresh token from the PKCE
 * sign-in in setup.mjs, so no app secret ever sits on the client's Mac.
 *
 * Team accounts: the folders a team member sees in the Dropbox app live under the team's root namespace, not their
 * home folder, so setup stores `pathRoot` and every call sends it as Dropbox-API-Path-Root. A personal account has
 * no pathRoot and paths start at the top of their Dropbox.
 */
import fs from "node:fs";

export const API = "https://api.dropboxapi.com";
export const CONTENT = "https://content.dropboxapi.com";
export const AUTHORIZE = "https://www.dropbox.com/oauth2/authorize";

// One request body above this goes up in an upload session instead (Dropbox's single-call limit is 150 MB).
const ONE_SHOT = 140 * 1024 * 1024;
const CHUNK = 64 * 1024 * 1024;

export class DropboxError extends Error {
  constructor(status, summary, body) {
    super(`Dropbox ${status}: ${summary}`);
    this.status = status;
    this.summary = String(summary || "");
    this.body = body;
  }
}

/** Dropbox-API-Arg is an HTTP header, so it must be plain ASCII: anything else goes as \uXXXX inside the JSON. */
export const apiArg = (o) =>
  JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryAfter = (r, attempt) => Math.min(60000, (Number(r.headers.get("retry-after")) || 2 ** attempt) * 1000);

/** A public link counts only when anyone with it can open the file (Opus fetches it with no Dropbox login). */
export function isPublicLink(l) {
  const p = l?.link_permissions || {};
  const who = p.effective_audience?.[".tag"] || p.resolved_visibility?.[".tag"];
  return who === "public";
}

export function createDropbox({ appKey, refreshToken, pathRoot, api = API, content = CONTENT, fetch = globalThis.fetch, wait = sleep }) {
  let token = null;
  let expires = 0;

  async function bearer(force = false) {
    if (!force && token && Date.now() < expires - 60000) return token;
    const r = await fetch(`${api}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: appKey }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new DropboxError(r.status, j.error_description || j.error || "could not refresh the sign-in", j);
    token = j.access_token;
    expires = Date.now() + (j.expires_in || 14400) * 1000;
    return token;
  }

  const rootHeader = () => (pathRoot ? { "Dropbox-API-Path-Root": apiArg({ ".tag": "root", root: String(pathRoot) }) } : {});

  /** One call with retries on rate limits, server errors and an expired token. */
  async function send(url, init) {
    let refresh = false;
    for (let attempt = 0; ; attempt++) {
      const headers = { Authorization: `Bearer ${await bearer(refresh)}`, ...rootHeader(), ...init.headers };
      refresh = false;
      const r = await fetch(url, { ...init, headers });
      if ((r.status === 429 || r.status >= 500) && attempt < 3) { await wait(retryAfter(r, attempt)); continue; }
      if (r.status === 401 && attempt === 0) { refresh = true; continue; }
      const text = await r.text();
      let j;
      try { j = text ? JSON.parse(text) : null; } catch { j = { error_summary: text }; }
      if (!r.ok) throw new DropboxError(r.status, j?.error_summary || text || r.statusText, j);
      return j;
    }
  }

  const rpc = (route, body) =>
    send(`${api}/2/${route}`, {
      method: "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const contentCall = (route, arg, data) =>
    send(`${content}/2/${route}`, {
      method: "POST",
      headers: { "Dropbox-API-Arg": apiArg(arg), "Content-Type": "application/octet-stream" },
      body: data,
    });

  return {
    rpc,

    /** Read at most 64 KB, cancelling the download as soon as the cap is reached. */
    async downloadText(path) {
      const r = await fetch(`${content}/2/files/download`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await bearer()}`, ...rootHeader(), "Dropbox-API-Arg": apiArg({ path }) },
      });
      if (!r.ok) { await r.body?.cancel(); throw new DropboxError(r.status, "could not read caption"); }
      const reader = r.body.getReader(), parts = [];
      let size = 0;
      try {
        while (size < 65536) {
          const { done, value } = await reader.read();
          if (done) break;
          const part = Buffer.from(value).subarray(0, 65536 - size);
          parts.push(part); size += part.length;
        }
      } finally { await reader.cancel(); }
      return Buffer.concat(parts).toString("utf8");
    },

    account: () => rpc("users/get_current_account"),

    /** Everything directly inside a folder (not its subfolders). */
    async list(path) {
      let page = await rpc("files/list_folder", { path, recursive: false, include_deleted: false });
      const entries = [...page.entries];
      while (page.has_more) {
        page = await rpc("files/list_folder/continue", { cursor: page.cursor });
        entries.push(...page.entries);
      }
      return entries;
    },

    async exists(path) {
      try { await rpc("files/get_metadata", { path }); return true; }
      catch (e) { if (e.status === 409 && /not_found/.test(e.summary)) return false; throw e; }
    },

    /** Make a folder. autorename: a taken name gets " (1)" and the real path comes back; otherwise a taken name is fine. */
    async createFolder(path, { autorename = false } = {}) {
      try { return (await rpc("files/create_folder_v2", { path, autorename })).metadata.path_display; }
      catch (e) { if (!autorename && e.status === 409 && /path\/conflict/.test(e.summary)) return path; throw e; }
    },

    async move(from, to) {
      return (await rpc("files/move_v2", { from_path: from, to_path: to, autorename: true })).metadata.path_display;
    },

    /** A link anyone can open: a new public shared link, or the file's existing one when it is already public. */
    async publicLink(path) {
      try {
        return (await rpc("sharing/create_shared_link_with_settings", { path, settings: { audience: "public", access: "viewer" } })).url;
      } catch (e) {
        if (!(e.status === 409 && /shared_link_already_exists/.test(e.summary))) throw e;
        const known = e.body?.error?.shared_link_already_exists?.metadata;
        const links = known ? [known] : (await rpc("sharing/list_shared_links", { path, direct_only: true })).links || [];
        const open = links.find(isPublicLink);
        if (open) return open.url;
        throw new DropboxError(409, "the file already has a shared link that only some people can open", e.body);
      }
    },

    /** A direct download link that works for 4 hours (used when the account does not allow public links). */
    async tempLink(path) {
      return (await rpc("files/get_temporary_link", { path })).link;
    },

    /** Have Dropbox fetch a URL into a file itself, so the video never passes through this Mac. */
    async saveUrl(path, url, { timeoutMs = 15 * 60000, pollMs = 3000 } = {}) {
      let r = await rpc("files/save_url", { path, url });
      const job = r.async_job_id;
      const started = Date.now();
      while (r[".tag"] === "async_job_id" || r[".tag"] === "in_progress") {
        if (Date.now() - started > timeoutMs) throw new DropboxError(408, "Dropbox took too long to fetch the clip");
        await wait(pollMs);
        r = await rpc("files/save_url/check_job_status", { async_job_id: job });
      }
      if (r[".tag"] === "failed") throw new DropboxError(409, `save_url failed: ${JSON.stringify(r.failed || r)}`, r);
      return r.path_display || path;
    },

    /** Upload bytes (a Buffer or string) or a local file path, replacing a file of the same name. */
    async upload(path, data) {
      const commit = { path, mode: "overwrite", autorename: false, mute: true };
      if (typeof data === "string" || Buffer.isBuffer(data)) {
        return contentCall("files/upload", commit, Buffer.from(data));
      }
      const file = data.file;
      const size = fs.statSync(file).size;
      if (size <= ONE_SHOT) return contentCall("files/upload", commit, fs.readFileSync(file));
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(CHUNK);
        const read = (off) => buf.subarray(0, fs.readSync(fd, buf, 0, CHUNK, off));
        const { session_id } = await contentCall("files/upload_session/start", { close: false }, read(0));
        let offset = Math.min(CHUNK, size);
        while (size - offset > CHUNK) {
          await contentCall("files/upload_session/append_v2", { cursor: { session_id, offset }, close: false }, read(offset));
          offset += CHUNK;
        }
        return contentCall("files/upload_session/finish", { cursor: { session_id, offset }, commit }, read(offset));
      } finally {
        fs.closeSync(fd);
      }
    },
  };
}

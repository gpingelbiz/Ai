import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";

export const STABLE_FEED = "https://github.com/gpingelbiz/Ai/releases/download/reel-stable/stable.json";
export const releaseId = (id) => typeof id === "string" && /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(id);
export function newerRelease(a, b) {
  if (!releaseId(a)) return false;
  if (!releaseId(b)) return true;
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validHash = (s) => typeof s === "string" && /^[a-f0-9]{64}$/i.test(s);
const safePath = (s) => typeof s === "string" && s && !s.includes("\\") && !s.includes("\0") && !path.posix.isAbsolute(s) && !s.split("/").includes("..");
const location = (s) => {
  const u = new URL(s);
  if (!["https:", "file:"].includes(u.protocol) || u.username || u.password) throw new Error("The update download address is not supported.");
  return u;
};

async function response(url, fetcher) {
  const u = location(url);
  if (u.protocol === "file:") return { body: fs.createReadStream(u) };
  const r = await fetcher(u.href, { signal: AbortSignal.timeout(300000) });
  if (!r.ok || !r.body) throw new Error("The update could not be downloaded. Try again later.");
  if (r.url) location(r.url);
  return r;
}

async function jsonBytes(url, fetcher) {
  const r = await response(url, fetcher);
  const parts = []; let size = 0;
  for await (const b of r.body) {
    size += b.length;
    if (size > 32 * 1024 * 1024) throw new Error("The update information is too large.");
    parts.push(Buffer.from(b));
  }
  return Buffer.concat(parts);
}

export async function stableRelease({ feed = STABLE_FEED, fetcher = globalThis.fetch } = {}) {
  const stable = JSON.parse(await jsonBytes(feed, fetcher));
  if (!releaseId(stable.id) || !validHash(stable.sha256)) throw new Error("The update information is incomplete.");
  location(stable.releaseJson);
  return stable;
}

export async function releaseManifest(stable, { fetcher = globalThis.fetch } = {}) {
  const bytes = await jsonBytes(stable.releaseJson, fetcher);
  if (digest(bytes) !== stable.sha256.toLowerCase()) throw new Error("The update information did not match its safety check. Nothing was installed.");
  const manifest = JSON.parse(bytes);
  validateManifest(manifest);
  if (manifest.id !== stable.id) throw new Error("The update names two different versions.");
  return { manifest, bytes };
}

export function validateManifest(m) {
  if (m.schema !== 1 || !releaseId(m.id) || !/^[a-f0-9]{40}$/i.test(m.commit || "") ||
      !/^rt-[A-Za-z0-9._-]+$/.test(m.runtime?.id || "") || !m.runtime?.tools?.node?.version ||
      m.artifact?.name !== `reel-editor-${m.id}.tar.gz` || !validHash(m.artifact?.sha256) ||
      !Number.isSafeInteger(m.artifact?.bytes) || m.artifact.bytes <= 0 ||
      !m.files || !Object.keys(m.files).length || Object.entries(m.files).some(([p, h]) => !safePath(p) || !validHash(h))) {
    throw new Error("The update information is incomplete.");
  }
  location(m.artifact.url);
}

export function verifyFiles(app, manifest) {
  const bad = [];
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!safePath(name)) throw new Error("The update contains an unsafe file name.");
    try {
      const file = path.join(app, name), real = fs.realpathSync(file);
      if (!real.startsWith(fs.realpathSync(app) + path.sep) || digest(fs.readFileSync(file)) !== hash.toLowerCase()) bad.push(name);
    } catch { bad.push(name); }
  }
  if (bad.length) throw new Error(`The update files did not match their safety check (${bad[0]}). Nothing was activated.`);
  const runtime = JSON.parse(fs.readFileSync(path.join(app, "runtime", "runtime.json")));
  if (!isDeepStrictEqual(runtime, manifest.runtime)) throw new Error("The update has different tools from its approved list.");
}

export async function downloadArtifact(manifest, file, { fetcher = globalThis.fetch } = {}) {
  const r = await response(manifest.artifact.url, fetcher);
  const hash = createHash("sha256"); let size = 0;
  async function* checked() {
    for await (const b of r.body) {
      size += b.length;
      if (size > manifest.artifact.bytes) throw new Error("The update download is larger than expected.");
      hash.update(b); yield b;
    }
  }
  await pipeline(Readable.from(checked()), fs.createWriteStream(file, { flags: "wx" }));
  if (size !== manifest.artifact.bytes || hash.digest("hex") !== manifest.artifact.sha256.toLowerCase()) {
    throw new Error("The update download did not match its safety check. Nothing was installed.");
  }
}

// Inspect before tar can write anything: even a verified archive must stay inside its app folder.
export async function checkArchive(file) {
  let pending = Buffer.alloc(0), remaining = 0, meta = null, next = {}, global = {}, ended = false;
  const entries = [], links = new Set();
  const str = (b, a, n) => b.subarray(a, a + n).toString().split("\0")[0];
  const member = (name) => {
    name = name.replace(/\/$/, "");
    if (!safePath(name) || (name !== "reel-editor" && !name.startsWith("reel-editor/"))) throw new Error("The update archive contains an unsafe file name.");
    if (name === "reel-editor/.complete") throw new Error("The update archive contains an early completion marker.");
    return name;
  };
  const unpackMeta = (type, bytes) => {
    if (type === "L" || type === "K") { next[type === "L" ? "path" : "linkpath"] = bytes.toString().replace(/\0.*$/s, ""); return; }
    const values = {};
    for (let i = 0; i < bytes.length;) {
      const space = bytes.indexOf(32, i), length = Number(bytes.subarray(i, space).toString());
      if (space < i || !Number.isSafeInteger(length) || length <= space - i + 1 || i + length > bytes.length) throw new Error("The update archive is damaged.");
      const record = bytes.subarray(space + 1, i + length - 1).toString(), eq = record.indexOf("=");
      if (eq < 1) throw new Error("The update archive is damaged.");
      values[record.slice(0, eq)] = record.slice(eq + 1); i += length;
    }
    if (type === "g") global = { ...global, ...values }; else next = { ...next, ...values };
  };
  const source = fs.createReadStream(file), stream = source.pipe(createGunzip());
  source.on("error", (e) => stream.destroy(e));
  for await (const chunk of stream) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length) {
      if (remaining) {
        const count = Math.min(remaining, pending.length);
        if (meta) meta.parts.push(pending.subarray(0, Math.min(count, Math.max(0, meta.size - meta.read))));
        if (meta) meta.read += count;
        remaining -= count; pending = pending.subarray(count);
        if (!remaining && meta) { unpackMeta(meta.type, Buffer.concat(meta.parts)); meta = null; }
        continue;
      }
      if (pending.length < 512) break;
      const h = pending.subarray(0, 512); pending = pending.subarray(512);
      if (h.every((b) => b === 0)) { ended = true; continue; }
      if (ended) throw new Error("The update archive has extra content.");
      const size = parseInt(str(h, 124, 12).trim() || "0", 8), type = str(h, 156, 1) || "0";
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("The update archive is damaged.");
      remaining = Math.ceil(size / 512) * 512;
      if (["x", "g", "L", "K"].includes(type)) {
        if (size > 1024 * 1024) throw new Error("The update archive information is too large.");
        meta = { type, size, read: 0, parts: [] };
        if (!remaining) { unpackMeta(type, Buffer.alloc(0)); meta = null; }
        continue;
      }
      const attrs = { ...global, ...next }; next = {};
      if (attrs.size && Number(attrs.size) !== size || Object.keys(attrs).some((k) => /sparse/i.test(k))) throw new Error("The update archive uses an unsupported file format.");
      const prefix = str(h, 345, 155), name = member(attrs.path || [prefix, str(h, 0, 100)].filter(Boolean).join("/"));
      if (!["0", "5", "1", "2"].includes(type)) throw new Error("The update archive contains an unsupported file.");
      entries.push(name);
      if (type === "1" || type === "2") {
        const target = attrs.linkpath || str(h, 157, 100);
        if (!target || path.posix.isAbsolute(target) || target.includes("\\")) throw new Error("The update archive contains an unsafe shortcut.");
        member(path.posix.normalize(type === "2" ? path.posix.join(path.posix.dirname(name), target) : target));
        links.add(name);
      }
    }
  }
  if (remaining || pending.some((b) => b !== 0) || !ended) throw new Error("The update archive is incomplete.");
  for (const entry of entries) {
    const parts = entry.split("/");
    while (parts.pop() && parts.length) if (links.has(parts.join("/"))) throw new Error("The update archive writes through a shortcut.");
  }
}

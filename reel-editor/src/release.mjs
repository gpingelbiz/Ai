import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PKG_ROOT } from "./util.mjs";

export const releaseID = (id) => /^\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/.test(String(id || ""));
export const fileHash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function readReleaseManifest(file) {
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data || data.schema !== 1 || !releaseID(data.id) || !/^[a-f0-9]{40}$/.test(data.commit) || !data.runtime?.id || !data.files || Array.isArray(data.files) || typeof data.files !== "object" || !Object.keys(data.files).length) {
    throw new Error("The release details are incomplete. Install this release again.");
  }
  return data;
}

export function sameRelease(embedded, sidecar) {
  return isDeepStrictEqual(embedded, { ...sidecar, artifact: { name: sidecar.artifact?.name, url: sidecar.artifact?.url } });
}

/** The manifest cannot hash itself; every shipped app and dependency file is checked. */
export function verifyRelease({ app = PKG_ROOT } = {}) {
  let data;
  try { data = readReleaseManifest(path.join(app, "release.json")); } catch { return ["release.json"]; }
  if (!data) return ["release.json"];
  const root = fs.realpathSync(app);
  return Object.entries(data.files).filter(([name, hash]) => {
    if (!name || name.includes("\\") || path.posix.isAbsolute(name) || name.split("/").some((part) => !part || part === "." || part === "..") || !/^[a-f0-9]{64}$/.test(hash)) return true;
    try {
      const file = fs.realpathSync(path.join(root, name));
      return !file.startsWith(root + path.sep) || fileHash(file) !== hash;
    } catch { return true; }
  }).map(([name]) => name).sort();
}

export function currentRelease({ app = PKG_ROOT } = {}) {
  const data = readReleaseManifest(path.join(app, "release.json"));
  if (!data) return { id: "dev" };
  return { id: data.id, commit: data.commit, runtime: data.runtime, verified: verifyRelease({ app }).length === 0 };
}

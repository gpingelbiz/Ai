import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function run(cmd, args, { cwd, env, capture = false, quiet = false, allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: capture ? ["ignore", "pipe", "pipe"] : quiet ? "ignore" : "inherit",
    });
    let out = "";
    let err = "";
    if (capture) {
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFail) return resolve({ out, err, code });
      reject(new Error(`${cmd} ${args.join(" ")} exited ${code}${err ? "\n" + err.slice(-3000) : ""}`));
    });
  });
}

export const log = (...a) => console.log("[reel]", ...a);
export const warn = (...a) => console.warn("[reel] warning:", ...a);

export function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function writeJSON(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

export const r3 = (n) => Math.round(n * 1000) / 1000;

export function slug(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "reel"
  );
}

/** Hard-link when possible (same filesystem), copy otherwise. Never touches the source. */
export function copyOrLink(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.rmSync(dst, { force: true });
    fs.linkSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
  }
}

export function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== "object" || base === null || typeof over !== "object" || over === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

export const VIDEO_EXTS = new Set([".mov", ".mp4", ".m4v", ".webm", ".mkv", ".avi"]);

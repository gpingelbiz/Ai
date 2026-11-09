import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isClientMode } from "./client-mode.mjs";
import { PKG_ROOT, warn } from "./util.mjs";

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const reported = new Set();
const labels = {
  faces: "face finder", matte: "person cutout", person: "cover picture", speakers: "speaker finder",
  featureprint: "scene checker", ocr: "picture text reader", dhash: "photo checker",
  photosheet: "photo export", photofinish: "photo finishing", reactions: "reaction finder",
};

/** Release tools must match both the source and the shipped binary before they can run. */
export async function nativeTool(name, { compile, app = PKG_ROOT, platform = process.platform, arch = process.arch } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Unknown built-in tool.");
  const source = path.join(app, "scripts", `${name}.swift`);
  const dir = path.join(app, "dist", "helpers", `${platform}-${arch}`);
  const bin = path.join(dir, name);
  try {
    const record = JSON.parse(fs.readFileSync(path.join(dir, "helpers.json"), "utf8"))[name];
    if (platform === "darwin" && record?.source === sha256(source) && record.sha256 === sha256(bin)) {
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    }
  } catch {}
  if (isClientMode()) {
    const message = `The ${labels[name] || "built-in"} tool is missing or out of date. Reinstall Reel Editor to restore it.`;
    if (!reported.has(name)) { reported.add(name); warn(message); }
    throw new Error(message);
  }
  if (compile) return compile();
  throw new Error(`The ${name} tool is unavailable.`);
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PKG_ROOT, slug } from "./util.mjs";

/**
 * Brand kits: one brand file (kit/brand-template.json) becomes a Reel Editor Kit zip for someone else, with their
 * look, fonts, words and caption voice built in. The kit's installer puts the brand in ~/.reel and never asks for a
 * look. Everything personal to Greg in his presets (colors, b-roll world, @handle, carousel style, name tag, his
 * caption voice and framework names) is overridden, so none of it can reach someone else's reels.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Problems with a brand file, in words; empty when it can be built. */
export function checkBrand(b) {
  const out = [];
  if (!b || typeof b !== "object") return ["the brand file is not a JSON object"];
  if (!String(b.name || "").trim()) out.push("name is missing (their name, as it appears on the kit)");
  if (b.handle && !/^@[A-Za-z0-9._]+$/.test(b.handle)) out.push(`handle "${b.handle}" should look like @theirhandle`);
  for (const k of ["text", "accent"]) if (!HEX.test(b.colors?.[k] || "")) out.push(`colors.${k} must be a hex color like #FFFFFF`);
  for (const k of ["stroke", "bg"]) if (b.colors?.[k] && !HEX.test(b.colors[k])) out.push(`colors.${k} must be a hex color like #000000`);
  if (b.look?.hook && !["headline", "gold", "box"].includes(b.look.hook)) out.push('look.hook is "headline", "gold" or "box"');
  if (b.look?.captions && !["reveal", "pop"].includes(b.look.captions)) out.push('look.captions is "reveal" or "pop"');
  return out;
}

export const kitSlug = (b) => slug(b.name || "brand");

/** The reel preset: Greg's full look underneath (so it keeps improving with the editor), every personal field theirs. */
export function brandPreset(b, { fonts = {} } = {}) {
  const look = b.look || {};
  return {
    name: `brand-${kitSlug(b)}`,
    extends: "pingel-brand",
    colors: { text: b.colors.text, accent: b.colors.accent, stroke: b.colors.stroke || "#000000", bg: b.colors.bg || "#0B0B0D" },
    ...(fonts.display || fonts.body ? { fonts: { ...(fonts.display ? { display: fonts.display } : {}), ...(fonts.body ? { body: fonts.body } : {}) } } : {}),
    captions: { style: look.captions || "reveal", annotate: look.annotate !== false },
    hook: { style: look.hook || "headline", behind: look.behind !== false },
    slams: { enabled: look.slams !== false },
    // The Greg card is Greg's signature look; nobody else's reels get it.
    graphics: { excludeLooks: ["gregcard"] },
    // worldInPrompt: the Codex stills come from their world, not Greg's built-in examples.
    broll: { world: String(b.world || "").trim(), worldInPrompt: true, style: String(b.brollStyle || "").trim() },
    carousel: { handle: b.handle || "", style: String(b.carouselStyle || "").trim() },
    lowerThird: { name: b.name, handle: b.handle || "" },
  };
}

/** Their YouTube look: the youtube preset with their name tag, colors and fonts. */
export function youtubePreset(b, { fonts = {} } = {}) {
  return {
    name: `brand-${kitSlug(b)}-youtube`,
    extends: "youtube",
    colors: { text: b.colors.text, accent: b.colors.accent, stroke: b.colors.stroke || "#000000", bg: b.colors.bg || "#0B0B0D" },
    ...(fonts.display || fonts.body ? { fonts: { ...(fonts.display ? { display: fonts.display } : {}), ...(fonts.body ? { body: fonts.body } : {}) } } : {}),
    broll: { world: String(b.world || "").trim() },
    carousel: { handle: b.handle || "" },
    lowerThird: { name: b.name, handle: b.handle || "" },
  };
}

/** Their word list: their terms and names; the generic power words stay, Greg's frameworks and fixes do not. */
export function brandDictionary(b) {
  let power = [];
  try { power = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "dictionary.json"), "utf8")).powerWords || []; } catch {}
  const list = (x) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
  return { terms: list(b.terms), names: [b.name, ...list(b.names)].filter((v, i, a) => v && a.indexOf(v) === i), phrases: list(b.phrases), candidates: list(b.candidates), powerWords: power, corrections: Array.isArray(b.corrections) ? b.corrections.filter((c) => c && c.from && c.to) : [] };
}

/** Their caption voice: the brand file's own words, or the neutral default with their name on it. */
export function brandVoice(b) {
  if (String(b.voice || "").trim()) return `# ${b.name}: caption voice\n\n${String(b.voice).trim()}\n`;
  let base = "";
  try { base = fs.readFileSync(path.join(PKG_ROOT, "voice", "default.md"), "utf8"); } catch {}
  return `# ${b.name}: caption voice\n\nEdit this file: who you talk to, the words you use, the words you never use.\n\n${base}`;
}

/**
 * A font for the kit: a .ttf/.otf path as given, or a Google Fonts family by name ("Bebas Neue", "Montserrat
 * ExtraBold"), fetched from github.com/google/fonts. Only open-licensed (OFL, Apache, UFL) families are taken.
 * Returns {file, license, source} or throws with what to do.
 */
export async function fetchFont(spec, outFile, { fetchImpl = fetch } = {}) {
  if (!spec) return null;
  if (/\.(ttf|otf)$/i.test(spec)) {
    const src = spec.replace(/^~(?=\/)/, os.homedir());
    if (!fs.existsSync(src)) throw new Error(`font file not found: ${spec}`);
    fs.copyFileSync(src, outFile);
    return { file: outFile, license: "supplied with the brand (check it allows video use)", source: src };
  }
  const words = String(spec).trim().split(/\s+/);
  const WEIGHTS = ["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold", "ExtraBold", "Black"];
  const weight = WEIGHTS.find((w) => w.toLowerCase() === words[words.length - 1].toLowerCase());
  const family = (weight ? words.slice(0, -1) : words).join(" ");
  const dir = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const lic of ["ofl", "apache", "ufl"]) {
    const list = async (sub) => {
      const res = await fetchImpl(`https://api.github.com/repos/google/fonts/contents/${lic}/${dir}${sub}`, { headers: { "User-Agent": "reel-editor" } });
      return res.ok ? (await res.json()).filter((f) => /\.ttf$/i.test(f.name)) : null;
    };
    const top = await list("");
    if (!top) continue;
    const stat = (await list("/static")) || [];
    const fam = family.replace(/\s+/g, "");
    const want = `${fam}-${weight || "Regular"}.ttf`.toLowerCase();
    // No weight named: the variable font first (it carries every weight; reveal captions are drawn at 850).
    const variable = top.find((f) => /\[.*wght.*\]\.ttf$/i.test(f.name) && !/italic/i.test(f.name));
    const pick = (!weight && variable) || [...top, ...stat].find((f) => f.name.toLowerCase() === want)
      || top.find((f) => /-regular\.ttf$/i.test(f.name))
      || top.find((f) => !/italic/i.test(f.name));
    if (!pick) continue;
    const res = await fetchImpl(pick.download_url);
    if (!res.ok) throw new Error(`could not download ${pick.name}: HTTP ${res.status}`);
    fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
    return { file: outFile, license: lic === "ofl" ? "SIL Open Font License" : lic === "apache" ? "Apache License 2.0" : "Ubuntu Font License", source: pick.download_url, note: weight && pick.name.toLowerCase() !== want ? `${weight} is not a separate file; using ${pick.name}` : "" };
  }
  throw new Error(`"${spec}" is not an open-licensed Google Fonts family; give a .ttf path instead`);
}

/** The Start Here page with their name on it and the look question gone (their look comes with the kit). */
export function personalizeStartHere(html, b) {
  const who = `${b.name}'s Reel Editor`;
  return String(html)
    .replace(/<title>Reel Editor: Start Here<\/title>/, `<title>${esc(who)}: Start Here</title>`)
    .replace(/<h1>Reel Editor<\/h1>/, `<h1>${esc(who)}</h1>`)
    .replace(/<tr><td>Your look<\/td><td>[\s\S]*?<\/td><\/tr>/, `<tr><td>Your look</td><td>Already set: this kit carries your colors${b.fonts?.display || b.fonts?.body ? ", fonts" : ""}, caption voice and words. The installer does not ask.</td></tr>`)
    .replace(/<li><b>Change your look:<\/b>[\s\S]*?<\/li>/, `<li><b>Change your look:</b> open <code>~/.reel/my-brand.json</code> and edit the <code>colors</code> hex codes, or ask for a new kit.</li>`);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

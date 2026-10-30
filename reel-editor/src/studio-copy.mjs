import { cleanCaption } from "../scripts/write-caption.mjs";

/**
 * The words on a Content Studio post: Claude writes them in the client's voice from the client's own brand guide
 * (never Greg's), as JSON; the code checks the shape, cleans the punctuation and turns the copy plus the picked
 * photos into a `reel slides` spec. Nobody reviews these posts, so everything that can be checked in code is.
 */

export const ROLES = ["cover", "point", "list", "compare", "close", "static"];
const clean = (s) => String(s ?? "").replace(/\r/g, "").trim();
const oneLine = (s) => clean(s).replace(/\s+/g, " ");
const words = (s) => oneLine(String(s).replace(/\*/g, "")).split(" ").filter(Boolean).length;

/** Dashes used as pauses become commas, semicolons periods; one *accent* phrase at most, balanced. */
export function plainText(s, { accent = true } = {}) {
  let t = oneLine(s)
    .replace(/\s*[—–―‒]\s*/g, ", ")
    .replace(/\s+-{1,2}\s+/g, ", ")
    .replace(/\s*(?:…|\.{3,})\s*/g, ". ")
    .replace(/\s*;\s*/g, ". ")
    .replace(/,\s*([.?!])/g, "$1")
    .replace(/\s+([,.?!])/g, "$1");
  const stars = (t.match(/\*/g) || []).length;
  if (!accent || stars % 2 || stars > 2) t = t.replace(/\*/g, "");
  return t.trim();
}

/** Every word the post says, for the never-say check. */
export function postWords(copy) {
  const parts = [copy.hook, copy.caption, ...(copy.hashtags || [])];
  for (const s of copy.slides || []) {
    parts.push(s.headline, s.body, ...(s.items || []), s.left?.label, s.left?.value, s.right?.label, s.right?.value);
  }
  return parts.filter(Boolean).join("\n").replace(/\*/g, "");
}

/** The first never-say phrase the post uses (whole words, any case), or "". */
export function neverSaid(copy, list = []) {
  const text = postWords(copy).toLowerCase();
  for (const raw of list) {
    const phrase = oneLine(raw).toLowerCase();
    if (!phrase) continue;
    const re = new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i");
    if (re.test(text)) return raw;
  }
  return "";
}

const GUIDE_LIMIT = 40000;

/** The prompt for one post. Pure, so it can be tested. */
export function copyPrompt({ format, job, client, handle, guide, voice, recent = [], slides = [5, 8], cta = "", neverSay = [], date }) {
  const carousel = format === "carousel";
  const shape = carousel
    ? `{"angle":"...","hook":"...","slides":[{"role":"cover","headline":"..."},{"role":"point","headline":"...","body":"..."},{"role":"list","headline":"...","items":["...","...","..."]},{"role":"compare","headline":"...","left":{"label":"...","value":"..."},"right":{"label":"...","value":"..."}},{"role":"close","headline":"...","body":"..."}],"caption":"line 1\\nline 2","hashtags":["#a","#b","#c"]}`
    : `{"angle":"...","hook":"...","slides":[{"role":"static","headline":"...","body":"..."}],"caption":"line 1\\nline 2","hashtags":["#a","#b","#c"]}`;
  return [
    `You write one Instagram ${carousel ? "carousel" : "single-image post (a static)"} for ${client}${handle ? ` (${handle})` : ""}. It is published automatically, with no person reviewing it, so it must be right as written.`,
    "",
    `The job of this post: ${job.name}${job.what ? ` (${job.what})` : ""}. Pick one specific angle inside that job that the recent posts below have not used.`,
    "",
    "Rules:",
    `- Write only in ${client}'s voice and only from their brand guide and voice notes below: their buyer, their words, their beliefs, their offer. Obey every rule in the guide's never-do list, word bank, proof and compliance rules, AI policy and CTA rules.`,
    "- Never invent a number, result, client, testimonial, quote, date or story. Use a real detail from the guide or say the idea without one.",
    carousel
      ? `- ${slides[0]} to ${slides[1]} slides. Slide 1 is the cover (role "cover"): the hook, at most 8 words, a statement that stops the scroll. Then one idea per slide (role "point": a headline of at most 10 words and a body of at most 28 words; or role "list": a headline and 3 to 5 short items; or role "compare": a headline and two sides, each a short label and a value of at most 8 words). The last slide (role "close") lands the one useful idea the reader keeps.`
      : `- One slide (role "static"): a headline of at most 10 words and an optional body of at most 24 words. It has to work alone in the feed.`,
    "- Each slide stands on its own: never start one with And, So, But or Because. No slide numbers, no \"swipe\", no \"link in bio\", no handle on the slides.",
    "- In a headline, wrap the one phrase that carries the point in *asterisks* (it is set in the brand accent). At most one per headline.",
    "- Plain punctuation everywhere: periods, commas, question marks. No dashes of any kind, no semicolons, no ellipses, no emojis on the slides.",
    "- Caption: 3 to 8 short lines in the same voice. The first line restates the hook. Then the point in their words. Exactly 3 hashtags the guide would use.",
    cta ? `- End the caption with this call to action, phrased as an offer the reader gets: ${cta}. One ask only.` : "- No call to action (no comment, DM, follow, share, save or link asks) unless the guide's CTA playbook gives one for this job; then one ask at most.",
    neverSay.length ? `- Never use these words or phrases: ${neverSay.join(", ")}.` : "",
    recent.length ? `- Do not repeat an angle or hook from these recent posts:\n${recent.map((r) => `  - ${r}`).join("\n")}` : "",
    "",
    `Today is ${date}.`,
    "",
    "BRAND GUIDE:",
    String(guide || "(none: use the voice notes and keep to plain, useful ideas)").slice(0, GUIDE_LIMIT),
    "",
    "VOICE NOTES:",
    String(voice || "(none)").slice(0, 8000),
    "",
    `Reply with JSON only, no prose and no code fence, in this shape (roles as needed): ${shape}`,
  ].filter((l) => l !== "").join("\n");
}

/** Claude's reply, checked and cleaned. Throws with what is wrong (the caller asks once more). */
export function parseCopy(text, { format, slides: range = [5, 8] } = {}) {
  const s = String(text);
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in the reply");
  const j = JSON.parse(s.slice(a, b + 1));
  if (!Array.isArray(j.slides) || !j.slides.length) throw new Error("the reply has no slides");
  const slides = j.slides.map((raw, i) => {
    const role = ROLES.includes(raw?.role) ? raw.role : i === 0 ? (format === "static" ? "static" : "cover") : "point";
    const out = { role, headline: plainText(raw?.headline || raw?.title) };
    if (raw?.body) out.body = plainText(raw.body, { accent: false });
    if (role === "list") out.items = (Array.isArray(raw.items) ? raw.items : []).map((x) => plainText(typeof x === "string" ? x : x?.text, { accent: false })).filter(Boolean).slice(0, 6);
    if (role === "compare") for (const k of ["left", "right"]) out[k] = { label: plainText(raw?.[k]?.label, { accent: false }), value: plainText(raw?.[k]?.value ?? raw?.[k], { accent: false }) };
    return out;
  });
  for (const [i, sl] of slides.entries()) {
    if (!sl.headline) throw new Error(`slide ${i + 1} has no headline`);
    if (sl.role === "compare" && !(sl.left.value && sl.right.value)) sl.role = "point";
    if (sl.role === "list" && sl.items.length < 3) { sl.body = [sl.body, ...(sl.items || [])].filter(Boolean).join(". "); sl.role = "point"; delete sl.items; }
  }
  let list = slides;
  if (format === "static") list = [{ ...slides[0], role: "static" }];
  else {
    list[0].role = "cover";
    if (list.length > range[1]) list = [...list.slice(0, range[1] - 1), list.at(-1)];
    if (list.length < range[0]) throw new Error(`a carousel needs ${range[0]} to ${range[1]} slides, got ${list.length}`);
    if (list.at(-1).role === "point") list.at(-1).role = "close";
  }
  if (words(list[0].headline) > (format === "static" ? 12 : 10)) throw new Error(`the ${format === "static" ? "headline" : "cover"} is too long (${words(list[0].headline)} words)`);
  const caption = cleanCaption(clean(j.caption));
  if (!caption) throw new Error("the reply has no caption");
  const hashtags = (Array.isArray(j.hashtags) ? j.hashtags : []).map((h) => `#${String(h).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`).filter((h) => h.length > 1).slice(0, 3);
  return { angle: oneLine(j.angle), hook: plainText(j.hook || list[0].headline, { accent: false }), slides: list, caption, hashtags };
}

/** The caption as it posts: the lines, a blank line, the hashtags. */
export const captionText = (copy) => [copy.caption, (copy.hashtags || []).join(" ")].filter(Boolean).join("\n\n");

/** How many photos a post can use: the cover and the point slides of a carousel, the one static. */
export function photoSlots(copy) {
  return copy.slides.filter((s) => ["cover", "point", "static", "close"].includes(s.role)).length;
}

/** The main face's centre height (0 top, 1 bottom) in a photo report, or null. */
export function faceY(photo) {
  const faces = [...(photo?.faces || [])].sort((a, b) => b.w * b.h - a.w * a.h);
  return faces[0] ? faces[0].y + faces[0].h / 2 : null;
}

/** Aim the crop at the face: "center 34%" (kept between 15% and 70% so the frame never jumps to an edge). */
const aim = (photo) => { const y = faceY(photo); return y == null ? "center 35%" : `center ${Math.round(Math.min(70, Math.max(15, y * 100)))}%`; };

/**
 * The `reel slides` spec. `photos` is in slide order: photos[i] is the photo for slide i, or null (that slide is set as
 * type only). Words never sit on a face: a face in the top half puts the words at the bottom (photo), a face low in
 * the frame puts them at the top (phototop); longer copy goes under or over the photo (photosplit / splittop).
 */
export function buildSpec(copy, photos = [], { format, outDir }) {
  const slides = copy.slides.map((s, i) => {
    const p = photos[i];
    const photo = p?.export || p?.file || null;
    const body = s.body || "";
    const fy = faceY(p);
    const pos = aim(p);
    if (s.role === "static") {
      if (!photo) return { kind: "static", headline: s.headline, ...(body ? { sub: body } : {}) };
      if (body.length > 90) return fy != null && fy < 0.5 ? { kind: "photosplit", headline: s.headline, sub: body, photo, split: 700, pos } : { kind: "splittop", headline: s.headline, sub: body, photo, split: 640, pos };
      return fy != null && fy < 0.55 ? { kind: "photo", headline: s.headline, ...(body ? { sub: body } : {}), photo, pos } : { kind: "phototop", headline: s.headline, ...(body ? { sub: body } : {}), photo, pos };
    }
    if (s.role === "cover") {
      if (!photo) return { kind: "cover", headline: s.headline };
      return fy != null && fy > 0.6 ? { kind: "phototop", headline: s.headline, photo, pos } : { kind: "photo", headline: s.headline, photo, pos };
    }
    if (s.role === "list") return { kind: "checklist", title: s.headline, items: s.items };
    if (s.role === "compare") return { kind: "compare", title: s.headline, left: s.left, right: s.right };
    // A point or the close: under its photo when it has one, as type when not.
    if (photo) return { kind: "photosplit", headline: s.headline, ...(body ? { sub: body } : {}), photo, split: body.length > 60 ? 700 : 860, pos };
    return s.role === "close" ? { kind: "cta", headline: s.headline, ...(body ? { sub: body } : {}) } : { kind: "body", headline: s.headline, ...(body ? { sub: body } : {}) };
  });
  return { out_dir: outDir, width: 1080, height: 1350, slides };
}

/**
 * Which slides get a photo: the cover (or the static) always when there is one, then points spread through the
 * carousel, never two photo slides in a row past the cover when the pool is short. Returns slide indexes.
 */
export function photoPlan(copy, available) {
  const want = copy.slides.map((s, i) => (["cover", "static"].includes(s.role) ? i : null)).filter((i) => i != null);
  const points = copy.slides.map((s, i) => (["point", "close"].includes(s.role) ? i : null)).filter((i) => i != null);
  const plan = want.slice(0, available);
  let left = available - plan.length;
  if (left > 0 && points.length) {
    const step = points.length / Math.min(left, points.length);
    for (let k = 0; k < Math.min(left, points.length); k++) plan.push(points[Math.floor(k * step)]);
  }
  return [...new Set(plan)].sort((a, b) => a - b);
}

/** The prompt for Claude to match photos to slides by looking at the contact sheet (it may only Read the sheet). */
export function photoPickPrompt({ sheet, count, copy, plan, guide }) {
  return [
    `Read the image ${sheet}: a contact sheet of ${count} photos, numbered 1 to ${count} in red.`,
    "They are candidates for one Instagram post that publishes automatically with no person reviewing it.",
    "",
    "Slides that need a photo:",
    ...plan.map((i) => `- slide ${i + 1} (${copy.slides[i].role}): ${copy.slides[i].headline.replace(/\*/g, "")}${copy.slides[i].body ? ` / ${copy.slides[i].body}` : ""}`),
    "",
    "Pick the photo number that fits each slide best. The cover gets the strongest, clearest photo of the person. Never use one number twice.",
    "Also list every number that must never be posted: a screenshot, a document, a card or a screen with private details, someone else's post or logo, a photo where the main subject is a stranger, a child in swimwear or anything a client or a parent would not want public, and anything the brand guide rules out below.",
    "",
    "Brand guide rules on photos and AI (from the client's guide):",
    String(guide || "(none)").slice(0, 6000),
    "",
    'Reply with JSON only: {"picks":{"<slide number>":<photo number>},"never":[{"photo":<number>,"why":"..."}]}',
  ].join("\n");
}

/** Claude's photo picks as {slideIndex: photoIndex} (0-based) and the vetoed photo indexes. */
export function parsePhotoPicks(text, { plan, count }) {
  const s = String(text);
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  const j = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : {};
  const never = new Map((Array.isArray(j.never) ? j.never : []).map((n) => [Number(n?.photo) - 1, oneLine(n?.why)]).filter(([i]) => i >= 0 && i < count));
  const picks = new Map();
  const used = new Set();
  for (const [slide, photo] of Object.entries(j.picks || {})) {
    const si = Number(slide) - 1, pi = Number(photo) - 1;
    if (!plan.includes(si) || !(pi >= 0 && pi < count) || used.has(pi) || never.has(pi)) continue;
    picks.set(si, pi);
    used.add(pi);
  }
  return { picks, never };
}

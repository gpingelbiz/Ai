import { cleanCaption } from "../scripts/write-caption.mjs";

/**
 * The words on a Content Studio post: Claude writes them in the client's voice from the client's own brand guide
 * (never Greg's), as JSON; the code checks the shape, cleans the punctuation and turns the copy plus the picked
 * photos into a `reel slides` spec. Nobody reviews these posts, so everything that can be checked in code is.
 */

export const ROLES = ["cover", "point", "list", "compare", "postcard", "notes", "story", "evidence", "stat", "steps", "quote", "close", "static"];
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
    parts.push(s.headline, s.body, s.postText, s.metadata, s.caption, s.chapter, s.sourceLabel,
      ...(s.items || []).map((x) => typeof x === "string" ? x : x?.text),
      ...(s.lines || []).map((x) => typeof x === "string" ? x : x?.text),
      s.left?.label, s.left?.value, s.right?.label, s.right?.value);
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
export function copyPrompt({ format, job, client, handle, guide, voice, recent = [], slides = [5, 8], cta = "", neverSay = [], date, evidenceFiles = [] }) {
  const carousel = format === "carousel";
  const shape = carousel
    ? `{"angle":"...","hook":"...","slides":[{"role":"cover","headline":"..."},{"role":"point","headline":"...","body":"..."},{"role":"list","headline":"...","items":["...","...","..."]},{"role":"compare","headline":"...","left":{"label":"...","value":"..."},"right":{"label":"...","value":"..."}},{"role":"postcard","postText":"..."},{"role":"notes","headline":"...","lines":["...","..."]},{"role":"story","caption":"..."},{"role":"steps","headline":"...","steps":["...","...","..."]}${evidenceFiles.length ? ',{"role":"evidence","proofFile":"one exact supplied file token","sourceLabel":"what this supplied proof is"}' : ""},{"role":"close","headline":"...","body":"..."}],"caption":"line 1\\nline 2","hashtags":["#a","#b","#c"]}`
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
      ? `- ${slides[0]} to ${slides[1]} slides. Slide 1 is the cover (role "cover"): the hook, at most 8 words, a statement that stops the scroll. Then one idea per slide. Use role "point" for a headline of at most 10 words and a body of at most 28 words, "list" for a headline and 3 to 5 short items, "compare" for a headline and two short sides, "postcard" for one supplied social-style statement in postText, "notes" for a title and 2 to 6 short lines, "story" for one documentary caption that only makes sense over a real client photo, "steps" for a headline and 3 to 5 short steps, "stat" for one number that appears word for word in the brand guide with its source (fields number, headline, body, source), or "quote" for words that appear word for word in the brand guide or voice notes, said by ${client} (fields quote, by, context). Slide 2 must stand on its own and pull the reader forward with a consequence, a contradiction, a proof point or the first step; never a recap of slide 1. The last slide (role "close") lands the one useful idea the reader keeps.`
      : `- One slide (role "static"): a headline of at most 10 words and an optional body of at most 24 words. It has to work alone in the feed.`,
    evidenceFiles.length
      ? `- You may use role "evidence" only for a real proof screenshot the client supplied. proofFile must be one of these exact tokens, and sourceLabel must truthfully name it: ${evidenceFiles.join(", ")}. Never reconstruct proof.`
      : "- Never use role \"evidence\" because the client supplied no proof screenshot for this run.",
    "- A story is eligible only when the renderer can pair it with a real unused client photo and an explicit focal point. Never turn AI B-roll into a story.",
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
/** Words and numbers on a post must come from the client's own files: a stat or quote not found there becomes a plain point. */
export function inSource(value, source) {
  const norm = (x) => String(x ?? "").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9%$.,' ]+/g, " ").replace(/\s+/g, " ").trim();
  const needle = norm(value);
  return Boolean(needle) && norm(source).includes(needle);
}

export function parseCopy(text, { format, slides: range = [5, 8], evidenceFiles = [], sourceText = "" } = {}) {
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
    if (role === "postcard") {
      out.postText = plainText(raw?.postText || raw?.text || raw?.body);
      if (raw?.metadata) out.metadata = plainText(raw.metadata, { accent: false });
      delete out.body;
    }
    if (role === "notes") {
      out.lines = (Array.isArray(raw?.lines) ? raw.lines : []).map((x) => plainText(typeof x === "string" ? x : x?.text, { accent: false })).filter(Boolean).slice(0, 6);
      if (raw?.date) out.date = plainText(raw.date, { accent: false });
    }
    if (role === "story") {
      out.caption = plainText(raw?.caption || raw?.text || raw?.body || raw?.headline);
      if (raw?.chapter) out.chapter = plainText(raw.chapter, { accent: false });
      delete out.body;
    }
    if (role === "steps") out.steps = (Array.isArray(raw?.steps) ? raw.steps : Array.isArray(raw?.items) ? raw.items : []).map((x) => plainText(typeof x === "string" ? x : x?.text, { accent: false })).filter(Boolean).slice(0, 5);
    if (role === "stat") {
      out.number = oneLine(raw?.number);
      out.source = plainText(raw?.source, { accent: false });
    }
    if (role === "quote") {
      out.quote = plainText(raw?.quote || raw?.text, { accent: false });
      out.by = plainText(raw?.by, { accent: false });
      if (raw?.context) out.context = plainText(raw.context, { accent: false });
      delete out.body;
    }
    if (role === "evidence") {
      const asked = oneLine(raw?.proofFile || raw?.file || raw?.image || raw?.screenshot);
      const matches = evidenceFiles.filter((file) => file === asked || String(file).split(/[\\/]/).at(-1) === asked);
      if (matches.length !== 1) throw new Error(`slide ${i + 1} evidence does not name one supplied proof screenshot`);
      out.evidenceFile = matches[0];
      out.sourceLabel = plainText(raw?.sourceLabel || raw?.label || raw?.source, { accent: false });
      delete out.body;
    }
    return out;
  });
  for (const [i, sl] of slides.entries()) {
    if (!["postcard", "story", "evidence", "quote"].includes(sl.role) && !sl.headline) throw new Error(`slide ${i + 1} has no headline`);
    if (sl.role === "compare" && !(sl.left.value && sl.right.value)) sl.role = "point";
    if (sl.role === "list" && sl.items.length < 3) { sl.body = [sl.body, ...(sl.items || [])].filter(Boolean).join(". "); sl.role = "point"; delete sl.items; }
    if (sl.role === "postcard" && !sl.postText) throw new Error(`slide ${i + 1} postcard needs postText`);
    if (sl.role === "notes" && sl.lines.length < 2) throw new Error(`slide ${i + 1} notes needs at least 2 lines`);
    if (sl.role === "story" && !sl.caption) throw new Error(`slide ${i + 1} story needs a caption`);
    if (sl.role === "evidence" && !sl.sourceLabel) throw new Error(`slide ${i + 1} evidence needs a sourceLabel`);
    if (sl.role === "steps" && sl.steps.length < 3) { sl.body = [sl.body, ...(sl.steps || [])].filter(Boolean).join(". "); sl.role = "point"; delete sl.steps; }
    // Nothing invented: a stat needs its number and source in the client's own guide, a quote its exact words there.
    if (sl.role === "stat" && !(sl.number && sl.source && inSource(sl.number, sourceText) && inSource(sl.source, sourceText))) { sl.role = "point"; delete sl.number; delete sl.source; }
    if (sl.role === "quote" && !(sl.quote && sl.by && inSource(sl.quote, sourceText))) { sl.role = "point"; sl.headline = sl.headline || sl.quote; delete sl.quote; delete sl.by; delete sl.context; }
    if (sl.role === "point" && !sl.headline) throw new Error(`slide ${i + 1} has no headline`);
  }
  let list = slides;
  if (format === "static") list = [{ ...slides[0], role: "static" }];
  else {
    list[0].role = "cover";
    if (!list[0].headline) throw new Error("slide 1 has no headline");
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
  return copy.slides.filter((s) => ["cover", "point", "story", "static", "close"].includes(s.role)).length;
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
    if (s.role === "postcard") return { kind: "postcard", postText: s.postText, ...(s.metadata ? { metadata: s.metadata } : {}) };
    if (s.role === "notes") return { kind: "notes", title: s.headline, lines: s.lines, ...(s.date ? { date: s.date } : {}) };
    if (s.role === "story") {
      if (!photo || p?.ai) throw new Error(`story slide ${i + 1} needs a real photo`);
      const faces = [...(p?.faces || [])].sort((a, b) => b.w * b.h - a.w * a.h);
      const focalPoint = p.focalPoint || (faces[0] ? { x: faces[0].x + faces[0].w / 2, y: faces[0].y + faces[0].h / 2 } : pos);
      return { kind: "story", photo, focalPoint, caption: s.caption, ...(s.chapter ? { chapter: s.chapter } : {}) };
    }
    if (s.role === "evidence") return { kind: "evidence", image: s.evidenceFile, sourceLabel: s.sourceLabel };
    if (s.role === "stat") return { kind: "stat", number: s.number, headline: s.headline, ...(body ? { sub: body } : {}), source: s.source };
    if (s.role === "steps") return { kind: "steps", headline: s.headline, steps: s.steps };
    if (s.role === "quote") return { kind: "quote", quote: s.quote, by: s.by, ...(s.context ? { context: s.context } : {}) };
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
  const want = copy.slides.map((s, i) => (["cover", "story", "static"].includes(s.role) ? i : null)).filter((i) => i != null);
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
    ...plan.map((i) => {
      const slide = copy.slides[i];
      const lead = slide.headline || slide.caption || slide.postText || "";
      return `- slide ${i + 1} (${slide.role}): ${lead.replace(/\*/g, "")}${slide.body ? ` / ${slide.body}` : ""}`;
    }),
    "",
    "Pick the photo number that fits each slide best. The cover gets the strongest, clearest photo of the person. Never use one number twice.",
    "For every picked photo, give one short literal visual description of only what is visible. Do not guess identity, emotion, intent, location, results or context.",
    "Also list every number that must never be posted: a screenshot, a document, a card or a screen with private details, someone else's post or logo, a photo where the main subject is a stranger, a child in swimwear or anything a client or a parent would not want public, and anything the brand guide rules out below.",
    "",
    "Brand guide rules on photos and AI (from the client's guide):",
    String(guide || "(none)").slice(0, 6000),
    "",
    'Reply with JSON only: {"picks":{"<slide number>":<photo number>},"descriptions":{"<photo number>":"literal visible description"},"never":[{"photo":<number>,"why":"..."}]}',
  ].join("\n");
}

/** Claude's photo picks as {slideIndex: photoIndex} (0-based) and the vetoed photo indexes. */
export function parsePhotoPicks(text, { plan, count }) {
  const s = String(text);
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  const j = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : {};
  const never = new Map((Array.isArray(j.never) ? j.never : []).map((n) => [Number(n?.photo) - 1, oneLine(n?.why)]).filter(([i]) => i >= 0 && i < count));
  const picks = new Map();
  const descriptions = new Map(Object.entries(j.descriptions || {}).map(([photo, description]) => [Number(photo) - 1, oneLine(description)]).filter(([i, description]) => i >= 0 && i < count && description));
  const used = new Set();
  for (const [slide, photo] of Object.entries(j.picks || {})) {
    const si = Number(slide) - 1, pi = Number(photo) - 1;
    if (!plan.includes(si) || !(pi >= 0 && pi < count) || used.has(pi) || never.has(pi)) continue;
    picks.set(si, pi);
    used.add(pi);
  }
  return { picks, descriptions, never };
}

const visibleSlideText = (slide) => {
  const parts = [slide.headline, slide.title, slide.sub, slide.body, slide.postText, slide.text, slide.caption, slide.chapter, slide.metadata, slide.date,
    ...(slide.items || []).flatMap((x) => typeof x === "string" ? [x] : [x?.text, x?.note]),
    ...[slide.left, slide.right].flatMap((x) => typeof x === "string" ? [x] : [x?.label, x?.value, x?.note]),
    ...(slide.lines || []).map((x) => typeof x === "string" ? x : x?.text), slide.decisionLine, slide.sourceLabel, slide.label];
  return [...new Set(parts.map((x) => oneLine(String(x || "").replace(/\*/g, ""))).filter(Boolean))].join(". ");
};

/** Grounded per-slide alt text: supplied visible words plus a photo picker's literal description, never a guess. */
export function buildAltText(spec, photos = [], { max = 300 } = {}) {
  return (spec?.slides || []).map((slide, i) => {
    const words = visibleSlideText(slide);
    const description = oneLine(photos[i]?.visualDescription);
    const text = description ? [description.replace(/[.]+$/, ""), words ? `Text reads: ${words}` : ""].filter(Boolean).join(". ") : words;
    return text.slice(0, max).trim();
  });
}

/** Prompt for the one permitted visual-gate copy repair. It names only the affected slides. */
export function shortenPrompt({ copy, indexes, client, guide, voice }) {
  const slides = indexes.map((index) => ({ index: index + 1, slide: copy.slides[index] }));
  return [
    `Shorten only the named slides for ${client}'s post by about one quarter so the same meaning fits.`,
    "Keep every claim, number, role, order and supplied proof exactly the same. Do not add facts, names, quotes, calls to action or dashes. Leave every other slide untouched.",
    `Slides: ${JSON.stringify(slides)}`,
    `Brand guide: ${String(guide || "").slice(0, 12000)}`,
    `Voice notes: ${String(voice || "").slice(0, 4000)}`,
    'Reply with JSON only: {"slides":[{"index":<the 1-based index>,"slide":<the complete shortened slide object>}]}',
  ].join("\n\n");
}

/** Apply only requested shortened slide objects; roles and non-text provenance fields cannot change. */
export function applyShortenedSlides(copy, text, indexes) {
  const s = String(text), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("shortening returned no JSON");
  const reply = JSON.parse(s.slice(a, b + 1));
  const wanted = new Set(indexes);
  const replacements = new Map((Array.isArray(reply.slides) ? reply.slides : []).map((item) => [Number(item?.index) - 1, item?.slide]));
  const slides = copy.slides.map((original, index) => {
    if (!wanted.has(index)) return structuredClone(original);
    const raw = replacements.get(index);
    if (!raw || raw.role !== original.role) throw new Error(`shortening did not preserve slide ${index + 1}'s role`);
    const out = structuredClone(original);
    for (const key of ["headline", "body", "postText", "metadata", "caption", "chapter", "date", "sourceLabel"]) if (key in raw) out[key] = plainText(raw[key], { accent: key === "headline" || key === "postText" || key === "caption" });
    if (Array.isArray(raw.items) && original.role === "list") out.items = raw.items.map((x) => plainText(typeof x === "string" ? x : x?.text, { accent: false })).filter(Boolean);
    if (Array.isArray(raw.lines) && original.role === "notes") out.lines = raw.lines.map((x) => plainText(typeof x === "string" ? x : x?.text, { accent: false })).filter(Boolean);
    if (original.role === "compare") for (const side of ["left", "right"]) if (raw[side]) out[side] = { label: plainText(raw[side].label, { accent: false }), value: plainText(raw[side].value, { accent: false }) };
    if (!postWords({ slides: [out] }).trim()) throw new Error(`shortening emptied slide ${index + 1}`);
    return out;
  });
  for (const index of wanted) if (!replacements.has(index)) throw new Error(`shortening omitted slide ${index + 1}`);
  return { ...copy, slides };
}

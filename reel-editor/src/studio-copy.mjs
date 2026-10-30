import { cleanCaption } from "../scripts/write-caption.mjs";

/**
 * The words on a Content Studio post: Claude writes them in the client's voice from the client's own brand guide
 * (never Greg's), as JSON; the code checks the shape, cleans the punctuation and turns the copy plus the picked
 * photos into a `reel slides` spec. Nobody reviews these posts, so everything that can be checked in code is.
 */

export const COVER_ROLES = ["cover-top", "cover-doc", "cover-card", "cover-compare", "cover-list"];
export const STATIC_FAMILIES = ["verdict", "note", "cover-top", "script"];
export const KEEP_ROLES = ["steps", "list", "stat", "compare"];
export const ROLES = ["cover", ...COVER_ROLES, "point", "body", "list", "compare", "postcard", "notes", "story", "evidence", "stat", "steps", "quote", "close", "static", "verdict", "note", "script"];
const clean = (s) => String(s ?? "").replace(/\r/g, "").trim();
const oneLine = (s) => clean(s).replace(/\s+/g, " ");
const words = (s) => oneLine(String(s).replace(/\*/g, "")).split(" ").filter(Boolean).length;

const POSITION_CLASS = {
  cover: "top", "cover-top": "top", "cover-doc": "card", "cover-card": "card", "cover-compare": "split", "cover-list": "top",
  point: "low", body: "center", list: "center", compare: "center", postcard: "center", notes: "center", story: "center", evidence: "center",
  stat: "center", steps: "center", quote: "center", close: "center", static: "center", verdict: "center", note: "card", script: "center",
};

export const textPositionClass = (role) => POSITION_CLASS[role] || "center";

export function coverFamiliesForJob(job) {
  const name = oneLine(typeof job === "string" ? job : job?.name).toLowerCase();
  if (name.includes("story")) return ["cover-doc"];
  if (name.includes("offer")) return ["cover-top", "cover-list"];
  if (name.includes("sales")) return ["cover-compare", "cover-top"];
  if (name.includes("system")) return ["cover-card", "cover-list"];
  return ["cover-top", "cover-list"];
}

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
    parts.push(s.headline, s.body, s.sub, s.text, s.say, s.label, s.postText, s.metadata, s.caption, s.chapter, s.sourceLabel,
      ...(s.items || []).map((x) => typeof x === "string" ? x : x?.text),
      ...(s.lines || []).map((x) => typeof x === "string" ? x : x?.text),
      s.left?.label, s.left?.value, s.left?.text, s.right?.label, s.right?.value, s.right?.text);
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
export function copyPrompt({ format, job, client, handle, guide, voice, recent = [], slides = [5, 8], cta = "", neverSay = [], date, evidenceFiles = [], staticFamily = "" }) {
  const carousel = format === "carousel";
  const jobName = oneLine(typeof job === "string" ? job : job?.name) || "Teach";
  const jobWhat = oneLine(typeof job === "object" ? job?.what : "");
  const coverFamilies = coverFamiliesForJob(job);
  const family = STATIC_FAMILIES.includes(staticFamily) ? staticFamily : "verdict, note, cover-top or script";
  const staticShape = staticFamily === "note"
    ? '{"role":"note","label":"...","text":"..."}'
    : staticFamily === "cover-top"
      ? '{"role":"cover-top","headline":"...","sub":"..."}'
      : staticFamily === "script"
        ? '{"role":"script","label":"...","headline":"...","say":"..."}'
        : '{"role":"verdict","headline":"..."}';
  const shape = carousel
    ? `{"angle":"...","hook":"...","slides":[{"role":"${coverFamilies[0]}","headline":"...","sub":"..."},{"role":"point","headline":"...","body":"..."},{"role":"list","headline":"...","items":["...","...","..."]},{"role":"compare","headline":"...","left":{"label":"...","value":"..."},"right":{"label":"...","value":"..."}},{"role":"postcard","postText":"..."},{"role":"notes","headline":"...","lines":["...","..."]},{"role":"story","caption":"..."},{"role":"steps","headline":"...","steps":["...","...","..."]}${evidenceFiles.length ? ',{"role":"evidence","proofFile":"one exact supplied file token","sourceLabel":"what this supplied proof is"}' : ""},{"role":"close","headline":"...","body":"..."}],"caption":"line 1\\nline 2","hashtags":["#a","#b","#c"]}`
    : `{"angle":"...","hook":"...","slides":[${staticShape}],"caption":"line 1\\nline 2","hashtags":["#a","#b","#c"]}`;
  return [
    `You write one Instagram ${carousel ? "carousel" : "single-image post (a static)"} for ${client}${handle ? ` (${handle})` : ""}. It is published automatically, with no person reviewing it, so it must be right as written.`,
    "",
    `The job of this post: ${jobName}${jobWhat ? ` (${jobWhat})` : ""}. Pick one specific angle inside that job that the recent posts below have not used.`,
    "",
    "Rules:",
    `- Write only in ${client}'s voice and only from their brand guide and voice notes below: their buyer, their words, their beliefs, their offer. Obey every rule in the guide's never-do list, word bank, proof and compliance rules, AI policy and CTA rules.`,
    "- Never invent a number, result, client, testimonial, quote, date or story. Use a real detail from the guide or say the idea without one.",
    carousel
      ? `- ${slides[0]} to ${slides[1]} slides. Slide 1 uses ${coverFamilies.map((x) => `role "${x}"`).join(" or ")} for this ${jobName} job. Cover copy has at most 18 words total. Then one idea per slide, at most 32 words total with no body or sub over 24 words. Use role "point" for a headline and body, "list" for a headline and 3 to 5 short items, "compare" for a headline and two short sides, "postcard" for one supplied social-style statement in postText, "notes" for a title and 2 to 6 short lines, "story" for one documentary caption that only makes sense over a real client photo, "steps" for a headline and 3 to 5 short steps, "stat" for one number that appears word for word in the brand guide with its source (fields number, headline, body, source), or "quote" for words that appear word for word in the brand guide or voice notes, said by ${client} (fields quote, by, context). Slide 2 must stand on its own, use a different text-position family than slide 1, and pull the reader forward with a consequence, contradiction, proof point or first step. The last slide (role "close") lands the one useful idea the reader keeps.`
      : `- One slide in the ${family} family. Verdict uses role "verdict" and 5 to 11 headline words. Note uses role "note" and 7 to 18 words in text. Candid Lesson uses role "cover-top", a real photo, and at most 18 words. Say This Instead uses role "script", a 6 to 10 word headline and 10 to 18 words in say, at most 28 total. It has to work alone in the feed.`,
    carousel ? '- Cover fields: cover-top and cover-list use headline plus optional sub; cover-doc uses optional headline plus optional corner (tl, tr, bl or br); cover-card uses headline, optional sub and optional side (left or right); cover-compare uses optional headline, left and right objects with label and text, plus optional decision (left or right).' : "",
    carousel && /story/i.test(jobName)
      ? "- This is a Story carousel. Use scenes, not keep-this slides: no steps, list, stat or compare roles."
      : carousel ? "- This is a teaching carousel. Include 2 or 3 keep-this slides using steps, list (rendered as checklist), stat or compare." : "",
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

function slideTextValues(slide) {
  const values = [slide.headline, slide.sub, slide.body, slide.text, slide.say, slide.postText, slide.metadata, slide.caption, slide.chapter, slide.number, slide.source, slide.quote, slide.by, slide.context, slide.sourceLabel];
  for (const item of slide.items || []) values.push(typeof item === "string" ? item : item?.text);
  for (const item of slide.steps || []) values.push(typeof item === "string" ? item : item?.text);
  for (const item of slide.lines || []) values.push(typeof item === "string" ? item : item?.text);
  for (const side of [slide.left, slide.right]) values.push(side?.label, side?.value, side?.text);
  return values.map(oneLine).filter(Boolean);
}

export const slideWordCount = (slide) => words(slideTextValues(slide).join(" "));

function genericSlide(text, role, headlineWords = 8) {
  const list = oneLine(text).replace(/\*/g, "").split(" ").filter(Boolean);
  const take = Math.min(headlineWords, list.length);
  return { role, headline: list.slice(0, take).join(" "), ...(list.length > take ? { body: list.slice(take).join(" ") } : {}) };
}

function splitForBudget(slide, limit, index) {
  const text = slideTextValues(slide).join(" ").replace(/\*/g, "");
  const tokens = oneLine(text).split(" ").filter(Boolean);
  const chunks = [];
  while (tokens.length) chunks.push(tokens.splice(0, limit).join(" "));
  if (chunks.length < 2) return [slide];
  return chunks.map((chunk, part) => {
    if (index === 0 && part === 0) return { role: "cover", headline: chunk };
    return genericSlide(chunk, "point");
  });
}

function enforceWordBudgets(slides, { format, max }) {
  const out = [];
  for (let index = 0; index < slides.length; index++) {
    const slide = slides[index];
    const isCover = format !== "static" && (index === 0 || slide.role === "cover" || COVER_ROLES.includes(slide.role));
    const limit = isCover ? 18 : slide.role === "verdict" ? 11 : slide.role === "note" ? 18 : slide.role === "script" ? 28 : 32;
    const subWords = Math.max(words(slide.body), words(slide.sub));
    const over = slideWordCount(slide) > limit || (!isCover && subWords > 24);
    if (!over) { out.push(slide); continue; }
    if (format === "static") throw new Error(`${slide.role} copy is over its ${limit} word budget and a static has no room for another slide`);
    const splitLimit = subWords > 24 ? Math.min(limit, Math.max(1, words(slide.headline) + 24)) : limit;
    const parts = splitForBudget(slide, splitLimit, index);
    if (parts.length < 2 || out.length + parts.length + (slides.length - index - 1) > max) throw new Error(`slide ${index + 1} is over its ${limit} word budget and the deck has no room to split it`);
    out.push(...parts);
  }
  return out;
}

function repairSlideTwo(slides) {
  if (slides.length < 2 || textPositionClass(slides[0].role) !== textPositionClass(slides[1].role)) return slides;
  const next = slides.slice();
  const role = textPositionClass(slides[0].role) === "center" ? "point" : "body";
  next[1] = genericSlide(slideTextValues(slides[1]).join(" "), role);
  return next;
}

function staticAsFamily(slide, family) {
  if (!STATIC_FAMILIES.includes(family)) return slide;
  if (family === "verdict") return { role: family, headline: slide.headline || slide.text };
  if (family === "note") return { role: family, text: [slide.text || slide.headline, slide.body].filter(Boolean).join(" "), ...(slide.label ? { label: slide.label } : {}) };
  if (family === "cover-top") return { role: family, headline: slide.headline || slide.text, ...((slide.sub || slide.body) ? { sub: slide.sub || slide.body } : {}) };
  return { role: family, headline: slide.headline, say: slide.say || slide.body || slide.text, ...(slide.label ? { label: slide.label } : {}) };
}

export function parseCopy(text, { format, slides: range = [5, 8], evidenceFiles = [], sourceText = "", job = null, staticFamily = "" } = {}) {
  const s = String(text);
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in the reply");
  const j = JSON.parse(s.slice(a, b + 1));
  if (!Array.isArray(j.slides) || !j.slides.length) throw new Error("the reply has no slides");
  const slides = j.slides.map((raw, i) => {
    const role = ROLES.includes(raw?.role) ? raw.role : i === 0 ? (format === "static" ? "static" : "cover") : "point";
    const out = { role, headline: plainText(raw?.headline || raw?.title) };
    if (raw?.body) out.body = plainText(raw.body, { accent: false });
    if (raw?.sub) out.sub = plainText(raw.sub, { accent: false });
    if (["cover-top", "cover-card", "cover-list"].includes(role) && out.body && !out.sub) { out.sub = out.body; delete out.body; }
    if (role === "cover-doc" && raw?.corner) {
      out.corner = oneLine(raw.corner).toLowerCase();
      if (!["tl", "tr", "bl", "br"].includes(out.corner)) throw new Error(`slide ${i + 1} cover-doc corner must be tl, tr, bl or br`);
    }
    if (role === "cover-card" && raw?.side) {
      out.side = oneLine(raw.side).toLowerCase();
      if (!["left", "right"].includes(out.side)) throw new Error(`slide ${i + 1} cover-card side must be left or right`);
    }
    if (role === "cover-compare") {
      for (const k of ["left", "right"]) out[k] = { label: plainText(raw?.[k]?.label, { accent: false }), text: plainText(raw?.[k]?.text ?? raw?.[k]?.value ?? raw?.[k], { accent: false }) };
      if (raw?.decision != null && !["left", "right"].includes(raw.decision)) throw new Error(`slide ${i + 1} cover-compare decision must be left or right`);
      out.decision = raw?.decision === "left" ? "left" : "right";
    }
    if (role === "verdict" && raw?.light === true) out.light = true;
    if (role === "note") {
      out.text = plainText(raw?.text || raw?.body || raw?.headline);
      if (raw?.label) out.label = plainText(raw.label, { accent: false });
      delete out.body;
    }
    if (role === "script") {
      out.say = plainText(raw?.say || raw?.body || raw?.text, { accent: false });
      if (raw?.label) out.label = plainText(raw.label, { accent: false });
      if (raw?.light === true) out.light = true;
      delete out.body;
    }
    if (role === "list") out.items = (Array.isArray(raw.items) ? raw.items : []).map((x) => plainText(typeof x === "string" ? x : x?.text, { accent: false })).filter(Boolean);
    if (role === "compare") for (const k of ["left", "right"]) out[k] = { label: plainText(raw?.[k]?.label, { accent: false }), value: plainText(raw?.[k]?.value ?? raw?.[k], { accent: false }) };
    if (role === "postcard") {
      out.postText = plainText(raw?.postText || raw?.text || raw?.body);
      if (raw?.metadata) out.metadata = plainText(raw.metadata, { accent: false });
      delete out.body;
    }
    if (role === "notes") {
      out.lines = (Array.isArray(raw?.lines) ? raw.lines : []).map((x) => plainText(typeof x === "string" ? x : x?.text, { accent: false })).filter(Boolean);
      if (raw?.date) out.date = plainText(raw.date, { accent: false });
    }
    if (role === "story") {
      out.caption = plainText(raw?.caption || raw?.text || raw?.body || raw?.headline);
      if (raw?.chapter) out.chapter = plainText(raw.chapter, { accent: false });
      delete out.body;
    }
    if (role === "steps") out.steps = (Array.isArray(raw?.steps) ? raw.steps : Array.isArray(raw?.items) ? raw.items : []).map((x) => plainText(typeof x === "string" ? x : x?.text, { accent: false })).filter(Boolean);
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
    if (!["postcard", "story", "evidence", "quote", "note", "cover-doc", "cover-compare"].includes(sl.role) && !sl.headline) throw new Error(`slide ${i + 1} has no headline`);
    if (sl.role === "compare" && !(sl.left.value && sl.right.value)) sl.role = "point";
    if (sl.role === "cover-compare" && !(sl.left.text && sl.right.text && sl.left.label && sl.right.label)) throw new Error(`slide ${i + 1} cover-compare needs left and right labels and text`);
    if (sl.role === "list" && sl.items.length < 3) { sl.body = [sl.body, ...(sl.items || [])].filter(Boolean).join(". "); sl.role = "point"; delete sl.items; }
    if (sl.role === "list" && sl.items.length > 6) throw new Error(`slide ${i + 1} list needs at most 6 items`);
    if (sl.role === "postcard" && !sl.postText) throw new Error(`slide ${i + 1} postcard needs postText`);
    if (sl.role === "notes" && sl.lines.length < 2) throw new Error(`slide ${i + 1} notes needs at least 2 lines`);
    if (sl.role === "notes" && sl.lines.length > 6) throw new Error(`slide ${i + 1} notes needs at most 6 lines`);
    if (sl.role === "story" && !sl.caption) throw new Error(`slide ${i + 1} story needs a caption`);
    if (sl.role === "evidence" && !sl.sourceLabel) throw new Error(`slide ${i + 1} evidence needs a sourceLabel`);
    if (sl.role === "steps" && sl.steps.length < 3) { sl.body = [sl.body, ...(sl.steps || [])].filter(Boolean).join(". "); sl.role = "point"; delete sl.steps; }
    if (sl.role === "steps" && sl.steps.length > 5) throw new Error(`slide ${i + 1} steps needs at most 5 steps`);
    if (sl.role === "note" && !sl.text) throw new Error(`slide ${i + 1} note needs text`);
    if (sl.role === "script" && !sl.say) throw new Error(`slide ${i + 1} script needs say`);
    // Nothing invented: a stat needs its number and source in the client's own guide, a quote its exact words there.
    if (sl.role === "stat" && !(sl.number && sl.source && inSource(sl.number, sourceText) && inSource(sl.source, sourceText))) { sl.role = "point"; delete sl.number; delete sl.source; }
    if (sl.role === "quote" && !(sl.quote && sl.by && inSource(sl.quote, sourceText))) { sl.role = "point"; sl.headline = sl.headline || sl.quote; delete sl.quote; delete sl.by; delete sl.context; }
    if (sl.role === "point" && !sl.headline) throw new Error(`slide ${i + 1} has no headline`);
  }
  let list = slides;
  if (format === "static") list = [staticAsFamily(slides[0], staticFamily)];
  else {
    if (!(list[0].role === "cover" || COVER_ROLES.includes(list[0].role))) list[0].role = "cover";
    if (!list[0].headline && list[0].role !== "cover-doc" && list[0].role !== "cover-compare") throw new Error("slide 1 has no headline");
    if (job && !coverFamiliesForJob(job).includes(list[0].role)) throw new Error(`${oneLine(typeof job === "string" ? job : job?.name)} needs ${coverFamiliesForJob(job).join(" or ")} on slide 1`);
    if (list.length > range[1]) throw new Error(`a carousel needs ${range[0]} to ${range[1]} slides, got ${list.length}`);
    list = enforceWordBudgets(list, { format, max: range[1] });
    if (list.length < range[0]) throw new Error(`a carousel needs ${range[0]} to ${range[1]} slides, got ${list.length}`);
    list = repairSlideTwo(list);
    if (job) {
      const story = /story/i.test(oneLine(typeof job === "string" ? job : job?.name));
      const keep = list.filter((slide) => KEEP_ROLES.includes(slide.role)).length;
      if (story && keep) throw new Error("a Story carousel cannot contain keep-this slides");
      if (!story && (keep < 2 || keep > 3)) throw new Error(`a teaching carousel needs 2 to 3 keep-this slides, got ${keep}`);
    }
    if (list.at(-1).role === "point") list.at(-1).role = "close";
  }
  if (format === "static") {
    list = enforceWordBudgets(list, { format, max: 1 });
    if (list[0].role === "static" && words(list[0].headline) > 12) throw new Error(`the headline is too long (${words(list[0].headline)} words)`);
  }
  const rangeWords = (value, min, max, field) => {
    const count = words(value);
    if (count < min || count > max) throw new Error(`${field} needs ${min} to ${max} words, got ${count}`);
  };
  for (const [index, slide] of list.entries()) {
    const at = `slide ${index + 1}`;
    if (slide.role === "cover-top") { rangeWords(slide.headline, 5, 12, `${at} cover-top headline`); if (slide.sub) rangeWords(slide.sub, 1, 14, `${at} cover-top sub`); }
    if (slide.role === "cover-doc" && slide.headline) rangeWords(slide.headline, 3, 6, `${at} cover-doc headline`);
    if (slide.role === "cover-card") { rangeWords(slide.headline, 6, 12, `${at} cover-card headline`); if (slide.sub) rangeWords(slide.sub, 1, 22, `${at} cover-card sub`); }
    if (slide.role === "cover-compare") for (const side of ["left", "right"]) { rangeWords(slide[side].label, 1, 3, `${at} cover-compare ${side} label`); rangeWords(slide[side].text, 2, 5, `${at} cover-compare ${side} text`); }
    if (slide.role === "cover-list") { rangeWords(slide.headline, 5, 8, `${at} cover-list headline`); if (slide.sub) rangeWords(slide.sub, 1, 14, `${at} cover-list sub`); }
    if (slide.role === "verdict") rangeWords(slide.headline, 5, 11, `${at} verdict headline`);
    if (slide.role === "note") rangeWords(slide.text, 7, 18, `${at} note text`);
    if (slide.role === "script") { rangeWords(slide.headline, 6, 10, `${at} script headline`); rangeWords(slide.say, 10, 18, `${at} script say`); }
  }
  if (slideWordCount(list[0]) > (format === "static" && list[0].role === "static" ? 32 : format === "static" ? ({ verdict: 11, note: 18, script: 28, "cover-top": 18 }[list[0].role] || 32) : 18)) throw new Error(`the ${format === "static" ? list[0].role : "cover"} is too long (${slideWordCount(list[0])} words)`);
  const caption = cleanCaption(clean(j.caption));
  if (!caption) throw new Error("the reply has no caption");
  const hashtags = (Array.isArray(j.hashtags) ? j.hashtags : []).map((h) => `#${String(h).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`).filter((h) => h.length > 1).slice(0, 3);
  return { angle: oneLine(j.angle), hook: plainText(j.hook || list[0].headline || list[0].text || list[0].say, { accent: false }), slides: list, caption, hashtags };
}

/** The caption as it posts: the lines, a blank line, the hashtags. */
export const captionText = (copy) => [copy.caption, (copy.hashtags || []).join(" ")].filter(Boolean).join("\n\n");

/** How many photos a post can use: the cover and the point slides of a carousel, the one static. */
export function photoSlots(copy) {
  return copy.slides.filter((s) => ["cover", ...COVER_ROLES, "point", "story", "static", "close"].includes(s.role)).length;
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
    if (COVER_ROLES.includes(s.role)) {
      // No usable real photo (an empty or spent photo folder): keep the words on a type-only layout instead of failing
      // the whole post (2026-10-30: a client with an empty Photos folder lost every carousel to this).
      if (!photo || p?.ai) {
        if (s.role === "cover-compare") return { kind: "compare", title: s.headline || "", left: { label: s.left?.label, value: s.left?.text }, right: { label: s.right?.label, value: s.right?.text } };
        if (!s.headline) throw new Error(`${s.role} slide ${i + 1} needs a real photo`);
        return { kind: "cover", headline: s.headline, ...(s.sub ? { sub: s.sub } : {}) };
      }
      // A face in the top half sits right where cover-top's words go, and recropping can't move it far enough on a
      // portrait selfie (2026-10-30 dry run: three held covers). The band-on-top cover keeps the same words and fields.
      if (s.role === "cover-top" && fy != null && fy < 0.55) return { kind: "cover-list", photo, headline: s.headline, ...(s.sub ? { sub: s.sub } : {}), pos };
      if (s.role === "cover-top") return { kind: s.role, photo, headline: s.headline, ...(s.sub ? { sub: s.sub } : {}), pos };
      if (s.role === "cover-doc") return { kind: s.role, photo, ...(s.headline ? { headline: s.headline } : {}), ...(s.corner ? { corner: s.corner } : {}), pos };
      if (s.role === "cover-card") return { kind: s.role, photo, headline: s.headline, ...(s.sub ? { sub: s.sub } : {}), ...(s.side ? { side: s.side } : {}), pos };
      if (s.role === "cover-compare") return { kind: s.role, photo, ...(s.headline ? { headline: s.headline } : {}), left: s.left, right: s.right, decision: s.decision, pos };
      return { kind: s.role, photo, headline: s.headline, ...(s.sub ? { sub: s.sub } : {}), pos };
    }
    if (s.role === "verdict") return { kind: "verdict", headline: s.headline, ...(s.light ? { light: true } : {}) };
    if (s.role === "note") return { kind: "note", text: s.text, ...(s.label ? { label: s.label } : {}) };
    if (s.role === "script") return { kind: "script", headline: s.headline, say: s.say, ...(s.label ? { label: s.label } : {}), ...(s.light ? { light: true } : {}) };
    if (s.role === "body") return { kind: "body", headline: s.headline, ...(body ? { sub: body } : {}) };
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
      // A story beat with no real photo left keeps its words as a note rather than failing the post.
      if (!photo || p?.ai) return { kind: "note", text: s.caption, ...(s.chapter ? { label: s.chapter } : {}) };
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
  const want = copy.slides.map((s, i) => (["cover", ...COVER_ROLES, "story", "static"].includes(s.role) ? i : null)).filter((i) => i != null);
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
  const parts = [slide.headline, slide.title, slide.sub, slide.body, slide.postText, slide.text, slide.say, slide.caption, slide.chapter, slide.metadata, slide.date,
    ...(slide.items || []).flatMap((x) => typeof x === "string" ? [x] : [x?.text, x?.note]),
    ...[slide.left, slide.right].flatMap((x) => typeof x === "string" ? [x] : [x?.label, x?.value, x?.text, x?.note]),
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

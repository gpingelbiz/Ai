import path from "node:path";
import { execFileSync } from "node:child_process";
import { hookBlockHeight } from "./placement.mjs";
import { CARD_RULES, cardWords, cardOccupancy, maxMajorEvents } from "./preflight.mjs";
import { PKG_ROOT, r3, writeJSON } from "./util.mjs";

const tokens = (text) => String(text || "").replace(/\*/g, "").toLowerCase().split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
const NUMBER = /\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|first|second|third)\b/i;
const TIME = /\b(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|today|tomorrow|yesterday)\b/i;

function hookLines(plan) {
  if (!plan.hook) return 0;
  const W = plan.canvas?.width || 1080, H = plan.canvas?.height || 1920;
  const style = plan.style?.hook || {};
  const fontPx = Math.round((style.fontSizeFrac || 0.052) * H * (style.style === "headline" ? 1.08 : 1));
  const list = plan.hook.words || tokens(plan.hook.text).map((text) => ({ text }));
  const height = hookBlockHeight(list, { W, H, fontPx });
  return Math.max(1, Math.round((height * H - 0.42 * fontPx) / fontPx));
}

function promisedPhraseAt(plan) {
  const hook = tokens(plan.hook?.text);
  const spoken = (plan.words || []).map((w) => ({ ...w, token: tokens(w.text)[0] || "" })).filter((w) => w.token);
  if (!hook.length || !spoken.length) return null;
  let best = null;
  for (let hi = 0; hi < hook.length; hi++) {
    for (let wi = 0; wi < spoken.length; wi++) {
      let n = 0;
      while (hi + n < hook.length && wi + n < spoken.length && hook[hi + n] === spoken[wi + n].token) n++;
      if (!best || n > best.n) best = { n, at: spoken[wi].start };
    }
  }
  return best && best.n >= Math.max(2, Math.ceil(hook.length / 2)) ? r3(best.at) : null;
}

function overlap(card, plan) {
  const start = +card.start || 0, end = start + (+card.duration || 0);
  const captionTokens = new Set((plan.captions || []).filter((c) => (+c.start || 0) < end && (+c.end || 0) > start).flatMap((c) => tokens(c.text)));
  const graphicTokens = cardWords(card).map((w) => tokens(w)[0]).filter(Boolean);
  const same = [...new Set(graphicTokens.filter((w) => captionTokens.has(w)))];
  return { ratio: graphicTokens.length ? r3(graphicTokens.filter((w) => captionTokens.has(w)).length / graphicTokens.length) : 0, words: same };
}

function informationRole(card, captionOverlap) {
  if (["message", "quote", "stat", "bars"].includes(card.type)) return "proof";
  if (["list", "steps", "compare", "chapter", "timeline", "progress"].includes(card.type)) return "orient";
  if (captionOverlap >= 0.6) return "repeat";
  return "new";
}

function visibleAtZero(plan) {
  let n = plan.hook && (+plan.hook.start || 0) <= 1 / 30 ? tokens(plan.hook.text).length : 0;
  for (const c of plan.captions || []) if ((+c.start || 0) <= 0 && (+c.end || 0) > 0) n += tokens(c.text).length;
  for (const g of plan.graphics || []) if ((+g.start || 0) <= 0 && (+g.start || 0) + (+g.duration || 0) > 0) n += cardWords(g).length;
  return n;
}

export function editorGitSha(cwd = PKG_ROOT) {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { return null; }
}

export function makeFeatures(plan, { gitSha, sceneSchema } = {}) {
  const graphics = plan.graphics || [];
  const reading = { ...CARD_RULES, ...(plan.style?.preflight?.cards || {}) };
  const schema = sceneSchema ?? plan.scenes?.schema ?? 1;
  const types = [...new Set(graphics.map((g) => g.type).filter(Boolean))].sort();
  const graphicVersions = types.map((type) => ({ type, version: Math.max(...graphics.filter((g) => g.type === type).map((g) => Number(g.version ?? schema) || 1)) }));
  const hookText = String(plan.hook?.text || "").replace(/\*/g, "");
  const firstBroll = plan.coldOpen ? (plan.coldOpen.file || plan.coldOpen.src || plan.broll?.[0]?.file || plan.broll?.[0]?.src || null) : null;
  const featureGraphics = graphics.map((card) => {
    const wordCount = cardWords(card).length;
    const hold = +card.duration || 0;
    const readableSeconds = Math.max(0, hold - reading.orientationSeconds);
    const readingBudgetWords = Math.max(0, Math.floor(readableSeconds / (60 / reading.readingWpm)));
    const caption = overlap(card, plan);
    return {
      type: card.type || "card",
      version: Number(card.version ?? schema) || 1,
      start: r3(+card.start || 0),
      end: r3((+card.start || 0) + hold),
      wordCount,
      wordsPerSecond: readableSeconds ? r3(wordCount / readableSeconds) : null,
      wordsPerSecondBudgetUsed: readingBudgetWords ? r3(wordCount / readingBudgetWords) : null,
      readingBudgetWords,
      informationRole: informationRole(card, caption.ratio),
      captionOverlap: caption.ratio,
      captionOverlapWords: caption.words,
    };
  });
  const hookTokens = tokens(hookText);
  const duration = plan.video?.duration || 0;
  const firstCard = featureGraphics.length ? Math.min(...featureGraphics.map((g) => g.start)) : null;
  return {
    experiment: {
      graphics: graphicVersions,
      graphicsEnabled: plan.style?.graphics?.enabled ?? (graphics.length > 0),
      graphicsSchema: schema,
      preset: plan.preset || plan.style?.name || null,
      look: plan.style?.look || graphics.find((g) => g.look)?.look || graphics[0]?.skin || null,
      editorGitSha: gitSha === undefined ? editorGitSha() : gitSha,
    },
    hook: {
      text: hookText,
      wordCount: hookTokens.length,
      lineCount: hookLines(plan),
      hasNumber: NUMBER.test(hookText),
      hasTime: TIME.test(hookText),
      hasQuote: /["“”]/.test(hookText),
      promisedPhraseAt: promisedPhraseAt(plan),
    },
    frameZero: {
      source: plan.coldOpen ? "cold-open" : "speaker",
      brollAsset: firstBroll,
      visibleWordCount: visibleAtZero(plan),
    },
    graphics: featureGraphics,
    derived: {
      firstCardDelay: firstCard,
      cardCount: graphics.length,
      occupancyPct: r3(cardOccupancy(graphics, duration) * 100),
      majorEventsPer10s: maxMajorEvents(plan, 10),
    },
    performance: {},
  };
}

export function writeFeatures(dir, plan, options = {}) {
  const file = path.join(dir, "analytics-features.json");
  writeJSON(file, makeFeatures(plan, options));
  return file;
}

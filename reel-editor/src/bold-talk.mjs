import { peopleFrom, speakerTimeline } from "./group.mjs";
import { registerBoldOverlay } from "./bold-overlays.mjs";
import { boldText, fitBoldText } from "./bold-render.mjs";

export const BOLD_TALK_DEFAULTS = Object.freeze({ enabled: true, gregPerson: null, otherWeight: 600, topic: { enabled: true, minWords: 4, maxWords: 7, width: 720, size: 44, padding: 16 } });

export function boldTalkPrompt() {
  return 'speakers: [] by default. Only for an actual conversation without usable face turns, select other-speaker speech as [{from,to,speaker:"other",reason}]. Never mark Greg quoting someone or acting out an objection as another speaker. All unmarked words belong to Greg. No names, rewritten dialogue or times.';
}

/** Speaker identity is separate from emphasis. Unknown and unmarked speech belongs to Greg. */
export function validateBoldSpeakers(list, words) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.some((p) => !p || p.speaker !== "other" || !Number.isInteger(p.from) || !Number.isInteger(p.to) || p.from < 0 || p.to < p.from || p.to >= words.length || typeof p.reason !== "string" || !p.reason.trim() || p.reason.length > 500 || Object.keys(p).some((key) => !["from", "to", "speaker", "reason"].includes(key)))) throw new Error("invalid bold speakers");
  const sorted = list.map((p) => ({ from: p.from, to: p.to, speaker: "other", reason: p.reason.trim() })).sort((a, b) => a.from - b.from);
  if (sorted.some((p, i) => i && p.from <= sorted[i - 1].to)) throw new Error("overlapping bold speakers");
  return sorted;
}

/** Match words by greatest temporal overlap, never by caption timing leads. Ambiguous words stay Greg. */
export function boldSpeakersFromTurns(words, turns, gregPerson) {
  if (!Number.isInteger(gregPerson) || gregPerson < 0 || !Array.isArray(turns)) return [];
  const valid = turns.filter((t) => Number.isFinite(t.start) && Number.isFinite(t.end) && t.start >= 0 && t.end > t.start && Number.isInteger(t.person) && t.person >= 0).sort((a, b) => a.start - b.start);
  if (valid.some((t, i) => i && t.start < valid[i - 1].end)) return [];
  const ranges = [];
  words.forEach((word, i) => {
    const hits = valid.map((turn) => ({ turn, overlap: Math.max(0, Math.min(word.end, turn.end) - Math.max(word.start, turn.start)) })).filter((hit) => hit.overlap > 0).sort((a, b) => b.overlap - a.overlap);
    const best = hits[0];
    if (!best || best.turn.person === gregPerson || (hits[1] && Math.abs(best.overlap - hits[1].overlap) < 1e-9)) return;
    const prev = ranges.at(-1);
    if (prev?.to === i - 1) prev.to = i;
    else ranges.push({ from: i, to: i, speaker: "other", reason: "Detected other speaker turn" });
  });
  return ranges;
}

/** Face turn IDs are positions, not identities. gregPerson must explicitly identify Greg (left to right). */
export async function resolveBoldTalk(plan, picks, detection, { settings, render, timeline = speakerTimeline } = {}) {
  if (settings.talk.enabled === false) return { speakers: [], conversation: null, source: "off" };
  const people = peopleFrom(detection);
  let turns = plan.speakerTimeline?.turns || plan.speakerTurns || null;
  if (people.length >= 2 && !turns && render) {
    try { turns = (await timeline(render, plan.words, { duration: plan.video.duration, people }))?.turns || null; } catch { /* uncertain identity stays Greg */ }
  }
  const detected = people.length >= 2 || new Set((turns || []).map((t) => t.person).filter(Number.isInteger)).size >= 2;
  const usable = turns?.length && detected && Number.isInteger(settings.talk.gregPerson) && settings.talk.gregPerson >= 0 && (people.length ? settings.talk.gregPerson < people.length : turns.some((t) => t.person === settings.talk.gregPerson));
  const speakers = usable ? boldSpeakersFromTurns(plan.words, turns, settings.talk.gregPerson) : validateBoldSpeakers(picks.speakers, plan.words);
  const conversation = (detected || speakers.length) && plan.words.length ? { from: 0, to: plan.words.length - 1 } : null;
  return { speakers, conversation, source: usable ? "faces" : speakers.length ? "direction" : "default" };
}

export function boldTalkCSS(settings, plan) {
  if (!plan.bold?.groups.some((g) => g.speaker === "other")) return "";
  const weight = Math.max(400, Math.min(650, Number(settings.talk.otherWeight) || 600));
  return `\n      .bold-root .bold-other, .bold-root .bold-other .bold-word { color:${settings.colors.gold}; font-weight:${weight}; -webkit-text-stroke:${10 * plan.canvas.width / 1080}px ${settings.colors.black}; paint-order:stroke fill; }`;
}

export function validateBoldTopic(pick, { words, settings }) {
  const cfg = settings.talk.topic, count = pick.to - pick.from + 1;
  if (!settings.talk.enabled || !cfg.enabled || count < Math.max(4, cfg.minWords) || count > Math.min(7, cfg.maxWords) || !words[pick.from] || !words[pick.to] || Object.keys(pick).some((key) => !["kind", "from", "to", "reason"].includes(key))) return null;
  return {};
}

export function placeBoldTopic(event, { plan, settings, talk, zones, fps, overlays }) {
  if (!talk?.conversation || overlays.some((e) => e.kind === "topic")) return null;
  const startFrame = Math.max(Math.round(plan.words[talk.conversation.from].start * fps), plan.bold?.headline?.endFrame || 0);
  const endFrame = Math.min(Math.round(plan.video.duration * fps), Math.ceil(plan.words[talk.conversation.to].end * fps));
  if (endFrame <= startFrame) return null;
  const cfg = settings.talk.topic, scale = plan.canvas.width / 1080, pad = cfg.padding * scale;
  const width = Math.min(zones.safe.w, cfg.width * scale);
  const text = plan.words.slice(event.from, event.to + 1).map((w) => boldText(w.text));
  const fit = fitBoldText(text, { size: cfg.size * scale, width: width - 2 * pad });
  return { startFrame, endFrame, landingFrame: startFrame, box: { x: zones.safe.x + (zones.safe.w - width) / 2, y: zones.safe.y, w: width, h: fit.h + 2 * pad }, data: { size: fit.size, lines: fit.lines } };
}

registerBoldOverlay("topic", {
  prompt: 'For a conversation only, optionally choose one topic {kind:"topic",from,to,reason}: 4 to 7 consecutive transcript words naming its actual lesson. The label holds through the conversation after the opening headline. Zero for solo speech. No text field.',
  validate: validateBoldTopic,
  place: placeBoldTopic,
  html: (event, { plan, esc, i }) => {
    const words = plan.words.slice(event.from, event.to + 1), b = event.box;
    const rows = event.data.lines.map((line) => `<span class="bold-row">${esc(words.slice(line.from, line.to).map((w) => boldText(w.text)).join(" "))}</span>`).join("");
    return `<div id="bold-topic-${i}" class="bold-topic" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;font-size:${event.data.size}px" data-start="${event.start}" data-duration="${event.end - event.start}">${rows}</div>`;
  },
  css: ({ settings, plan }) => `\n      .bold-root .bold-topic { position:absolute; z-index:18; opacity:0; box-sizing:border-box; display:flex; flex-direction:column; justify-content:center; text-align:center; pointer-events:none; border-radius:8px; background:${settings.colors.black}; color:${settings.colors.bone}; padding:${settings.talk.topic.padding * plan.canvas.width / 1080}px; font:650 44px/1.08 "Inter",sans-serif; }`,
  timeline: (event, { i }) => `tl.set("#bold-topic-${i}", { opacity:0 }, 0);\ntl.set("#bold-topic-${i}", { opacity:1 }, ${event.start});\ntl.set("#bold-topic-${i}", { opacity:0 }, ${event.end});`,
  sounds: () => [],
});

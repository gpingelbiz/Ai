import { endingReport, planCuts, remapWords } from "./cuts.mjs";
import { norm } from "./text.mjs";
import { rawToClean } from "./review.mjs";
import { r3 } from "./util.mjs";

export { endingReport };
const tokens = (text) => String(text || "").replace(/’/g, "'").split(/\s+/).map(norm).filter(Boolean);
const STOP = new Set("a an the i you your we our they their it its it's is are was were be been to of for and or but in on at this that with have has do don't not so can will me my i'm you're".split(" "));

/** Words must already be on the finished timeline, as they are in plan.words. */
export function openingReport(words, plan = {}) {
  const spoken = (words || []).filter((w) => !w.drop);
  const firstWordStart = spoken[0]?.start ?? null;
  const firstCaptionText = plan?.captions?.[0]?.text ?? "";
  const firstText = firstCaptionText || spoken.slice(0, 4).map((w) => w.text).join(" ");
  const opening = tokens(firstText).join(" ");
  const spokenOpening = tokens(spoken.slice(0, 4).map((w) => w.text).join(" ")).join(" ");
  const findings = [];
  if (firstWordStart > 1) findings.push({ level: "warn", code: "opening-delay", message: `first spoken word starts at ${firstWordStart.toFixed(2)} s. Bring the subject in sooner.` });
  if ([opening, spokenOpening].some((text) => /^(?:hey guys|so\b|um\b|what's up|good morning|okay so|alright\b)/.test(text))) findings.push({ level: "warn", code: "opening-filler", message: `opening starts with filler or a greeting ("${firstText}"). Start with the subject.` });
  const hookText = typeof plan?.hook === "string" ? plan.hook : plan?.hook?.text;
  const marked = typeof plan?.hook === "object" ? (plan.hook?.words || []).filter((w) => w.key).map((w) => w.text).join(" ") : "";
  const hookKeywords = [...new Set(tokens(marked || hookText).filter((t) => !STOP.has(t)))];
  const early = new Set(spoken.filter((w) => w.start < 4).flatMap((w) => tokens(w.text)));
  const missingHookKeywords = hookKeywords.filter((t) => !early.has(t));
  const hookSpoken = hookKeywords.length && spoken.length ? missingHookKeywords.length === 0 : null;
  if (hookSpoken === false) findings.push({ level: "warn", code: "opening-setup", message: `the first 4 s may be setup. The hook words "${missingHookKeywords.join(", ")}" are not spoken yet.` });
  return { firstWordStart, firstCaptionText, hookKeywords, missingHookKeywords, hookSpoken, findings };
}

/** Inverse of rawToClean. A join selects the end of the preceding kept segment. */
export function timelineToSource(time, cuts) {
  if (!Number.isFinite(time) || time < 0) throw new Error("Ending time must be a nonnegative number.");
  if (!cuts?.segments?.length) throw new Error("A saved cuts map is required for a timeline ending time. Use the ending phrase for a new edit.");
  let offset = 0;
  for (const s of cuts.segments) {
    const length = s.end - s.start;
    if (time <= offset + length + 0.001) return r3(s.start + Math.min(length, Math.max(0, time - offset)));
    offset += length;
  }
  // Encoded video duration can round past cuts.keptDuration by a fraction of a frame.
  throw new Error("Ending time is past the saved cut timeline.");
}

/** Last occurrence of the complete phrase, with punctuation and curly apostrophes ignored. */
export function endAfterPhrase(words, phrase) {
  const target = tokens(phrase);
  if (!target.length) throw new Error("The ending phrase needs spoken words.");
  const source = words.filter((w) => !w.drop).flatMap((w) => tokens(w.text).map((text) => ({ text, end: w.end })));
  for (let i = source.length - target.length; i >= 0; i--) {
    if (target.every((t, j) => t === source[i + j].text)) return source[i + target.length - 1].end;
  }
  throw new Error(`Ending phrase was not found: "${phrase}".`);
}

/** Resolve CLI timeline seconds or a spoken phrase before cuts.json is replaced. */
export function resolveEndingOverride(opts, words, previousCuts) {
  if (opts.endAt != null && opts.endAfter != null) throw new Error("Choose one ending option: a time or a phrase.");
  if (opts.endAt == null && opts.endAfter == null) return null;
  if (opts.noCuts) throw new Error("An ending trim requires cuts. Remove the no cuts option.");
  return opts.endAfter != null ? endAfterPhrase(words, opts.endAfter) : timelineToSource(opts.endAt === "" ? NaN : Number(opts.endAt), previousCuts);
}

/** Exact sidecar contract. Diagnostic times are on the untrimmed cut timeline; endAt is source seconds. */
export function endingMetadata(words, duration, cuts, settings = {}, endAt = null) {
  const lastKept = cuts.words.filter((w) => !w.drop).at(-1);
  const trimmed = cuts.removed.some((r) => r.reason === "ending" || r.reason === "sign-off");
  const baseline = trimmed ? planCuts(words, duration, { ...settings, signOff: false, endAt: null }) : cuts;
  if (trimmed) {
    // Retain the actual earlier edit, including pauses restored by the audio guard. Only reconstruct
    // the removed suffix for the before-trim diagnostic.
    const stop = cuts.segments.at(-1)?.end ?? 0;
    baseline.segments = [...cuts.segments, ...baseline.segments.filter((s) => s.end > stop).map((s) => ({ start: Math.max(stop, s.start), end: s.end }))];
  }
  const before = remapWords(baseline.words, baseline.segments);
  const baselineDuration = baseline.segments.reduce((sum, s) => sum + s.end - s.start, 0);
  let report = endingReport(before, baselineDuration);
  const sourceReport = endingReport(words, duration);
  if (!report && sourceReport?.reason === "silence or room tone after the last word") {
    report = { ...sourceReport, lastPointEnd: rawToClean(sourceReport.lastPointEnd, baseline.segments) };
  }
  return {
    lastPointEnd: endAt != null ? rawToClean(lastKept?.end ?? endAt, baseline.segments) : report?.lastPointEnd ?? before.at(-1)?.end ?? null,
    tailSeconds: report?.tailSeconds ?? 0,
    tailText: report?.tailText ?? "",
    trimmed,
    endAt: trimmed ? endAt ?? lastKept?.end ?? null : null,
  };
}

/** Shared pure reports and warning items for preflight and the read only CLI command. */
export function openingEndingChecks(words, plan, duration = plan?.video?.duration) {
  const opening = openingReport(words, plan);
  const ending = endingReport(words, duration);
  const items = [...opening.findings];
  if (ending) {
    const excerpt = ending.tailText.length > 100 ? `${ending.tailText.slice(0, 97)}...` : ending.tailText;
    items.push({ level: ending.tailSeconds > 4 ? "check" : "warn", code: "ending-tail", message: `ending runs ${ending.tailSeconds.toFixed(1)} s past the last point${excerpt ? ` ("${excerpt}")` : " with silence or room tone"}; trim with reel edit --end-at ${ending.lastPointEnd.toFixed(2)}` });
  }
  return { opening, ending, items };
}

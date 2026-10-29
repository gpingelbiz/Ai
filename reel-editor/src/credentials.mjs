import { r3 } from "./util.mjs";

const clean = (value) => String(value ?? "").trim();
const verifiedWord = (value) => /^(?:verified|true|yes|check|checked|✓)$/i.test(clean(value));
const frame = (value, fps = 30) => Math.round(value * fps) / fps;
const overlap = (a, b, gap = 0) => a.start < b.start + b.duration + gap && a.start + a.duration + gap > b.start;

/**
 * One supplied credit. The first three pipe fields are stable; source and verified are optional fourth/fifth fields.
 * Missing trailing fields stay empty instead of being guessed.
 */
export function parseCredit(value, { at = null } = {}) {
  const raw = clean(value);
  if (!raw) throw new Error("--credit needs a name");
  const parts = raw.split("|").map(clean);
  const [name = "", credential = "", organisation = ""] = parts;
  if (!name) throw new Error("--credit needs a name before the first pipe");
  const tail = parts.slice(3);
  const verified = tail.some(verifiedWord);
  const source = tail.find((part) => part && !verifiedWord(part)) || "";
  const when = at == null || at === "" ? null : Number(at);
  if (when != null && (!Number.isFinite(when) || when < 0)) throw new Error(`--credit-at must be zero or later (got "${at}")`);
  return {
    name,
    credential,
    organisation,
    source,
    verified,
    at: when,
    input: { kind: "cli", text: raw },
  };
}

/** Repeatable --credit / --credit-at values, paired in command-line order. */
export function parseCredits(values = [], ats = []) {
  const list = values == null ? [] : Array.isArray(values) ? values : [values];
  const times = ats == null ? [] : Array.isArray(ats) ? ats : [ats];
  if (times.length > list.length) throw new Error("--credit-at has no matching --credit");
  return list.map((value, i) => parseCredit(value, { at: times[i] }));
}

/** The creator's own credit comes only from the resolved brand identity. */
export function brandCredit(brand) {
  const name = clean(brand?.identity?.name);
  const credential = clean(brand?.identity?.credential);
  if (!name || !credential) return null;
  const text = `${name} | ${credential}`;
  return {
    name,
    credential,
    organisation: "",
    source: "",
    verified: false,
    at: null,
    input: { kind: "brand.identity", text },
  };
}

/** Exact provenance for a displayed field; field position matters, so a short name cannot validate a role. */
export function creditValueGrounded(item, key) {
  const parts = clean(item?.input?.text).split("|").map(clean);
  const expected = key === "name" ? parts[0]
    : key === "credential" ? parts[1]
      : key === "organisation" ? parts[2]
        : key === "source" ? parts.slice(3).find((part) => part && !verifiedWord(part))
          : "";
  return clean(item?.[key]) !== "" && clean(item[key]) === clean(expected);
}

export function creditVerifiedGrounded(item) {
  return item?.verified === true && clean(item?.input?.text).split("|").slice(3).some(verifiedWord);
}

function clearStart(wanted, hold, busy, { min = 0, max = Infinity, fps = 30 } = {}) {
  let start = frame(Math.max(min, wanted), fps);
  const blocks = (busy || []).map((item) => ({ start: Number(item.start) || 0, duration: Math.max(0, Number(item.duration) || 0) })).sort((a, b) => a.start - b.start);
  for (let changed = true; changed;) {
    changed = false;
    const hit = blocks.find((block) => overlap({ start, duration: hold }, block, 1 / fps));
    if (hit) {
      // Round up past the block and its one-frame gap: rounding to the nearest frame could land back inside the gap
      // (a block ending off the frame grid) and loop forever on the same start.
      const next = Math.ceil((hit.start + hit.duration + 1 / fps) * fps - 1e-6) / fps;
      start = next > start ? next : start + 1 / fps;
      changed = true;
    }
  }
  return start + hold <= max + 1 / fps ? start : null;
}

/**
 * Long-form repeat points: first appearance, then the first appearance after a chapter when this speaker has been
 * absent for more than `offscreen` seconds. Chapter-card time itself remains busy and is resolved by scheduling.
 */
export function youtubeReshowStarts(turns = [], chapters = [], { speaker = 0, offscreen = 180, minTurn = 3 } = {}) {
  const allMine = turns.filter((turn) => (turn.person ?? turn.track) === speaker).sort((a, b) => a.start - b.start);
  const mine = allMine.filter((turn) => turn.end - turn.start >= minTurn);
  if (!mine.length) return [];
  const starts = [mine[0].start];
  for (const chapter of chapters.slice(1)) {
    const next = mine.find((turn) => turn.start >= chapter.start);
    if (!next) continue;
    const previous = [...allMine].reverse().find((turn) => turn !== next && turn.end <= next.start);
    if (previous && next.start - previous.end > offscreen && !starts.some((at) => Math.abs(at - next.start) < 1 / 30)) starts.push(next.start);
  }
  return starts;
}

/**
 * Grounded credit timing. Credit order maps to diarized speaker order. Without diarization, one credit may use the
 * preset's ordinary lower-third time; several speakers need explicit --credit-at values so names are never guessed.
 */
export function scheduleCredits(credits = [], {
  turns = [],
  hook = null,
  cards = [],
  chapters = [],
  duration = 0,
  at = 4,
  hold = 5,
  fps = 30,
  youtube = false,
  offscreen = 180,
  minTurn = 3,
  tail = 0,
} = {}) {
  const shown = [];
  const skipped = [];
  const safeHold = frame(Math.max(3, Math.min(5, Number(hold) || 5)), fps);
  const end = Math.max(0, duration - tail);
  const fixedBusy = [
    ...(hook ? [{ start: hook.start, duration: hook.duration }] : []),
    ...cards.map((card) => ({ start: card.start, duration: card.duration })),
  ];

  credits.forEach((credit, speaker) => {
    const explicit = Number.isFinite(credit.at);
    let wanted = [];
    if (explicit) wanted = [credit.at];
    else if (turns.length) {
      const enough = Math.max(minTurn, safeHold);
      if (youtube) wanted = youtubeReshowStarts(turns, chapters, { speaker, offscreen, minTurn: enough });
      else wanted = turns
        .filter((turn) => (turn.person ?? turn.track) === speaker && turn.end - turn.start >= enough)
        .sort((a, b) => a.start - b.start)
        .map((turn) => turn.start);
    } else if (credits.length === 1) wanted = [at];

    if (!wanted.length) {
      skipped.push({ credit, reason: turns.length ? "no long turn for that speaker" : "several speakers need diarization or --credit-at" });
      return;
    }

    for (const desired of wanted) {
      const speakerTurn = explicit ? null : turns.find((turn) =>
        (turn.person ?? turn.track) === speaker && desired >= turn.start - 1 / fps && desired < turn.end,
      );
      const start = clearStart(desired, safeHold, [...fixedBusy, ...shown], {
        min: 0,
        max: speakerTurn ? Math.min(end, speakerTurn.end) : end,
        fps,
      });
      if (start == null) {
        skipped.push({ credit, reason: `no clear ${safeHold}s window after ${r3(desired)}s` });
        continue;
      }
      shown.push({ ...credit, speaker, at: r3(start), duration: safeHold });
      if (!youtube) break;
    }
  });

  shown.sort((a, b) => a.at - b.at);
  return { items: shown, skipped };
}

/** Size the token-driven plate before face-aware placement. */
export function credentialDimensions(brand, item, { W = 1080, H = 1920 } = {}) {
  const type = brand?.typeScale || {};
  const space = brand?.spacing || {};
  const name = Number(type.lg) || 54;
  const body = (Number(type.sm) || 30) + (Number(space.xs) || 8) / 2;
  const meta = Number(type.xs) || 24;
  const pad = Number(space.md) || 24;
  const gap = Number(space.xs) || 8;
  const lines = [item.credential && body, item.organisation && meta, item.source && meta].filter(Boolean);
  const height = Math.ceil(pad * 2 + name + lines.reduce((sum, size) => sum + size, 0) + Math.max(0, lines.length) * gap);
  const width = W > H ? Math.min(760, W - 180) : Math.min(720, W - 152);
  return { width, height };
}

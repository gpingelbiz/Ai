// The "receipts" look for reel proof (Greg 2026-11-25, on the first proof reel: "i dont like the still pic that shows in
// the middle"). Research in ~/Reels/research/2026-11-25-proof-reel-flow: none of 8 top proof reels go back to a still;
// the texts fill the screen and the proof piles up. So the photo footage stays hidden (it only carries the voice and
// feeds the cover), and the picture is:
//   hook over a moving wall of real texts -> each text full width as a thread, a gold marker filling word by word with
//   the voice -> a number slam when the quote says "from X to Y" -> a phone-scroll swipe to the next text, the wall
//   blurred and drifting behind -> back out to the wall for the closer, built line by line.
// No dates anywhere (Greg 2026-11-25: "remove the dates of the texts"). Everything stays inside the Instagram safe
// zone the master gate measures (x 70..1010, right edge 946 beside the buttons, bottom 83%).
import { esc } from "./text.mjs";

export const RECEIPTS = Object.freeze({
  threadLeft: 98, threadWidth: 820, threadTop: 250, threadHeight: 1020, push: 1.05,
  capTop: 1330, capLeft: 80, capWidth: 860,
  textLeft: 76, textWidth: 864, hookTop: 600, closeTop: 600,
  minSlam: 0.9,
});
const GOLD = "#C8A24B", BONE = "#F5F1E8", INK = "#0B0B0D";
const OUT = 0.22, IN = 0.35; // a text swipes away in OUT s, the next one rises in IN s

/** Word tokens the way reel proof checks quotes (letters and digits, inner apostrophes kept), with where each sits. */
export function tokenSpans(text) {
  return [...String(text || "").matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map((m) => ({ text: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length }));
}

/**
 * Times for every token of the script, read off the transcript of the finished voice (plan.words, reel time). The
 * voice says the script word for word, so a plain edit-distance alignment holds even where the transcriber mishears
 * a word; a token it dropped takes the time between its neighbours.
 */
export function alignTokens(script, heard) {
  const h = [];
  for (const w of heard || []) for (const t of tokenSpans(w.text)) h.push({ text: t.text, start: w.start, end: w.end });
  const n = script.length, m = h.length;
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 0; i <= n; i++) D[i][0] = i;
  for (let j = 0; j <= m; j++) D[0][j] = j;
  // A heard word that is the script word with a different ending ("coach" heard as "coached") is half a mismatch.
  const cost = (a, b) => (a === b ? 0 : a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)) ? 0.5 : 1);
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const sub = D[i - 1][j - 1] + cost(script[i - 1], h[j - 1].text);
    D[i][j] = Math.min(sub, D[i - 1][j] + 1, D[i][j - 1] + 1);
  }
  const at = new Array(n).fill(null);
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (D[i][j] === D[i - 1][j - 1] + cost(script[i - 1], h[j - 1].text)) { at[i - 1] = { start: h[j - 1].start, end: h[j - 1].end }; i--; j--; }
    else if (D[i][j] === D[i - 1][j] + 1) i--;
    else j--;
  }
  // Gaps: between the neighbours that were heard.
  for (let i = 0; i < n; i++) {
    if (at[i]) continue;
    let a = i - 1; while (a >= 0 && !at[a]) a--;
    let b = i + 1; while (b < n && !at[b]) b++;
    const t0 = a >= 0 ? at[a].end : (b < n ? at[b].start : 0), t1 = b < n ? at[b].start : t0 + 0.3;
    const k = (i - a) / (b - a);
    const s = t0 + (t1 - t0) * k;
    at[i] = { start: s, end: Math.max(s + 0.08, Math.min(t1, s + 0.3)) };
  }
  return at;
}

/** Each spoken line of the proof script with its words and their reel times. */
export function lineTimings(lines, heard) {
  const flat = [];
  lines.forEach((line, li) => tokenSpans(line.text).forEach((t, k) => flat.push({ li, k, text: t.text })));
  const times = alignTokens(flat.map((t) => t.text), heard);
  return lines.map((line, li) => {
    const toks = flat.map((t, i) => ({ ...t, ...times[i] })).filter((t) => t.li === li);
    // Display words (split on spaces) take the time of their first token.
    const words = [];
    let k = 0;
    for (const w of String(line.text || "").split(/\s+/).filter(Boolean)) {
      const nTok = tokenSpans(w).length;
      const t = toks[Math.min(k, toks.length - 1)];
      words.push({ text: w, start: t ? t.start : 0, end: t ? (toks[Math.min(k + Math.max(nTok, 1) - 1, toks.length - 1)].end) : 0 });
      k += nTok;
    }
    return { ...line, tokens: toks, words, start: toks[0]?.start ?? 0, end: toks.at(-1)?.end ?? 0 };
  });
}

const NUM = String.raw`\$?\d[\d,]*(?:\.\d+)?%?`;
const SLAM = new RegExp(String.raw`(?:\b([a-z]+(?:\s+[a-z]+)?)\s+(?:went|jumped|grew|climbed|increased|rose|moved|doubled)\s+)?\bfrom\s+(${NUM})\s+to\s+(?:(?:a\s+little\s+|just\s+)?(?:over|about|almost|nearly|around|above)\s+)?(${NUM})`, "i");

/** "from 8% to a little over 35%": the two numbers a quote itself says, for the number slam. Money never slams. */
export function statSlam(quote) {
  const m = SLAM.exec(String(quote || ""));
  if (!m) return null;
  const [, rawLabel, from, to] = m;
  if (/\$/.test(from + to)) return null;
  if (/%/.test(from) !== /%/.test(to)) return null;
  const a = Number(from.replace(/[,%]/g, "")), b = Number(to.replace(/[,%]/g, ""));
  if (!(Number.isFinite(a) && Number.isFinite(b)) || b <= a) return null;
  const unit = /%/.test(to) ? "%" : "";
  const label = rawLabel ? rawLabel.replace(/^(?:my|our|his|her|their|the|a)\s+/i, "").trim().toUpperCase() : "";
  // The token of the second number: the slam lands when it is said.
  const digits = to.replace(/[^\d.,]/g, "").replace(/,/g, "").split(".")[0];
  const before = tokenSpans(String(quote).slice(0, m.index + m[0].length));
  let toIndex = -1;
  for (let i = before.length - 1; i >= 0; i--) if (before[i].text.replace(/,/g, "") === digits) { toIndex = i; break; }
  return { label, from: `${from.replace(/,/g, "")}`, to: `${b}${unit}`, toIndex };
}

/**
 * The thread's bubbles as HTML: the quoted run of words wrapped one span per token (the marker fills each as it is
 * said), names covered with solid pills. Returns the bubbles and how many quote tokens were marked.
 */
export function threadMarkup(messages, quote, redact = [], id = "t") {
  const q = tokenSpans(quote).map((t) => t.text);
  const texts = messages.map((m) => String(m.text || "").trim().replace(/[ \t]*\n[\s]*\n\s*/g, "\n"));
  const all = [];
  texts.forEach((text, mi) => tokenSpans(text).forEach((t) => all.push({ ...t, mi })));
  let run = -1;
  outer: for (let i = 0; q.length && i <= all.length - q.length; i++) {
    for (let j = 0; j < q.length; j++) if (all[i + j].text !== q[j]) continue outer;
    run = i; break;
  }
  const marked = new Map(); // "mi:start" -> token index in the quote
  if (run >= 0) for (let j = 0; j < q.length; j++) marked.set(`${all[run + j].mi}:${all[run + j].start}`, j);
  const bubbles = texts.map((text, mi) => {
    let html = "", at = 0;
    for (const t of tokenSpans(text)) {
      const j = marked.get(`${mi}:${t.start}`);
      if (j === undefined) continue;
      // The word stays white underneath; a dark-on-gold copy on top is uncovered left to right as it is said, so
      // every letter reads at every frame (a color switch before the marker got there hid the rest of the word).
      const word = esc(text.slice(t.start, t.end));
      html += cover(text.slice(at, t.start), redact) + `<span class="qw" id="${id}-q${j}">${word}<span class="ink" aria-hidden="true">${word}</span></span>`;
      at = t.end;
    }
    html += cover(text.slice(at), redact);
    return { who: messages[mi].who === "greg" ? "greg" : "them", html };
  });
  return { bubbles, marked: run >= 0 ? q.length : 0 };
}

/** Text escaped for HTML with every covered name replaced by a solid pill. */
export function cover(text, redact = []) {
  let out = esc(text);
  for (const w of [...redact].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const pat = esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${pat}(?![\\p{L}\\p{N}])`, "giu"), '<span class="red"></span>');
  }
  return out;
}

function miniCard(c) {
  const bubbles = (c.messages || []).map((m) => `<div class="mb ${m.who === "greg" ? "greg" : "them"}">${cover(String(m.text || "").trim(), c.redact || [])}</div>`).join("");
  return `<div class="mc"><div class="ml">${esc(c.label || "")}</div>${bubbles}</div>`;
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Every time the composition needs, from the script lines as heard in the finished voice. */
export function receiptsTimeline(data, heard, duration) {
  const items = data.items || [];
  const lines = [{ kind: "hook", text: data.hook }, ...items.flatMap((it, i) => [{ kind: "setup", item: i, text: it.setup }, { kind: "quote", item: i, text: it.quote }]), { kind: "close", text: data.close }];
  const timed = lineTimings(lines, heard);
  const hook = timed[0], close = timed.at(-1);
  const setups = items.map((_, i) => timed[1 + 2 * i]), quotes = items.map((_, i) => timed[2 + 2 * i]);
  const dive = r3(Math.max(hook.end + 0.15, (setups[0]?.start ?? hook.end + 0.5) - 0.35));
  // One text leaves (OUT s) before the next one rises (IN s): two texts never share the screen.
  const outs = items.map((_, i) => i + 1 < items.length ? Math.max(quotes[i].end + 0.15, setups[i + 1].start - 0.55) : close.start - 0.45);
  const threads = items.map((it, i) => {
    const into = i === 0 ? dive + 0.25 : outs[i - 1] + OUT;
    const out = outs[i];
    const q = quotes[i];
    const qa = q.start;
    // The text never rises empty (preflight 11-25, Reel 10 at 0:19.4: only the "Real text" label on screen): the
    // typing dots ride in with it when the setup leaves time for them, otherwise the first bubble pops as it lands.
    // Dots only when the thread opens on the client's message: nobody sees their own typing dots.
    const nb = (it.messages || []).length;
    const theirsFirst = (it.messages || [])[0]?.who !== "greg";
    const typing = theirsFirst && qa - into >= 2.4 ? into : null;
    let p0 = typing != null ? typing + 0.8 : into + 0.05;
    const latest = qa - 0.25;
    if (p0 > latest) p0 = Math.max(into + 0.1, latest);
    const gap = nb > 1 ? Math.max(0.12, Math.min(0.35, (latest - p0) / (nb - 1))) : 0;
    const slam = statSlam(it.quote);
    let slamAt = null;
    if (slam && slam.toIndex >= 0 && q.tokens[slam.toIndex]) {
      const t = q.tokens[slam.toIndex].start + 0.1;
      if (out - t >= RECEIPTS.minSlam) slamAt = t;
    }
    const gone = slamAt != null ? slamAt + 0.2 : out + (i + 1 < items.length ? OUT : 0.3);
    return {
      into: r3(into), out: r3(out), gone: r3(gone), typing: typing == null ? null : r3(typing),
      pops: Array.from({ length: nb }, (_, k) => r3(p0 + k * gap)),
      quote: q.tokens.map((t) => [r3(t.start), r3(t.end)]), qa: r3(qa), qb: r3(q.end),
      slam: slamAt == null ? null : { ...slam, at: r3(slamAt) },
      last: i === items.length - 1,
    };
  });
  return {
    duration, dive,
    hook: { start: 0, end: r3(dive + 0.23), words: hook.words.map((w) => [w.text, r3(w.start)]) },
    setups: setups.map((s, i) => ({ a: r3(s.start), b: r3(s.end), show: r3(Math.max(s.start - 0.05, i === 0 ? dive + 0.25 : outs[i - 1] + OUT + IN - 0.05)), words: s.words.map((w) => [w.text, r3(w.start)]) })),
    threads,
    close: { start: r3(close.start), sentences: splitSentences(data.close).map((s) => ({ words: s.words, at: r3(close.words[s.first]?.start ?? close.start) })) },
  };
}

/** The closer as sentences, each with the index of its first word. */
export function splitSentences(text) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  let cur = [], first = 0;
  words.forEach((w, i) => {
    if (!cur.length) first = i;
    cur.push(w);
    if (/[.!?]["”’]?$/.test(w) || i === words.length - 1) { out.push({ words: cur, first }); cur = []; }
  });
  return out;
}

function sentenceHTML(words) {
  return words.map((w, i) => i === words.length - 1 ? `<b>${esc(w.toUpperCase())}</b>` : esc(w.toUpperCase())).join(" ");
}

const CSS = (R) => `
html,body{margin:0;background:${INK}}
#root{position:relative;width:1080px;height:1920px;overflow:hidden;background:${INK};font-family:Inter,-apple-system,sans-serif}
#video-wrap{position:absolute;inset:0;opacity:0}
#footage{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#wall{position:absolute;inset:0;transform-origin:50% 45%}
.col{position:absolute;width:336px;display:flex;flex-direction:column;gap:18px}
.mc{background:#111113;border:1.5px solid rgba(200,162,75,.35);border-radius:18px;padding:12px 12px 14px;max-height:440px;overflow:hidden}
.ml{font-weight:600;font-size:13px;color:${GOLD};padding:0 4px 8px;border-bottom:1px solid #26252A;margin-bottom:8px}
.mb{font-family:-apple-system,Inter,sans-serif;font-size:18px;line-height:1.3;padding:7px 11px;border-radius:14px;margin-top:6px;width:fit-content;max-width:290px}
.mb.them{background:#26252A;color:#fff}.mb.greg{background:#1F6FD1;color:#fff;margin-left:auto}
.mc .red{width:2.2em}
#dim{position:absolute;inset:0;background:radial-gradient(ellipse 90% 42% at 50% 46%,rgba(11,11,13,.93) 0%,rgba(11,11,13,.74) 65%,rgba(11,11,13,.6) 100%)}
#hook{position:absolute;left:${R.textLeft}px;width:${R.textWidth}px;top:${R.hookTop}px;text-align:center;font-family:Anton;font-size:116px;line-height:1.04;color:${BONE};text-transform:uppercase;text-shadow:0 6px 30px rgba(0,0,0,.7);opacity:0}
#hook .g{display:block}
.thread{position:absolute;left:${R.threadLeft}px;width:${R.threadWidth}px;top:${R.threadTop}px;height:${R.threadHeight}px;display:flex;flex-direction:column;justify-content:center;opacity:0}
.push{transform-origin:50% 40%}
.meta{text-align:center;font-weight:600;font-size:30px;color:${GOLD};margin-bottom:28px}
.b{position:relative;isolation:isolate;max-width:${R.threadWidth}px;width:fit-content;box-sizing:border-box;padding:20px 28px;border-radius:34px;color:#fff;line-height:1.34;margin-top:14px;font-family:-apple-system,"SF Pro Text",Inter,sans-serif;opacity:0}
.b.them{background:#26252A}.b.greg{background:#1F6FD1;margin-left:auto}
.b.last.them{border-bottom-left-radius:10px}.b.last.greg{border-bottom-right-radius:10px}
.typing{display:flex;gap:12px;width:fit-content;padding:28px 32px;border-radius:34px;background:#26252A;opacity:0;margin-top:14px}
.typing i{width:20px;height:20px;border-radius:50%;background:#8E8A84;display:block}
.qw{position:relative}
.qw .ink{position:absolute;left:-5px;right:-14px;top:0;bottom:0;padding-left:5px;line-height:normal;white-space:nowrap;color:${INK};background:linear-gradient(to bottom,transparent 8px,${GOLD} 8px,${GOLD} calc(100% - 2px),transparent calc(100% - 2px));border-radius:6px;clip-path:inset(0% 100% 0% 0%)}
.red{display:inline-block;width:2.4em;height:.9em;background:#4A4950;border-radius:.3em;vertical-align:-.08em}
.cap{position:absolute;left:${R.capLeft}px;width:${R.capWidth}px;top:${R.capTop}px;text-align:center;font-weight:800;font-size:60px;line-height:1.18;color:${BONE};opacity:0;text-shadow:0 4px 18px rgba(0,0,0,.8)}
.cw{opacity:.28}
.stat{position:absolute;inset:0;background:${INK};opacity:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.stat .lab{font-weight:800;font-size:40px;letter-spacing:.14em;color:${GOLD};margin-bottom:10px;max-width:${R.textWidth}px;text-align:center}
.stat .row{display:flex;align-items:center;gap:30px;font-family:Anton;margin-right:${1080 - 2 * 508}px}
.stat .from{font-size:150px;color:#8E8A84}
.stat .arr{font-size:130px;color:${BONE}}
.stat .to{font-size:230px;color:${GOLD};white-space:nowrap}
#close{position:absolute;left:${R.textLeft}px;width:${R.textWidth}px;top:${R.closeTop}px;text-align:center;font-family:Anton;font-size:80px;line-height:1.14;color:${BONE};text-shadow:0 6px 30px rgba(0,0,0,.8);opacity:0}
#close div{opacity:0}
#close b{color:${GOLD};font-weight:400}
`;

/**
 * The whole composition. footageMarkup is the hidden <video> (it carries the voice; the cover reads its frames) and
 * audioMarkup the music tracks, both from compose.mjs so the mix is the editor's.
 */
export function receiptsHTML({ data, heard, duration, footageMarkup, audioMarkup = "", fxChain = "", fps = 30 }) {
  const R = RECEIPTS;
  const T = receiptsTimeline(data, heard, duration);
  const D = r3(duration);
  const wall = data.wall || [];
  const cards = wall.map(miniCard);
  // Each column repeats its texts until it is long enough to keep scrolling the whole reel (a short coach list too).
  const cols = [0, 1, 2].map((c) => {
    let mine = cards.filter((_, i) => i % 3 === c);
    if (!mine.length) mine = cards.slice(0, 1);
    const reps = mine.length ? Math.max(3, Math.ceil(24 / mine.length)) : 0;
    const html = Array.from({ length: reps }, (_, r) => mine.slice(r % mine.length).concat(mine.slice(0, r % mine.length)).join("")).join("");
    return `<div class="col" id="col${c}" style="left:${18 + c * 354}px;top:${-120 * c}px">${html}</div>`;
  }).join("");
  const win = (a, b) => `data-start="${r3(Math.max(0, a))}" data-duration="${r3(Math.max(0.1, Math.min(D, b) - Math.max(0, a)))}"`;
  // The hook and the setup captions drop sentence periods (captions never carry them); ? and ! stay.
  const hookWords = String(data.hook || "").replace(/[.,;:]+$/, "").split(/\s+/).filter(Boolean);
  const goldFrom = hookWords.length >= 4 ? hookWords.length - 2 : hookWords.length;
  const hookHTML = esc(hookWords.slice(0, goldFrom).join(" ")) + (goldFrom < hookWords.length ? ` <span class="g">${esc(hookWords.slice(goldFrom).join(" "))}</span>` : "");
  const threadsHTML = (data.items || []).map((it, i) => {
    const th = T.threads[i];
    const { bubbles } = threadMarkup(it.messages || [], it.quote, it.redact || [], `t${i}`);
    const chars = (it.messages || []).reduce((n, m) => n + String(m.text || "").length, 0);
    // Short texts (most coach texts are a line or two) read big; long ones step down so the thread fits.
    const font = chars > 520 ? 40 : chars > 380 ? 46 : chars > 140 ? 52 : chars > 60 ? 62 : 72;
    const bs = bubbles.map((b, k) => `<div class="b ${b.who}${k === bubbles.length - 1 || bubbles[k + 1].who !== b.who ? " last" : ""}" id="t${i}-b${k}" style="font-size:${font}px">${b.html}</div>`).join("");
    const typing = th.typing != null ? `<div class="typing" id="t${i}-typing"><i></i><i></i><i></i></div>` : "";
    return `<div class="thread" id="t${i}" ${win(th.into, th.gone)}><div class="push" id="t${i}-push"><div class="meta">${esc(data.label || "Real text")}</div>${typing}${bs}</div></div>`;
  }).join("\n");
  const statsHTML = T.threads.map((th, i) => {
    if (!th.slam) return "";
    const s = th.slam;
    return `<div class="stat" id="s${i}" ${win(s.at, th.out + OUT)}>${s.label ? `<div class="lab">${esc(s.label)}</div>` : ""}<div class="row"><div class="from">${esc(s.from)}</div><div class="arr">→</div><div class="to">${esc(s.to)}</div></div></div>`;
  }).join("\n");
  const capsHTML = T.setups.map((s, i) => `<div class="cap" id="cap${i}" ${win(s.show, s.b + 0.7)}>${s.words.map(([w], j) => `<span class="cw" id="c${i}-${j}">${esc(w.replace(/[.,;:]+$/, ""))}</span>`).join(" ")}</div>`).join("\n");
  const closeHTML = `<div id="close" ${win(T.close.start - 0.12, D)}>${T.close.sentences.map((s, i) => `<div id="cl${i}">${sentenceHTML(s.words)}</div>`).join("")}</div>`;
  const runtime = {
    D, dive: T.dive, push: R.push,
    hookGold: (T.hook.words[goldFrom] || [null, null])[1],
    out: OUT, in: IN,
    threads: T.threads.map((t) => ({ into: t.into, out: t.out, gone: t.gone, typing: t.typing, pops: t.pops, quote: t.quote, qa: t.qa, qb: t.qb, last: t.last, slam: t.slam ? { at: t.slam.at } : null })),
    // A setup caption leaves as its text's quote starts, so the marker is never under a different line.
    caps: T.setups.map((s, i) => ({ show: s.show, hide: Math.max(s.b + 0.05, Math.min(s.b + 0.45, (T.threads[i]?.qa ?? s.b + 1) - 0.05)), words: s.words.map(([, t]) => t) })),
    close: { start: T.close.start, at: T.close.sentences.map((s) => s.at) },
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>${esc(data.name || "proof")}</title>
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Anton"; src: url("assets/fonts/Anton-Regular.ttf") format("truetype"); font-display: block; }
      @font-face { font-family: "Inter"; src: url("assets/fonts/Inter.ttf") format("truetype"); font-weight: 100 900; font-display: block; }
      ${CSS(R)}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="reel" data-start="0" data-width="1080" data-height="1920" data-duration="${D}" data-fps="${fps}"${fxChain}>
      <div id="video-wrap" data-layout-allow-overflow>${footageMarkup}</div>
      <div id="wall" data-start="0" data-duration="${D}" data-gate="backdrop" data-layout-allow-overflow>${cols}<div id="dim"></div></div>
      <div id="hook" ${win(0, T.hook.end)}>${hookHTML}</div>
${threadsHTML}
${statsHTML}
${capsHTML}
      ${closeHTML}
${audioMarkup}
    </div>
    <script>
      const P = ${JSON.stringify(runtime)};
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const ir = { immediateRender: false };
      // The wall moves from frame 0: three columns at different speeds.
      [[0, -900], [-500, -1600], [-200, -1100]].forEach(([a, b], c) => tl.fromTo("#col" + c, { y: a }, { y: b, duration: P.dive + 0.5, ease: "none" }, 0));
      tl.fromTo("#hook", { scale: 1.1, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: "expo.out" }, 0);
      if (P.hookGold != null) {
        tl.fromTo("#hook .g", { color: "${BONE}" }, { color: "${GOLD}", duration: 0.1, ...ir }, P.hookGold);
        tl.fromTo("#hook .g", { scale: 1 }, { scale: 1.08, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out", ...ir }, P.hookGold);
      }
      tl.to("#hook", { opacity: 0, scale: 0.92, duration: 0.22, ease: "power2.in" }, P.dive);
      tl.to("#wall", { scale: 1.5, opacity: 0.3, filter: "blur(10px)", duration: 0.5, ease: "power3.in" }, P.dive);
      [[-900, -1300], [-1600, -2000], [-1100, -1500]].forEach(([a, b], c) => tl.fromTo("#col" + c, { y: a }, { y: b, duration: Math.max(1, P.close.start - P.dive - 0.5), ease: "none", ...ir }, P.dive + 0.5));
      P.threads.forEach((t, i) => {
        const el = "#t" + i;
        if (i === 0) tl.fromTo(el, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.4, ease: "power3.out" }, t.into);
        else tl.fromTo(el, { opacity: 0, y: 500 }, { opacity: 1, y: 0, duration: P.in, ease: "power3.out" }, t.into);
        if (t.typing != null) {
          tl.fromTo(el + "-typing", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.18, ease: "back.out(2)" }, t.typing);
          tl.to(el + "-typing i", { y: -8, duration: 0.15, stagger: 0.08, yoyo: true, repeat: 3, ease: "sine.inOut" }, t.typing + 0.1);
          tl.set(el + "-typing", { display: "none" }, t.pops[0]);
        }
        t.pops.forEach((p, k) => tl.fromTo(el + "-b" + k, { opacity: 0, scale: 0.7, transformOrigin: "0% 100%" }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(1.6)" }, p));
        // The marker follows the voice, word by word.
        t.quote.forEach((q, j) => {
          const next = j + 1 < t.quote.length ? t.quote[j + 1][0] : q[1];
          const d = Math.max(0.08, Math.min(0.28, next - q[0]));
          tl.fromTo(el + "-q" + j + " .ink", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: d, ease: "none", immediateRender: false }, q[0]);
        });
        tl.fromTo(el + "-push", { scale: 1 }, { scale: P.push, duration: Math.max(0.5, t.qb - t.qa), ease: "sine.inOut" }, t.qa);
        if (t.slam) {
          // The number card takes the screen; the text under it is put away so the two never share a frame.
          const s = "#s" + i;
          tl.fromTo(s, { opacity: 0 }, { opacity: 1, duration: 0.18 }, t.slam.at);
          tl.fromTo(s + " .row", { scale: 1.3 }, { scale: 1, duration: 0.32, ease: "expo.out" }, t.slam.at);
          tl.fromTo(s + " .to", { scale: 1 }, { scale: 1.08, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out", ...ir }, t.slam.at + 0.32);
          tl.set(el, { opacity: 0 }, t.gone);
          tl.to(s, { y: -600, opacity: 0, duration: P.out, ease: "power2.in" }, t.out);
        } else if (!t.last) tl.to(el, { y: -600, opacity: 0, duration: P.out, ease: "power2.in" }, t.out);
        if (t.last) tl.to(el, { scale: 0.4, opacity: 0, y: 160, duration: 0.3, ease: "power2.in" }, t.out);
      });
      P.caps.forEach((c, i) => {
        tl.fromTo("#cap" + i, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.2, ease: "power2.out" }, c.show);
        c.words.forEach((t0, j) => {
          tl.to("#c" + i + "-" + j, { opacity: 1, color: "${GOLD}", duration: 0.05 }, t0);
          tl.to("#c" + i + "-" + j, { color: "${BONE}", duration: 0.12 }, t0 + 0.25);
        });
        tl.to("#cap" + i, { opacity: 0, duration: 0.2 }, c.hide);
      });
      // Close: back out to the wall of receipts, the closer built line by line.
      tl.to("#wall", { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.6, ease: "power3.out" }, P.close.start - 0.15);
      [[-1300, -1700], [-2000, -2500], [-1500, -1900]].forEach(([a, b], c) => tl.fromTo("#col" + c, { y: a }, { y: b, duration: Math.max(0.5, P.D - P.close.start + 0.2), ease: "none", ...ir }, P.close.start - 0.2));
      tl.set("#close", { opacity: 1 }, P.close.start - 0.12);
      P.close.at.forEach((t0, i) => tl.fromTo("#cl" + i, { opacity: 0, y: 40, scale: 1.08 }, { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: "expo.out" }, t0));
      tl.set({}, {}, P.D);
      window.__timelines["reel"] = tl;
    </script>
  </body>
</html>
`;
}

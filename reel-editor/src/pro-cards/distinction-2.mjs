// Keep spoken copy hidden in the DOM as well as the timeline for direct frame seeks.
function write(h, selector, at, drop = false) {
  return `tl.fromTo(${h.sel(selector)},{opacity:0,clipPath:"inset(0 100% 0 0)"${drop ? ",y:-12" : ""}},{opacity:1,clipPath:"inset(0 0% 0 0)"${drop ? ",y:0" : ""},duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

function state(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${at});`;
}

// The shared grounder checks label length, not enums; never print an unchecked verdict.
function choice(item, allowed) {
  return allowed.find((value) => value.toLowerCase() === item?.text?.trim().toLowerCase());
}

const ear = `<svg class="d2-ear" viewBox="0 0 64 80" aria-hidden="true"><path d="M12 31C10 1 55 0 54 30c0 17-17 18-18 31-1 17-22 17-23 2M22 31c-2-15 21-17 21-2 0 10-14 9-14 21"/></svg>`;
const cursor = `<svg class="d2-cursor" viewBox="0 0 48 56" aria-hidden="true"><path d="M6 4v39l11-10 9 18 9-5-9-17 15-1Z"/></svg>`;

export const CARDS = {
  "versus-split": {
    family: "distinction",
    hint: "Greg names a short weaker option then a better one; both must fit a single line and the second must be his recommendation",
    slots: {
      weaker: { kind: "spoken", maxChars: 28, width: 656, size: 40, maxLines: 1 },
      better: { kind: "spoken", maxChars: 28, width: 656, size: 40, maxLines: 1 },
    },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="d2-half d2-weaker"><div class="d2-copy">${h.copy(o.slots.weaker[0])}</div></div><div class="d2-half d2-better"><div class="d2-copy">${h.copy(o.slots.better[0])}</div></div><div class="d2-vs">VS</div>`;
      return { inner, timeline: [write(h, ".d2-weaker .d2-copy", o.reveals[0]), write(h, ".d2-better .d2-copy", o.reveals[1]), state(h, ".d2-better", { borderColor: "#343438" }, { borderColor: "#C8A24B" }, o.reveals[1])].join("\n") };
    },
    css: `
      .pro-versus-split { padding:0;background:#0B0B0D; }
      .pro-versus-split .d2-half { height:88px;display:flex;align-items:center;justify-content:center;padding:16px 28px; }
      .pro-versus-split .d2-weaker { color:#A8A49C;background:#343438; }
      .pro-versus-split .d2-better { border:3px solid #343438;border-radius:0 0 16px 16px; }
      .pro-versus-split .d2-copy { font:700 40px/48px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-versus-split .d2-vs { position:absolute;left:calc(50% - 26px);top:74px;width:52px;height:28px;border:1px solid #A8A49C;border-radius:14px;background:#0B0B0D;color:#A8A49C;text-align:center;font:700 18px/26px "Inter",sans-serif;letter-spacing:2px; }`,
  },
  "scale-balance": {
    family: "distinction",
    hint: "Greg weighs two named priorities and explicitly gives the second more weight; use qualitative pans, never infer amounts",
    slots: {
      first: { kind: "spoken", maxChars: 22, width: 252, size: 36, maxLines: 2 },
      second: { kind: "spoken", maxChars: 22, width: 252, size: 36, maxLines: 2 },
    },
    size: { w: 720, h: 304 },
    surface: "obsidian",
    render(o, h) {
      const pan = (name) => `<div class="d2-pan d2-${name}"><svg viewBox="0 0 300 188" aria-hidden="true"><path d="M150 0 8 82M150 0l142 82M8 82q142 48 284 0Z"/></svg><div class="d2-copy"><span>${h.copy(o.slots[name][0])}</span></div></div>`;
      const inner = `<svg class="d2-scale" viewBox="0 0 720 304" aria-hidden="true"><path d="M360 52v224M312 276h96"/><line class="d2-beam" x1="180" y1="52" x2="540" y2="52"/><circle cx="360" cy="52" r="8"/></svg>${pan("first")}${pan("second")}`;
      // Move the beam endpoints and keep the pans upright; no rotating text or transform origin guesses.
      const timeline = [write(h, ".d2-first .d2-copy", o.reveals[0]), write(h, ".d2-second .d2-copy", o.reveals[1]), state(h, ".d2-beam", { attr: { y1: 52, y2: 52 } }, { attr: { y1: 32, y2: 72 } }, o.reveals[1]), state(h, ".d2-first", { y: 0 }, { y: -20 }, o.reveals[1]), state(h, ".d2-second", { y: 0 }, { y: 20, color: "#C8A24B" }, o.reveals[1])].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-scale-balance { padding:0;background:#0B0B0D; }
      .pro-scale-balance .d2-scale { position:absolute;inset:0;width:720px;height:304px;fill:#C8A24B;stroke:#C8A24B;stroke-width:4;stroke-linecap:round; }
      .pro-scale-balance .d2-pan { position:absolute;top:52px;width:300px;height:200px;color:#A8A49C; }
      .pro-scale-balance .d2-first { left:30px; }
      .pro-scale-balance .d2-second { right:30px; }
      .pro-scale-balance .d2-pan svg { width:300px;height:188px;fill:none;stroke:currentColor;stroke-width:3;stroke-linejoin:round; }
      .pro-scale-balance .d2-copy { position:absolute;left:24px;top:108px;width:252px;height:88px;display:flex;align-items:center;justify-content:center;text-align:center;font:700 36px/44px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "toggle-switch": {
    family: "distinction",
    hint: "Greg replaces an old habit with a new habit in that order; use the exact old and new lines, not a generic improvement claim",
    slots: {
      old: { kind: "spoken", maxChars: 46, width: 672, size: 38, maxLines: 2 },
      new: { kind: "spoken", maxChars: 46, width: 672, size: 38, maxLines: 2 },
    },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="d2-controls"><span class="d2-old-label">Old way</span><div class="d2-switch"><div class="d2-knob"></div></div><span class="d2-new-label">New way</span></div><div class="d2-lines"><div class="d2-old">${h.copy(o.slots.old[0])}</div><div class="d2-new">${h.copy(o.slots.new[0])}</div></div>`;
      return { inner, timeline: [write(h, ".d2-old", o.reveals[0]), `tl.set(${h.sel(".d2-old")},{visibility:"hidden"},${o.reveals[1]});`, write(h, ".d2-new", o.reveals[1]), state(h, ".d2-knob", { x: 0 }, { x: 44 }, o.reveals[1]), state(h, ".d2-switch", { backgroundColor: "#343438" }, { backgroundColor: "#C8A24B" }, o.reveals[1]), state(h, ".d2-new-label", { color: "#A8A49C" }, { color: "#C8A24B" }, o.reveals[1])].join("\n") };
    },
    css: `
      .pro-toggle-switch { padding:16px 24px;background:#0B0B0D; }
      .pro-toggle-switch .d2-controls { display:flex;align-items:center;gap:18px;height:40px;color:#A8A49C;font:700 26px/32px "Inter",sans-serif; }
      .pro-toggle-switch .d2-switch { width:84px;height:40px;padding:4px;border-radius:20px;background:#343438; }
      .pro-toggle-switch .d2-knob { width:32px;height:32px;border-radius:50%;background:#F5F1E8; }
      .pro-toggle-switch .d2-lines { position:relative;height:92px;margin-top:12px; }
      .pro-toggle-switch .d2-old,.pro-toggle-switch .d2-new { position:absolute;inset:0;font:700 38px/46px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-toggle-switch .d2-old { color:#A8A49C; }`,
  },
  spectrum: {
    family: "distinction",
    hint: "Greg names two ends of a continuum then picks one; pick must be Left or Right, verdict is optional exact spoken choice after both ends; omit verdict only if the second line already makes his choice explicit",
    slots: {
      left: { kind: "spoken", maxChars: 18, width: 300, size: 36, maxLines: 1 },
      right: { kind: "spoken", maxChars: 18, width: 300, size: 36, maxLines: 1 },
      verdict: { kind: "spoken", optional: true, maxChars: 22, width: 300, size: 32, maxLines: 1 },
      pick: { kind: "label", maxChars: 5, width: 160, size: 26, maxLines: 1 },
    },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const pick = choice(o.slots.pick[0], ["Left", "Right"]), verdict = o.slots.verdict[0];
      if (!pick) return { inner: "", timeline: "" };
      const right = pick === "Right", time = verdict?.at ?? o.reveals[1];
      const gradient = h.esc(`${o.id}-spectrum-gradient`);
      const inner = `<div class="d2-ends"><div class="d2-left">${h.copy(o.slots.left[0])}</div><div class="d2-right">${h.copy(o.slots.right[0])}</div></div><div class="d2-gradient"><svg viewBox="0 0 640 12" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gradient}"><stop offset="0" stop-color="#343438"/><stop offset=".5" stop-color="#A8A49C"/><stop offset="1" stop-color="#C8A24B"/></linearGradient></defs><rect width="640" height="12" rx="6" fill="url(#${gradient})"/></svg><div class="d2-marker"></div></div>${verdict ? `<div class="d2-verdict d2-${right ? "right" : "left"}-verdict">${h.copy(verdict)}</div>` : ""}`;
      return { inner, timeline: [write(h, ".d2-left", o.reveals[0]), write(h, ".d2-right", o.reveals[1]), state(h, ".d2-marker", { left: "50%", opacity: 0 }, { left: right ? "100%" : "0%", opacity: 1 }, time), ...(verdict ? [write(h, ".d2-verdict", time)] : [])].join("\n") };
    },
    css: `
      .pro-spectrum { padding:20px 32px;background:#0B0B0D; }
      .pro-spectrum .d2-ends { display:flex;justify-content:space-between;gap:56px;font:700 36px/44px "Inter",sans-serif; }
      .pro-spectrum .d2-left,.pro-spectrum .d2-right { width:300px;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-spectrum .d2-right { text-align:right; }
      .pro-spectrum .d2-gradient { position:relative;height:12px;margin:16px 8px 18px; }
      .pro-spectrum .d2-gradient svg { display:block;width:100%;height:12px; }
      .pro-spectrum .d2-marker { position:absolute;left:50%;top:-7px;width:6px;height:26px;margin-left:-3px;background:#F5F1E8;opacity:0; }
      .pro-spectrum .d2-verdict { width:300px;font:700 32px/40px "Inter",sans-serif;color:#C8A24B;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-spectrum .d2-right-verdict { margin-left:auto;text-align:right; }`,
  },
  "you-say-they-hear": {
    family: "distinction",
    hint: "Greg quotes a rep's words then explicitly voices the prospect's interpretation; both interpretations must be spoken, never inferred",
    slots: {
      youSay: { kind: "spoken", maxChars: 46, width: 560, size: 40, maxLines: 2 },
      theyHear: { kind: "spoken", maxChars: 46, width: 560, size: 40, maxLines: 2 },
    },
    size: { w: 720, h: 352 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="d2-say"><div class="d2-label">You say</div><div class="d2-copy">${h.copy(o.slots.youSay[0])}</div></div><div class="d2-hear">${ear}<div class="d2-label">They hear</div><div class="d2-copy">${h.copy(o.slots.theyHear[0])}</div></div>`;
      return { inner, timeline: [write(h, ".d2-say .d2-copy", o.reveals[0]), write(h, ".d2-hear .d2-copy", o.reveals[1]), state(h, ".d2-ear", { color: "#343438" }, { color: "#C8A24B" }, o.reveals[1])].join("\n") };
    },
    css: `
      .pro-you-say-they-hear { padding:24px 32px 24px 128px;background:#0B0B0D; }
      .pro-you-say-they-hear .d2-say,.pro-you-say-they-hear .d2-hear { position:relative;min-height:140px; }
      .pro-you-say-they-hear .d2-hear { border-top:2px solid #343438;padding-top:14px;margin-top:12px; }
      .pro-you-say-they-hear .d2-label { font:700 28px/34px "Inter",sans-serif;color:#A8A49C;margin-bottom:6px; }
      .pro-you-say-they-hear .d2-hear .d2-label { color:#C8A24B; }
      .pro-you-say-they-hear .d2-copy { font:700 40px/48px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-you-say-they-hear .d2-ear { position:absolute;left:-92px;top:40px;width:64px;height:80px;color:#343438;fill:none;stroke:currentColor;stroke-width:4;stroke-linecap:round; }`,
  },
  "true-false": {
    family: "distinction",
    hint: "Greg explicitly judges one statement true or false; include his judgment in the spoken statement range and set verdict to exactly True or False",
    slots: {
      statement: { kind: "spoken", maxChars: 44, width: 480, size: 38, maxLines: 2 },
      verdict: { kind: "label", maxChars: 5, width: 140, size: 28, maxLines: 1 },
    },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const verdict = choice(o.slots.verdict[0], ["True", "False"]);
      if (!verdict) return { inner: "", timeline: "" };
      const inner = `<div class="d2-statement">${h.copy(o.slots.statement[0])}</div><div class="d2-chips"><div class="d2-chip d2-true">TRUE</div><div class="d2-chip d2-false">FALSE</div></div>`;
      return { inner, timeline: [write(h, ".d2-statement", o.reveals[0]), state(h, `.d2-${verdict.toLowerCase()}`, { backgroundColor: "#0B0B0D", borderColor: "#343438", color: "#A8A49C" }, { backgroundColor: "#C8A24B", borderColor: "#C8A24B", color: "#0B0B0D" }, o.slots.statement[0].end)].join("\n") };
    },
    css: `
      .pro-true-false { padding:20px 24px;display:flex;align-items:center;gap:32px;background:#0B0B0D; }
      .pro-true-false .d2-statement { width:480px;font:700 38px/46px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-true-false .d2-chips { width:160px;display:flex;flex-direction:column;gap:10px; }
      .pro-true-false .d2-chip { border:2px solid #343438;border-radius:6px;padding:6px;text-align:center;background:#0B0B0D;color:#A8A49C;font:400 30px/36px "Anton",sans-serif;letter-spacing:2px; }`,
  },
  "verdict-stamp": {
    family: "distinction",
    hint: "Greg explicitly approves, rejects, keeps or cuts a specific phrase; include that judgment in phrase and use only Approved, Rejected, Keep or Cut as verdict",
    slots: {
      phrase: { kind: "spoken", maxChars: 48, width: 624, size: 42, maxLines: 2 },
      verdict: { kind: "label", maxChars: 8, width: 300, size: 44, maxLines: 1 },
    },
    size: { w: 720, h: 288 },
    surface: "bone",
    render(o, h) {
      const verdict = choice(o.slots.verdict[0], ["Approved", "Rejected", "Keep", "Cut"]);
      if (!verdict) return { inner: "", timeline: "" };
      const inner = `<div class="d2-phrase">${h.copy(o.slots.phrase[0])}</div><div class="d2-stamp-tilt"><div class="d2-stamp">${h.esc(verdict)}</div></div>`;
      return { inner, timeline: [write(h, ".d2-phrase", o.reveals[0]), state(h, ".d2-stamp", { opacity: 0, scale: 1.04, y: -12 }, { opacity: 1, scale: 1, y: 0 }, o.slots.phrase[0].end)].join("\n") };
    },
    css: `
      .pro-verdict-stamp { padding:28px 48px;border-radius:2px;border-bottom:6px solid #A8A49C; }
      .pro-verdict-stamp .d2-phrase { font:700 42px/52px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-verdict-stamp .d2-stamp-tilt { position:absolute;right:48px;bottom:30px;transform:rotate(-7deg); }
      .pro-verdict-stamp .d2-stamp { padding:10px 20px;border:5px double #0B0B0D;color:#0B0B0D;background:#F5F1E8;font:400 44px/52px "Anton",sans-serif;letter-spacing:3px;text-transform:uppercase;opacity:0; }`,
  },
  "rookie-pro": {
    family: "distinction",
    hint: "Greg explicitly contrasts a beginner's behavior with an experienced rep's behavior, rookie first and pro second; do not assign skill levels to an arbitrary comparison",
    slots: {
      rookie: { kind: "spoken", maxChars: 24, width: 296, size: 36, maxLines: 2 },
      pro: { kind: "spoken", maxChars: 24, width: 296, size: 36, maxLines: 2 },
    },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="d2-rookie"><div class="d2-label">Rookie</div><div class="d2-copy">${h.copy(o.slots.rookie[0])}</div></div><div class="d2-pro"><div class="d2-label">Pro</div><div class="d2-copy">${h.copy(o.slots.pro[0])}</div></div>`;
      return { inner, timeline: [write(h, ".d2-rookie .d2-copy", o.reveals[0]), write(h, ".d2-pro .d2-copy", o.reveals[1]), state(h, ".d2-pro", { borderTopColor: "#343438" }, { borderTopColor: "#C8A24B" }, o.reveals[1])].join("\n") };
    },
    css: `
      .pro-rookie-pro { padding:0;display:grid;grid-template-columns:1fr 1fr;background:#0B0B0D; }
      .pro-rookie-pro .d2-rookie,.pro-rookie-pro .d2-pro { padding:16px 32px;border-top:6px solid #343438;min-width:0; }
      .pro-rookie-pro .d2-rookie { background:#343438;color:#A8A49C; }
      .pro-rookie-pro .d2-pro { background:#F5F1E8;color:#0B0B0D; }
      .pro-rookie-pro .d2-label { font:400 30px/36px "Anton",sans-serif;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px; }
      .pro-rookie-pro .d2-copy { font:700 36px/44px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "word-swap": {
    family: "distinction",
    hint: "Greg replaces exactly one word in a short phrase: split its contiguous original range into optional before, one-word word, optional after, then a later one-word replacement; never overlap ranges or paraphrase",
    slots: {
      before: { kind: "spoken", optional: true, maxChars: 14, width: 200, size: 36, maxLines: 1 },
      word: { kind: "spoken", maxChars: 12, width: 220, size: 36, maxLines: 1 },
      after: { kind: "spoken", optional: true, maxChars: 14, width: 200, size: 36, maxLines: 1 },
      replacement: { kind: "spoken", maxChars: 12, width: 220, size: 36, maxLines: 1 },
    },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const { before: [before], word: [word], after: [after], replacement: [replacement] } = o.slots;
      const single = (item) => item.from === item.to && item.text.trim().split(/\s+/).length === 1;
      // Separate ranges obey groundCard's ordering rule while still drawing one intact phrase.
      if (!single(word) || !single(replacement) || (before && before.to + 1 !== word.from) || (after && word.to + 1 !== after.from)) return { inner: "", timeline: "" };
      const inner = `<div class="d2-sentence">${before ? `<span class="d2-before">${h.copy(before)}</span> ` : ""}<span class="d2-edit"><span class="d2-target"><span class="d2-word">${h.copy(word)}</span><svg class="d2-strike" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M1 4h98"/></svg></span><span class="d2-replacement">${h.copy(replacement)}</span></span>${after ? ` <span class="d2-after">${h.copy(after)}</span>` : ""}</div>`;
      return { inner, timeline: [...(before ? [write(h, ".d2-before", before.at)] : []), write(h, ".d2-word", word.at), ...(after ? [write(h, ".d2-after", after.at)] : []), write(h, ".d2-replacement", replacement.at, true), state(h, ".d2-strike path", { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, replacement.at)].join("\n") };
    },
    css: `
      .pro-word-swap { padding:16px 24px;background:#0B0B0D;display:flex;align-items:flex-end;justify-content:center; }
      .pro-word-swap .d2-sentence { display:flex;align-items:baseline;gap:14px;padding-bottom:12px;font:700 36px/44px "Inter",sans-serif;white-space:nowrap; }
      .pro-word-swap .d2-before,.pro-word-swap .d2-after { display:inline-block;max-width:200px;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-word-swap .d2-edit { position:relative;display:inline-block;width:220px;text-align:center; }
      .pro-word-swap .d2-target { position:relative;display:inline-block; }
      .pro-word-swap .d2-word { display:inline-block;color:#A8A49C;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-word-swap .d2-replacement { position:absolute;left:0;bottom:54px;width:220px;color:#C8A24B;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-word-swap .d2-strike { position:absolute;left:0;top:20px;width:100%;height:8px;fill:none;stroke:#C8A24B;stroke-width:3;stroke-dasharray:1;stroke-dashoffset:1; }`,
  },
  "either-or": {
    family: "distinction",
    hint: "Greg presents two short mutually exclusive actions and explicitly chooses the second; each must fit a pill, not a multi-sentence message",
    slots: {
      first: { kind: "spoken", maxChars: 20, width: 284, size: 36, maxLines: 2 },
      second: { kind: "spoken", maxChars: 20, width: 284, size: 36, maxLines: 2 },
    },
    size: { w: 720, h: 160 },
    surface: "bare",
    render(o, h) {
      const inner = `<div class="d2-pill d2-first"><div class="d2-copy">${h.copy(o.slots.first[0])}</div></div><div class="d2-pill d2-second"><div class="d2-copy">${h.copy(o.slots.second[0])}</div></div>${cursor}`;
      const press = h.at(o.reveals[1] + h.motion.state);
      return { inner, timeline: [write(h, ".d2-first .d2-copy", o.reveals[0]), write(h, ".d2-second .d2-copy", o.reveals[1]), state(h, ".d2-cursor", { x: 0 }, { x: 356 }, o.reveals[1]), state(h, ".d2-cursor", { scale: 1 }, { scale: 0.9 }, press), state(h, ".d2-second", { scale: 1, borderColor: "#343438", backgroundColor: "#0B0B0D", color: "#F5F1E8" }, { scale: 0.98, borderColor: "#C8A24B", backgroundColor: "#C8A24B", color: "#0B0B0D" }, press)].join("\n") };
    },
    css: `
      .pro-either-or { display:flex;align-items:flex-start;gap:24px; }
      .pro-either-or .d2-pill { width:348px;height:128px;padding:16px 29px;border:3px solid #343438;border-radius:64px;background:#0B0B0D;display:flex;align-items:center;justify-content:center; }
      .pro-either-or .d2-copy { font:700 36px/44px "Inter",sans-serif;text-align:center;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-either-or .d2-cursor { position:absolute;left:218px;top:100px;width:48px;height:56px;fill:#F5F1E8;stroke:#0B0B0D;stroke-width:3;stroke-linejoin:round;transform-origin:6px 4px; }`,
  },
};

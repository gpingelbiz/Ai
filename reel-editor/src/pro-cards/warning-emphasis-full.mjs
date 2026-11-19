// Keep every reveal explicit so rendering a single frame never depends on playback history.
const write = (h, selector, at, down = false) =>
  `tl.fromTo(${h.sel(selector)},{opacity:0,clipPath:"${down ? "inset(0 0 100% 0)" : "inset(0 100% 0 0)"}"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
const draw = (h, selector, at) =>
  `tl.fromTo(${h.sel(selector)},{strokeDashoffset:1},{strokeDashoffset:0,duration:${h.motion.state},ease:proState,immediateRender:false},${at});`;

export const CARDS = {
  "red-flag": {
    family: "warning",
    hint: "Greg names a specific mistake or warning sign worth stopping for",
    slots: {
      mistake: { kind: "spoken", maxChars: 48, width: 596, size: 40, maxLines: 2 },
    },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<svg class="flag-icon" viewBox="0 0 72 80" aria-hidden="true"><path d="M12 72 V8 M14 10 C30 0 42 24 62 12 V48 C42 60 30 34 14 46"/></svg><div class="flag-body"><div class="flag-heading">Red flag</div><div class="flag-copy">${h.copy(o.slots.mistake[0])}</div></div>`;
      return { inner, timeline: write(h, ".flag-copy", o.reveals[0]) };
    },
    css: `
      .pro-red-flag { display:flex;align-items:center;gap:20px;padding:20px; }
      .pro-red-flag .flag-icon { width:64px;height:80px;flex:none;fill:none;stroke:#C8A24B;stroke-width:5;stroke-linecap:round;stroke-linejoin:round; }
      .pro-red-flag .flag-body { min-width:0; }
      .pro-red-flag .flag-heading { font:700 28px/34px "Inter",sans-serif;letter-spacing:3px;text-transform:uppercase;color:#C8A24B;margin-bottom:6px; }
      .pro-red-flag .flag-copy { font:700 40px/48px "Inter",sans-serif;opacity:0; }`,
  },
  cost: {
    family: "warning",
    hint: "Greg says what a mistake costs, then gives its concrete consequence",
    slots: {
      heading: { kind: "label", optional: true, maxChars: 26, width: 656, size: 30, maxLines: 1 },
      loss: { kind: "spoken", maxChars: 14, width: 520, size: 88, maxLines: 1 },
      consequence: { kind: "spoken", maxChars: 48, width: 656, size: 40, maxLines: 2 },
    },
    size: { w: 720, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="cost-heading">${h.copy(o.slots.heading[0] || { text: "What it costs" })}</div><div class="cost-loss">${h.copy(o.slots.loss[0])}</div><div class="cost-consequence">${h.copy(o.slots.consequence[0])}</div>`;
      return { inner, timeline: write(h, ".cost-loss", o.reveals[0]) + "\n" + write(h, ".cost-consequence", o.reveals[1]) };
    },
    css: `
      .pro-cost { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-cost .cost-heading { font:700 30px/36px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase;color:#C8A24B; }
      .pro-cost .cost-loss { font:400 88px/100px "Anton",sans-serif;text-transform:uppercase;color:#C8A24B;opacity:0; }
      .pro-cost .cost-consequence { font:700 40px/48px "Inter",sans-serif;color:#A8A49C;opacity:0; }`,
  },
  receipt: {
    family: "warning",
    hint: "Greg lists the costs of a behavior and lands the total; include counts only inside his spoken lines",
    slots: {
      heading: { kind: "label", optional: true, maxChars: 26, width: 656, size: 32, maxLines: 1 },
      items: { kind: "spoken", repeat: [2, 3], maxChars: 44, width: 656, size: 38, maxLines: 2 },
      total: { kind: "spoken", maxChars: 32, width: 550, size: 40, maxLines: 2 },
    },
    size: { w: 720, h: 560 },
    surface: "bone",
    render(o, h) {
      const rows = o.slots.items.map((item, i) => `<div class="receipt-line receipt-line-${i}">${h.copy(item)}</div>`).join("");
      const inner = `<div class="receipt-heading">${h.copy(o.slots.heading[0] || { text: "The receipt" })}</div><div class="receipt-lines">${rows}</div><div class="receipt-total"><span class="receipt-label">Total</span><div>${h.copy(o.slots.total[0])}</div></div>`;
      const timeline = o.slots.items.map((_, i) => write(h, `.receipt-line-${i}`, o.reveals[i], true)).join("\n") + "\n" + write(h, ".receipt-total", o.reveals.at(-1), true);
      return { inner, timeline };
    },
    css: `
      .pro-receipt { border-radius:0;display:flex;flex-direction:column;justify-content:center;gap:16px; }
      .pro-receipt .receipt-heading { font:800 32px/40px "Inter",sans-serif;text-align:center;text-transform:uppercase;letter-spacing:2px; }
      .pro-receipt .receipt-lines { display:flex;flex-direction:column;gap:12px; }
      .pro-receipt .receipt-line { font:600 38px/46px "Inter",sans-serif;border-bottom:2px dotted #A8A49C;opacity:0; }
      .pro-receipt .receipt-total { display:grid;grid-template-columns:90px 1fr;gap:16px;border-top:2px dashed #343438;padding-top:16px;font:800 40px/48px "Inter",sans-serif;opacity:0; }
      .pro-receipt .receipt-label { font:800 28px/48px "Inter",sans-serif;text-transform:uppercase; }`,
  },
  "pros-cons": {
    family: "warning",
    hint: "Greg weighs a tempting benefit against the downsides he actually names",
    slots: {
      pros: { kind: "spoken", repeat: [1, 2], maxChars: 28, width: 276, size: 36, maxLines: 2 },
      cons: { kind: "spoken", repeat: [1, 2], maxChars: 28, width: 276, size: 36, maxLines: 2 },
    },
    size: { w: 720, h: 352 },
    surface: "obsidian",
    render(o, h) {
      let index = 0;
      const inner = ["pros", "cons"].map((name) => `<div class="pc-column pc-${name}"><div class="pc-heading">${name === "pros" ? "Pros" : "Cons"}</div>${o.slots[name].map((item) => `<div class="pc-row pc-row-${index++}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 H20${name === "pros" ? " M12 4 V20" : ""}"/></svg><div>${h.copy(item)}</div></div>`).join("")}</div>`).join("");
      return { inner, timeline: o.reveals.map((at, i) => write(h, `.pc-row-${i}`, at)).join("\n") };
    },
    css: `
      .pro-pros-cons { display:grid;grid-template-columns:1fr 1fr;gap:32px; }
      .pro-pros-cons .pc-column { min-width:0; }
      .pro-pros-cons .pc-heading { font:700 30px/36px "Inter",sans-serif;text-transform:uppercase;letter-spacing:3px;color:#A8A49C;margin-bottom:16px; }
      .pro-pros-cons .pc-cons .pc-heading { color:#C8A24B; }
      .pro-pros-cons .pc-row { display:grid;grid-template-columns:24px 1fr;gap:12px;font:700 36px/44px "Inter",sans-serif;margin-bottom:16px;opacity:0; }
      .pro-pros-cons .pc-row svg { width:24px;height:24px;margin-top:10px;fill:none;stroke:#C8A24B;stroke-width:3;stroke-linecap:round; }`,
  },
  "gold-frame": {
    family: "payoff",
    hint: "Greg delivers a complete line worth repeating word for word",
    slots: {
      heading: { kind: "label", optional: true, maxChars: 26, width: 656, size: 30, maxLines: 1 },
      quote: { kind: "spoken", maxChars: 64, width: 656, size: 52, maxLines: 3 },
    },
    size: { w: 720, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<svg class="frame-border" viewBox="0 0 720 320" preserveAspectRatio="none" aria-hidden="true"><rect pathLength="1" x="3" y="3" width="714" height="314" rx="18"/></svg><div class="frame-heading">${h.copy(o.slots.heading[0] || { text: "Say it like this" })}</div><div class="frame-copy">${h.copy(o.slots.quote[0])}</div>`;
      return { inner, timeline: draw(h, ".frame-border rect", o.reveals[0]) + "\n" + write(h, ".frame-copy", o.reveals[0]) };
    },
    css: `
      .pro-gold-frame { border-radius:20px;display:flex;flex-direction:column;justify-content:center;gap:16px; }
      .pro-gold-frame .frame-border { position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:#C8A24B;stroke-width:5;stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-gold-frame .frame-heading { font:700 30px/36px "Inter",sans-serif;text-transform:uppercase;letter-spacing:2px;color:#C8A24B; }
      .pro-gold-frame .frame-copy { font:800 52px/62px "Inter",sans-serif;opacity:0; }`,
  },
  "big-word": {
    family: "payoff",
    hint: "one short spoken word deserves a single Anton slam in clear headroom above Greg",
    slots: {
      word: { kind: "spoken", maxChars: 9, width: 560, size: 128, maxLines: 1 },
    },
    size: { w: 720, h: 176 },
    surface: "bare",
    render(o, h) {
      // The shared slot contract wraps text but has no word-count validator.
      const word = o.slots.word[0];
      if (word.from !== word.to || word.text.trim().split(/\s+/).length !== 1) return { inner: "", timeline: "" };
      return { inner: `<div class="big-copy">${h.copy(word)}</div>`, timeline: `tl.fromTo(${h.sel(".big-copy")},{opacity:0,clipPath:"inset(0 100% 0 0)",scale:1.04},{opacity:1,clipPath:"inset(0 0% 0 0)",scale:1,duration:${h.motion.enter},ease:proEnter,immediateRender:false},${o.reveals[0]});` };
    },
    css: `
      .pro-big-word { display:flex;align-items:center;justify-content:center; }
      .pro-big-word .big-copy { font:400 128px/160px "Anton",sans-serif;text-transform:uppercase;text-align:center;color:#C8A24B;opacity:0;transform-origin:center; }`,
  },
  "sticky-note": {
    family: "payoff",
    hint: "Greg gives a brief practical reminder worth keeping on a note",
    slots: {
      note: { kind: "spoken", maxChars: 56, width: 616, size: 48, maxLines: 3 },
    },
    size: { w: 720, h: 336 },
    surface: "bone",
    render(o, h) {
      return { inner: `<div class="sticky-paper"><div class="sticky-copy">${h.copy(o.slots.note[0])}</div></div>`, timeline: write(h, ".sticky-copy", o.reveals[0]) };
    },
    css: `
      .pro-sticky-note.pro-bone { padding:24px;background:none;box-shadow:none; }
      .pro-sticky-note .sticky-paper { width:100%;height:100%;padding:28px;display:flex;align-items:center;background:#F5F1E8;color:#0B0B0D;border-top:6px solid #C8A24B;transform:rotate(-2deg); }
      .pro-sticky-note .sticky-copy { font:italic 700 48px/60px "Inter",sans-serif;opacity:0; }`,
  },
  arrow: {
    family: "emphasis",
    hint: "Greg explicitly directs attention with a short spoken phrase such as this part right here",
    slots: {
      label: { kind: "spoken", maxChars: 32, width: 520, size: 44, maxLines: 2 },
    },
    size: { w: 720, h: 176 },
    surface: "bare",
    render(o, h) {
      const inner = `<svg class="arrow-mark" viewBox="0 0 200 200" aria-hidden="true"><path pathLength="1" d="M180 10 C120 30 60 80 40 170 L20 140 M40 170 L72 150"/></svg><div class="arrow-copy">${h.copy(o.slots.label[0])}</div>`;
      return { inner, timeline: draw(h, ".arrow-mark path", o.reveals[0]) + "\n" + write(h, ".arrow-copy", o.reveals[0]) };
    },
    css: `
      .pro-arrow { display:flex;align-items:center;gap:24px; }
      .pro-arrow .arrow-mark { width:160px;height:160px;flex:none;fill:none;stroke:#C8A24B;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-arrow .arrow-copy { font:italic 700 44px/54px "Inter",sans-serif;color:#C8A24B;opacity:0; }`,
  },
  meter: {
    family: "distinction",
    hint: "Greg contrasts two ways of delivering a line and moves toward the better one, without an invented score",
    slots: {
      heading: { kind: "label", optional: true, maxChars: 26, width: 656, size: 30, maxLines: 1 },
      left: { kind: "spoken", maxChars: 24, width: 312, size: 40, maxLines: 2 },
      right: { kind: "spoken", maxChars: 24, width: 312, size: 40, maxLines: 2 },
    },
    size: { w: 720, h: 272 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="meter-heading">${h.copy(o.slots.heading[0] || { text: "Your opener" })}</div><div class="meter-labels"><div class="meter-left">${h.copy(o.slots.left[0])}</div><div class="meter-right">${h.copy(o.slots.right[0])}</div></div><div class="meter-track"><div class="meter-fill"></div><div class="meter-needle"></div></div>`;
      const timeline = write(h, ".meter-left", o.reveals[0]) + "\n" + write(h, ".meter-right", o.reveals[1]) + `\ntl.fromTo(${h.sel(".meter-fill")},{scaleX:0},{scaleX:1,duration:${h.motion.state},ease:proState,immediateRender:false},${o.reveals[1]});\ntl.fromTo(${h.sel(".meter-needle")},{left:"0%"},{left:"78%",duration:${h.motion.state},ease:proState,immediateRender:false},${o.reveals[1]});`;
      return { inner, timeline };
    },
    css: `
      .pro-meter .meter-heading { font:700 30px/36px "Inter",sans-serif;text-transform:uppercase;letter-spacing:2px;color:#C8A24B;margin-bottom:12px; }
      .pro-meter .meter-labels { display:grid;grid-template-columns:1fr 1fr;gap:32px;font:700 40px/48px "Inter",sans-serif; }
      .pro-meter .meter-left { color:#A8A49C;opacity:0; }
      .pro-meter .meter-right { text-align:right;color:#C8A24B;opacity:0; }
      .pro-meter .meter-track { position:relative;height:22px;border-radius:11px;background:#343438;margin:24px 24px 0; }
      .pro-meter .meter-fill { width:78%;height:100%;border-radius:11px;background:#C8A24B;transform:scaleX(0);transform-origin:left; }
      .pro-meter .meter-needle { position:absolute;left:0;top:-12px;width:46px;height:46px;margin-left:-23px;border-radius:50%;background:#F5F1E8;border:6px solid #C8A24B; }`,
  },
  "voice-wave": {
    family: "proof",
    hint: "Greg demonstrates an audible change in tonality; bars are decorative and labels quote his spoken words",
    slots: {
      heading: { kind: "label", optional: true, maxChars: 26, width: 656, size: 30, maxLines: 1 },
      labels: { kind: "spoken", repeat: [2, 3], maxChars: 20, width: 200, size: 32, maxLines: 2 },
    },
    size: { w: 720, h: 336 },
    surface: "obsidian",
    render(o, h) {
      // Fixed decorative bars illustrate delivery, never a measured audio claim.
      const bars = Array.from({ length: 60 }, (_, i) => {
        const height = [18, 52, 76, 83, 71, 43, 28, 60, 80, 82, 64, 33][i % 12] * (i >= 28 && i < 41 ? 1.4 : 1);
        return `<rect${i >= 28 && i < 41 ? ' class="wave-accent"' : ""} x="${i * 13}" y="${(140 - height) / 2}" width="8" height="${height}" rx="4"/>`;
      }).join("");
      const inner = `<div class="wave-heading">${h.copy(o.slots.heading[0] || { text: "Tonality" })}</div><svg class="wave-bars" viewBox="0 0 780 140" aria-hidden="true">${bars}</svg><div class="wave-labels">${o.slots.labels.map((item, i) => `<div class="wave-label wave-label-${i}">${h.copy(item)}</div>`).join("")}</div>`;
      const timeline = write(h, ".wave-bars", o.reveals[0]) + "\n" + o.reveals.map((at, i) => write(h, `.wave-label-${i}`, at)).join("\n") + `\ntl.fromTo(${h.sel(".wave-accent")},{fill:"#A8A49C"},{fill:"#C8A24B",duration:${h.motion.state},ease:proState,immediateRender:false},${o.reveals[Math.floor(o.reveals.length / 2)]});`;
      return { inner, timeline };
    },
    css: `
      .pro-voice-wave .wave-heading { font:700 30px/36px "Inter",sans-serif;text-transform:uppercase;letter-spacing:2px;color:#C8A24B;margin-bottom:16px; }
      .pro-voice-wave .wave-bars { display:block;width:100%;height:112px;fill:#A8A49C;opacity:0; }
      .pro-voice-wave .wave-labels { display:flex;justify-content:space-between;gap:16px;margin-top:16px; }
      .pro-voice-wave .wave-label { width:200px;font:700 32px/40px "Inter",sans-serif;color:#A8A49C;opacity:0; }
      .pro-voice-wave .wave-label:last-child { text-align:right; }
      .pro-voice-wave .wave-label:nth-child(2) { color:#C8A24B; }`,
  },
  "full-list": {
    family: "procedure",
    hint: "a compact spoken list of three or four actions earns the reel's one full-screen reading moment",
    slots: {
      heading: { kind: "label", optional: true, maxChars: 30, width: 860, size: 34, maxLines: 1 },
      items: { kind: "spoken", repeat: [3, 4], maxChars: 52, width: 804, size: 64, maxLines: 2 },
    },
    size: { w: 1080, h: 1920 },
    surface: "obsidian",
    fullscreen: true,
    render(o, h) {
      // Unnumbered markers avoid inventing ordinal counts Greg never said.
      const rows = o.slots.items.map((item, i) => `<div class="full-item full-item-${i}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg><div>${h.copy(item)}</div></div>`).join("");
      return { inner: `<div class="full-heading">${h.copy(o.slots.heading[0] || { text: "Put it into practice" })}</div><div class="full-items">${rows}</div>`, timeline: o.reveals.map((at, i) => write(h, `.full-item-${i}`, at)).join("\n") };
    },
    css: `
      .pro-full-list { display:flex;flex-direction:column;justify-content:center;gap:32px;background:#0B0B0D; }
      .pro-full-list .full-heading { font:700 34px/42px "Inter",sans-serif;letter-spacing:3px;text-transform:uppercase;color:#C8A24B; }
      .pro-full-list .full-items { display:flex;flex-direction:column;gap:32px; }
      .pro-full-list .full-item { display:grid;grid-template-columns:24px 1fr;gap:32px;font:800 64px/80px "Inter",sans-serif;opacity:0; }
      .pro-full-list .full-item svg { width:24px;height:24px;margin-top:28px;fill:#C8A24B; }`,
  },
};

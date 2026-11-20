// Keep spoken copy hidden in the initial DOM, including when a renderer seeks straight to a frame.
function write(h, selector, at) {
  return `tl.fromTo(${h.sel(selector)},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

function state(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${at});`;
}

const draw = (h, selector, at) => state(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at);

export const CARDS = {
  "stop-sign": {
    family: "warning",
    hint: "Greg explicitly tells the rep to stop a specific mistake; quote that mistake, not a general caution",
    slots: { mistake: { kind: "spoken", maxChars: 44, width: 520, size: 40, maxLines: 2 } },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<svg class="wp-stop" viewBox="0 0 120 120" role="img" aria-label="Stop"><path class="wp-octagon" d="M36 4H84L116 36V84L84 116H36L4 84V36Z"/><path class="wp-rim" pathLength="1" d="M39 12H81L108 39V81L81 108H39L12 81V39Z"/><text x="60" y="73" text-anchor="middle">STOP</text></svg><div class="wp-copy">${h.copy(o.slots.mistake[0])}</div>`;
      return { inner, timeline: write(h, ".wp-copy", o.reveals[0]) + "\n" + draw(h, ".wp-rim", o.reveals[0]) };
    },
    css: `
      .pro-stop-sign { display:flex;align-items:center;gap:24px;padding:24px 28px;background:#0B0B0D; }
      .pro-stop-sign .wp-stop { width:120px;height:120px;flex:none; }
      .pro-stop-sign .wp-octagon { fill:#C8A24B; }
      .pro-stop-sign .wp-rim { fill:none;stroke:#0B0B0D;stroke-width:2;stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-stop-sign .wp-stop text { fill:#0B0B0D;font:400 38px "Anton",sans-serif; }
      .pro-stop-sign .wp-copy { width:520px;min-width:0;font:700 40px/48px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "caution-tape": {
    family: "warning",
    hint: "Greg delivers a short explicit warning that earns the reel's single full-width reading moment; quote the warning verbatim",
    slots: { warning: { kind: "spoken", maxChars: 72, width: 912, size: 52, maxLines: 2 } },
    // Like takeaway-banner, only the strip is opaque; fullscreen reserves the full-width reading moment.
    size: { w: 1080, h: 1920 },
    fullscreen: true,
    surface: "bare",
    render(o, h) {
      // Repeated SVG slashes avoid an external texture or a gradient behind the words.
      const stripes = `<svg class="wp-stripes" viewBox="0 0 1080 20" preserveAspectRatio="none" aria-hidden="true">${Array.from({ length: 24 }, (_, i) => `<path d="M${i * 48 - 24} 20l20-20h24l-20 20Z"/>`).join("")}</svg>`;
      const inner = `<div class="wp-tape">${stripes}<div class="wp-warning"><div class="wp-copy">${h.copy(o.slots.warning[0])}</div></div>${stripes}</div>`;
      return { inner, timeline: write(h, ".wp-copy", o.reveals[0]) };
    },
    css: `
      .pro-caution-tape.pro-full { padding:0;background:none;box-shadow:none; }
      .pro-caution-tape .wp-tape { position:absolute;left:0;top:170px;width:1080px;background:#C8A24B;color:#0B0B0D; }
      .pro-caution-tape .wp-stripes { display:block;width:1080px;height:20px;fill:#0B0B0D; }
      .pro-caution-tape .wp-warning { padding:20px 84px; }
      .pro-caution-tape .wp-copy { font:800 52px/62px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "crossed-out": {
    family: "warning",
    hint: "Greg explicitly rejects a named bad habit; quote the habit being rejected, never a recommended action",
    slots: { habit: { kind: "spoken", maxChars: 48, width: 624, size: 44, maxLines: 2 } },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="wp-copy">${h.copy(o.slots.habit[0])}</div><svg class="wp-cross" viewBox="0 0 640 120" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M10 10 630 110"/><path pathLength="1" d="M630 10 10 110"/></svg>`;
      // The X is a rejection mark over this card's phrase, never a mark over a caption word.
      return { inner, timeline: write(h, ".wp-copy", o.reveals[0]) + "\n" + draw(h, ".wp-cross path", o.reveals[0]) };
    },
    css: `
      .pro-crossed-out { display:flex;align-items:center;justify-content:center;padding:24px 48px;background:#0B0B0D; }
      .pro-crossed-out .wp-copy { width:624px;font:800 44px/52px "Inter",sans-serif;text-align:center;color:#A8A49C;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-crossed-out .wp-cross { position:absolute;left:40px;top:20px;width:640px;height:120px;fill:none;stroke:#C8A24B;stroke-width:6;stroke-linecap:round; }
      .pro-crossed-out .wp-cross path { stroke-dasharray:1;stroke-dashoffset:1; }`,
  },
  trap: {
    family: "warning",
    hint: "Greg names a tempting behavior or belief that traps a rep and explains why it backfires; quote the trap phrase",
    slots: { trap: { kind: "spoken", maxChars: 42, width: 512, size: 38, maxLines: 2 } },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<svg class="wp-snare" viewBox="0 0 128 120" aria-hidden="true"><path class="wp-ground" d="M6 106H122M108 105V62M102 62H114"/><path class="wp-rope" pathLength="1" d="M108 67V89Q108 100 94 98L80 93C51 108 15 100 14 77C13 48 66 43 83 65C98 87 60 104 35 86C15 71 42 51 66 63C83 71 77 84 69 86"/></svg><div class="wp-body"><div class="wp-label">Trap</div><div class="wp-copy">${h.copy(o.slots.trap[0])}</div></div>`;
      return { inner, timeline: write(h, ".wp-copy", o.reveals[0]) + "\n" + draw(h, ".wp-rope", o.reveals[0]) };
    },
    css: `
      .pro-trap { display:flex;align-items:center;gap:24px;padding:20px 28px;background:#0B0B0D;border-radius:0 24px 24px 0; }
      .pro-trap .wp-snare { width:128px;height:120px;flex:none;fill:none;stroke-width:4;stroke-linecap:round;stroke-linejoin:round; }
      .pro-trap .wp-ground { stroke:#A8A49C; }
      .pro-trap .wp-rope { stroke:#C8A24B;stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-trap .wp-body { width:512px;min-width:0; }
      .pro-trap .wp-label { font:700 28px/32px "Inter",sans-serif;letter-spacing:3px;text-transform:uppercase;color:#C8A24B;margin-bottom:8px; }
      .pro-trap .wp-copy { font:700 38px/46px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "marker-highlight": {
    family: "payoff",
    hint: "Greg lands a concise lesson worth underlining in your notes; quote the lesson, not dialogue or a setup line",
    slots: { line: { kind: "spoken", maxChars: 52, width: 656, size: 44, maxLines: 2 } },
    size: { w: 720, h: 160 },
    surface: "bone",
    render(o, h) {
      const item = o.slots.line[0];
      // One irregular marker sweep per fitted line keeps the ink behind the actual words.
      const inner = `<div class="wp-lines">${(item.lines || [item.text]).map((line) => `<div class="wp-line"><svg class="wp-marker" viewBox="0 0 656 52" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M5 31 Q170 22 332 29 T651 25"/></svg><div class="wp-copy">${h.copy({ ...item, lines: [line] })}</div></div>`).join("")}</div>`;
      return { inner, timeline: write(h, ".wp-copy", o.reveals[0]) + "\n" + draw(h, ".wp-marker path", o.reveals[0]) };
    },
    css: `
      .pro-marker-highlight { display:flex;align-items:center;padding:24px 32px;border-radius:4px; }
      .pro-marker-highlight .wp-lines { width:656px; }
      .pro-marker-highlight .wp-line { position:relative;width:max-content;max-width:100%; }
      .pro-marker-highlight .wp-marker { position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:#C8A24B;stroke-width:28; }
      .pro-marker-highlight .wp-marker path { stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-marker-highlight .wp-copy { position:relative;font:800 44px/52px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  newspaper: {
    family: "payoff",
    hint: "Greg states a surprising self-contained conclusion that overturns an assumption and earns a headline; quote his conclusion",
    slots: { headline: { kind: "spoken", maxChars: 52, width: 656, size: 44, maxLines: 2 } },
    size: { w: 720, h: 176 },
    surface: "bone",
    render(o, h) {
      const inner = `<div class="wp-masthead">Breaking</div><div class="wp-copy">${h.copy(o.slots.headline[0])}</div>`;
      return { inner, timeline: write(h, ".wp-copy", o.reveals[0]) };
    },
    css: `
      .pro-newspaper { display:flex;flex-direction:column;justify-content:center;padding:12px 28px;border:4px double #343438;border-radius:0; }
      .pro-newspaper .wp-masthead { border-bottom:2px solid #343438;padding-bottom:4px;margin-bottom:8px;font:800 24px/28px "Inter",sans-serif;letter-spacing:5px;text-transform:uppercase; }
      .pro-newspaper .wp-copy { font:400 44px/48px "Anton",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  seal: {
    family: "payoff",
    hint: "Greg explicitly promises an outcome or makes a guarantee; quote the complete promise with its qualifications, never infer certainty",
    slots: { promise: { kind: "spoken", maxChars: 44, width: 504, size: 40, maxLines: 2 } },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      // Promise names the kind of spoken line without adding an unspoken guarantee.
      const inner = `<svg class="wp-seal" viewBox="0 0 144 144" role="img" aria-label="Promise"><circle class="wp-edge" cx="72" cy="72" r="66"/><circle class="wp-ring" pathLength="1" cx="72" cy="72" r="57"/><path class="wp-check" d="m55 43 12 12 22-23"/><text x="72" y="88" text-anchor="middle">Promise</text><path class="wp-rule" d="M48 102H96"/></svg><div class="wp-copy">${h.copy(o.slots.promise[0])}</div>`;
      return { inner, timeline: write(h, ".wp-copy", o.reveals[0]) + "\n" + draw(h, ".wp-ring", o.reveals[0]) };
    },
    css: `
      .pro-seal { display:flex;align-items:center;gap:24px;padding:16px 24px;background:#0B0B0D; }
      .pro-seal .wp-seal { width:144px;height:144px;flex:none;fill:none;stroke:#C8A24B; }
      .pro-seal .wp-edge { stroke-width:5;stroke-dasharray:2 5; }
      .pro-seal .wp-ring { stroke-width:2;stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-seal .wp-check { stroke-width:4;stroke-linecap:round;stroke-linejoin:round; }
      .pro-seal .wp-rule { stroke-width:2; }
      .pro-seal .wp-seal text { fill:#C8A24B;stroke:none;font:400 26px "Anton",sans-serif; }
      .pro-seal .wp-copy { width:504px;min-width:0;font:700 40px/48px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "key-insight": {
    family: "payoff",
    hint: "Greg identifies the decisive reason a sales approach works; quote that insight, not a routine instruction or a prospect's yes",
    slots: { insight: { kind: "spoken", maxChars: 46, width: 528, size: 42, maxLines: 2 } },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="wp-copy">${h.copy(o.slots.insight[0])}</div><svg class="wp-key" viewBox="0 0 112 112" aria-hidden="true"><circle cx="34" cy="34" r="23"/><circle class="wp-hole" cx="34" cy="34" r="7"/><path class="wp-teeth" pathLength="1" d="M51 51 98 98h10V83H94V69H80L62 51"/></svg>`;
      return { inner, timeline: write(h, ".wp-copy", o.reveals[0]) + "\n" + draw(h, ".wp-teeth", o.reveals[0]) };
    },
    css: `
      .pro-key-insight { display:flex;align-items:center;gap:24px;padding:24px 28px;background:#0B0B0D;border-radius:24px 4px 24px 4px; }
      .pro-key-insight .wp-copy { width:528px;min-width:0;font:800 42px/50px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-key-insight .wp-key { width:112px;height:112px;flex:none;fill:none;stroke:#C8A24B;stroke-width:4;stroke-linejoin:round; }
      .pro-key-insight .wp-hole { fill:#C8A24B;stroke:none; }
      .pro-key-insight .wp-teeth { stroke-dasharray:1;stroke-dashoffset:1; }`,
  },
  lightbulb: {
    family: "payoff",
    hint: "Greg voices a new realization or a concrete idea that solves the problem he just described; quote the idea itself",
    slots: { idea: { kind: "spoken", maxChars: 46, width: 544, size: 44, maxLines: 2 } },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<svg class="wp-bulb" viewBox="0 0 96 112" aria-hidden="true"><path class="wp-rays" d="M48 2V10M12 17l7 7M2 49h10M84 49h10M77 24l7-7"/><path class="wp-glass" d="M48 20C17 20 15 54 29 68C35 74 36 79 36 85H60C60 79 61 74 67 68C81 54 79 20 48 20Z"/><path class="wp-filament" d="M48 84V57M38 49l10 8 10-8"/><path class="wp-base" d="M35 91H61M38 99H58M43 106H53"/></svg><div class="wp-copy">${h.copy(o.slots.idea[0])}</div>`;
      return { inner, timeline: [write(h, ".wp-copy", o.reveals[0]), state(h, ".wp-glass", { fill: "#343438" }, { fill: "#C8A24B" }, o.reveals[0]), state(h, ".wp-rays", { opacity: 0 }, { opacity: 1 }, o.reveals[0])].join("\n") };
    },
    css: `
      .pro-lightbulb { display:flex;align-items:center;gap:24px;padding:20px 28px;border-radius:80px;background:#0B0B0D; }
      .pro-lightbulb .wp-bulb { width:96px;height:112px;flex:none;fill:none;stroke-width:4;stroke-linecap:round;stroke-linejoin:round; }
      .pro-lightbulb .wp-rays { stroke:#C8A24B;opacity:0; }
      .pro-lightbulb .wp-glass { fill:#343438;stroke:#C8A24B; }
      .pro-lightbulb .wp-filament { stroke:#0B0B0D; }
      .pro-lightbulb .wp-base { stroke:#A8A49C; }
      .pro-lightbulb .wp-copy { width:544px;min-width:0;font:700 44px/52px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "save-this": {
    family: "payoff",
    hint: "Greg gives a concise reusable line or instruction the viewer can keep for the next sales call; quote the useful line, not merely save this",
    slots: { line: { kind: "spoken", maxChars: 48, width: 568, size: 40, maxLines: 2 } },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="wp-body"><div class="wp-label">Save this</div><div class="wp-copy">${h.copy(o.slots.line[0])}</div></div><svg class="wp-bookmark" viewBox="0 0 72 112" aria-hidden="true"><path class="wp-ribbon" d="M8 4H64V106L36 84 8 106Z"/><path class="wp-fold" d="M20 18H52"/></svg>`;
      return { inner, timeline: write(h, ".wp-copy", o.reveals[0]) + "\n" + state(h, ".wp-ribbon", { fill: "#0B0B0D" }, { fill: "#C8A24B" }, o.reveals[0]) };
    },
    css: `
      .pro-save-this { display:flex;align-items:center;gap:24px;padding:20px 28px;background:#0B0B0D; }
      .pro-save-this .wp-body { width:568px;min-width:0; }
      .pro-save-this .wp-label { font:700 28px/30px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase;color:#C8A24B;margin-bottom:6px; }
      .pro-save-this .wp-copy { font:700 40px/48px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-save-this .wp-bookmark { width:72px;height:112px;flex:none;align-self:flex-start;stroke-width:4;stroke-linejoin:round; }
      .pro-save-this .wp-ribbon { fill:#0B0B0D;stroke:#C8A24B; }
      .pro-save-this .wp-fold { fill:none;stroke:#0B0B0D; }`,
  },
};

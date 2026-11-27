// Keep reveal order identical to the spoken slots, including the optional tip number.
function writeIn(o, h, selectors) {
  return selectors.map((s, i) =>
    `tl.fromTo(${h.sel(s)},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${o.reveals[i]});`).join("\n");
}

function state(o, h, selector, values, at) {
  return `tl.to(${h.sel(selector)},{${values},duration:${h.motion.state},ease:proState},${at});`;
}

// SVG keeps both thumbs consistent on machines without an emoji font.
function thumb(up) {
  return `<svg class="dp-thumb" viewBox="0 0 64 64" aria-hidden="true"><g${up ? "" : ' transform="rotate(180 32 32)"'}><path d="M22 28 33 9c2-4 8-2 8 3v13h12c4 0 6 3 5 7l-5 20c-1 3-3 4-6 4H22Z"/><path d="M7 28h15v28H7Z"/></g></svg>`;
}

export const CARDS = {
  "do-dont": {
    family: "distinction",
    hint: "Greg rejects one specific action, then gives the action to take instead",
    slots: {
      dont: { kind: "spoken", maxChars: 36, width: 294, size: 42, maxLines: 3 },
      do: { kind: "spoken", maxChars: 36, width: 294, size: 42, maxLines: 3 },
    },
    size: { w: 720, h: 300 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="dp-side dp-dont"><div class="dp-pill">DON'T</div><div class="dp-copy">${h.copy(o.slots.dont[0])}</div></div><div class="dp-side dp-do"><div class="dp-pill">DO</div><div class="dp-copy">${h.copy(o.slots.do[0])}</div></div>`;
      const timeline = writeIn(o, h, [".dp-dont .dp-copy", ".dp-do .dp-copy"]) + "\n" +
        state(o, h, ".dp-dont .dp-copy", 'color:"#A8A49C"', o.reveals[1]) + "\n" +
        state(o, h, ".dp-do .dp-pill", 'backgroundColor:"#C8A24B",color:"#0B0B0D"', o.reveals[1]);
      return { inner, timeline };
    },
    css: `
      .pro-do-dont { display:grid;grid-template-columns:1fr 1fr;padding:0; }
      .pro-do-dont .dp-side { padding:30px 32px;min-width:0; }
      .pro-do-dont .dp-dont { border-right:2px solid #343438; }
      .pro-do-dont .dp-pill { display:inline-block;padding:8px 16px;border-radius:8px;background:#343438;color:#A8A49C;font:800 30px/36px "Inter",sans-serif;letter-spacing:3px; }
      .pro-do-dont .dp-copy { margin-top:16px;font:700 42px/54px "Inter",sans-serif;opacity:0; }`,
  },
  "myth-truth": {
    family: "distinction",
    hint: "Greg states a common sales misconception and immediately corrects it",
    slots: {
      myth: { kind: "spoken", maxChars: 48, width: 480, size: 42, maxLines: 3 },
      truth: { kind: "spoken", maxChars: 48, width: 480, size: 42, maxLines: 3 },
    },
    size: { w: 720, h: 420 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="dp-row dp-myth"><div class="dp-pill">MYTH</div><div class="dp-copy">${h.copy(o.slots.myth[0])}</div></div><div class="dp-row dp-truth"><div class="dp-pill">TRUTH</div><div class="dp-copy">${h.copy(o.slots.truth[0])}</div></div>`;
      const timeline = writeIn(o, h, [".dp-myth .dp-copy", ".dp-truth .dp-copy"]) + "\n" +
        state(o, h, ".dp-myth .dp-copy", 'textDecorationColor:"#C8A24B"', o.reveals[1]);
      return { inner, timeline };
    },
    css: `
      .pro-myth-truth { display:flex;flex-direction:column;justify-content:center;gap:24px; }
      .pro-myth-truth .dp-row { display:grid;grid-template-columns:152px 1fr;gap:18px;align-items:start; }
      .pro-myth-truth .dp-pill { padding:8px 12px;border-radius:8px;background:#343438;color:#A8A49C;font:800 30px/36px "Inter",sans-serif;letter-spacing:3px;text-align:center; }
      .pro-myth-truth .dp-truth .dp-pill { background:#C8A24B;color:#0B0B0D; }
      .pro-myth-truth .dp-copy { font:700 42px/50px "Inter",sans-serif;opacity:0; }
      .pro-myth-truth .dp-myth .dp-copy { color:#A8A49C;text-decoration:line-through;text-decoration-color:transparent;text-decoration-thickness:5px; }`,
  },
  "before-after": {
    family: "distinction",
    hint: "Greg demonstrates an original line or behavior and its improved replacement",
    slots: {
      before: { kind: "spoken", maxChars: 40, width: 302, size: 42, maxLines: 4 },
      after: { kind: "spoken", maxChars: 40, width: 302, size: 42, maxLines: 4 },
    },
    size: { w: 720, h: 340 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="dp-before"><div class="dp-label">Before</div><div class="dp-copy">${h.copy(o.slots.before[0])}</div></div><div class="dp-after"><div class="dp-label">After</div><div class="dp-copy">${h.copy(o.slots.after[0])}</div></div>`;
      const timeline = writeIn(o, h, [".dp-before .dp-copy", ".dp-after .dp-copy"]) + "\n" +
        state(o, h, ".dp-after", "x:0", o.reveals[1]);
      return { inner, timeline };
    },
    css: `
      .pro-before-after { display:grid;grid-template-columns:1fr 1fr; }
      .pro-before-after .dp-before { padding-right:24px;border-right:2px solid #343438;color:#A8A49C; }
      .pro-before-after .dp-after { padding-left:24px;transform:translateX(12px); }
      .pro-before-after .dp-label { margin-bottom:18px;font:700 32px/40px "Inter",sans-serif;letter-spacing:3px;text-transform:uppercase;color:#A8A49C; }
      .pro-before-after .dp-after .dp-label { color:#C8A24B; }
      .pro-before-after .dp-copy { font:700 42px/54px "Inter",sans-serif;opacity:0; }`,
  },
  thumbs: {
    family: "distinction",
    hint: "Greg contrasts a bad sales choice with a clearly recommended choice",
    slots: {
      down: { kind: "spoken", maxChars: 32, width: 280, size: 40, maxLines: 3 },
      up: { kind: "spoken", maxChars: 32, width: 280, size: 40, maxLines: 3 },
    },
    size: { w: 720, h: 300 },
    surface: "bare",
    render(o, h) {
      const inner = `<div class="dp-choice dp-down">${thumb(false)}<div class="dp-copy">${h.copy(o.slots.down[0])}</div></div><div class="dp-choice dp-up">${thumb(true)}<div class="dp-copy">${h.copy(o.slots.up[0])}</div></div>`;
      return { inner, timeline: writeIn(o, h, [".dp-down .dp-copy", ".dp-up .dp-copy"]) + "\n" +
        state(o, h, ".dp-up", 'borderColor:"#C8A24B"', o.reveals[1]) };
    },
    css: `
      .pro-thumbs { display:grid;grid-template-columns:1fr 1fr;gap:24px; }
      .pro-thumbs .dp-choice { padding:28px 26px;background:#0B0B0D;border:3px solid #343438;border-radius:16px; }
      .pro-thumbs .dp-down { color:#A8A49C; }
      .pro-thumbs .dp-thumb { display:block;width:70px;height:70px;margin-bottom:16px;fill:none;stroke:currentColor;stroke-width:3;stroke-linejoin:round; }
      .pro-thumbs .dp-up .dp-thumb { color:#C8A24B; }
      .pro-thumbs .dp-copy { font:700 40px/50px "Inter",sans-serif;opacity:0; }`,
  },
  poll: {
    family: "distinction",
    hint: "Greg offers two example messages in order and recommends the second",
    slots: {
      first: { kind: "spoken", maxChars: 48, width: 544, size: 40, maxLines: 2 },
      second: { kind: "spoken", maxChars: 48, width: 544, size: 40, maxLines: 2 },
    },
    size: { w: 720, h: 420 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="dp-label">Which would you send?</div><div class="dp-option dp-first"><span class="dp-letter">A</span><div class="dp-copy">${h.copy(o.slots.first[0])}</div></div><div class="dp-option dp-second"><span class="dp-letter">B</span><div class="dp-copy">${h.copy(o.slots.second[0])}</div></div>`;
      return { inner, timeline: writeIn(o, h, [".dp-first .dp-copy", ".dp-second .dp-copy"]) + "\n" +
        state(o, h, ".dp-second", 'borderColor:"#C8A24B",color:"#F5F1E8"', o.reveals[1]) };
    },
    css: `
      .pro-poll .dp-label { margin-bottom:18px;color:#C8A24B;font:700 30px/40px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase; }
      .pro-poll .dp-option { display:grid;grid-template-columns:40px 1fr;gap:16px;padding:16px 22px;border:3px solid #343438;border-radius:12px;background:#343438;color:#A8A49C; }
      .pro-poll .dp-second { margin-top:14px;background:#0B0B0D; }
      .pro-poll .dp-letter { font:800 40px/50px "Inter",sans-serif; }
      .pro-poll .dp-copy { font:700 40px/50px "Inter",sans-serif;opacity:0; }`,
  },
  signpost: {
    family: "distinction",
    hint: "Greg contrasts two directions a rep can take, then chooses the better path",
    slots: {
      left: { kind: "spoken", maxChars: 32, width: 548, size: 46, maxLines: 2 },
      right: { kind: "spoken", maxChars: 32, width: 548, size: 46, maxLines: 2 },
    },
    size: { w: 720, h: 320 },
    surface: "bare",
    render(o, h) {
      const inner = `<div class="dp-road dp-left"><div class="dp-copy">${h.copy(o.slots.left[0])}</div></div><div class="dp-road dp-right"><div class="dp-copy">${h.copy(o.slots.right[0])}</div></div>`;
      return { inner, timeline: writeIn(o, h, [".dp-left .dp-copy", ".dp-right .dp-copy"]) + "\n" +
        state(o, h, ".dp-right", "x:0", o.reveals[1]) };
    },
    css: `
      .pro-signpost { display:flex;flex-direction:column;gap:16px; }
      .pro-signpost .dp-road { width:640px;min-height:148px;display:flex;align-items:center;border-radius:12px; }
      .pro-signpost .dp-left { padding:18px 62px 18px 30px;background:#0B0B0D;color:#A8A49C;clip-path:polygon(0 0,92% 0,100% 50%,92% 100%,0 100%); }
      .pro-signpost .dp-right { margin-left:80px;padding:18px 30px 18px 62px;background:#C8A24B;color:#0B0B0D;clip-path:polygon(8% 0,100% 0,100% 100%,8% 100%,0 50%);transform:translateX(-12px); }
      .pro-signpost .dp-copy { font:800 46px/56px "Inter",sans-serif;opacity:0; }`,
  },
  venn: {
    family: "distinction",
    hint: "Greg relates what a rep says to what a prospect hears, or two overlapping ideas",
    slots: {
      left: { kind: "spoken", maxChars: 24, width: 232, size: 40, maxLines: 3 },
      right: { kind: "spoken", maxChars: 24, width: 232, size: 40, maxLines: 3 },
    },
    size: { w: 720, h: 400 },
    surface: "bare",
    render(o, h) {
      const inner = `<div class="dp-circle dp-left"><div class="dp-copy">${h.copy(o.slots.left[0])}</div></div><div class="dp-circle dp-right"><div class="dp-copy">${h.copy(o.slots.right[0])}</div></div>`;
      return { inner, timeline: writeIn(o, h, [".dp-left .dp-copy", ".dp-right .dp-copy"]) + "\n" +
        state(o, h, ".dp-left", "x:0", o.reveals[1]) + "\n" + state(o, h, ".dp-right", "x:0", o.reveals[1]) };
    },
    css: `
      .pro-venn .dp-circle { position:absolute;top:12px;width:412px;height:376px;border-radius:50%;border:4px solid #343438;background:#0B0B0D;display:flex;align-items:center; }
      .pro-venn .dp-left { left:12px;padding-left:40px;transform:translateX(-12px); }
      .pro-venn .dp-right { right:12px;padding-left:128px;border-color:#C8A24B;background:rgba(200,162,75,.18);transform:translateX(12px); }
      .pro-venn .dp-copy { position:relative;width:232px;font:700 40px/50px "Inter",sans-serif;opacity:0; }`,
  },
  rule: {
    family: "payoff",
    hint: "Greg states a concise rule the viewer should follow",
    slots: { rule: { kind: "spoken", maxChars: 68, width: 660, size: 58, maxLines: 3 } },
    size: { w: 720, h: 340 },
    surface: "bare",
    render(o, h) {
      return { inner: `<div class="dp-label">Rule</div><div class="dp-rule"><div class="dp-copy">${h.copy(o.slots.rule[0])}</div></div>`, timeline: writeIn(o, h, [".dp-copy"]) };
    },
    css: `
      .pro-rule { display:flex;flex-direction:column;align-items:flex-start;gap:12px; }
      .pro-rule .dp-label { padding:14px 22px;border-radius:10px;background:#C8A24B;color:#0B0B0D;font:400 44px/44px "Anton",sans-serif;letter-spacing:2px;text-transform:uppercase; }
      .pro-rule .dp-rule { width:100%;padding:22px 30px;border-radius:14px;background:#0B0B0D; }
      .pro-rule .dp-copy { font:800 58px/70px "Inter",sans-serif;opacity:0; }`,
  },
  "tip-badge": {
    family: "payoff",
    hint: "Greg gives a practical tip; supply a badge number only if he says it before the tip",
    slots: {
      number: { kind: "spoken", optional: true, maxChars: 8, width: 196, size: 56, maxLines: 1 },
      tip: { kind: "spoken", maxChars: 56, width: 424, size: 48, maxLines: 3 },
    },
    size: { w: 720, h: 256 },
    surface: "bare",
    render(o, h) {
      const number = o.slots.number[0];
      const inner = `<div class="dp-badge${number ? " dp-numbered" : ""}"><span>TIP</span>${number ? `<div class="dp-number">${h.copy(number)}</div>` : ""}</div><div class="dp-tip"><div class="dp-copy">${h.copy(o.slots.tip[0])}</div></div>`;
      return { inner, timeline: writeIn(o, h, [...(number ? [".dp-number"] : []), ".dp-copy"]) };
    },
    css: `
      .pro-tip-badge { display:flex;border-radius:16px;overflow:hidden; }
      .pro-tip-badge .dp-badge { flex:0 0 144px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;padding:18px;background:#C8A24B;color:#0B0B0D;font:400 64px/64px "Anton",sans-serif; }
      .pro-tip-badge .dp-numbered { flex-basis:232px; }
      .pro-tip-badge .dp-number { font:400 56px/64px "Anton",sans-serif;opacity:0; }
      .pro-tip-badge .dp-tip { flex:1;display:flex;align-items:center;min-width:0;padding:26px 32px;background:#0B0B0D; }
      .pro-tip-badge .dp-copy { font:800 48px/60px "Inter",sans-serif;opacity:0; }`,
  },
  quote: {
    family: "payoff",
    hint: "Greg delivers a memorable self-contained line worth holding as his pull quote",
    slots: { quote: { kind: "spoken", maxChars: 92, width: 622, size: 54, maxLines: 4 } },
    size: { w: 720, h: 480 },
    surface: "obsidian",
    render(o, h) {
      return { inner: `<div class="dp-mark" aria-hidden="true">“</div><div class="dp-copy">${h.copy(o.slots.quote[0])}</div><div class="dp-attribution">Greg Pingel</div>`, timeline: writeIn(o, h, [".dp-copy"]) };
    },
    css: `
      .pro-quote { padding:40px 44px;border-left:10px solid #C8A24B; }
      .pro-quote .dp-mark { height:60px;color:#C8A24B;font:400 120px/100px "Anton",sans-serif; }
      .pro-quote .dp-copy { font:800 54px/66px "Inter",sans-serif;opacity:0; }
      .pro-quote .dp-attribution { margin-top:18px;color:#A8A49C;font:600 32px/40px "Inter",sans-serif; }`,
  },
  "takeaway-banner": {
    family: "payoff",
    hint: "Greg gives a short final takeaway that earns the reel's single full-width reading moment",
    slots: { takeaway: { kind: "spoken", maxChars: 72, width: 708, size: 54, maxLines: 2 } },
    // Fullscreen placement is the registry's only route to a 1080px strip; the rest stays transparent.
    size: { w: 1080, h: 1920 },
    fullscreen: true,
    surface: "bare",
    render(o, h) {
      return { inner: `<div class="dp-strip"><div class="dp-copy">${h.copy(o.slots.takeaway[0])}</div></div>`, timeline: writeIn(o, h, [".dp-copy"]) };
    },
    css: `
      .pro-takeaway-banner.pro-full { padding:0;background:none;box-shadow:none; }
      .pro-takeaway-banner .dp-strip { position:absolute;left:150px;top:170px;width:780px;padding:26px 36px;background:#C8A24B;color:#0B0B0D; }
      .pro-takeaway-banner .dp-copy { font:800 54px/64px "Inter",sans-serif;opacity:0; }`,
  },
};

// Reference card for the registry (see index.mjs). Batch builders copy this shape.
export const CARDS = {
  objection: {
    family: "conversation",
    hint: "a prospect's objection Greg quotes, then the line he says back",
    slots: {
      theySay: { kind: "spoken", maxChars: 44, width: 656, size: 48, maxLines: 2 },
      youSay: { kind: "spoken", maxChars: 52, width: 656, size: 52, maxLines: 2 },
    },
    size: { w: 720, h: 420 },
    render(o, h) {
      const row = (label, item, cls) => `<div class="obj-row ${cls}"><div class="obj-label">${label}</div><div class="obj-text">${h.copy(item)}</div></div>`;
      const inner = row("Prospect says", o.slots.theySay[0], "obj-they") + `<div class="obj-rule"></div>` + row("You say", o.slots.youSay[0], "obj-you");
      const timeline = [".obj-they .obj-text", ".obj-you .obj-text"].map((s, i) =>
        `tl.fromTo(${h.sel(s)},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${o.reveals[i]});`).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-objection { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-objection .obj-label { font:700 30px/36px "Inter",sans-serif;letter-spacing:3px;text-transform:uppercase;color:#A8A49C; }
      .pro-objection .obj-you .obj-label { color:#C8A24B; }
      .pro-objection .obj-text { font-weight:700;font-size:48px;line-height:58px;opacity:0; }
      .pro-objection .obj-you .obj-text { font-size:52px;line-height:62px; }
      .pro-objection .obj-rule { height:2px;background:#343438;margin:8px 0; }`,
  },
};

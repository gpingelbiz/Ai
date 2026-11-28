import { fileURLToPath } from "node:url";
import { loadProMeasure } from "../pro-captions.mjs";

const itemSize = 56, itemLine = 64, itemGap = 6, itemWidth = 632;
const headingSize = 36, headingLine = 42, headingGap = 8;
// Copy starts at y=1072 to clear a two-line seam plate, with room for the shared entrance and exit travel.
const copyHeight = 472;
const fontFile = fileURLToPath(new URL("../../assets/fonts/Inter.ttf", import.meta.url));
let measureItem;

export const CARDS = {
  "split-list": {
    family: "procedure",
    tags: ["list", "steps"],
    hint: "Greg says he has three to five things and then names each one in turn; use the short names in spoken order and give a heading only if he says it",
    slots: {
      heading: { kind: "label", optional: true, maxChars: 30, width: 700, size: headingSize, maxLines: 1 },
      items: { kind: "spoken", repeat: [3, 5], maxChars: 30, width: itemWidth, size: itemSize, maxLines: 2 },
    },
    fullscreen: true,
    split: true,
    size: { w: 1080, h: 1920 },
    surface: "bare",
    validate({ heading: [heading], items }, matchesSpoken) {
      if (heading && (/\p{Nd}/u.test(heading.text) || !matchesSpoken(heading.text))) return false;
      if ([...(heading ? [heading] : []), ...items].some((item) => /\p{Extended_Pictographic}/u.test(item.text))) return false;
      measureItem ||= loadProMeasure(fontFile, { size: itemSize, weight: 700, tracking: 0 });
      if (items.some((item) => item.fontSize || item.lines.some((line) => measureItem(line) > itemWidth))) return false;
      const height = items.reduce((sum, item) => sum + item.lines.length * itemLine, (items.length - 1) * itemGap);
      return height + (heading ? headingLine + headingGap : 0) <= copyHeight;
    },
    render(o, h) {
      const [heading] = o.slots.heading;
      const label = heading ? `<div class="split-heading">${h.copy(heading)}</div>` : "";
      // A list item is a name, not a sentence: the period he ended it on is not shown.
      const bare = (item) => ({ ...item, lines: (item.lines || [item.text]).map((line, k, all) => (k === all.length - 1 ? String(line).replace(/[.,;:!?]+$/, "") : line)) });
      const rows = o.slots.items.map((item, i) => `<li class="split-item"><span class="split-number" aria-hidden="true">${i + 1}</span><span>${h.copy(bare(item))}</span></li>`).join("");
      const timeline = o.slots.items.map((item, i) =>
        `tl.fromTo(${h.sel(`.split-item:nth-child(${i + 1})`)},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${item.at});`
      ).join("\n");
      return { inner: `<div class="split-panel"><div class="split-copy">${label}<ol class="split-items" role="list">${rows}</ol></div></div>`, timeline };
    },
    css: `
      .pro-split-list.pro-full { padding:0; }
      .pro-split-list .split-panel { position:absolute;inset:960px 0 -16px;background:#0B0B0D;border-top:4px solid #C8A24B; }
      .pro-split-list .split-copy { position:absolute;top:108px;left:180px;width:720px; }
      .pro-split-list .split-heading { color:#C8A24B;font:700 ${headingSize}px/${headingLine}px "Inter",sans-serif;text-transform:uppercase;margin-bottom:${headingGap}px; }
      .pro-split-list .split-items { display:grid;gap:${itemGap}px;list-style:none;margin:0;padding:0; }
      .pro-split-list .split-item { display:grid;grid-template-columns:64px 1fr;gap:20px;color:#F5F1E8;font:700 ${itemSize}px/${itemLine}px "Inter",sans-serif;font-optical-sizing:none;white-space:nowrap;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-split-list .split-number { color:#C8A24B;font:400 ${itemSize}px/${itemLine}px "Anton",sans-serif; }`,
  },
};

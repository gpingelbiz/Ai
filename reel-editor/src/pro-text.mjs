import { esc } from "./text.mjs";
import { PRO_CAPTION_PLATE, PRO_CAPTION_LINE, PRO_HOOK_LINE, PRO_PAD } from "./pro-captions.mjs";

function rows(words, lengths, render) {
  let offset = 0;
  return (lengths || [words.length]).map((length) => {
    const line = words.slice(offset, offset + length).map((w, i) => render(w, offset + i)).join(" ");
    offset += length;
    return `<span class="pro-row">${line}</span>`;
  }).join("");
}

export function proCaptionHTML(group, index, { height = 1920, mark = () => "" } = {}) {
  const size = 80 * height / 1920;
  const spans = rows(group.words, group.lines, (w, j) => `<span class="w${w.key ? " k" : ""}" id="cap-${index}-w${j}">${esc(w.text)}${mark(index, j)}</span>`);
  // A cue holding one very long word is set smaller so it fits the plate (pro-captions.mjs longWordCue).
  const shrink = group.fontScale ? ` style="font-size:${Math.round(80 * group.fontScale * height / 1920)}px;line-height:${Math.round(92 * group.fontScale * height / 1920)}px"` : "";
  return `      <div class="cap cap-pro" id="cap-${index}" style="font-size:${size}px;top:${group.y ?? 1248 * height / 1920}px"><div class="cap-line"${shrink}>${spans}</div></div>`;
}

export function proHookHTML(hook) {
  const spans = rows(hook.words, hook.lines, (w) => esc(w.text));
  return `      <div id="hook" class="clip hook-pro" data-start="0" data-duration="${hook.duration}" data-track-index="3" data-layout-allow-overflow><div id="pro-title"${hook.fontSize ? ` style="font-size:${hook.fontSize}px;line-height:${Math.round(hook.fontSize * 1.06)}px"` : ""}>${spans}</div></div>`;
}

export function proCSS({ height = 1920, captions = false, hook = false, hookTop = 176 } = {}) {
  const px = (n) => `${n * height / 1920}px`;
  return `${captions ? `
      #captions { z-index: 20; }
      #captions .cap.cap-pro { left: 50%; right: auto; width: max-content; max-width: ${px(PRO_CAPTION_PLATE)}; margin: 0; transform: translateX(-50%); }
      #captions .cap-pro .cap-line { display: block; box-sizing: content-box; max-width: ${px(PRO_CAPTION_LINE)}; padding: ${px(12)} ${px(PRO_PAD)}; border-radius: ${px(12)}; background: rgba(17,17,17,0.92); color: #FFFFFF; font-family: "Inter", sans-serif; font-size: ${px(80)}; font-weight: 700; line-height: ${px(92)}; letter-spacing: ${px(-0.8)}; text-transform: none; text-align: center; text-shadow: none; -webkit-text-stroke: 0; filter: none; box-shadow: none; }
      #captions .cap-pro .cap-line { font-optical-sizing: none; }
      #captions .cap-pro .w { font-size: inherit; font-weight: 700; opacity: 1; text-shadow: none; }
      #captions .cap-pro .w.k { color: #E2BA64; font-size: inherit; font-weight: 700; background: none; }
      #captions .cap-pro .pro-row { display: block; white-space: nowrap; }` : ""}${hook ? `
      #hook.hook-pro { position: absolute; inset: 0; padding: 0; opacity: 1; pointer-events: none; z-index: 19; }
      #pro-title { position: absolute; top: ${px(hookTop)}; left: 50%; transform: translateX(-50%); width: max-content; max-width: ${px(PRO_HOOK_LINE)}; padding: ${px(16)} ${px(PRO_PAD)}; border-radius: ${px(12)}; background: #000000; color: #FFFFFF; font-family: "Anton", sans-serif; font-weight: 400; font-size: ${px(100)}; line-height: ${px(106)}; letter-spacing: 0; text-align: center; text-transform: none; text-shadow: none; -webkit-text-stroke: 0; }
      #pro-title .pro-row { display: block; white-space: nowrap; }` : ""}`;
}

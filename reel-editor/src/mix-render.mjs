import { esc } from "./text.mjs";

/**
 * Page side of the element mix (beat-jobs.mjs): the flip card's markup and styles, the entrances the variety pass
 * hands out, and the hand-drawn marks (underline, circle, arrow) on a card's key word. Emitted only when a card in
 * the reel carries one of them, so an older plan renders exactly as before.
 */

/** Mark shapes on a 100-unit box, stretched over the word (the arrow sits off its lower left and points at it). */
export const MIX_MARKS = {
  underline: { box: "0 0 100 20", d: "M3 9 C 20 3, 36 14, 54 8 S 84 3, 97 10" },
  circle: { box: "0 0 100 60", d: "M8 31 C 9 11, 36 3, 58 6 C 84 9, 98 19, 96 33 C 94 49, 70 58, 46 56 C 22 54, 4 45, 6 31 C 8 19, 24 11, 44 9" },
  arrow: { box: "0 0 100 100", d: "M6 94 C 22 74, 44 58, 84 24 M60 18 L 86 21 L 81 46" },
};

/** One slot: the wrong phrase, struck as the right one is said, then the right phrase in its place. */
export function flipHTML(s) {
  const eyebrow = s.eyebrow ? `<div class="g-eyebrow g-in"><span class="g-dot"></span>${esc(s.eyebrow)}</div>` : "";
  return `<div class="g-box g-center g-flip-box">${eyebrow}<div class="g-flip g-in"><div class="g-flip-wrong"><span class="g-flip-text">${esc(s.wrong)}<span class="g-flip-strike"></span></span></div><div class="g-flip-right"><span class="g-flip-text g-flip-key">${esc(s.right)}</span></div></div></div>`;
}

export function mixCSS({ H, colors }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", ...colors };
  const px = (n) => `${Math.round((n * H) / 1920)}px`;
  return `
      .g-flip { display: grid; justify-items: start; align-items: center; min-width: ${px(420)}; }
      .g-flip > div { grid-area: 1 / 1; }
      .g-flip-text { position: relative; display: inline-block; font-size: ${px(78)}; font-weight: 850; line-height: 1.02; text-transform: uppercase; letter-spacing: -0.01em; }
      .g-flip-wrong .g-flip-text { color: ${c.text}; opacity: 0.78; }
      .g-flip-right .g-flip-text { color: ${c.accent}; }
      .g-flip-right { opacity: 0; }
      .g-flip-strike { position: absolute; left: -3%; right: -3%; top: 52%; height: 0.09em; border-radius: 0.05em; background: ${c.accent}; transform: scaleX(0); transform-origin: 0 50%; }
      .gfx.skin-note .g-flip-text, .gfx.skin-atelier .g-flip-text, .gfx.skin-serifonlife .g-flip-text { text-transform: none; font-weight: 600; letter-spacing: 0; font-family: inherit; }
      .mx-mark { position: absolute; opacity: 0; overflow: visible; pointer-events: none; }
      .mx-mark path { fill: none; stroke: ${c.accent}; stroke-width: ${px(9)}; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
      .mx-underline { left: -3%; width: 106%; bottom: -0.16em; height: 0.24em; }
      .mx-circle { left: -12%; width: 124%; top: -20%; height: 140%; }
      .mx-arrow { left: -1.05em; top: 52%; width: 0.95em; height: 0.95em; }`;
}

/**
 * Runs after the card runtime has laid every card out (placement included). Per card: the entrance on the card's
 * layer (the box keeps its own transforms), the flip's strike and swap at the spoken turn, and the mark drawn on as
 * its word is said. Seek-safe: every step is a timeline tween or set.
 */
export const MIX_JS = `
        PLAN.graphics.forEach((g, i) => {
          const el = document.getElementById("gfx-" + i);
          if (!el || el.style.opacity === "0") return;
          const box = el.querySelector(".g-box");
          if (!box || box.style.visibility === "hidden" || el.style.visibility === "hidden") return;
          const f = 1 / (PLAN.fps || 30);
          const root = document.getElementById("root").getBoundingClientRect();
          const k = root.height ? root.height / PLAN.height : 1;
          if (g.enter) {
            const b = box.getBoundingClientRect();
            const L = (b.left - root.left) / k, T = (b.top - root.top) / k, Rr = (b.right - root.left) / k, B = (b.bottom - root.top) / k;
            const cx = (L + Rr) / 2, cy = (T + B) / 2, pad = PLAN.height * 0.03;
            gsap.set(el, { transformOrigin: cx + "px " + cy + "px" });
            if (g.enter === "pop") tl.fromTo(el, { scale: 0.82 }, { scale: 1, duration: 9 * f, ease: "back.out(2)", immediateRender: false }, g.start);
            else if (g.enter === "slide") tl.fromTo(el, { x: cx < PLAN.width / 2 ? -PLAN.width * 0.09 : PLAN.width * 0.09 }, { x: 0, duration: 9 * f, ease: "power3.out", immediateRender: false }, g.start);
            else if (g.enter === "rise") tl.fromTo(el, { y: PLAN.height * 0.025 }, { y: 0, duration: 11 * f, ease: "power3.out", immediateRender: false }, g.start);
            else if (g.enter === "drop") tl.fromTo(el, { y: -PLAN.height * 0.035 }, { y: 0, duration: 12 * f, ease: "back.out(1.6)", immediateRender: false }, g.start);
            else if (g.enter === "blur") tl.fromTo(el, { filter: "blur(14px)" }, { filter: "blur(0px)", duration: 12 * f, ease: "power2.out", immediateRender: false }, g.start);
            else if (g.enter === "wipe") {
              const t = Math.max(0, T - pad), r = Math.max(0, PLAN.width - Rr - pad), bt = Math.max(0, PLAN.height - B - pad), l = Math.max(0, L - pad);
              const fromLeft = cx < PLAN.width / 2;
              const closed = fromLeft ? "inset(" + t + "px " + (PLAN.width - l) + "px " + bt + "px " + l + "px)" : "inset(" + t + "px " + r + "px " + bt + "px " + (PLAN.width - r) + "px)";
              tl.fromTo(el, { clipPath: closed }, { clipPath: "inset(" + t + "px " + r + "px " + bt + "px " + l + "px)", duration: 10 * f, ease: "power3.inOut", immediateRender: false }, g.start);
              tl.set(el, { clipPath: "none" }, g.start + 11 * f);
            }
          }
          if (g.type === "flip" && Number.isFinite(g.pivotAt)) {
            const wrong = el.querySelector(".g-flip-wrong"), right = el.querySelector(".g-flip-right"), strike = el.querySelector(".g-flip-strike");
            const at = g.start + g.pivotAt, lift = PLAN.height * 0.02;
            if (strike) tl.fromTo(strike, { scaleX: 0 }, { scaleX: 1, duration: 7 * f, ease: "power2.inOut", immediateRender: false }, at);
            if (wrong) tl.to(wrong, { opacity: 0, y: -lift, duration: 6 * f, ease: "power2.in" }, at + 10 * f);
            if (right) tl.fromTo(right, { opacity: 0, y: lift }, { opacity: 1, y: 0, duration: 8 * f, ease: "power3.out", immediateRender: false }, at + 12 * f);
          }
          if (g.mark && PLAN.mixMarks && PLAN.mixMarks[g.mark.kind]) {
            const target = g.type === "flip" ? el.querySelector(".g-flip-key") : g.type === "stat" ? el.querySelector(".g-value-lock, .g-stat, .g-num") : el.querySelector(".g-gold, .g-hl");
            if (!target) return;
            const m = PLAN.mixMarks[g.mark.kind];
            if (getComputedStyle(target).position === "static") target.style.position = "relative";
            target.insertAdjacentHTML("beforeend", '<svg class="mx-mark mx-' + g.mark.kind + '" viewBox="' + m.box + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + m.d + '"/></svg>');
            const svg = target.lastElementChild, p = svg.querySelector("path");
            const L = p.getTotalLength();
            p.style.strokeDasharray = L + " " + L;
            p.style.strokeDashoffset = L;
            const at = Math.max(g.start + 0.3, g.start + (g.type === "flip" ? g.pivotAt + 22 * f : g.mark.at));
            if (at > g.start + g.duration - 0.5) return;
            tl.set(svg, { opacity: 1 }, at);
            tl.fromTo(p, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: 0.38, ease: "power2.inOut", immediateRender: false }, at);
          }
        });`;

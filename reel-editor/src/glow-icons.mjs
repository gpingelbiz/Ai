export const GLOW_ICON_ACTIONS = ["drop", "spin", "stack", "ping", "hit", "float"];
export const glowIconAction = (action) => GLOW_ICON_ACTIONS.includes(action) ? action : "float";

/** Extra pieces stay inside the face-safe icon square, behind the main cut-out. */
export function glowIconExtras(icon, esc) {
  const action = glowIconAction(icon.action);
  if (action === "stack") return [0, 1].map((k) => `<img class="icon-ghost icon-ghost-${k}" src="${esc(icon.image)}" alt="" aria-hidden="true">`).join("");
  if (action === "ping") return '<span class="icon-ping" aria-hidden="true"></span>';
  if (action === "hit") return '<span class="icon-hit" aria-hidden="true"></span>';
  if (action === "drop") return '<span class="icon-shadow" aria-hidden="true"></span>';
  return "";
}

export function glowIconsCSS(accent) {
  return `
      .icon-act .icon-disc { position: absolute; inset: 0; width: 100%; height: 100%; }
      .icon-act-stack .icon-disc { inset: 12%; width: 76%; height: 76%; }
      .icon-act .icon-disc img { display: block; }
      .icon-ghost { position: absolute; left: 4%; top: 20%; width: 76%; height: 76%; object-fit: contain; opacity: 0; }
      .icon-ghost-1 { left: 8%; top: 16%; }
      .icon-ping { position: absolute; z-index: 1; top: 10%; right: 10%; width: 13%; height: 13%; border-radius: 50%; background: ${accent}; opacity: 0; }
      .icon-hit { position: absolute; z-index: 1; inset: 6%; box-sizing: border-box; border: 3px solid ${accent}; border-radius: 50%; opacity: 0; }
      .icon-shadow { position: absolute; left: 18%; right: 18%; bottom: 6%; height: 8%; border-radius: 50%; background: rgba(0,0,0,0.45); filter: blur(5px); opacity: 0; }`;
}

export const GLOW_ICONS_JS = `
        // Glow image icons act once, then hold. Every handoff is on the timeline so seeking restores it.
        const giAnimate = (icon, i, el, disc) => {
          const bridge = (PLAN.glowScenes || []).find((s) => s.bridge === i);
          const outAt = bridge ? bridge.start : icon.end - Math.min(0.14, (icon.end - icon.t) / 4);
          const enter = Math.min(0.32, (outAt - icon.t) * 0.7);
          const at = icon.t, size = el.offsetWidth;
          const tween = (target, from, to, t) => tl.fromTo(target, from, { ...to, immediateRender: false }, t);
          tween(el, { opacity: 0 }, { opacity: 1, duration: Math.min(0.06, outAt - at) }, at);
          if (icon.action === "drop") {
            tween(disc, { y: -size * 0.45, opacity: 0 }, { y: 0, opacity: 1, duration: enter, ease: "back.out(1.4)" }, at);
            tween(el.querySelector(".icon-shadow"), { opacity: 0, scaleX: 0.5 }, { opacity: 0.65, scaleX: 1, duration: enter, ease: "power2.out" }, at);
          } else if (icon.action === "spin") {
            tween(disc, { scaleX: 1, opacity: 0 }, { scaleX: 0, opacity: 1, duration: enter / 2, ease: "power2.in" }, at);
            tween(disc, { scaleX: 0 }, { scaleX: 1, duration: enter / 2, ease: "power2.out" }, at + enter / 2);
          } else {
            tween(disc, { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1, duration: enter / 2, ease: "power2.out" }, at);
            if (icon.action === "stack") {
              [0, 1].forEach((k) => tween(el.querySelector(".icon-ghost-" + k), { y: -size * 0.08, opacity: 0 }, { y: 0, opacity: k ? 0.45 : 0.25, duration: enter * 0.65, ease: "power2.out" }, at + k * enter * 0.35));
            } else if (icon.action === "ping") {
              tween(el.querySelector(".icon-ping"), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: enter / 2, ease: "back.out(1.4)" }, at + enter / 2);
            } else if (icon.action === "hit") {
              const frame = Math.min(iconFrame, enter / 4);
              tween(disc, { x: 0 }, { x: size * 0.025, duration: frame, ease: "none" }, at + enter / 2);
              tween(disc, { x: size * 0.025 }, { x: 0, duration: frame, ease: "none" }, at + enter / 2 + frame);
              tween(el.querySelector(".icon-hit"), { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 0.9, duration: enter / 4, ease: "power2.out" }, at + enter / 2);
              tween(el.querySelector(".icon-hit"), { opacity: 0.9 }, { opacity: 0, duration: enter / 4 }, at + enter * 0.75);
            }
          }
          if (icon.action === "float" && outAt > at + enter) tween(disc, { y: 0 }, { y: -size * 0.015, duration: (outAt - at - enter) / 2, ease: "sine.inOut", yoyo: true, repeat: 1 }, at + enter);
          if (!bridge) tween(el, { opacity: 1 }, { opacity: 0, duration: icon.end - outAt, ease: "power2.in" }, outAt);
          tl.set(el, { opacity: 0 }, icon.end);
        };
`;

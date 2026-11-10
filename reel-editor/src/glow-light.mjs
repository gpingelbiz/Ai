import { esc } from "./text.mjs";
import { r3 } from "./util.mjs";

/** A duplicate glyph layer carries the light; the actual letters keep their bone and gold fills. */
export const glowLightWord = (text) => `<span class="glow-light" aria-hidden="true">${esc(text)}</span>`;

export function glowLightCSS() {
  return `
      .hook-glow .hw, .cap-feat .w { position: relative; }
      .glow-light { position: absolute; inset: 0; pointer-events: none; opacity: 0; color: transparent; -webkit-text-fill-color: transparent; -webkit-text-stroke: 0; text-shadow: none; background-image: linear-gradient(105deg, transparent 38%, rgba(200,162,75,0.22) 44%, rgba(245,241,232,0.8) 50%, rgba(200,162,75,0.3) 56%, transparent 62%); background-repeat: no-repeat; background-clip: text; -webkit-background-clip: text; }
      #hook.hook-glow #hook-lines .glow-light { color: transparent; text-shadow: none; }
`;
}

const featureDone = (g) => Math.max(g.start, ...g.words.map((w) => Math.max(g.start, w.start - 0.03))) + 0.18;

/**
 * Reserve one complete sweep and a quiet exit. A phrase with no hold room (the next band element or scene comes too
 * soon, or the longer hold would run into the face) keeps its own timing and simply gets no sweep: the line matters
 * more than the light.
 */
export function holdGlowFeatures(plan, { place = (g) => g.place } = {}) {
  const obstacles = [...plan.captions.filter((g) => g.kind === "feat"), ...(plan.glowOverlays || []), ...(plan.glowScenes || [])];
  plan.captions = plan.captions.map((g) => {
    if (g.kind !== "feat") return g;
    const end = Math.max(g.end, r3(featureDone(g) + 0.6 + 0.16));
    const next = obstacles.filter((x) => x !== g && x.start > g.start).map((x) => x.start - 0.05);
    const position = place(g, end);
    if (position && end <= Math.min(plan.video.duration - 0.05, ...next) + 0.001) return { ...g, end, place: position };
    return { ...g, sweep: false };
  });
}

export function glowLightRuntime(plan) {
  return [
    ...(plan.hook ? [{ selector: "#hook-lines .hw", start: r3(plan.hook.start + 0.3 + Math.max(0, (plan.hook.words?.length || String(plan.hook.text || "").split(/\s+/).length) - 1) * 0.03), duration: 0.6 }] : []),
    ...(plan.captions || []).flatMap((g, i) => g.kind === "feat" && g.place && g.sweep !== false ? [{ selector: `#cap-${i} .w`, start: r3(featureDone(g)), duration: 0.6 }] : []),
  ];
}

export const GLOW_LIGHT_JS = `        // One shared light crosses the entire phrase; each glyph samples the same moving gradient.
        PLAN.glowLights.forEach((s) => {
          const words = [...document.querySelectorAll(s.selector)];
          if (!words.length) return;
          const bounds = words.map((w) => w.getBoundingClientRect());
          const left = Math.min(...bounds.map((b) => b.left));
          const width = Math.max(...bounds.map((b) => b.right)) - left;
          if (!width) return;
          const scale = document.getElementById("root").getBoundingClientRect().width / PLAN.width || 1;
          words.forEach((w, i) => {
            const light = w.querySelector(".glow-light");
            if (!light) return;
            light.style.backgroundSize = (width * 3 / scale) + "px 100%";
            const offset = (bounds[i].left - left) / scale;
            tl.set(light, { opacity: 0.65 }, s.start);
            tl.fromTo(light, { backgroundPositionX: (-width * 2 / scale - offset) + "px" }, { backgroundPositionX: (width / scale - offset) + "px", duration: s.duration, ease: "sine.inOut", immediateRender: false }, s.start);
            tl.set(light, { opacity: 0 }, s.start + s.duration);
          });
        });
`;

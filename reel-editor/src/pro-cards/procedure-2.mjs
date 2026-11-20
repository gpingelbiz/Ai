// Explicit starting states keep spoken copy hidden when the renderer seeks straight to a frame.
function write(h, selector, at) {
  return `tl.fromTo(${h.sel(selector)},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

function state(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${at});`;
}

function enter(h, selector, from, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js({ opacity: 0, ...from })},{opacity:1,x:0,y:0,duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

const tick = `<svg viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="m5 12 5 5 9-10"/></svg>`;
const pin = `<svg viewBox="0 0 32 40" aria-hidden="true"><path d="M16 38C12 31 3 23 3 15a13 13 0 0 1 26 0c0 8-9 16-13 23Z"/><circle cx="16" cy="15" r="4"/></svg>`;
const draw = (h, selector, at) => state(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at);
const copyCSS = (type, size, line) => `
  .pro-${type} .p2-copy { font:700 ${size}px/${line}px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`;

export const CARDS = {
  "stack-fan": {
    family: "procedure",
    hint: "Greg builds a method by adding two to four concrete actions or components, each worth keeping in the stack",
    slots: { items: { kind: "spoken", repeat: [2, 4], maxChars: 40, width: 552, size: 38, maxLines: 2 } },
    size: (o) => ({ w: 720, h: o.slots.items.length * 120 + 56 }),
    surface: "bare",
    render(o, h) {
      // Overlap only the paper edges; previous spoken lines remain readable beneath the new sheet.
      const inner = o.slots.items.map((item, i) => `<div class="p2-sheet p2-item-${i}" style="left:${32 + i * 12}px;top:${24 + i * 120}px;z-index:${i + 1}"><div class="p2-paper" style="transform:rotate(${[-1.5, 1, -1, 1.5][i]}deg)"><div class="p2-copy">${h.copy(item)}</div></div></div>`).join("");
      const timeline = o.slots.items.map((item, i) => [enter(h, `.p2-item-${i}`, { x: i ? 16 : 0 }, item.at), write(h, `.p2-item-${i} .p2-copy`, item.at), ...(i ? [state(h, `.p2-item-${i - 1} .p2-paper`, { borderColor: "#C8A24B" }, { borderColor: "#343438" }, item.at)] : [])].join("\n")).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-stack-fan .p2-sheet { position:absolute;width:608px;height:128px;opacity:0; }
      .pro-stack-fan .p2-paper { width:100%;height:100%;padding:16px 26px;background:#0B0B0D;border:2px solid #C8A24B;border-radius:12px; }
      .pro-stack-fan .p2-paper::after { content:"";position:absolute;bottom:10px;right:24px;width:40px;height:3px;background:#C8A24B; }
      ${copyCSS("stack-fan", 38, 42)}`,
  },
  roadmap: {
    family: "procedure",
    hint: "Greg names two to four successive milestones on a route toward a goal; use his short milestone names in travel order",
    slots: { pins: { kind: "spoken", repeat: [2, 4], maxChars: 16, width: 148, size: 32, maxLines: 2 } },
    size: { w: 720, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const n = o.slots.pins.length;
      const points = o.slots.pins.map((_, i) => ({ x: 82 + i * 492 / (n - 1), y: i % 2 ? 146 : 110 }));
      const road = `M${points[0].x} ${points[0].y}` + points.slice(1).map((p, i) => ` C${(points[i].x + p.x) / 2} ${points[i].y - 60} ${(points[i].x + p.x) / 2} ${p.y + 60} ${p.x} ${p.y}`).join("");
      const inner = `<svg class="p2-road" viewBox="0 0 656 256" aria-hidden="true"><path class="p2-asphalt" d="${road}"/><path class="p2-lane" d="${road}"/></svg>` + o.slots.pins.map((item, i) => `<div class="p2-pin p2-item-${i}" style="left:${points[i].x - 16}px;top:${points[i].y - 38}px">${pin}</div><div class="p2-copy p2-copy-${i}" style="left:${points[i].x - 74}px;top:${i % 2 ? 174 : 0}px">${h.copy(item)}</div>`).join("");
      const timeline = o.slots.pins.map((item, i) => enter(h, `.p2-item-${i}`, { y: -16 }, item.at) + "\n" + write(h, `.p2-copy-${i}`, item.at)).join("\n");
      return { inner: `<div class="p2-map">${inner}</div>`, timeline };
    },
    css: `
      .pro-roadmap .p2-map { position:relative;width:656px;height:256px; }
      .pro-roadmap .p2-road { position:absolute;inset:0;width:100%;height:100%;fill:none;stroke-linecap:round; }
      .pro-roadmap .p2-asphalt { stroke:#343438;stroke-width:28; }
      .pro-roadmap .p2-lane { stroke:#A8A49C;stroke-width:2;stroke-dasharray:6 10; }
      .pro-roadmap .p2-pin { position:absolute;width:32px;height:40px;opacity:0; }
      .pro-roadmap .p2-pin svg { width:100%;height:100%;fill:#C8A24B; }
      .pro-roadmap .p2-pin circle { fill:#0B0B0D; }
      .pro-roadmap .p2-copy { position:absolute;width:148px;text-align:center; }
      ${copyCSS("roadmap", 32, 38)}`,
  },
  branch: {
    family: "procedure",
    hint: "Greg states an if condition then two alternative outcomes or responses, explicitly favoring the second branch",
    slots: {
      condition: { kind: "spoken", maxChars: 40, width: 564, size: 38, maxLines: 2 },
      outcomes: { kind: "spoken", repeat: [2, 2], maxChars: 26, width: 260, size: 36, maxLines: 2 },
    },
    size: { w: 720, h: 368 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="p2-condition"><div class="p2-copy">${h.copy(o.slots.condition[0])}</div></div><svg class="p2-fork" viewBox="0 0 656 88" aria-hidden="true"><path class="p2-track" d="M328 0V28M328 28H160V86M328 28H496V86"/><path class="p2-path-0" pathLength="1" d="M328 0V28H160V86"/><path class="p2-path-1" pathLength="1" d="M328 0V28H496V86"/></svg><div class="p2-outcomes">${o.slots.outcomes.map((item, i) => `<div class="p2-outcome p2-item-${i}"><div class="p2-copy">${h.copy(item)}</div></div>`).join("")}</div>`;
      const timeline = write(h, ".p2-condition .p2-copy", o.reveals[0]) + "\n" + o.slots.outcomes.map((item, i) => [write(h, `.p2-item-${i} .p2-copy`, item.at), draw(h, `.p2-path-${i}`, item.at), ...(i ? [state(h, ".p2-item-1", { backgroundColor: "#0B0B0D", color: "#F5F1E8", borderColor: "#343438" }, { backgroundColor: "#C8A24B", color: "#0B0B0D", borderColor: "#C8A24B" }, item.at)] : [])].join("\n")).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-branch .p2-condition { margin:0 24px;padding:8px 20px;border:2px solid #343438;border-radius:12px;text-align:center; }
      .pro-branch .p2-fork { display:block;width:656px;height:88px;fill:none;stroke:#C8A24B;stroke-width:3;stroke-linejoin:round; }
      .pro-branch .p2-fork .p2-track { stroke:#343438; }
      .pro-branch .p2-path-0,.pro-branch .p2-path-1 { stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-branch .p2-outcomes { display:grid;grid-template-columns:1fr 1fr;gap:24px; }
      .pro-branch .p2-outcome { padding:10px 26px;border:2px solid #343438;border-radius:12px;background:#0B0B0D;text-align:center; }
      ${copyCSS("branch", 38, 44)}
      .pro-branch .p2-outcome .p2-copy { font-size:36px;line-height:42px; }`,
  },
  funnel: {
    family: "procedure",
    hint: "Greg describes exactly three stages that filter or narrow a sales process, broadest stage first and final stage last",
    slots: { stages: { kind: "spoken", repeat: [3, 3], maxChars: 18, width: 224, size: 36, maxLines: 2 } },
    size: { w: 720, h: 400 },
    surface: "obsidian",
    render(o, h) {
      const paths = ["M8 4H648L564 104H92Z", "M100 116H556L480 216H176Z", "M184 228H472L452 316H352V332H304V316H204Z"];
      const inner = `<svg class="p2-funnel" viewBox="0 0 656 336" aria-hidden="true">${paths.map((d, i) => `<path class="p2-tier-${i}" d="${d}"/>`).join("")}</svg>` + o.slots.stages.map((item, i) => `<div class="p2-copy p2-item-${i}" style="top:${44 + i * 112}px">${h.copy(item)}</div>`).join("");
      const timeline = o.slots.stages.map((item, i) => write(h, `.p2-item-${i}`, item.at) + "\n" + state(h, `.p2-tier-${i}`, { stroke: "#343438" }, { stroke: "#C8A24B" }, item.at)).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-funnel .p2-funnel { display:block;width:656px;height:336px;fill:#0B0B0D;stroke:#343438;stroke-width:3;stroke-linejoin:round; }
      .pro-funnel .p2-copy { position:absolute;left:248px;width:224px;text-align:center; }
      .pro-funnel .p2-item-2 { color:#C8A24B; }
      ${copyCSS("funnel", 36, 40)}`,
  },
  cycle: {
    family: "procedure",
    hint: "Greg gives exactly three actions in a repeatable loop and explicitly returns to the start; never use for a one-way list",
    slots: { nodes: { kind: "spoken", repeat: [3, 3], maxChars: 20, width: 224, size: 36, maxLines: 2 } },
    size: { w: 720, h: 480 },
    surface: "obsidian",
    render(o, h) {
      const arcs = ["M328 48A160 160 0 0 1 467 288", "M467 288A160 160 0 0 1 189 288", "M189 288A160 160 0 0 1 328 48"];
      const arrows = ["m452 118 14 10 2-18", "m340 356-12 12 12 12", "m187 146 2-18 14 10"];
      const positions = [[200, 0], [384, 252], [16, 252]];
      const inner = `<div class="p2-loop"><svg class="p2-ring" viewBox="0 0 656 416" aria-hidden="true"><circle class="p2-track" cx="328" cy="208" r="160"/>${arcs.map((d, i) => `<path class="p2-arc-${i}" pathLength="1" d="${d}"/><path class="p2-arrow p2-arrow-${i}" d="${arrows[i]}"/>`).join("")}</svg>${o.slots.nodes.map((item, i) => `<div class="p2-node p2-item-${i}" style="left:${positions[i][0]}px;top:${positions[i][1]}px"><div class="p2-copy">${h.copy(item)}</div></div>`).join("")}</div>`;
      const timeline = o.slots.nodes.map((item, i) => [write(h, `.p2-item-${i} .p2-copy`, item.at), draw(h, `.p2-arc-${i}`, item.at), state(h, `.p2-arrow-${i}`, { opacity: 0 }, { opacity: 1 }, item.at), state(h, `.p2-item-${i}`, { borderColor: "#343438" }, { borderColor: "#C8A24B" }, item.at)].join("\n")).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-cycle .p2-loop { position:relative;width:656px;height:416px; }
      .pro-cycle .p2-ring { position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;stroke-linejoin:round; }
      .pro-cycle .p2-track { stroke:#343438; }
      .pro-cycle .p2-ring path { stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-cycle .p2-ring .p2-arrow { stroke-dasharray:none;stroke-dashoffset:0;opacity:0; }
      .pro-cycle .p2-node { position:absolute;width:256px;min-height:96px;padding:12px 14px;border:2px solid #343438;border-radius:16px;background:#0B0B0D;text-align:center; }
      ${copyCSS("cycle", 36, 40)}`,
  },
  staircase: {
    family: "procedure",
    hint: "Greg names two to four short actions that build on each previous action toward greater skill or a completed process",
    slots: { steps: { kind: "spoken", repeat: [2, 4], maxChars: 16, width: 140, size: 32, maxLines: 2 } },
    size: { w: 720, h: 384 },
    surface: "obsidian",
    render(o, h) {
      const steps = o.slots.steps, width = 656 / steps.length;
      const top = (i) => 224 - i * 48;
      const path = `M0 320V${top(0)}` + steps.map((_, i) => `H${(i + 1) * width}${i < steps.length - 1 ? `V${top(i + 1)}` : ""}`).join("") + "V320Z";
      const inner = `<div class="p2-stairs"><svg class="p2-profile" viewBox="0 0 656 320" aria-hidden="true"><path d="${path}"/></svg><div class="p2-dot" style="left:${width / 2 - 8}px;top:${top(0) - 40}px"></div>${steps.map((item, i) => `<div class="p2-copy p2-item-${i}" style="left:${width * (i + 0.5) - 70}px;top:${top(i) + 10}px">${h.copy(item)}</div>`).join("")}</div>`;
      const timeline = steps.map((item, i) => write(h, `.p2-item-${i}`, item.at) + "\n" + (i ? state(h, ".p2-dot", { x: (i - 1) * width, y: -(i - 1) * 48 }, { x: i * width, y: -i * 48 }, item.at) : enter(h, ".p2-dot", {}, item.at))).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-staircase .p2-stairs { position:relative;width:656px;height:320px; }
      .pro-staircase .p2-profile { position:absolute;inset:0;width:100%;height:100%;fill:#343438;stroke:#A8A49C;stroke-width:2;stroke-linejoin:round; }
      .pro-staircase .p2-dot { position:absolute;width:16px;height:16px;border-radius:50%;background:#C8A24B;opacity:0; }
      .pro-staircase .p2-copy { position:absolute;width:140px;text-align:center; }
      ${copyCSS("staircase", 32, 38)}`,
  },
  "pill-tracker": {
    family: "procedure",
    hint: "Greg walks through two to four brief named phases in order, with each phase finished when he moves to the next",
    slots: { pills: { kind: "spoken", repeat: [2, 4], maxChars: 12, width: 126, size: 32, maxLines: 2 } },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const inner = o.slots.pills.map((item, i) => `<div class="p2-pill p2-item-${i}"><div class="p2-copy">${h.copy(item)}</div><span class="p2-check">${tick}</span></div>`).join("");
      const timeline = o.slots.pills.map((item, i) => [write(h, `.p2-item-${i} .p2-copy`, item.at), state(h, `.p2-item-${i}`, { backgroundColor: "#0B0B0D", color: "#F5F1E8", borderColor: "#343438" }, { backgroundColor: "#C8A24B", color: "#0B0B0D", borderColor: "#C8A24B" }, item.at), ...(i ? [state(h, `.p2-item-${i - 1}`, { backgroundColor: "#C8A24B", color: "#0B0B0D", borderColor: "#C8A24B" }, { backgroundColor: "#343438", color: "#A8A49C", borderColor: "#343438" }, item.at), draw(h, `.p2-item-${i - 1} .p2-check path`, item.at)] : [])].join("\n")).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-pill-tracker { display:flex;align-items:center;gap:12px;padding:16px; }
      .pro-pill-tracker .p2-pill { position:relative;flex:1;min-width:0;height:112px;padding:8px 16px 26px;border:2px solid #343438;border-radius:56px;background:#0B0B0D;display:flex;align-items:center;justify-content:center;text-align:center; }
      .pro-pill-tracker .p2-check { position:absolute;bottom:4px;left:calc(50% - 12px);width:24px;height:24px; }
      .pro-pill-tracker .p2-check svg { display:block;width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round; }
      .pro-pill-tracker .p2-check path { stroke-dasharray:1;stroke-dashoffset:1; }
      ${copyCSS("pill-tracker", 32, 36)}`,
  },
  "first-then-finally": {
    family: "procedure",
    hint: "Greg gives exactly three ordered actions with a clear beginning, next action and final action",
    slots: { actions: { kind: "spoken", repeat: [3, 3], maxChars: 32, width: 456, size: 38, maxLines: 2 } },
    size: { w: 720, h: 352 },
    surface: "obsidian",
    render(o, h) {
      const inner = o.slots.actions.map((item, i) => `<div class="p2-row p2-item-${i}"><div class="p2-label">${["First", "Then", "Finally"][i]}</div><div class="p2-copy">${h.copy(item)}</div></div>`).join("");
      const timeline = o.slots.actions.map((item, i) => write(h, `.p2-item-${i} .p2-copy`, item.at) + "\n" + state(h, `.p2-item-${i} .p2-label`, { color: "#A8A49C" }, { color: "#C8A24B" }, item.at)).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-first-then-finally { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-first-then-finally .p2-row { display:grid;grid-template-columns:168px 1fr;gap:24px;min-height:88px;align-items:center;border-bottom:2px solid #343438; }
      .pro-first-then-finally .p2-row:last-child { border-bottom:0; }
      .pro-first-then-finally .p2-label { font:400 38px/44px "Anton",sans-serif;text-transform:uppercase;letter-spacing:1px;color:#A8A49C; }
      ${copyCSS("first-then-finally", 38, 42)}`,
  },
  pyramid: {
    family: "procedure",
    hint: "Greg builds exactly three levels from a foundation to a middle layer and a final priority at the top, spoken base first",
    slots: {
      base: { kind: "spoken", maxChars: 36, width: 480, size: 38, maxLines: 2 },
      middle: { kind: "spoken", maxChars: 24, width: 288, size: 36, maxLines: 2 },
      top: { kind: "spoken", maxChars: 12, width: 152, size: 32, maxLines: 2 },
    },
    size: { w: 720, h: 504 },
    surface: "obsidian",
    render(o, h) {
      const paths = ["M96 328H560L640 436H16Z", "M184 216H472L552 316H104Z", "M328 4 464 204H192Z"];
      const inner = `<svg class="p2-pyramid" viewBox="0 0 656 440" aria-hidden="true">${paths.map((d, i) => `<path class="p2-tier p2-tier-${i}" d="${d}"/>`).join("")}</svg>` + ["base", "middle", "top"].map((name, i) => `<div class="p2-copy p2-${name}">${h.copy(o.slots[name][0])}</div>`).join("");
      const timeline = ["base", "middle", "top"].map((name, i) => write(h, `.p2-${name}`, o.reveals[i]) + "\n" + enter(h, `.p2-tier-${i}`, {}, o.reveals[i])).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-pyramid .p2-pyramid { display:block;width:656px;height:440px;fill:#343438;stroke:#A8A49C;stroke-width:2;stroke-linejoin:round; }
      .pro-pyramid .p2-tier { opacity:0; }
      .pro-pyramid .p2-tier-2 { fill:#C8A24B;stroke:#C8A24B; }
      .pro-pyramid .p2-copy { position:absolute;text-align:center; }
      ${copyCSS("pyramid", 38, 42)}
      .pro-pyramid .p2-base { left:120px;top:370px;width:480px; }
      .pro-pyramid .p2-middle { left:216px;top:260px;width:288px;font-size:36px;line-height:40px; }
      .pro-pyramid .p2-top { left:284px;top:152px;width:152px;font-size:32px;line-height:36px;color:#0B0B0D; }`,
  },
  recipe: {
    family: "procedure",
    hint: "Greg names a method or desired result, then lists two to four ingredients needed to produce it; title must be spoken before ingredients",
    slots: {
      title: { kind: "spoken", maxChars: 32, width: 576, size: 40, maxLines: 2 },
      ingredients: { kind: "spoken", repeat: [2, 4], maxChars: 36, width: 528, size: 36, maxLines: 2 },
    },
    size: (o) => ({ w: 720, h: 208 + o.slots.ingredients.length * 80 }),
    surface: "bone",
    render(o, h) {
      const inner = `<div class="p2-label">Recipe</div><div class="p2-title p2-copy">${h.copy(o.slots.title[0])}</div><div class="p2-ingredients">${o.slots.ingredients.map((item, i) => `<div class="p2-row p2-item-${i}"><span class="p2-check">${tick}</span><div class="p2-copy">${h.copy(item)}</div></div>`).join("")}</div>`;
      const timeline = write(h, ".p2-title", o.reveals[0]) + "\n" + o.slots.ingredients.map((item, i) => write(h, `.p2-item-${i} .p2-copy`, item.at) + "\n" + draw(h, `.p2-item-${i} .p2-check path`, item.at)).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-recipe { padding:24px 48px 24px 72px;border-radius:8px;border-top:8px solid #C8A24B; }
      .pro-recipe::before { content:"";position:absolute;left:48px;top:0;bottom:0;width:2px;background:#C8A24B; }
      .pro-recipe .p2-label { font:400 30px/36px "Anton",sans-serif;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px; }
      ${copyCSS("recipe", 36, 38)}
      .pro-recipe .p2-title { width:576px;font-size:40px;line-height:44px;min-height:88px;margin-bottom:12px; }
      .pro-recipe .p2-row { display:grid;grid-template-columns:24px 1fr;gap:24px;height:80px;align-items:center;border-bottom:2px solid #A8A49C; }
      .pro-recipe .p2-row:last-child { border-bottom:0; }
      .pro-recipe .p2-check svg { display:block;width:24px;height:24px;fill:none;stroke:#0B0B0D;stroke-width:3;stroke-linecap:round;stroke-linejoin:round; }
      .pro-recipe .p2-check path { stroke-dasharray:1;stroke-dashoffset:1; }`,
  },
};

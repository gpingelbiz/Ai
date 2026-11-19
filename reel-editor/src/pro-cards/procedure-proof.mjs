const heading = { kind: "label", optional: true, maxChars: 26, width: 656, size: 30, maxLines: 1 };
const digits = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Ambiguous quantities stay qualitative; a range is never reduced to its first number.
function amount(text) {
  if (/\b(?:minus|negative|million|billion|trillion|point)\b|\d\s*(?:hundred|thousand|[km])\b/i.test(text)) return null;
  const tokens = String(text).toLowerCase().replace(/(?<=[a-z])-(?=[a-z])/g, " ").match(/-?\d+(?:,\d{3})*(?:\.\d+)?|[a-z]+/g) || [];
  const values = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^-?\d/.test(token)) values.push(Number(token.replaceAll(",", "")));
    else if (token in digits) {
      let value = digits[token];
      if (value >= 20 && tokens[i + 1] in digits && digits[tokens[i + 1]] > 0 && digits[tokens[i + 1]] < 10) value += digits[tokens[++i]];
      if (tokens[i + 1] === "hundred") {
        value *= 100; i++;
        if (tokens[i + 1] === "and") i++;
        if (tokens[i + 1] in digits) {
          let tail = digits[tokens[++i]];
          if (tail >= 20 && tokens[i + 1] in digits && digits[tokens[i + 1]] > 0 && digits[tokens[i + 1]] < 10) tail += digits[tokens[++i]];
          value += tail;
        }
      }
      if (tokens[i + 1] === "thousand") { value *= 1000; i++; }
      values.push(value);
    }
  }
  return values.length === 1 && Number.isFinite(values[0]) ? values[0] : null;
}

function ratio(text, percent = false) {
  const pair = String(text).split(/\s*(?:\/|\bout of\b|\bof\b)\s*/i);
  if (pair.length === 2) {
    const value = amount(pair[0]), total = amount(pair[1]);
    if (value !== null && total > 0 && value >= 0 && value <= total) return value / total;
  }
  if (percent || /%|\bpercent\b/i.test(text)) {
    const value = amount(text);
    if (value !== null && value >= 0 && value <= 100) return value / 100;
  }
  return null;
}

function title(o, h) {
  return o.slots.heading?.length ? `<div class="pp-heading">${h.copy(o.slots.heading[0])}</div>` : "";
}

function write(h, selector, time) {
  return `tl.fromTo(${h.sel(selector)},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${time});`;
}

function state(h, selector, from, to, time) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${time});`;
}

const tick = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const plus = `<svg class="pp-operator" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M12 4v16"/></svg>`;
const equals = `<svg class="pp-operator" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg>`;
const ring = `<svg class="pp-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="pp-track" cx="50" cy="50" r="40"/><circle class="pp-fill" cx="50" cy="50" r="40" pathLength="1" transform="rotate(-90 50 50)"/></svg>`;

function ringMotion(h, value, time) {
  return value === null ? "" : state(h, ".pp-fill", { strokeDashoffset: 1 }, { strokeDashoffset: 1 - value }, time);
}

function ringCSS(type) {
  return `
    .pro-${type} { display:flex;align-items:center;gap:24px; }
    .pro-${type} .pp-dial { position:relative;width:228px;height:228px;flex:none; }
    .pro-${type} .pp-ring { display:block;width:100%;height:100%; }
    .pro-${type} .pp-track,.pro-${type} .pp-fill { fill:none;stroke-width:10; }
    .pro-${type} .pp-track { stroke:#343438; }
    .pro-${type} .pp-fill { stroke:#C8A24B;stroke-dasharray:1;stroke-dashoffset:1; }
    .pro-${type} .pp-value { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:30px;font:400 36px/42px "Anton",sans-serif;opacity:0; }
    .pro-${type} .pp-context { min-width:0;flex:1;font:700 44px/54px "Inter",sans-serif;opacity:0; }
    .pro-${type} .pp-detail { font:600 32px/40px "Inter",sans-serif;color:#A8A49C;margin-top:16px;opacity:0; }`;
}

export const CARDS = {
  checklist: {
    family: "procedure",
    hint: "Greg gives two to four concrete actions to check off; each exact action ticks when said",
    slots: { heading, items: { kind: "spoken", repeat: [2, 4], maxChars: 44, width: 592, size: 42, maxLines: 2 } },
    size: { w: 720, h: 544 },
    surface: "obsidian",
    render(o, h) {
      const inner = title(o, h) + `<div class="pp-list">${o.slots.items.map((item, i) => `<div class="pp-row pp-item-${i}"><div class="pp-box"><span class="pp-tick">${tick}</span></div><div class="pp-copy">${h.copy(item)}</div></div>`).join("")}</div>`;
      const timeline = o.slots.items.map((_, i) => write(h, `.pp-item-${i} .pp-copy`, o.reveals[i]) + "\n" + state(h, `.pp-item-${i} .pp-box`, { backgroundColor: "#0B0B0D", borderColor: "#343438" }, { backgroundColor: "#C8A24B", borderColor: "#C8A24B" }, o.reveals[i]) + "\n" + state(h, `.pp-item-${i} .pp-tick`, { opacity: 0 }, { opacity: 1 }, o.reveals[i])).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-checklist { display:flex;flex-direction:column;justify-content:center; }
      .pro-checklist .pp-heading { font:700 30px/40px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase;color:#C8A24B;margin-bottom:16px; }
      .pro-checklist .pp-list { display:flex;flex-direction:column;gap:12px; }
      .pro-checklist .pp-row { display:flex;align-items:center;gap:18px; }
      .pro-checklist .pp-box { width:46px;height:46px;border:4px solid #343438;border-radius:10px;flex:none;color:#0B0B0D; }
      .pro-checklist .pp-tick { display:block;opacity:0; }
      .pro-checklist .pp-tick svg { display:block;width:38px;height:38px; }
      .pro-checklist .pp-copy { font:700 42px/48px "Inter",sans-serif;opacity:0; }`,
  },
  timeline: {
    family: "procedure",
    hint: "Greg moves between two to four spoken milestones such as week three to week eight; keep time units in each slot",
    slots: { heading, items: { kind: "spoken", repeat: [2, 4], maxChars: 18, width: 148, size: 34, maxLines: 2 } },
    size: { w: 720, h: 288 },
    surface: "obsidian",
    render(o, h) {
      const inner = title(o, h) + `<div class="pp-rail">${o.slots.items.map((item, i) => `<div class="pp-step pp-item-${i}">${i ? `<div class="pp-link"></div>` : ""}<div class="pp-node"></div><div class="pp-copy">${h.copy(item)}</div></div>`).join("")}</div>`;
      const timeline = o.slots.items.map((_, i) => [write(h, `.pp-item-${i} .pp-copy`, o.reveals[i]), state(h, `.pp-item-${i} .pp-node`, { backgroundColor: "#343438" }, { backgroundColor: "#C8A24B" }, o.reveals[i]), ...(i ? [state(h, `.pp-item-${i} .pp-link`, { scaleX: 0 }, { scaleX: 1 }, o.reveals[i]), state(h, `.pp-item-${i - 1} .pp-node`, { backgroundColor: "#C8A24B" }, { backgroundColor: "#A8A49C" }, o.reveals[i])] : [])].join("\n")).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-timeline .pp-heading { font:700 30px/40px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase;color:#C8A24B;margin-bottom:16px; }
      .pro-timeline .pp-rail { display:flex;gap:16px; }
      .pro-timeline .pp-step { position:relative;flex:1;min-width:0;text-align:center; }
      .pro-timeline .pp-step::before { content:"";position:absolute;right:50%;top:24px;width:calc(100% + 16px);height:4px;background:#343438; }
      .pro-timeline .pp-step:first-child::before { display:none; }
      .pro-timeline .pp-link { position:absolute;right:50%;top:24px;width:calc(100% + 16px);height:4px;background:#C8A24B;transform:scaleX(0);transform-origin:left; }
      .pro-timeline .pp-node { position:relative;width:48px;height:48px;border-radius:50%;background:#343438;margin:0 auto 16px; }
      .pro-timeline .pp-copy { font:700 34px/42px "Inter",sans-serif;opacity:0; }`,
  },
  formula: {
    family: "procedure",
    hint: "Greg explicitly combines two or three spoken ingredients into a spoken result; do not invent a causal formula",
    slots: {
      parts: { kind: "spoken", repeat: [2, 3], maxChars: 20, width: 192, size: 36, maxLines: 2 },
      result: { kind: "spoken", maxChars: 32, width: 600, size: 52, maxLines: 2 },
    },
    size: { w: 720, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="pp-parts">${o.slots.parts.map((item, i) => `${i ? plus : ""}<div class="pp-part pp-item-${i}">${h.copy(item)}</div>`).join("")}</div><div class="pp-result-row">${equals}<div class="pp-result">${h.copy(o.slots.result[0])}</div></div>`;
      const timeline = o.slots.parts.map((_, i) => write(h, `.pp-item-${i}`, o.reveals[i])).join("\n") + "\n" + write(h, ".pp-result", o.reveals.at(-1));
      return { inner, timeline };
    },
    css: `
      .pro-formula { display:flex;flex-direction:column;justify-content:center;gap:24px; }
      .pro-formula .pp-parts,.pro-formula .pp-result-row { display:flex;align-items:center;gap:16px; }
      .pro-formula .pp-part { flex:1;min-width:0;text-align:center;font:800 36px/44px "Inter",sans-serif;opacity:0; }
      .pro-formula .pp-operator { width:24px;height:24px;flex:none;fill:none;stroke:#C8A24B;stroke-width:3; }
      .pro-formula .pp-result { font:800 52px/62px "Inter",sans-serif;color:#C8A24B;opacity:0; }`,
  },
  countdown: {
    family: "procedure",
    hint: "only when Greg actually counts down two to four numbers; each slot is one spoken count, never an automatic countdown",
    slots: { counts: { kind: "spoken", repeat: [2, 4], maxChars: 5, width: 156, size: 48, maxLines: 1 } },
    size: { w: 720, h: 176 },
    surface: "bare",
    render(o, h) {
      const inner = o.slots.counts.map((item, i) => `<div class="pp-count pp-item-${i}${/^\d+$/.test(item.text) ? " pp-digit" : ""}">${h.copy(item)}</div>`).join("");
      const timeline = o.slots.counts.map((_, i) => write(h, `.pp-item-${i}`, o.reveals[i])).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-countdown { display:flex;gap:20px; }
      .pro-countdown .pp-count { flex:1;min-width:0;display:flex;align-items:center;justify-content:center;background:#0B0B0D;border-radius:16px;font:400 48px/56px "Anton",sans-serif;opacity:0; }
      .pro-countdown .pp-digit { font-size:96px;line-height:112px; }
      .pro-countdown .pp-count:last-child { background:#C8A24B;color:#0B0B0D; }`,
  },
  ranking: {
    family: "procedure",
    hint: "Greg ranks exactly three priorities; include any spoken rank in its item's range, never add ordinal numbers",
    slots: { heading, items: { kind: "spoken", repeat: [3, 3], maxChars: 40, width: 526, size: 42, maxLines: 2 } },
    size: { w: 720, h: 448 },
    surface: "obsidian",
    render(o, h) {
      const inner = title(o, h) + `<div class="pp-list">${o.slots.items.map((item, i) => {
        // Only a rank inside this spoken range earns the mockup's number column.
        const rank = item.text.match(/^((?:\d+(?:st|nd|rd|th)?|first|second|third|one|two|three)[.:,)]?)\s+(.+)$/i);
        const copy = rank ? `<span class="pp-ordinal${/^\d/.test(rank[1]) ? " pp-digit" : ""}">${h.esc(rank[1])}</span><span class="pp-copy">${h.copy({ text: rank[2] })}</span>` : h.copy(item);
        return `<div class="pp-rank pp-item-${i}">${copy}</div>`;
      }).join("")}</div>`;
      return { inner, timeline: o.slots.items.map((_, i) => write(h, `.pp-item-${i}`, o.reveals[i])).join("\n") };
    },
    css: `
      .pro-ranking .pp-heading { font:700 30px/40px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase;color:#C8A24B;margin-bottom:16px; }
      .pro-ranking .pp-list { display:flex;flex-direction:column;gap:12px; }
      .pro-ranking .pp-rank { display:flex;align-items:center;gap:18px;font:700 42px/48px "Inter",sans-serif;color:#A8A49C;opacity:0; }
      .pro-ranking .pp-rank:first-child { color:#C8A24B;font-weight:800; }
      .pro-ranking .pp-ordinal { width:112px;flex:none;font:400 40px/48px "Anton",sans-serif; }
      .pro-ranking .pp-digit { font-size:56px;line-height:56px; }
      .pro-ranking .pp-copy { flex:1;min-width:0; }`,
  },
  "percent-ring": {
    family: "proof",
    hint: "Greg states a percentage and its meaning; value is his exact percentage, context is the spoken qualification",
    slots: {
      value: { kind: "spoken", maxChars: 22, width: 168, size: 36, maxLines: 2 },
      context: { kind: "spoken", maxChars: 46, width: 404, size: 44, maxLines: 3 },
    },
    size: { w: 720, h: 320 },
    surface: "obsidian",
    render(o, h) {
      return { inner: `<div class="pp-dial">${ring}<div class="pp-value">${h.copy(o.slots.value[0])}</div></div><div class="pp-context">${h.copy(o.slots.context[0])}</div>`, timeline: [write(h, ".pp-value", o.reveals[0]), ringMotion(h, ratio(o.slots.value[0].text, true), o.reveals[0]), write(h, ".pp-context", o.reveals[1])].join("\n") };
    },
    css: ringCSS("percent-ring"),
  },
  bars: {
    family: "proof",
    hint: "two to four comparable spoken amounts with their labels and units in each range; without comparable numbers use illustrative practice steps",
    slots: { heading, items: { kind: "spoken", repeat: [2, 4], maxChars: 24, width: 144, size: 30, maxLines: 3 } },
    size: { w: 720, h: 464 },
    surface: "obsidian",
    render(o, h) {
      const values = o.slots.items.map((item) => amount(item.text));
      const measured = values.every((v) => v !== null && v >= 0);
      const heights = measured ? values.map((v) => v / Math.max(1, ...values)) : values.map((_, i) => (i + 1) / values.length);
      const inner = title(o, h) + `<div class="pp-bars">${o.slots.items.map((item, i) => `<div class="pp-column pp-item-${i}"><div class="pp-stage"><div class="pp-bar" style="height:${h.at(176 * heights[i])}px"></div></div><div class="pp-copy">${h.copy(item)}</div></div>`).join("")}</div>` + (measured ? "" : `<div class="pp-note">Practice steps</div>`);
      const timeline = o.slots.items.map((_, i) => write(h, `.pp-item-${i} .pp-copy`, o.reveals[i]) + "\n" + state(h, `.pp-item-${i} .pp-bar`, { scaleY: 0 }, { scaleY: 1 }, o.reveals[i])).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-bars .pp-heading { font:700 30px/40px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase;color:#C8A24B;margin-bottom:16px; }
      .pro-bars .pp-bars { display:flex;gap:24px; }
      .pro-bars .pp-column { flex:1;min-width:0;text-align:center; }
      .pro-bars .pp-stage { height:176px;display:flex;align-items:flex-end; }
      .pro-bars .pp-bar { width:100%;background:#343438;border-radius:10px 10px 0 0;transform:scaleY(0);transform-origin:bottom; }
      .pro-bars .pp-column:last-child .pp-bar { background:#C8A24B; }
      .pro-bars .pp-copy { font:700 30px/36px "Inter",sans-serif;color:#A8A49C;margin-top:12px;opacity:0; }
      .pro-bars .pp-note { font:600 26px/32px "Inter",sans-serif;color:#A8A49C;margin-top:8px; }`,
  },
  rating: {
    family: "proof",
    hint: "Greg speaks a score; include the scale in the score range if said, dots only fill against that spoken scale",
    slots: { heading, score: { kind: "spoken", maxChars: 32, width: 656, size: 48, maxLines: 2 } },
    size: { w: 720, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const text = o.slots.score[0].text, pair = text.split(/\s*(?:\/|\bout of\b|\bof\b)\s*/i), fraction = ratio(text);
      const total = pair.length === 2 ? amount(pair[1]) : null;
      const count = Number.isInteger(total) && total > 0 && total <= 12 && fraction !== null && Number.isInteger(amount(pair[0])) ? total : 0;
      const inner = title(o, h) + `<div class="pp-score">${h.copy(o.slots.score[0])}</div><div class="pp-dots">${Array.from({ length: count }, (_, i) => `<span class="pp-dot pp-dot-${i}"></span>`).join("")}</div>`;
      const timeline = write(h, ".pp-score", o.reveals[0]) + (count ? "\n" + write(h, ".pp-dots", o.reveals[0]) + "\n" + Array.from({ length: Math.floor(fraction * count + 1e-8) }, (_, i) => state(h, `.pp-dot-${i}`, { backgroundColor: "#343438" }, { backgroundColor: "#C8A24B" }, o.reveals[0])).join("\n") : "");
      return { inner, timeline };
    },
    css: `
      .pro-rating .pp-heading { font:700 30px/40px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase;color:#C8A24B;margin-bottom:16px; }
      .pro-rating .pp-score { font:700 48px/56px "Inter",sans-serif;opacity:0; }
      .pro-rating .pp-dots { display:flex;gap:10px;margin-top:20px;opacity:0; }
      .pro-rating .pp-dot { flex:1;max-width:56px;aspect-ratio:1;border-radius:50%;background:#343438; }`,
  },
  "progress-ring": {
    family: "proof",
    hint: "Greg gives a practice instruction then a spoken day or progress count; total is optional and must also be spoken to imply completion",
    slots: {
      instruction: { kind: "spoken", maxChars: 40, width: 404, size: 44, maxLines: 3 },
      value: { kind: "spoken", maxChars: 20, width: 168, size: 36, maxLines: 2 },
      total: { kind: "spoken", optional: true, maxChars: 24, width: 404, size: 32, maxLines: 2 },
    },
    size: { w: 720, h: 352 },
    surface: "obsidian",
    render(o, h) {
      const total = o.slots.total[0], value = o.slots.value[0];
      const current = amount(value.text), goal = total ? amount(total.text) : null;
      const fraction = total ? current !== null && goal > 0 && current >= 0 && current <= goal ? current / goal : null : ratio(value.text);
      const inner = `<div class="pp-summary"><div class="pp-context">${h.copy(o.slots.instruction[0])}</div>${total ? `<div class="pp-detail">${h.copy(total)}</div>` : ""}</div><div class="pp-dial">${ring}<div class="pp-value">${h.copy(value)}</div></div>`;
      const timeline = [write(h, ".pp-context", o.reveals[0]), write(h, ".pp-value", o.reveals[1]), ringMotion(h, fraction, o.reveals.at(-1)), ...(total ? [write(h, ".pp-detail", o.reveals[2])] : [])].join("\n");
      return { inner, timeline };
    },
    css: ringCSS("progress-ring") + `
      .pro-progress-ring .pp-summary { flex:1;min-width:0; }`,
  },
  stopwatch: {
    family: "proof",
    hint: "Greg states a duration such as two to three minutes; keep the exact spoken time and units, never run a fabricated timer",
    slots: { time: { kind: "spoken", maxChars: 30, width: 400, size: 48, maxLines: 2 } },
    size: { w: 464, h: 448 },
    surface: "bare",
    render(o, h) {
      const inner = `<svg class="pp-watch" viewBox="0 0 100 110" aria-hidden="true"><path class="pp-crown" d="M44 2h12v10H44z"/><circle cx="50" cy="60" r="44"/><path class="pp-hand" d="M50 60V30"/></svg><div class="pp-time">${h.copy(o.slots.time[0])}</div>`;
      return { inner, timeline: write(h, ".pp-time", o.reveals[0]) + "\n" + state(h, ".pp-hand", { rotation: 0 }, { rotation: 54 }, o.reveals[0]) };
    },
    css: `
      .pro-stopwatch { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 32px; }
      .pro-stopwatch .pp-watch { width:260px;height:286px;flex:none;overflow:visible; }
      .pro-stopwatch .pp-watch circle { fill:#0B0B0D;stroke:#C8A24B;stroke-width:6; }
      .pro-stopwatch .pp-crown { fill:#C8A24B; }
      .pro-stopwatch .pp-hand { fill:none;stroke:#C8A24B;stroke-width:5;stroke-linecap:round;transform-origin:50px 60px; }
      .pro-stopwatch .pp-time { width:400px;text-align:center;font:400 48px/56px "Anton",sans-serif;opacity:0; }`,
  },
  "loading-bar": {
    family: "proof",
    hint: "Greg describes skill progressing through one to four spoken states; only show percentages if he actually says them",
    slots: { heading, states: { kind: "spoken", repeat: [1, 4], maxChars: 44, width: 656, size: 40, maxLines: 2 } },
    size: { w: 720, h: 288 },
    surface: "obsidian",
    render(o, h) {
      const inner = title(o, h) + `<div class="pp-track"><div class="pp-fill"></div></div><div class="pp-states">${o.slots.states.map((item, i) => `<div class="pp-state pp-item-${i}">${h.copy(item)}</div>`).join("")}</div>`;
      let previous = 0;
      const timeline = o.slots.states.map((item, i) => {
        const next = ratio(item.text) ?? (i + 1) / (o.slots.states.length + 1);
        const fill = state(h, ".pp-fill", { scaleX: previous }, { scaleX: next }, o.reveals[i]);
        previous = next;
        return (i ? `tl.set(${h.sel(`.pp-item-${i - 1}`)},{visibility:"hidden"},${o.reveals[i]});\n` : "") + write(h, `.pp-item-${i}`, o.reveals[i]) + "\n" + fill;
      }).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-loading-bar .pp-heading { font:700 30px/40px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase;color:#C8A24B;margin-bottom:16px; }
      .pro-loading-bar .pp-track { height:34px;border-radius:17px;background:#343438;overflow:hidden; }
      .pro-loading-bar .pp-fill { width:100%;height:100%;background:#C8A24B;transform:scaleX(0);transform-origin:left; }
      .pro-loading-bar .pp-states { position:relative;height:96px;margin-top:16px; }
      .pro-loading-bar .pp-state { position:absolute;inset:0;font:700 40px/48px "Inter",sans-serif;color:#A8A49C;opacity:0; }`,
  },
};

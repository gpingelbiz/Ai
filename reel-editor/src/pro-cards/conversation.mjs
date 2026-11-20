// Keep copy masked in the initial DOM so direct frame seeks cannot expose a later spoken item.
const write = (o, h, selector, i) => `tl.fromTo(${h.sel(selector)},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${o.reveals[i]});`;

const phone = `<svg class="call-handset" viewBox="0 0 48 48" aria-hidden="true"><path d="M12 8 6 13c0 14 15 29 29 29l5-6-10-8-5 5c-5-2-9-6-11-11l5-5Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>`;
const person = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="22" r="10"/><path d="M13 53c0-21 38-21 38 0"/></svg>`;
const message = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 8h32v25H22L11 41v-8H8Z"/><path d="M16 18h16M16 25h10"/></svg>`;
const question = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 17a8 8 0 0 1 16 0c0 7-8 6-8 13"/><circle cx="24" cy="37" r="2" fill="currentColor" stroke="none"/></svg>`;
const search = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="21" cy="21" r="13"/><path d="m31 31 11 11"/></svg>`;
const calendar = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="10" width="34" height="31" rx="3"/><path d="M15 5v10M33 5v10M7 21h34"/></svg>`;
const check = `<svg class="calendar-check" viewBox="0 0 48 48" aria-hidden="true"><path pathLength="1" d="m8 25 10 10 23-23"/></svg>`;
const lock = `<svg class="unlock-icon" viewBox="0 0 96 112" aria-hidden="true"><path class="lock-shackle" d="M25 53V29a23 23 0 0 1 46 0v24"/><rect x="14" y="49" width="68" height="55" rx="9"/><path d="M48 72v13"/></svg>`;
const flag = `<svg class="flag-icon" viewBox="0 0 80 104" aria-hidden="true"><path d="M14 96V8"/><path class="flag-cloth" d="M14 10c21-17 36 17 57 0v43c-21 17-36-17-57 0Z"/></svg>`;

export const CARDS = {
  "text-thread": {
    family: "conversation",
    hint: "Greg quotes one to three messages in a prospect conversation, in speaking order",
    slots: { messages: { kind: "spoken", repeat: [1, 3], maxChars: 44, width: 552, size: 42, maxLines: 2 } },
    size: { w: 720, h: 560 },
    surface: "bone",
    render(o, h) {
      const inner = `<div class="thread-label">Example dialogue</div><div class="thread-messages">${o.slots.messages.map((p, i) => `<div class="thread-bubble thread-bubble-${i}"><div class="thread-copy">${h.copy(p)}</div></div>`).join("")}</div>`;
      const timeline = o.slots.messages.map((_, i) => `tl.fromTo(${h.sel(`.thread-bubble-${i}`)},{opacity:0},{opacity:1,duration:${h.motion.enter},ease:proEnter,immediateRender:false},${o.reveals[i]});\n${write(o, h, `.thread-bubble-${i} .thread-copy`, i)}`).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-text-thread { display:flex;flex-direction:column;justify-content:center;border-radius:28px; }
      .pro-text-thread .thread-label { font:700 28px/36px "Inter",sans-serif;color:#343438;text-align:center;margin-bottom:16px; }
      .pro-text-thread .thread-messages { display:flex;flex-direction:column;gap:12px; }
      .pro-text-thread .thread-bubble { max-width:600px;width:max-content;padding:16px 24px;border-radius:28px;background:rgba(168,164,156,.22);opacity:0; }
      .pro-text-thread .thread-bubble:nth-child(even) { align-self:flex-end;background:#0B0B0D;color:#F5F1E8; }
      .pro-text-thread .thread-copy { font:600 42px/52px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "incoming-call": {
    family: "conversation",
    hint: "Greg identifies the lead calling or receiving a call before demonstrating the opener",
    slots: { caller: { kind: "spoken", maxChars: 24, width: 464, size: 44, maxLines: 1 } },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      return {
        inner: `<div class="call-avatar">${person}</div><div class="call-info"><div class="call-label">Incoming call</div><div class="call-copy">${h.copy(o.slots.caller[0])}</div></div><div class="call-answer">${phone}</div>`,
        timeline: `${write(o, h, ".call-copy", 0)}\ntl.fromTo(${h.sel(".call-handset")},{rotation:0},{rotation:-24,duration:${h.motion.state},ease:proState,immediateRender:false},${o.reveals[0]});`,
      };
    },
    css: `
      .pro-incoming-call { display:flex;align-items:center;gap:20px;border-radius:28px; }
      .pro-incoming-call .call-avatar { width:88px;height:88px;flex:none;border-radius:50%;background:#343438;display:grid;place-items:center; }
      .pro-incoming-call .call-avatar svg { width:56px;height:56px;fill:none;stroke:#F5F1E8;stroke-width:3;stroke-linecap:round; }
      .pro-incoming-call .call-info { flex:1;min-width:0; }
      .pro-incoming-call .call-label { font:700 28px/34px "Inter",sans-serif;color:#A8A49C;margin-bottom:6px; }
      .pro-incoming-call .call-copy { font:800 44px/54px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-incoming-call .call-answer { width:64px;height:64px;flex:none;display:grid;place-items:center;background:#C8A24B;color:#0B0B0D;border-radius:50%; }
      .pro-incoming-call .call-handset { width:40px;height:40px;transform-origin:50% 50%; }`,
  },
  email: {
    family: "conversation",
    hint: "Greg gives an exact email subject and optionally the opening preview line",
    slots: {
      subject: { kind: "spoken", maxChars: 48, width: 656, size: 44, maxLines: 2 },
      preview: { kind: "spoken", optional: true, maxChars: 56, width: 656, size: 36, maxLines: 2 },
    },
    size: { w: 720, h: 336 },
    surface: "bone",
    render(o, h) {
      const preview = o.slots.preview[0];
      return {
        inner: `<div class="email-label">Inbox</div><div class="email-subject">${h.copy(o.slots.subject[0])}</div>${preview ? `<div class="email-preview">${h.copy(preview)}</div>` : ""}`,
        timeline: write(o, h, ".email-subject", 0) + (preview ? `\n${write(o, h, ".email-preview", 1)}` : ""),
      };
    },
    css: `
      .pro-email { display:flex;flex-direction:column;justify-content:center;border-radius:20px; }
      .pro-email .email-label { font:700 28px/34px "Inter",sans-serif;text-transform:uppercase;letter-spacing:3px;color:#343438;margin-bottom:8px; }
      .pro-email .email-subject { font:800 44px/54px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-email .email-preview { font:500 36px/44px "Inter",sans-serif;color:#343438;margin-top:12px;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  notification: {
    family: "conversation",
    hint: "Greg quotes the short direct message or alert a prospect sends",
    slots: { message: { kind: "spoken", maxChars: 48, width: 550, size: 38, maxLines: 2 } },
    size: { w: 720, h: 224 },
    surface: "bone",
    render(o, h) {
      // The wrapper travels +16px; this inner frame compensates so the visible alert drops only 16px.
      return {
        inner: `<div class="notice-frame"><div class="notice-icon">${message}</div><div class="notice-info"><div class="notice-label">New message</div><div class="notice-copy">${h.copy(o.slots.message[0])}</div></div></div>`,
        timeline: `tl.fromTo(${h.sel(".notice-frame")},{y:-32},{y:0,duration:${h.motion.enter},ease:proEnter,immediateRender:false},${o.start});\n${write(o, h, ".notice-copy", 0)}`,
      };
    },
    css: `
      .pro-notification.pro-bone { padding:0;background:none;box-shadow:none;overflow:visible; }
      .pro-notification .notice-frame { width:100%;height:100%;padding:32px;background:#F5F1E8;display:flex;align-items:center;gap:22px;border-radius:30px;box-shadow:0 12px 32px rgba(0,0,0,.22); }
      .pro-notification .notice-icon { width:84px;height:84px;flex:none;background:#0B0B0D;border-radius:20px;display:grid;place-items:center; }
      .pro-notification .notice-icon svg { width:48px;height:48px;stroke:#C8A24B;stroke-width:3;fill:none;stroke-linejoin:round;stroke-linecap:round; }
      .pro-notification .notice-info { flex:1;min-width:0; }
      .pro-notification .notice-label { font:800 30px/36px "Inter",sans-serif;margin-bottom:8px; }
      .pro-notification .notice-copy { font:500 38px/46px "Inter",sans-serif;color:#343438;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "ask-this": {
    family: "conversation",
    hint: "Greg models the exact question a rep should ask next",
    slots: { question: { kind: "spoken", maxChars: 52, width: 656, size: 50, maxLines: 2 } },
    size: { w: 720, h: 288 },
    surface: "obsidian",
    render(o, h) {
      return {
        inner: `<div class="ask-heading"><div class="ask-icon">${question}</div><div class="ask-label">Ask this</div></div><div class="ask-copy">${h.copy(o.slots.question[0])}</div>`,
        timeline: write(o, h, ".ask-copy", 0),
      };
    },
    css: `
      .pro-ask-this { display:flex;flex-direction:column;justify-content:center;gap:18px; }
      .pro-ask-this .ask-heading { display:flex;align-items:center;gap:18px; }
      .pro-ask-this .ask-icon { width:64px;height:64px;flex:none;border-radius:50%;background:#C8A24B;color:#0B0B0D;display:grid;place-items:center; }
      .pro-ask-this .ask-icon svg { width:48px;height:48px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round; }
      .pro-ask-this .ask-label { font:700 30px/36px "Inter",sans-serif;letter-spacing:3px;text-transform:uppercase;color:#C8A24B; }
      .pro-ask-this .ask-copy { font:700 50px/60px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "script-highlight": {
    family: "conversation",
    hint: "Greg reads a short script line worth highlighting exactly as he says it",
    slots: { line: { kind: "spoken", maxChars: 72, width: 656, size: 46, maxLines: 3 } },
    size: { w: 720, h: 320 },
    surface: "bone",
    render(o, h) {
      const inner = `<div class="script-label">Script example</div><div class="script-text">${o.slots.line[0].lines.map((line) => `<span class="script-row"><span class="script-mark"></span><span class="script-copy">${h.esc(line)}</span></span>`).join("")}</div>`;
      return { inner, timeline: `${write(o, h, ".script-copy", 0)}\ntl.fromTo(${h.sel(".script-mark")},{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:${h.motion.state},ease:proState,immediateRender:false},${o.reveals[0]});` };
    },
    css: `
      .pro-script-highlight { display:flex;flex-direction:column;justify-content:center;gap:16px; }
      .pro-script-highlight .script-label { font:700 28px/36px "Inter",sans-serif;letter-spacing:3px;text-transform:uppercase;color:#343438; }
      .pro-script-highlight .script-text { font:600 46px/62px "Inter",sans-serif; }
      .pro-script-highlight .script-row { position:relative;display:table; }
      .pro-script-highlight .script-mark { position:absolute;inset:55% 0 8% 0;background:rgba(200,162,75,.28);clip-path:inset(0 100% 0 0); }
      .pro-script-highlight .script-copy { position:relative;display:block;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "search-bar": {
    family: "conversation",
    hint: "Greg voices the exact question or problem someone would search for",
    slots: { query: { kind: "spoken", maxChars: 48, width: 568, size: 42, maxLines: 2 } },
    size: { w: 720, h: 176 },
    surface: "bone",
    render(o, h) {
      return { inner: `${search}<div class="search-query">${h.copy(o.slots.query[0])}<span class="search-caret"></span></div>`, timeline: write(o, h, ".search-query", 0) };
    },
    css: `
      .pro-search-bar { display:flex;align-items:center;gap:20px;border-radius:88px; }
      .pro-search-bar>svg { width:56px;height:56px;flex:none;fill:none;stroke:#343438;stroke-width:3;stroke-linecap:round; }
      .pro-search-bar .search-query { font:600 42px/52px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-search-bar .search-caret { display:inline-block;width:3px;height:42px;margin-left:3px;background:#C8A24B;vertical-align:-7px; }`,
  },
  calendar: {
    family: "payoff",
    hint: "Greg confirms a booked call; include a date or time only if he actually says it",
    slots: {
      event: { kind: "spoken", maxChars: 30, width: 424, size: 44, maxLines: 2 },
      date: { kind: "spoken", optional: true, maxChars: 12, width: 128, size: 44, maxLines: 2 },
      details: { kind: "spoken", optional: true, maxChars: 40, width: 424, size: 36, maxLines: 2 },
    },
    size: { w: 720, h: 336 },
    surface: "obsidian",
    render(o, h) {
      const date = o.slots.date[0], details = o.slots.details[0];
      const inner = `<div class="calendar-label">Booked</div><div class="calendar-row"><div class="calendar-tile"><div class="calendar-top">${calendar}</div>${date ? `<div class="calendar-date">${h.copy(date)}</div>` : ""}</div><div class="calendar-info"><div class="calendar-event">${h.copy(o.slots.event[0])}</div>${details ? `<div class="calendar-details">${h.copy(details)}</div>` : ""}</div>${check}</div>`;
      const timeline = [write(o, h, ".calendar-event", 0), ...(date ? [write(o, h, ".calendar-date", 1)] : []), ...(details ? [write(o, h, ".calendar-details", date ? 2 : 1)] : []), `tl.fromTo(${h.sel(".calendar-check path")},{strokeDashoffset:1},{strokeDashoffset:0,duration:${h.motion.state},ease:proState,immediateRender:false},${o.reveals.at(-1)});`].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-calendar { display:flex;flex-direction:column;justify-content:center;gap:16px; }
      .pro-calendar .calendar-label { font:700 30px/36px "Inter",sans-serif;color:#C8A24B;letter-spacing:3px;text-transform:uppercase; }
      .pro-calendar .calendar-row { display:flex;align-items:center;gap:24px; }
      .pro-calendar .calendar-tile { width:144px;flex:none;border-radius:14px;overflow:hidden;background:#F5F1E8;color:#0B0B0D;text-align:center; }
      .pro-calendar .calendar-top { height:48px;display:grid;place-items:center;background:#C8A24B; }
      .pro-calendar .calendar-top svg { width:40px;height:40px;fill:none;stroke:#0B0B0D;stroke-width:3;stroke-linecap:round; }
      .pro-calendar .calendar-date { padding:8px;font:700 44px/52px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-calendar .calendar-info { flex:1;min-width:0; }
      .pro-calendar .calendar-event { font:700 44px/54px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-calendar .calendar-details { font:600 36px/44px "Inter",sans-serif;color:#A8A49C;margin-top:12px;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-calendar .calendar-check { width:48px;height:48px;margin-left:-8px;flex:none;fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;stroke-linejoin:round; }
      .pro-calendar .calendar-check path { stroke-dasharray:1;stroke-dashoffset:1; }`,
  },
  unlock: {
    family: "payoff",
    hint: "Greg earns permission or a yes that lets the conversation continue",
    slots: { payoff: { kind: "spoken", maxChars: 40, width: 536, size: 44, maxLines: 2 } },
    size: { w: 720, h: 224 },
    surface: "obsidian",
    render(o, h) {
      return {
        inner: `${lock}<div class="unlock-info"><div class="unlock-label">Unlocked</div><div class="unlock-copy">${h.copy(o.slots.payoff[0])}</div></div>`,
        timeline: `${write(o, h, ".unlock-copy", 0)}\ntl.fromTo(${h.sel(".lock-shackle")},{rotation:0,y:0},{rotation:-28,y:-8,duration:${h.motion.state},ease:proState,immediateRender:false},${o.reveals[0]});`,
      };
    },
    css: `
      .pro-unlock { display:flex;align-items:center;gap:24px; }
      .pro-unlock .unlock-icon { width:96px;height:112px;flex:none;fill:none;stroke:#C8A24B;stroke-width:5;stroke-linecap:round;overflow:visible; }
      .pro-unlock .unlock-icon rect { fill:rgba(200,162,75,.18); }
      .pro-unlock .lock-shackle { transform-box:fill-box;transform-origin:0 100%; }
      .pro-unlock .unlock-info { flex:1;min-width:0; }
      .pro-unlock .unlock-label { font:700 30px/36px "Inter",sans-serif;color:#C8A24B;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px; }
      .pro-unlock .unlock-copy { font:700 44px/52px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "green-flag": {
    family: "payoff",
    hint: "Greg names an observable positive response showing the conversation is working",
    slots: { signal: { kind: "spoken", maxChars: 44, width: 552, size: 44, maxLines: 2 } },
    size: { w: 720, h: 224 },
    surface: "obsidian",
    render(o, h) {
      return {
        inner: `${flag}<div class="flag-info"><div class="flag-label">Green flag</div><div class="flag-copy">${h.copy(o.slots.signal[0])}</div></div>`,
        timeline: `${write(o, h, ".flag-copy", 0)}\ntl.fromTo(${h.sel(".flag-cloth")},{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:${h.motion.state},ease:proState,immediateRender:false},${o.reveals[0]});`,
      };
    },
    css: `
      .pro-green-flag { display:flex;align-items:center;gap:24px; }
      .pro-green-flag .flag-icon { width:80px;height:104px;flex:none;fill:none;stroke:#C8A24B;stroke-width:5;stroke-linecap:round;stroke-linejoin:round; }
      .pro-green-flag .flag-cloth { fill:rgba(200,162,75,.18);clip-path:inset(0 100% 0 0); }
      .pro-green-flag .flag-info { flex:1;min-width:0; }
      .pro-green-flag .flag-label { font:700 30px/36px "Inter",sans-serif;color:#C8A24B;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px; }
      .pro-green-flag .flag-copy { font:700 44px/52px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
};

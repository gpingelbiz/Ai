// Keep speech hidden in the initial DOM and every change explicit for arbitrary frame seeks.
function write(h, selector, at) {
  return `tl.fromTo(${h.sel(selector)},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

function state(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${at});`;
}

const avatar = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/><circle cx="24" cy="18" r="6"/><path d="M12 36c0-14 24-14 24 0"/></svg>`;
const silhouette = `<svg viewBox="0 0 160 120" aria-hidden="true"><circle cx="80" cy="38" r="22"/><path d="M32 120v-10c0-50 96-50 96 0v10Z"/></svg>`;
const play = `<svg class="vm-play" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/><path d="m20 15 14 9-14 9Z"/></svg>`;
const pencil = `<svg class="crm-pencil" viewBox="0 0 32 32" aria-hidden="true"><path d="m7 20 15-15 6 6-15 15-8 2Z M19 8l6 6 M7 20l6 6"/></svg>`;
const bell = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M9 28h22l-3-5v-8a8 8 0 0 0-16 0v8Z M16 33h8"/></svg>`;

// Compact threads grow only for grounded lines; a single short message fits upper and torso.
const threadSize = (o) => ({ w: 720, h: Math.max(160, 92 + o.slots.messages.reduce((sum, item) => sum + item.lines.length * 44 + 24, 0) + (o.slots.messages.length - 1) * 12) });
const notificationSize = (o) => ({ w: 720, h: Math.max(160, 80 + o.slots.messages.reduce((sum, item) => sum + Math.max(64, item.lines.length * 44 + 24), 0) + (o.slots.messages.length - 1) * 12) });

export const CARDS = {
  "dm-chat": {
    family: "conversation",
    hint: "Greg quotes one to three direct messages exchanged in alternating turns; use the exact messages in speaking order, not a summary of outreach",
    slots: { messages: { kind: "spoken", repeat: [1, 3], maxChars: 42, width: 560, size: 36, maxLines: 2 } },
    size: threadSize,
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="dm-header">${avatar}<div>Direct messages</div></div><div class="dm-thread">${o.slots.messages.map((item, i) => `<div class="dm-bubble dm-item-${i}"><div class="dm-copy">${h.copy(item)}</div></div>`).join("")}</div>`;
      const timeline = o.slots.messages.map((item, i) => write(h, `.dm-item-${i}`, item.at) + "\n" + write(h, `.dm-item-${i} .dm-copy`, item.at)).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-dm-chat { padding:20px 24px;background:#0B0B0D;border-radius:16px; }
      .pro-dm-chat .dm-header { height:40px;display:flex;align-items:center;gap:12px;margin-bottom:12px;border-bottom:2px solid #343438;font:700 24px/30px "Inter",sans-serif;color:#A8A49C; }
      .pro-dm-chat .dm-header svg { width:32px;height:32px;flex:none;fill:none;stroke:#C8A24B;stroke-width:2; }
      .pro-dm-chat .dm-thread { display:flex;flex-direction:column;gap:12px; }
      .pro-dm-chat .dm-bubble { max-width:600px;width:max-content;padding:12px 18px;border-left:4px solid #A8A49C;border-radius:0 12px 12px 12px;background:#343438;opacity:0; }
      .pro-dm-chat .dm-bubble:nth-child(even) { align-self:flex-end;border-left:0;border-right:4px solid #C8A24B;border-radius:12px 0 12px 12px;background:#F5F1E8;color:#0B0B0D; }
      .pro-dm-chat .dm-copy { font:600 36px/44px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  voicemail: {
    family: "conversation",
    hint: "Greg dictates or quotes an actual voicemail message; transcript is the spoken message, never an inferred caller, duration or audio measurement",
    slots: { transcript: { kind: "spoken", maxChars: 64, width: 672, size: 32, maxLines: 2 } },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      // The fixed waveform is decorative; it has no elapsed time or fabricated audio values.
      const bars = Array.from({ length: 32 }, (_, i) => {
        const height = [12, 24, 36, 20, 40, 28, 16, 32][i % 8];
        return `<path d="M${i * 13 + 4} ${(48 - height) / 2}v${height}"/>`;
      }).join("");
      const inner = `<div class="vm-row">${play}<div class="vm-label">Voicemail</div><svg class="vm-wave" viewBox="0 0 416 48" aria-hidden="true">${bars}</svg></div><div class="vm-copy">${h.copy(o.slots.transcript[0])}</div>`;
      return { inner, timeline: write(h, ".vm-copy", o.reveals[0]) + "\n" + state(h, ".vm-play path", { fill: "#A8A49C" }, { fill: "#C8A24B" }, o.reveals[0]) };
    },
    css: `
      .pro-voicemail { padding:20px 24px;background:#0B0B0D; }
      .pro-voicemail .vm-row { height:48px;display:flex;align-items:center;gap:16px;margin-bottom:12px; }
      .pro-voicemail .vm-play { width:48px;height:48px;flex:none; }
      .pro-voicemail .vm-play circle { fill:none;stroke:#343438;stroke-width:2; }
      .pro-voicemail .vm-play path { fill:#A8A49C; }
      .pro-voicemail .vm-label { font:700 24px/30px "Inter",sans-serif;color:#A8A49C; }
      .pro-voicemail .vm-wave { flex:1;min-width:0;height:48px;fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round; }
      .pro-voicemail .vm-copy { font:600 32px/38px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "video-call": {
    family: "conversation",
    hint: "Greg roleplays a rep's video-call line followed by the prospect's reply; each exact line captions its speaker's tile as that speaker talks",
    slots: {
      rep: { kind: "spoken", maxChars: 28, width: 292, size: 34, maxLines: 2 },
      prospect: { kind: "spoken", maxChars: 28, width: 292, size: 34, maxLines: 2 },
    },
    size: { w: 720, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const inner = ["rep", "prospect"].map((name) => `<div class="vc-tile vc-${name}"><div class="vc-portrait">${silhouette}</div><div class="vc-copy">${h.copy(o.slots[name][0])}</div></div>`).join("");
      const timeline = [write(h, ".vc-rep .vc-copy", o.reveals[0]), state(h, ".vc-rep", { borderColor: "#343438" }, { borderColor: "#C8A24B" }, o.reveals[0]), write(h, ".vc-prospect .vc-copy", o.reveals[1]), state(h, ".vc-prospect", { borderColor: "#343438" }, { borderColor: "#C8A24B" }, o.reveals[1]), state(h, ".vc-rep", { borderColor: "#C8A24B" }, { borderColor: "#343438" }, o.reveals[1])].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-video-call { padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:16px;background:#0B0B0D; }
      .pro-video-call .vc-tile { min-width:0;border:2px solid #343438;border-radius:12px;padding:16px; }
      .pro-video-call .vc-portrait { height:136px;display:flex;justify-content:center;align-items:flex-end;border-bottom:2px solid #343438;margin-bottom:12px; }
      .pro-video-call .vc-portrait svg { display:block;width:160px;height:120px;fill:#A8A49C; }
      .pro-video-call .vc-prospect .vc-portrait svg { width:136px;height:102px;fill:#C8A24B; }
      .pro-video-call .vc-copy { font:600 34px/42px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  comment: {
    family: "conversation",
    hint: "Greg quotes a viewer's social comment worth acknowledging; use the exact comment without inventing a username, like count or reply",
    slots: { comment: { kind: "spoken", maxChars: 48, width: 544, size: 36, maxLines: 2 } },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="comment-avatar">${avatar}</div><div class="comment-body"><div class="comment-label">Comment</div><div class="comment-copy">${h.copy(o.slots.comment[0])}</div></div><svg class="comment-heart" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 34 6 21C-5 9 12-2 20 10 28-2 45 9 34 21Z"/></svg>`;
      return { inner, timeline: write(h, ".comment-copy", o.reveals[0]) + "\n" + state(h, ".comment-heart path", { fill: "#0B0B0D" }, { fill: "#C8A24B" }, o.reveals[0]) };
    },
    css: `
      .pro-comment { padding:24px;display:flex;align-items:flex-start;gap:16px;background:#0B0B0D;border-bottom:2px solid #343438; }
      .pro-comment .comment-avatar { width:56px;height:56px;flex:none; }
      .pro-comment .comment-avatar svg { width:100%;height:100%;fill:none;stroke:#A8A49C;stroke-width:2; }
      .pro-comment .comment-body { flex:1;min-width:0; }
      .pro-comment .comment-label { font:700 24px/28px "Inter",sans-serif;color:#A8A49C;margin-bottom:8px; }
      .pro-comment .comment-copy { font:600 36px/44px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-comment .comment-heart { width:40px;height:40px;flex:none;align-self:center;overflow:visible; }
      .pro-comment .comment-heart path { fill:#0B0B0D;stroke:#C8A24B;stroke-width:2;stroke-linejoin:round; }`,
  },
  "crm-note": {
    family: "conversation",
    hint: "Greg dictates the exact note a rep should save about a prospect or follow-up; do not turn general sales advice into a CRM entry",
    slots: { note: { kind: "spoken", maxChars: 56, width: 672, size: 34, maxLines: 2 } },
    size: { w: 720, h: 160 },
    surface: "bone",
    render(o, h) {
      return { inner: `<div class="crm-header"><div>Note</div>${pencil}</div><div class="crm-copy">${h.copy(o.slots.note[0])}</div>`, timeline: write(h, ".crm-copy", o.reveals[0]) };
    },
    css: `
      .pro-crm-note { padding:20px 24px;border-radius:8px; }
      .pro-crm-note .crm-header { height:28px;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font:800 24px/28px "Inter",sans-serif;color:#343438; }
      .pro-crm-note .crm-pencil { width:28px;height:28px;fill:none;stroke:#343438;stroke-width:2;stroke-linejoin:round; }
      .pro-crm-note .crm-copy { font:600 34px/40px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  dialer: {
    family: "conversation",
    hint: "Greg names who to dial or quotes the exact line to use while placing an outbound call; never infer a phone number or add keypad digits",
    slots: { line: { kind: "spoken", maxChars: 48, width: 672, size: 36, maxLines: 2 } },
    size: { w: 720, h: 336 },
    surface: "obsidian",
    render(o, h) {
      // Unmarked keys suggest a dial pad without displaying numbers Greg never said.
      const keys = Array.from({ length: 12 }, (_, i) => `<circle cx="${30 + i % 3 * 60}" cy="${20 + Math.floor(i / 3) * 40}" r="14"/>`).join("");
      const inner = `<div class="dial-copy">${h.copy(o.slots.line[0])}</div><svg class="dial-keys" viewBox="0 0 180 160" aria-hidden="true">${keys}</svg>`;
      const timeline = [write(h, ".dial-copy", o.reveals[0]), state(h, ".dial-keys circle", { fill: "#343438" }, { fill: "#C8A24B" }, o.reveals[0]), state(h, ".dial-keys circle", { fill: "#C8A24B" }, { fill: "#343438" }, h.at(o.reveals[0] + h.motion.state))].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-dialer { padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#0B0B0D; }
      .pro-dialer .dial-copy { width:672px;text-align:center;font:600 36px/44px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-dialer .dial-keys { width:180px;height:160px;flex:none;fill:#343438; }`,
  },
  typing: {
    family: "conversation",
    hint: "Greg supplies the exact short message a rep is composing before sending; use for composing a message, not an already received quote",
    slots: { message: { kind: "spoken", maxChars: 48, width: 656, size: 40, maxLines: 2 } },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      // Crossfade the placeholder on the spoken beat; never delay the words to stage typing.
      const inner = `<div class="typing-stage"><svg class="typing-dots" viewBox="0 0 120 48" aria-hidden="true"><circle cx="20" cy="24" r="9"/><circle cx="60" cy="24" r="9"/><circle cx="100" cy="24" r="9"/></svg><div class="typing-copy">${h.copy(o.slots.message[0])}</div></div>`;
      return { inner, timeline: state(h, ".typing-dots", { opacity: 1 }, { opacity: 0 }, o.reveals[0]) + "\n" + write(h, ".typing-copy", o.reveals[0]) };
    },
    css: `
      .pro-typing { padding:32px;background:#0B0B0D;border-radius:32px 32px 32px 8px; }
      .pro-typing .typing-stage { position:relative;display:flex;align-items:center;height:96px; }
      .pro-typing .typing-dots { position:absolute;left:0;top:24px;width:120px;height:48px;fill:#A8A49C; }
      .pro-typing .typing-copy { position:relative;width:656px;font:600 40px/48px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
  "quick-replies": {
    family: "conversation",
    hint: "Greg quotes an incoming message then two or three possible replies and endorses the last; every chip must be a reply he actually says",
    slots: {
      incoming: { kind: "spoken", maxChars: 48, width: 624, size: 36, maxLines: 2 },
      replies: { kind: "spoken", repeat: [2, 3], maxChars: 18, width: 168, size: 32, maxLines: 2 },
    },
    size: { w: 720, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="qr-incoming">${h.copy(o.slots.incoming[0])}</div><div class="qr-label">Reply options</div><div class="qr-options">${o.slots.replies.map((item, i) => `<div class="qr-chip qr-item-${i}">${h.copy(item)}</div>`).join("")}</div>`;
      return { inner, timeline: [write(h, ".qr-incoming", o.reveals[0]), ...o.slots.replies.map((item, i) => write(h, `.qr-item-${i}`, item.at))].join("\n") };
    },
    css: `
      .pro-quick-replies { padding:24px;display:flex;flex-direction:column;justify-content:center;gap:12px;background:#0B0B0D; }
      .pro-quick-replies .qr-incoming { padding:12px 24px;border-radius:12px;background:#343438;font:600 36px/44px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-quick-replies .qr-label { font:700 24px/28px "Inter",sans-serif;color:#A8A49C; }
      .pro-quick-replies .qr-options { display:flex;gap:12px; }
      .pro-quick-replies .qr-chip { flex:1;min-width:0;display:flex;align-items:center;justify-content:center;padding:10px 22px;border:2px solid #A8A49C;border-radius:24px;text-align:center;font:600 32px/38px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-quick-replies .qr-chip:last-child { border-color:#C8A24B;background:#C8A24B;color:#0B0B0D; }`,
  },
  "call-transcript": {
    family: "conversation",
    hint: "Greg quotes a rep's call line followed by the prospect's exact answer; use a two-speaker transcript only when both turns are spoken",
    slots: {
      rep: { kind: "spoken", maxChars: 44, width: 500, size: 36, maxLines: 2 },
      prospect: { kind: "spoken", maxChars: 44, width: 500, size: 36, maxLines: 2 },
    },
    size: { w: 720, h: 256 },
    surface: "obsidian",
    render(o, h) {
      const inner = ["rep", "prospect"].map((name) => `<div class="ct-row ct-${name}"><div class="ct-label">${name === "rep" ? "Rep" : "Prospect"}</div><div class="ct-copy">${h.copy(o.slots[name][0])}</div></div>`).join("");
      return { inner, timeline: [write(h, ".ct-rep .ct-copy", o.reveals[0]), write(h, ".ct-prospect .ct-copy", o.reveals[1]), state(h, ".ct-prospect .ct-label", { color: "#A8A49C" }, { color: "#C8A24B" }, o.reveals[1])].join("\n") };
    },
    css: `
      .pro-call-transcript { padding:24px;display:flex;flex-direction:column;justify-content:center;gap:24px;background:#0B0B0D;border-radius:8px; }
      .pro-call-transcript .ct-row { display:grid;grid-template-columns:132px 1fr;gap:16px;align-items:start; }
      .pro-call-transcript .ct-label { font:700 24px/32px "Inter",sans-serif;color:#A8A49C;padding-top:6px; }
      .pro-call-transcript .ct-copy { border-left:2px solid #343438;padding-left:22px;font:600 36px/44px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-call-transcript .ct-prospect .ct-copy { border-color:#C8A24B; }`,
  },
  "lock-screen": {
    family: "conversation",
    hint: "Greg quotes one to three incoming notification lines arriving in order; use each exact alert with no invented sender, clock, date or unread count",
    slots: { messages: { kind: "spoken", repeat: [1, 3], maxChars: 48, width: 584, size: 36, maxLines: 2 } },
    size: notificationSize,
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="ls-header"><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M6 12V8a6 6 0 0 1 12 0v4"/><rect x="3" y="12" width="18" height="14" rx="3"/></svg><div>Notifications</div></div><div class="ls-stack">${o.slots.messages.map((item, i) => `<div class="ls-row ls-item-${i}"><div class="ls-icon">${bell}</div><div class="ls-copy">${h.copy(item)}</div></div>`).join("")}</div>`;
      return { inner, timeline: o.slots.messages.map((item, i) => write(h, `.ls-item-${i}`, item.at) + "\n" + write(h, `.ls-item-${i} .ls-copy`, item.at)).join("\n") };
    },
    css: `
      .pro-lock-screen { padding:20px 24px;background:rgba(11,11,13,.92);border-radius:24px;box-shadow:inset 0 0 0 2px #343438; }
      .pro-lock-screen .ls-header { height:24px;display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:16px;font:700 20px/24px "Inter",sans-serif;color:#A8A49C; }
      .pro-lock-screen .ls-header svg { width:20px;height:24px;fill:none;stroke:#A8A49C;stroke-width:2; }
      .pro-lock-screen .ls-stack { display:flex;flex-direction:column;gap:12px; }
      .pro-lock-screen .ls-row { display:flex;align-items:center;gap:16px;min-height:64px;padding:12px 16px;border-radius:16px;background:rgba(168,164,156,.14);opacity:0; }
      .pro-lock-screen .ls-icon { width:40px;height:40px;flex:none;border-radius:10px;background:#343438; }
      .pro-lock-screen .ls-icon svg { width:40px;height:40px;fill:none;stroke:#C8A24B;stroke-width:2;stroke-linecap:round;stroke-linejoin:round; }
      .pro-lock-screen .ls-copy { flex:1;min-width:0;font:600 36px/44px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }`,
  },
};

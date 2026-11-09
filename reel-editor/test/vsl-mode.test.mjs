import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadPreset } from "../src/presets.mjs";
import { planCuts, remapWords } from "../src/cuts.mjs";
import { brandPreset } from "../src/brandkit.mjs";
import { clientPaths, clientEnv } from "../src/clients.mjs";
import { vslChapters } from "../src/vsl-chapters.mjs";
import { PKG_ROOT } from "../src/util.mjs";

const words = (text, start = 1) => text.split(" ").map((text, i) => ({ text, start: start + i * 0.4, end: start + i * 0.4 + 0.25 }));

test("VSL is calm, landscape, captioned, script-only and keeps all closing words with a source hold", () => {
  const p = loadPreset("vsl");
  assert.equal(p.canvas, "landscape");
  assert.equal(p.captions.enabled, true);
  assert.equal(p.captions.uppercase, false);
  assert.equal(p.captions.animation, "cut");
  assert.equal(p.captions.annotate, false);
  assert.equal(p.captions.maxKeywordsPerLine, 0);
  assert.equal(p.cuts.signOff, false);
  assert.equal(p.graphics.mode, "overlay");
  assert.equal(p.graphics.scriptOnly, true);
  assert.equal(p.graphics.enabled, false);
  assert.equal(p.graphics.clearStart, 2);
  for (const key of ["hook", "zooms", "broll", "slams", "icons", "coldOpen", "lowerThird", "cta", "cover", "signature", "houseLooks"]) assert.equal(p[key].enabled, false, key);
  assert.equal(p.zooms.cadence.enabled, false);
  assert.equal(p.motion.impact.enabled, false);
  assert.equal(p.motion.drift.enabled, false);
  assert.equal(p.audio.music, null);
  assert.equal(p.audio.sounds, false);
  assert.equal(p.preflight.enabled, true);
  const w = words("Choose the next step. Thanks for watching");
  const cuts = planCuts(w, 10, p.cuts);
  assert.deepEqual(remapWords(cuts.words, cuts.segments).map((w) => w.text), w.map((w) => w.text));
  assert.equal(cuts.segments.at(-1).end, w.at(-1).end + 2);
  assert.ok(!cuts.removed.some((r) => r.reason === "sign-off"));
  const defaultCuts = planCuts(w, 10, { badTakes: false, fillers: false });
  assert.ok(defaultCuts.words.slice(-3).every((w) => w.drop === "sign-off"), "default sign-off detection is unchanged");
  for (const preset of ["clean", "youtube", "pingel-brand"]) assert.notEqual(loadPreset(preset).cuts.signOff, false, preset);
});

test("VSL retakes are removed, natural pauses stay, trimmed pauses keep breath and short sources clamp the hold", () => {
  const p = loadPreset("vsl");
  const w = [...words("We can help", 0.5), ...words("We can help you.", 2), ...words("Keep this breath.", 4.35), ...words("Book the call.", 9)];
  const cuts = planCuts(w, 13, p.cuts);
  assert.ok(cuts.words.slice(0, 3).every((w) => w.drop === "bad-take"));
  const mapped = remapWords(cuts.words, cuts.segments);
  const last = mapped.findIndex((w) => w.text === "Book");
  assert.ok(mapped[last].start - mapped[last - 1].end >= 0.35);
  assert.ok(cuts.segments.some((s) => s.start <= 3.45 && s.end >= 4.35), "a pause of less than 1 second stays natural");
  const duration = w.at(-1).end + 0.4;
  assert.ok(Math.abs(planCuts(w, duration, p.cuts).segments.at(-1).end - duration) < 0.001);
});

test("VSL carries only the active client's colors, fonts and brand tokens into its calm preset", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vsl-brand-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, "preset.json");
  fs.writeFileSync(file, JSON.stringify(brandPreset({ name: "Fictional Company", handle: "@fictional", colors: { text: "#F0F0F0", accent: "#123456" } }, { fonts: { display: "fonts/Display.ttf", body: "fonts/Body.ttf" } })));
  const script = `import {loadPreset} from ${JSON.stringify(new URL("../src/presets.mjs", import.meta.url).href)}; console.log(JSON.stringify(loadPreset('vsl')))`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, REEL_PRESET: file, REEL_CLIENT: "Fictional Company", REEL_CLIENT_MODE: "1" } });
  assert.equal(result.status, 0, result.stderr);
  const p = JSON.parse(result.stdout);
  assert.equal(p.name, "vsl");
  assert.equal(p.colors.accent, "#123456");
  assert.equal(p.fonts.body, path.join(home, "fonts/Body.ttf"));
  assert.equal(p.brand.identity.name, "Fictional Company");
  assert.equal(p.lowerThird.name, "");
  assert.equal(p.carousel.handle, "");
  assert.equal(p.hook.enabled, false);
  assert.equal(p.cuts.signOff, false);
  assert.equal(p.captions.uppercase, false);
  assert.equal(p.captions.maxKeywordsPerLine, 0);
  assert.doesNotMatch(JSON.stringify(p), /officialgregpingel|Greg Pingel|C8A24B/);
});

test("chapters use finished section times, ids and titles in order", () => {
  assert.equal(vslChapters({ sections: [{ id: "S6b", title: "Next step", start: 125.9, end: 140 }, { id: "S1", title: "Opening", start: 0, end: 20 }, { id: "S2", title: "The offer", start: 63.2, end: 90 }] }), "00:00 S1 Opening\n01:03 S2 The offer\n02:05 S6b Next step\n");
});

function dropFixture(t, { matched = false, chapters = matched, client = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vsl-drops-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, ".local/bin"); fs.mkdirSync(bin, { recursive: true });
  const stub = (name, code) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${code}\n`, { mode: 0o755 });
  stub("node", `exec '${process.execPath}' "$@"`);
  stub("osascript", "exit 0");
  stub("df", 'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nvolume 40000000 20000000 20000000 50%% /\\n"');
  stub("claude", 'echo must-not-run >> "$HOME/claude-calls"; exit 1');
  stub("reel", `printf '%s\\n' "$@" >> "$HOME/reel-calls"
work="$4"; name="$6"; mkdir -p "$work/renders"
echo synthetic > "$work/renders/$name.mp4"
${chapters ? `printf '%s' '[{"id":"S1","title":"Opening","start":0,"end":65},{"id":"S6b","title":"Next step","start":65.2,"end":90}]' > "$work/vsl-sections.json"` : ""}
`);
  const root = path.join(home, "Reels"), done = path.join(home, "Delivered");
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, REEL_WATCH_ROOT: root, REEL_WATCH_DONE: done, REEL_WATCH_FAST: "1", REEL_WATCH_PRUNE_DAYS: "0", REEL_WATCH_CAPTION: "1", REEL_WATCH_CTA: "Wrong reel CTA" };
  let raw = path.join(root, "raw-vsl"), delivered = done;
  if (client) {
    const p = clientPaths({ name: "Fictional Client" }, { REEL_CLIENTS: path.join(root, "clients"), REEL_CLIENTS_DESKTOP: path.join(home, "Client Desktop") });
    fs.mkdirSync(p.root, { recursive: true });
    fs.writeFileSync(p.env, clientEnv({ name: "Fictional Client", cta: "Client reel CTA" }, p));
    raw = path.join(p.root, "raw-vsl"); delivered = p.desktop;
  }
  fs.mkdirSync(raw, { recursive: true });
  const input = path.join(raw, "take 1 #vsl-2026-sample-offer #fast #v2 #credit__Wrong hook.mov");
  fs.writeFileSync(input, "original");
  fs.mkdirSync(path.join(root, "music"), { recursive: true });
  fs.writeFileSync(path.join(root, "music/calm.mp3"), "dummy");
  let script = null;
  if (matched) {
    script = path.join(home, "Clients/fictional/vsl/projects/2026-sample-offer/04-script/script.v001.md");
    fs.mkdirSync(path.dirname(script), { recursive: true }); fs.writeFileSync(script, "## S1 Opening\nSAY: Synthetic words.\n");
  }
  const run = () => spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts/watch-folder.sh")], { env, encoding: "utf8", timeout: 30000 });
  return { home, root, env, raw, input, script, delivered, run };
}

for (const client of [false, true]) for (const matched of [false, true]) {
  test(`VSL drops render once and deliver ${matched ? "chapters" : "a missing-script note"} (${client ? "client" : "Greg"})`, (t) => {
    const f = dropFixture(t, { client, matched });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(path.join(f.home, "reel-calls"), "utf8").trim().split("\n");
    assert.equal(calls.filter((a) => a === "edit").length, 1);
    assert.deepEqual(calls.slice(6, 10), ["--preset", "vsl", "--canvas", "landscape"]);
    assert.deepEqual(calls.slice(10), matched ? ["--script", f.script] : []);
    assert.equal(fs.existsSync(path.join(f.home, "claude-calls")), false);
    const folders = fs.readdirSync(f.delivered).filter((n) => /^\d{4}-\d{2}-\d{2} VSL 1$/.test(n));
    assert.equal(folders.length, 1);
    const dest = path.join(f.delivered, folders[0]);
    assert.equal(fs.readdirSync(dest).filter((f) => f.endsWith(".mp4")).length, 1);
    if (matched) assert.equal(fs.readFileSync(path.join(dest, "chapters.txt"), "utf8"), "00:00 S1 Opening\n01:05 S6b Next step\n");
    else assert.match(fs.readFileSync(path.join(dest, "No script found.txt"), "utf8"), /#vsl-2026-sample-offer/);
    assert.equal(fs.readFileSync(f.input, "utf8"), "original");
    assert.equal(f.run().status, 0);
    assert.equal(fs.readFileSync(path.join(f.home, "reel-calls"), "utf8").trim().split("\n").filter((a) => a === "edit").length, 1);
  });
}

test("a matched script without section timings delivers the video without stale chapters", (t) => {
  const f = dropFixture(t, { matched: true, chapters: false });
  const work = path.join(f.root, "videos/take-1-2026-sample-offer-2-vsl");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "vsl-sections.json"), '[{"id":"S9","title":"Stale","start":0}]');
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  const dest = path.join(f.delivered, fs.readdirSync(f.delivered)[0]);
  assert.deepEqual(fs.readdirSync(dest), ["take-1-2026-sample-offer-2-vsl.mp4"]);
});

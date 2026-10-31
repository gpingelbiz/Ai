import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { speakerConfig, speakerSlug, safeName, assertSpeakerBrand, manifestSkeleton, speakerPlist, speakerClients, speakerHelp } from "../scripts/speaker-client.mjs";
import { contractRows, versionRecord, planState, speakerStatus, writeSpeakerStatus, intakeSnapshot } from "../scripts/speaker-status.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = (name) => path.join(repo, "scripts", name);
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "speaker desktop "));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, SPEAKER_HOME: home, SPEAKER_CLIENTS_ROOT: path.join(home, "clients & reels"), SPEAKER_DESKTOP_ROOT: path.join(home, "Desktop/Speaker Reels"), SPEAKER_AGENT_DIR: path.join(home, "agents"), SPEAKER_LAUNCHCTL: "/usr/bin/true", SPEAKER_STABLE_SECONDS: "0.03", SPEAKER_STABLE_ATTEMPTS: "10", CALLS: path.join(home, "calls.jsonl") };
  const fake = path.join(home, "reel");
  fs.writeFileSync(fake, `#!${process.execPath}\nimport fs from 'node:fs';\nconst a=process.argv.slice(2);\nif(a.includes('--help')) { console.log(process.env.FAKE_HELP ?? 'reel speaker init index --add-new --draft'); process.exit(process.env.FAKE_MISSING ? 1 : 0); }\nfs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\\n');\nif(process.env.FAKE_FAIL && a.includes(process.env.FAKE_FAIL)) process.exit(1);\n`);
  // Extensionless executable is ESM under Node 22's syntax detection.
  fs.chmodSync(fake, 0o755); env.PATH = home + path.delimiter + process.env.PATH;
  // The full path: the watcher puts /opt/homebrew/bin first, where the Mac Mini has the real reel installed.
  env.SPEAKER_REEL = fake;
  const config = speakerConfig(env), folder = path.join(config.root, "julee-gracey");
  const brand = path.join(home, "brand.json"); fs.writeFileSync(brand, JSON.stringify({ identity: { name: "Julee Gracey" }, colors: { accent: "#123456" } }));
  const run = (name, args = [], extra = {}) => spawnSync(name.endsWith(".sh") ? "/bin/bash" : process.execPath, [script(name), ...args], { env: { ...env, ...extra }, encoding: "utf8", timeout: 20000 });
  const add = () => { const r = run("speaker-client.mjs", ["add", "Julee Gracey", "--brand", brand]); assert.equal(r.status, 0, r.stdout + r.stderr); return r; };
  const put = (rel, value) => { const f = path.join(folder, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof value === "string" ? value : JSON.stringify(value)); return f; };
  const calls = () => fs.existsSync(env.CALLS) ? fs.readFileSync(env.CALLS, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  return { home, env, config, folder, brand, run, add, put, calls };
}
const ok = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);

test("speaker paths, names, brand isolation and manifest skeleton", () => {
  const c = speakerConfig({ HOME: "/tmp/home", SPEAKER_CLIENTS_ROOT: "/tmp/custom" });
  assert.equal(c.root, "/tmp/custom"); assert.equal(c.desktop, "/tmp/home/Desktop/Reels/Speaker Reels");
  assert.equal(speakerSlug("Jülée Gracey!"), "julee-gracey");
  assert.equal(safeName(" Julee "), "Julee");
  for (const name of ["../outside", "..", "a\\b", "a\nb"]) assert.throws(() => safeName(name));
  assert.throws(() => speakerSlug("!!!"));
  for (const identity of ["Greg Pingel", "officialgregpingel", "PINGEL", "nested pingel value"]) assert.throws(() => assertSpeakerBrand({ nested: { identity } }), /Refusing/);
  for (const b of [null, [], "brand"]) assert.throws(() => assertSpeakerBrand(b));
  assert.equal(assertSpeakerBrand({ name: "Julee" }).name, "Julee");
  const m = manifestSkeleton("Julee", "julee", "/brand.json");
  assert.equal(m.schemaVersion, 1); assert.equal(m.identity.name, "Julee"); assert.equal(m.brand.file, "/brand.json");
  for (const key of ["sources", "proof", "rights", "music"]) assert.deepEqual(m[key], []);
});

test("client dry run has no layout side effects; real setup, refresh, list and remove preserve originals", (t) => {
  const f = fixture(t);
  const r = f.run("speaker-client.mjs", ["add", "Julee Gracey", "--brand", f.brand, "--dry-run"]); ok(r);
  assert.match(r.stdout, /Would link 1 Drop footage here/); assert.match(r.stdout, /com.pingel.speaker-watch/); assert.match(r.stdout, /work\/plans/);
  assert.equal(fs.existsSync(f.config.root), false); assert.deepEqual(f.calls(), []);
  f.add();
  const desktop = path.join(f.config.desktop, "Julee Gracey");
  for (const [label, target] of [["1 Drop footage here", "footage"], ["2 Drop proof here", "proof"], ["3 Music", "music"], ["4 Drafts to review", "review"], ["5 Final", "final"]]) assert.equal(fs.readlinkSync(path.join(desktop, label)), path.join(f.folder, target));
  for (const p of ["proof/testimonials", "proof/logos", "proof/press", "proof/photos", "work/plans", "review", "final"]) assert.ok(fs.statSync(path.join(f.folder, p)).isDirectory());
  for (const p of ["START HERE.txt", "Status.txt"]) assert.ok(fs.lstatSync(path.join(desktop, p)).isFile());
  assert.match(fs.readFileSync(path.join(desktop, "START HERE.txt"), "utf8"), /Nothing is ever posted automatically/);
  const original = f.put("footage/talk original.mov", "real original");
  const manifest = JSON.parse(fs.readFileSync(path.join(f.folder, "speaker-manifest.json"))); manifest.sources.push({ id: "talk", path: "footage/talk original.mov" }); f.put("speaker-manifest.json", manifest);
  f.add(); assert.equal(JSON.parse(fs.readFileSync(path.join(f.folder, "speaker-manifest.json"))).sources.length, 1);
  assert.match(f.run("speaker-client.mjs", ["list"]).stdout, /Julee Gracey.*Status:/);
  ok(f.run("speaker-client.mjs", ["remove", "Julee Gracey", "--dry-run"])); assert.ok(fs.existsSync(desktop));
  ok(f.run("speaker-client.mjs", ["remove", "Julee Gracey"]));
  assert.equal(fs.existsSync(desktop), false); assert.equal(fs.readFileSync(original, "utf8"), "real original");
  assert.equal(speakerClients(f.config, { activeOnly: true }).length, 0);
  assert.equal(speakerClients(f.config).length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(f.config.agents, "com.pingel.speaker-watch.plist"), "utf8"), /<string>[^<]*julee-gracey\/footage/);
  f.add(); assert.equal(speakerClients(f.config, { activeOnly: true }).length, 1);
});

test("client fallback with missing CLI, Greg brand refusal and unsafe slug", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.brand, '{"name":"Greg Pingel"}');
  const bad = f.run("speaker-client.mjs", ["add", "Julee", "--brand", f.brand]); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /Refusing/);
  fs.writeFileSync(f.brand, '{"name":"Julee"}');
  assert.notEqual(f.run("speaker-client.mjs", ["add", "Julee", "--brand", f.brand, "--slug", "../../oops"]).status, 0);
  ok(f.run("speaker-client.mjs", ["add", "Julee Gracey", "--brand", f.brand], { FAKE_MISSING: "1" }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.folder, "speaker-manifest.json"))).identity.name, "Julee Gracey");
  assert.equal(speakerHelp({ reel: "/no/such/reel" }), "");
});

test("plist XML escapes roots, rebuilds active watches, and installer dry run lints without launchctl", (t) => {
  const f = fixture(t); f.add();
  const text = speakerPlist(f.config, [f.folder], { SPEAKER_STABLE_SECONDS: "0.02" });
  assert.match(text, /clients &amp; reels/); assert.match(text, /<integer>900<\/integer>/); assert.match(text, /<integer>30<\/integer>/); assert.match(text, /<key>RunAtLoad<\/key><false\/>/);
  const plist = path.join(f.home, "test.plist"); fs.writeFileSync(plist, text);
  const lint = spawnSync("plutil", ["-lint", "--", plist], { encoding: "utf8" });
  if (!lint.error) assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  const r = f.run("install-speaker-watch.sh", ["--dry-run"], { SPEAKER_LAUNCHCTL: "/does/not/exist" }); ok(r); assert.match(r.stdout, /work\/plans/); assert.match(r.stderr, /dry run/);
  ok(f.run("install-speaker-watch.sh", ["--uninstall", "--dry-run"]));
  assert.ok(fs.existsSync(path.join(f.config.agents, "com.pingel.speaker-watch.plist")));
  ok(f.run("install-speaker-watch.sh", ["--uninstall"])); assert.equal(fs.existsSync(path.join(f.config.agents, "com.pingel.speaker-watch.plist")), false);
});

test("watcher runs init, index, draft in order, caches intake and only rebuilds a newer plan", (t) => {
  const f = fixture(t); f.add(); fs.writeFileSync(f.env.CALLS, "");
  f.put("footage/a talk.mov", "a"); const plan = f.put("work/plans/full.json", { schemaVersion: 1, version: "full", revision: 1, items: [] });
  ok(f.run("speaker-watch.sh"));
  assert.deepEqual(f.calls(), [["speaker", "init", f.folder, "--add-new"], ["speaker", "index", f.folder], ["speaker", f.folder, "--version", "full", "--draft"]]);
  ok(f.run("speaker-watch.sh")); assert.equal(f.calls().length, 3);
  fs.utimesSync(plan, new Date(), new Date(Date.now() + 1000));
  ok(f.run("speaker-watch.sh")); assert.equal(f.calls().length, 4); assert.equal(f.calls().at(-1).at(-1), "--draft");
  assert.ok(fs.readFileSync(path.join(f.folder, "watch.log"), "utf8").split("\n").some((s) => /intake unchanged/.test(s)));
  assert.match(fs.readFileSync(path.join(f.config.desktop, "Julee Gracey/Status.txt"), "utf8"), /Nothing is posted automatically/);
  assert.equal(fs.existsSync(path.join(f.home, "Reels/publish")), false);
});

test("watcher lock, stale takeover, dry run and unavailable steps", (t) => {
  const f = fixture(t); f.add(); fs.writeFileSync(f.env.CALLS, "");
  const lock = path.join(f.config.root, ".speaker-watch.lock"); fs.mkdirSync(lock);
  assert.match(f.run("speaker-watch.sh").stdout, /busy/); assert.deepEqual(f.calls(), []);
  fs.utimesSync(lock, new Date(0), new Date(0));
  ok(f.run("speaker-watch.sh")); assert.equal(fs.existsSync(lock), false); assert.equal(f.calls().length, 2);
  const plan = f.put("work/plans/full.json", { version: "full", items: [] });
  const before = fs.readFileSync(path.join(f.folder, "watch.log"), "utf8");
  ok(f.run("speaker-watch.sh", ["--dry-run"])); assert.equal(fs.readFileSync(path.join(f.folder, "watch.log"), "utf8"), before);
  fs.writeFileSync(f.env.CALLS, "");
  ok(f.run("speaker-watch.sh", [], { FAKE_MISSING: "1" })); assert.deepEqual(f.calls(), []);
  const log = fs.readFileSync(path.join(f.folder, "watch.log"), "utf8"); for (const step of ["init skipped", "index skipped", "draft full skipped"]) assert.match(log, new RegExp(step));
  assert.ok(fs.existsSync(plan));
});

test("watcher retries size stability and blocks indexing/drafts while files are growing", async (t) => {
  const f = fixture(t); f.add(); fs.writeFileSync(f.env.CALLS, ""); const source = f.put("footage/growing.mov", "a");
  const run = spawn("/bin/bash", [script("speaker-watch.sh")], { env: { ...f.env, SPEAKER_STABLE_SECONDS: "0.2", SPEAKER_STABLE_ATTEMPTS: "3" }, stdio: "ignore" });
  const timer = setInterval(() => fs.appendFileSync(source, "more"), 25);
  const code = await new Promise((resolve) => run.on("close", resolve)); clearInterval(timer);
  assert.equal(code, 0); assert.deepEqual(f.calls(), []); assert.match(fs.readFileSync(path.join(f.folder, "watch.log"), "utf8"), /still changing/);
  ok(f.run("speaker-watch.sh")); assert.equal(f.calls().length, 2);
  const snap = intakeSnapshot(f.folder); f.put("proof/nested/a, (b).png", "photo"); assert.notEqual(intakeSnapshot(f.folder), snap);
  ok(f.run("speaker-watch.sh", [], { FAKE_FAIL: "init" })); assert.equal(f.calls().at(-1)[1], "init");
});

test("status handles empty contract, index, rights, candidates, revisions, approvals and delivery", (t) => {
  const f = fixture(t); f.add();
  assert.match(speakerStatus(f.folder), /0 files; 0.00 hours indexed; 0 transcribed/); assert.match(speakerStatus(f.folder), /not yet/);
  const m = manifestSkeleton("Julee Gracey", "julee-gracey", f.brand); m.sources = [{ id: "talk", path: "footage/talk.mov", audio: "ok", rights: "r1" }]; m.proof = [{ id: "sonia", attribution: { name: "Sonia" }, rights: "r2" }]; m.rights = [{ id: "r1", status: "pending" }];
  f.put("speaker-manifest.json", m); f.put("work/index/talk.json", { sourceId: "talk", probe: { duration: 7200 }, words: [{ text: "Hi" }] });
  f.put("work/candidates/all.json", { candidates: [{ id: "c1" }, { id: "c2" }] });
  f.put("work/plans/full.json", { version: "full", revision: 2 }); f.put("work/full/plan.resolved.json", { version: "full", revision: 2 });
  f.put("review/review.json", { versions: { full: { state: "revision", revision: 2 } } });
  let status = speakerStatus(f.folder); for (const re of [/2.00 hours/, /1 transcribed/, /Rights waiting: 2/, /talk.mov \(pending\)/, /Sonia \(unknown\)/, /Candidates found: 2/, /revision requested/]) assert.match(status, re);
  f.put("review/review.json", { versions: [{ version: "full", status: "approved", revision: 2 }] }); assert.match(writeSpeakerStatus(f.folder, { config: f.config }), /approved/);
  f.put("final/manifest.json", { versions: { full: { status: "delivered", revision: 2 } } }); assert.match(speakerStatus(f.folder), /delivered/);
  const p = path.join(f.folder, "work/plans/full.json"); fs.utimesSync(p, new Date(), new Date(Date.now() + 1000)); assert.match(speakerStatus(f.folder), /plan changed; awaiting draft/);
  assert.match(f.run("speaker-status.mjs", [f.folder, "--dry-run"]).stdout, /Julee Gracey/);
  assert.deepEqual(contractRows(null, ["items"]), []); assert.deepEqual(contractRows({ items: [1] }, ["items"]), [1]); assert.deepEqual(contractRows([1], []), [1]); assert.deepEqual(contractRows({ id: 1 }, []), [{ id: 1 }]);
  assert.deepEqual(versionRecord([{ version: "full" }], "full"), { version: "full" }); assert.equal(versionRecord(null, "full"), null); assert.equal(versionRecord({ version: "short" }, "full"), null);
  assert.equal(planState({}, null), "not yet drafted"); assert.equal(planState({ revision: 2 }, { revision: 1 }), "revision 2 awaiting draft");
  assert.equal(planState({ revision: 2 }, { revision: 2 }, { status: "approved", revision: 1 }), "draft, revision 2");
});

function zip(file, entries) {
  execFileSync("python3", ["-c", "import zipfile,json,sys\nwith zipfile.ZipFile(sys.argv[1], 'w', allowZip64=True) as z:\n for name,data in json.loads(sys.argv[2]):\n  with z.open(name, 'w', force_zip64=True) as out: out.write(data.encode())", file, JSON.stringify(entries)]);
}
test("ZIP64 import routes proof and footage with spaces, commas and parentheses; filters and dry run", (t) => {
  const f = fixture(t), archive = path.join(f.home, "client footage, (originals).zip");
  zip(archive, [["Event (2025)/Talk, main (1).mov", "talk"], ["Event/testimonials/Sonia, (CEO).mp4", "testimonial"], ["Event/logos/Logo (1).png", "logo"], ["Event/press/Magazine.pdf", "press"], ["Event/Screenshot, (1).png", "shot"], ["Event/photo portraits/Headshot.jpg", "photo"], ["Event/Audio.wav", "audio"], ["Event/raw.CR2", "raw"], ["__MACOSX/._talk.mov", "junk"], ["Event/.DS_Store", "junk"], ["Event/notes.txt", "notes"]]);
  const dry = f.run("speaker-import.sh", [archive, f.folder, "--dry-run"]); ok(dry); assert.match(dry.stdout, /would extract/); assert.equal(fs.existsSync(f.folder), false);
  const imported = f.run("speaker-import.sh", [pathToFileURL(archive).href, f.folder]); ok(imported);
  for (const [rel, data] of [["footage/Event (2025)/Talk, main (1).mov", "talk"], ["footage/Event/Audio.wav", "audio"], ["proof/testimonials/Event/Sonia, (CEO).mp4", "testimonial"], ["proof/logos/Event/Logo (1).png", "logo"], ["proof/press/Event/Magazine.pdf", "press"], ["proof/press/Event/Screenshot, (1).png", "shot"], ["proof/photos/Event/photo portraits/Headshot.jpg", "photo"]]) assert.equal(fs.readFileSync(path.join(f.folder, rel), "utf8"), data);
  assert.match(imported.stdout, /skipped: 4/); assert.ok(fs.existsSync(archive)); assert.equal(fs.existsSync(path.join(f.folder, "footage/Event/raw.CR2")), false);
  assert.match(f.run("speaker-import.sh", [archive, f.folder]).stdout, /already exists \(kept original\)/);
  const other = path.join(f.home, "filtered");
  const filtered = f.run("speaker-import.sh", [archive, other, "--include", "*.mov", "--include", "*.wav", "--exclude", "*Audio*", "--delete-zip"]); ok(filtered);
  assert.ok(fs.existsSync(path.join(other, "footage/Event (2025)/Talk, main (1).mov"))); assert.equal(fs.existsSync(path.join(other, "footage/Event/Audio.wav")), false); assert.equal(fs.existsSync(archive), false);
});

test("import refuses ZIP traversal and symlink destinations without writing outside client", (t) => {
  const f = fixture(t), archive = path.join(f.home, "bad.zip"); zip(archive, [["../escape.mov", "bad"]]);
  const bad = f.run("speaker-import.sh", [archive, f.folder]); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /Unsafe ZIP entry/); assert.equal(fs.existsSync(path.join(f.home, "escape.mov")), false);
  zip(archive, [["talk.mov", "bad"]]); fs.mkdirSync(f.folder, { recursive: true }); const outside = path.join(f.home, "outside"); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(f.folder, "footage"));
  const link = f.run("speaker-import.sh", [archive, f.folder]); assert.notEqual(link.status, 0); assert.match(link.stderr, /symlink destination/); assert.deepEqual(fs.readdirSync(outside), []);
});


test("failed drafts retry even if compilation wrote a resolved plan", (t) => {
  const f = fixture(t); f.add(); fs.writeFileSync(f.env.CALLS, "");
  f.put("work/plans/full.json", { version: "full", revision: 1 });
  f.put("work/full/plan.resolved.json", { version: "full", revision: 1 });
  ok(f.run("speaker-watch.sh", [], { FAKE_FAIL: "--draft" }));
  assert.equal(fs.existsSync(path.join(f.folder, "work/full/.speaker-watch-draft")), false);
  assert.equal(f.calls().filter((c) => c.includes("--draft")).length, 1);
  ok(f.run("speaker-watch.sh"));
  assert.equal(f.calls().filter((c) => c.includes("--draft")).length, 2);
  assert.ok(fs.existsSync(path.join(f.folder, "work/full/.speaker-watch-draft")));
});

test("Dropbox imports retry from zero with byte counts and retain the ZIP; remote dry run never downloads", (t) => {
  const f = fixture(t), archive = path.join(f.home, "download-source.zip"); zip(archive, [["Original, (A).mov", "original"]]);
  const fakeCurl = path.join(f.home, "curl"), attempts = path.join(f.home, "curl-count");
  fs.writeFileSync(fakeCurl, `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2), out=args[args.indexOf('--output')+1];
const count=Number(fs.existsSync(process.env.CURL_COUNT)?fs.readFileSync(process.env.CURL_COUNT,'utf8'):0)+1;
fs.writeFileSync(process.env.CURL_COUNT,String(count));
if(fs.statSync(out).size!==0) process.exit(9);
if(count<3) { fs.writeFileSync(out,'partial'); process.exit(1); }
if(!args.includes('--location') || !args.at(-1).includes('dl=1') || args.at(-1).includes('dl=0')) process.exit(8);
fs.copyFileSync(process.env.CURL_ZIP,out);
`); fs.chmodSync(fakeCurl, 0o755);
  const env = { SPEAKER_CURL: fakeCurl, CURL_COUNT: attempts, CURL_ZIP: archive };
  const args = ["https://www.dropbox.com/scl/fo/example?rlkey=example&dl=0", f.folder];
  const dry = f.run("speaker-import.sh", [...args, "--dry-run"], env); ok(dry); assert.equal(fs.existsSync(attempts), false); assert.equal(fs.existsSync(f.folder), false);
  const r = f.run("speaker-import.sh", args, env); ok(r);
  assert.equal(fs.readFileSync(attempts, "utf8"), "3"); assert.match(r.stdout, /attempt 1: 7 bytes received/); assert.match(r.stdout, /attempt 3:/);
  assert.equal(fs.readFileSync(path.join(f.folder, "footage/Original, (A).mov"), "utf8"), "original");
  assert.equal(fs.readdirSync(path.join(f.folder, "work/imports")).filter((p) => p.endsWith(".zip")).length, 1);
  ok(f.run("speaker-import.sh", args, env)); assert.equal(fs.readFileSync(attempts, "utf8"), "3");
});

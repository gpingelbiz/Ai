import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { personalizeStartHere, personalizeSetupGuide } from "../src/brandkit.mjs";
import { copyApp } from "../scripts/release.mjs";
import { fileHash } from "../src/release.mjs";
import { PKG_ROOT } from "../src/util.mjs";

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "firstopen-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(file, body, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
}
function run(cmd, args, env) {
  return spawnSync(cmd, args, { cwd: PKG_ROOT, env, encoding: "utf8" });
}
function kitAt(root, studio) {
  const kit = path.join(root, `Zack and Kat's "Reels" $kit`);
  fs.mkdirSync(path.join(kit, "Brand"), { recursive: true });
  const name = studio ? "Install Reels" : "Install Reel Editor";
  fs.copyFileSync(path.join(PKG_ROOT, "kit", `${name}.command`), path.join(kit, `${name}.command`));
  put(path.join(kit, "release.json"), "{}");
  for (const file of ["my-brand.json", "brand.json"]) put(path.join(kit, "Brand", file), "{}");
  return { kit, name };
}
function signingTools(t, { identity = true, profile = true, accepted = true, fail = "" } = {}) {
  const root = temporary(t), bin = path.join(root, "bin"), log = path.join(root, "calls.jsonl");
  const fake = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const tool = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({tool, args}) + '\\n');
if (tool === 'security') console.log(${JSON.stringify(identity ? '  1) ABCDEF "Developer ID Application: Test (TEAM)"\n  1 valid identities found' : '  0 valid identities found')});
if (tool === 'xcrun' && args[0] === 'notarytool') {
  if (args[1] === 'history') process.exit(${profile ? 0 : 1});
  console.log(${JSON.stringify(JSON.stringify({ status: accepted ? "Accepted" : "Invalid" }))});
}
if (tool === 'osacompile') {
  const app = args[args.indexOf('-o') + 1];
  fs.mkdirSync(app, {recursive: true});
  fs.copyFileSync(args.at(-1), path.join(app, 'source.applescript'));
}
if (tool === 'codesign' && args.includes('--entitlements')) fs.copyFileSync(args[args.indexOf('--entitlements') + 1], path.join(args.at(-1), 'signed-entitlements.plist'));
if (tool === 'ditto') {
  if (args.includes('--norsrc')) execFileSync('/usr/bin/ditto', args);
  else fs.writeFileSync(args.at(-1), 'fake zip');
}
if (tool === ${JSON.stringify(fail)}) process.exit(1);
`;
  for (const tool of ["security", "xcrun", "codesign", "osacompile", "plutil", "ditto", "spctl"]) put(path.join(bin, tool), fake, 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log, REEL_NOTARY_PROFILE: "reel saved profile" };
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [];
  return { root, env, calls };
}

for (const studio of [false, true]) {
  test(`guides lead with Terminal and illustrate the matching Install file: studio=${studio}`, () => {
    for (const [file, personalize] of [["Start Here.html", personalizeStartHere], ["Setup Guide.html", personalizeSetupGuide]]) {
      const html = fs.readFileSync(path.join(PKG_ROOT, "kit", file), "utf8");
      for (const page of [html, personalize(html, { name: `Zack & Kat's "Reels"` }, { studio })]) {
        const text = page.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
        assert.match(text, /Open Terminal \(Applications, Utilities\)\./);
        assert.match(text, /Type bash and a space\./);
        assert.match(text, /Drag Install .*?\.command from the kit folder into the Terminal window\./);
        assert.match(text, /Press Return\./);
        assert.ok(text.indexOf("Type bash") < text.indexOf("You can also double click"));
        assert.match(text, /never change your security settings/i);
        assert.doesNotMatch(page, /Open Anyway|Privacy\s*(?:&amp;|&)\s*Security|password/i);
        assert.match(page, /<figure class="terminal-picture"/);
        assert.doesNotMatch(page, /<img\b/);
      }
      const page = personalize(html, { name: "Zack and Kat Straughn" }, { studio });
      assert.match(page, studio ? /Install Reels\.app/ : /Install Reel Editor\.app/);
      if (studio) assert.doesNotMatch(page, /Install Reel Editor\.(app|command)/);
    }
  });

  test(`Terminal launcher preserves exact paths and arguments with quotes: studio=${studio}`, (t) => {
    const root = temporary(t), { kit, name } = kitAt(root, studio), log = path.join(root, "args");
    put(path.join(kit, "install.sh"), '#!/bin/bash\nprintf "%s\\0" "$@" > "$ARGS_FILE"\nexit 23\n');
    const result = run("/bin/bash", [path.join(kit, `${name}.command`)], { ...process.env, HOME: root, TERM: "dumb", ARGS_FILE: log });
    assert.equal(result.status, 23);
    assert.match(result.stdout, /This works the same when started from Terminal\./);
    assert.deepEqual(fs.readFileSync(log, "utf8").split("\0").slice(0, -1), ["--brand", path.join(kit, "Brand"), ...(studio ? ["--studio"] : []), "--release", path.join(kit, "release.json")]);
  });

  test(`signed app is compiled, signed, notarized, stapled and assessed: studio=${studio}`, (t) => {
    const { root, env, calls } = signingTools(t), { kit, name } = kitAt(root, studio);
    put(path.join(kit, "install.sh"), "unused");
    const result = run("/bin/bash", ["scripts/make-installer-app.sh", kit], env);
    assert.equal(result.status, 0, result.stderr);
    const app = path.join(kit, `${name}.app`);
    assert.ok(fs.existsSync(app));
    const c = calls();
    assert.deepEqual(c.map(x => [x.tool, ...x.args.slice(0, x.tool === "xcrun" ? 2 : 1)]), [
      ["security", "find-identity"], ["xcrun", "notarytool", "history"], ["osacompile", "-o"],
      ["plutil", "-replace"], ["plutil", "-replace"], ["codesign", "--force"], ["codesign", "--verify"], ["ditto", "-c"],
      ["xcrun", "notarytool", "submit"], ["xcrun", "stapler", "staple"], ["xcrun", "stapler", "validate"], ["spctl", "-a"],
    ]);
    assert.deepEqual(c[0].args, ["find-identity", "-v", "-p", "codesigning"]);
    const stagedApp = c[2].args[1];
    assert.deepEqual(c[5].args, ["--force", "--options", "runtime", "--timestamp", "--entitlements", path.join(path.dirname(stagedApp), "entitlements.plist"), "--sign", "Developer ID Application: Test (TEAM)", stagedApp]);
    assert.deepEqual(c[8].args, ["notarytool", "submit", path.join(path.dirname(stagedApp), "installer.zip"), "--keychain-profile", "reel saved profile", "--wait", "--output-format", "json"]);
    assert.deepEqual(c[9].args, ["stapler", "staple", stagedApp]);
    assert.deepEqual(c[11].args, ["-a", "-vv", "--type", "execute", stagedApp]);
    assert.deepEqual(c[4].args, ["-replace", "NSAppleEventsUsageDescription", "-string", "Opens Terminal to install Reels in your account.", `${stagedApp}/Contents/Info.plist`]);
    assert.match(fs.readFileSync(path.join(app, "signed-entitlements.plist"), "utf8"), /<key>com.apple.security.automation.apple-events<\/key><true\/>/);
    const source = fs.readFileSync(path.join(app, "source.applescript"), "utf8");
    assert.match(source, /path to me/);
    assert.match(source, /quoted form of \(kitPath & "\/install.sh"\)/);
    assert.match(source, /quoted form of \(kitPath & "\/Brand"\)/);
    assert.match(source, /quoted form of \(kitPath & "\/release.json"\)/);
    assert.equal(source.includes(" --studio"), studio);
    assert.match(source, /choose folder with prompt/);
    assert.doesNotMatch(source, new RegExp(root));
    assert.match(source, /tell application "Terminal"/);
    assert.equal(fs.existsSync(path.dirname(stagedApp)), false, "temporary notarization files cleaned");
  });
}

for (const options of [{ identity: false }, { profile: false }]) {
  test(`without signing prerequisites builds nothing: ${JSON.stringify(options)}`, (t) => {
    const { root, env, calls } = signingTools(t, options), { kit } = kitAt(root, false);
    const result = run("/bin/bash", ["scripts/make-installer-app.sh", kit], env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "No Developer ID on this Mac: kits ship the Terminal steps.\n");
    assert.ok(calls().every(c => ["security", "xcrun"].includes(c.tool)));
    assert.ok(!fs.readdirSync(kit).some(f => f.endsWith(".app")));
  });
}

test("no stored profile name skips before touching the keychain profile", (t) => {
  const { root, env, calls } = signingTools(t), { kit } = kitAt(root, false);
  const result = run("/bin/bash", ["scripts/make-installer-app.sh", kit], { ...env, REEL_NOTARY_PROFILE: "" });
  assert.equal(result.status, 0);
  assert.deepEqual(calls().map(c => c.tool), ["security"]);
});

for (const options of [{ accepted: false }, { fail: "codesign" }, { fail: "spctl" }]) {
  test(`a failed signing step never leaves an unsigned or unapproved app: ${JSON.stringify(options)}`, (t) => {
    const { root, env } = signingTools(t, options), { kit } = kitAt(root, false);
    put(path.join(kit, "install.sh"), "unused");
    const result = run("/bin/bash", ["scripts/make-installer-app.sh", kit], env);
    assert.notEqual(result.status, 0);
    assert.ok(!fs.readdirSync(kit).some(f => f.endsWith(".app")));
  });
}

test("kit names with apostrophes and quotes produce safe short folders and runnable launchers", (t) => {
  const root = temporary(t), brandFile = path.join(root, "brand.json");
  for (const name of ['Zack and Kat Straughn', `Zack's "Reels" $(false)`, "A".repeat(180)]) {
    put(brandFile, JSON.stringify({ name, handle: "@test", colors: { text: "#FFFFFF", accent: "#E94B8A" } }));
    const out = fs.mkdtempSync(path.join(root, "out-"));
    const result = run(process.execPath, ["scripts/brand-kit.mjs", brandFile, "--dev", "--out", out], { ...process.env, REEL_NOTARY_PROFILE: "" });
    assert.equal(result.status, 0, result.stderr);
    const zipName = fs.readdirSync(out).find(f => f.endsWith(".zip"));
    assert.match(zipName, /^[a-zA-Z0-9 ]+\.zip$/);
    assert.ok(zipName.length < 80);
    const extract = path.join(out, "extracted");
    assert.equal(run("unzip", ["-q", path.join(out, zipName), "-d", extract], process.env).status, 0);
    const kit = path.join(extract, zipName.slice(0, -4)), log = path.join(out, "args");
    put(path.join(kit, "release.json"), "{}");
    put(path.join(kit, "install.sh"), '#!/bin/bash\nprintf "%s\\0" "$@" > "$ARGS_FILE"\n');
    const launcher = run("bash", [path.join(kit, "Install Reel Editor.command")], { ...process.env, HOME: root, TERM: "dumb", ARGS_FILE: log });
    assert.equal(launcher.status, 0, launcher.stderr);
    assert.deepEqual(fs.readFileSync(log, "utf8").split("\0").slice(0, -1), ["--brand", path.join(kit, "Brand"), "--release", path.join(kit, "release.json")]);
    const message = fs.readFileSync(path.join(out, zipName.slice(0, -4) + " - send-out message.txt"), "utf8");
    assert.match(message, /Open Terminal \(Applications, Utilities\)\. Type bash and a space\. Drag the Install file from the kit folder into the Terminal window\. Press Return\./);
    assert.doesNotMatch(message, /password|Open Anyway|Privacy\s*(?:&amp;|&)\s*Security|[\u2013\u2014]/i);
  }
});

for (const options of [{ identity: false }, { identity: true }, { fail: "codesign" }]) {
  test(`release kit builder uses signing route safely: ${JSON.stringify(options)}`, (t) => {
    const { root, env, calls } = signingTools(t, options), source = path.join(root, "release-app"), out = path.join(root, "out");
    copyApp(PKG_ROOT, source);
    const manifest = path.join(source, "release.json");
    put(manifest, JSON.stringify({ schema: 1, id: "2026.11.08.1", commit: "a".repeat(40), runtime: { id: "fake" }, files: { "install.sh": fileHash(path.join(source, "install.sh")) }, artifact: { name: "fake.tar.gz", url: "https://example.invalid/fake.tar.gz" } }));
    const brand = path.join(root, "brand.json");
    put(brand, JSON.stringify({ name: `Zack's "Reels"`, handle: "@test", colors: { text: "#FFFFFF", accent: "#E94B8A" } }));
    const result = run(process.execPath, [path.join(source, "scripts/brand-kit.mjs"), brand, "--release", manifest, "--out", out], env);
    assert.equal(calls().some(c => c.tool === "security"), true);
    if (options.fail) {
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(out), false);
      return;
    }
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /No Developer ID on this Mac/);
    const zip = path.join(out, fs.readdirSync(out).find(f => f.endsWith(".zip")));
    const listing = run("unzip", ["-Z1", zip], process.env);
    assert.equal(listing.status, 0, listing.stderr);
    assert.equal(listing.stdout.includes("Install Reel Editor.app/"), options.identity);
    for (const file of ["Brand/my-brand.json", "release.json", "install.sh", "Start Here.html", "Setup Guide.html", "Install Reel Editor.command"]) assert.ok(listing.stdout.includes(file));
  });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findVslScript } from "../src/vsl-script.mjs";

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vsl-lookup-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home };
  const project = (id = "2026-sample-offer", client = "fictional-client") => {
    const dir = path.join(env.REEL_VSL_PROJECTS?.replace(/^~/, home) || path.join(home, "Clients"), client, "vsl/projects", id);
    fs.mkdirSync(path.join(dir, "04-script"), { recursive: true });
    return dir;
  };
  const script = (p, version) => {
    const file = path.join(p, "04-script", `script.v${version}.md`);
    fs.writeFileSync(file, "## S1 Test\nSAY: Synthetic test words.\nSCREEN: Test\n");
    return file;
  };
  return { home, env, project, script };
}

test("lookup uses bounded project ids, an explicit tag, and the highest numeric version", (t) => {
  const f = fixture(t), p = f.project();
  f.script(p, "001"); f.script(p, "002"); const latest = f.script(p, "010");
  fs.writeFileSync(path.join(p, "04-script", "script.v999.md.bak"), "ignore");
  assert.equal(findVslScript("2026-sample-offer.mov", f.env), latest);
  assert.equal(findVslScript("take 2 #vsl-2026-sample-offer.MOV", f.env), latest);
  assert.equal(findVslScript("take_2026-sample-offer__title.mp4", f.env), latest);
  assert.equal(findVslScript("not2026-sample-offering.mov", f.env), null);
  assert.equal(findVslScript("2026-sample-offer #vsl-wrong-project.mov", f.env), null);
  assert.equal(findVslScript("other.mov", f.env), null);
});

test("newest final_script line wins over version number and other approval stages", (t) => {
  const f = fixture(t), p = f.project();
  f.script(p, "001"); const approved = f.script(p, "002"); f.script(p, "010");
  fs.writeFileSync(path.join(p, "approvals.jsonl"), [
    { stage: "final_script", file: "04-script/script.v010.md" },
    { stage: "final_script", file: "04-script/script.v002.md" },
    { stage: "edit", file: "04-script/script.v010.md" },
  ].map(JSON.stringify).join("\n") + "\npartial invalid line");
  assert.equal(findVslScript("2026-sample-offer.mov", f.env), approved);
});

for (const file of ["04-script/script.v999.md", "../../outside.md", "/tmp/outside.md"]) {
  test(`missing or escaping approval falls back to a local version: ${file}`, (t) => {
    const f = fixture(t), p = f.project(), latest = f.script(p, "003");
    fs.writeFileSync(path.join(p, "approvals.jsonl"), JSON.stringify({ stage: "final_script", file }));
    assert.equal(findVslScript("2026-sample-offer.mov", f.env), latest);
  });
}

test("configured project root, tilde expansion, missing scripts and ambiguous clients", (t) => {
  const f = fixture(t); f.env.REEL_VSL_PROJECTS = "~/custom projects";
  assert.equal(findVslScript("anything.mov", f.env), null);
  const p = f.project();
  assert.equal(findVslScript("2026-sample-offer.mov", f.env), null);
  const latest = f.script(p, "003");
  assert.equal(findVslScript("2026-sample-offer.mov", f.env), latest);
  f.script(f.project("2026-sample-offer", "other-client"), "001");
  assert.equal(findVslScript("2026-sample-offer.mov", f.env), null);
});

test("a longer project id wins over its prefix", (t) => {
  const f = fixture(t); f.script(f.project("sample"), "001");
  const latest = f.script(f.project("sample-offer"), "002");
  assert.equal(findVslScript("sample-offer.mov", f.env), latest);
});

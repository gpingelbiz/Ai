import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fixturePlan } from "../scripts/golden.mjs";
import { main } from "../src/cli.mjs";
import { composeProject, projectHTML } from "../src/compose.mjs";
import { makeProofFirst, withProofOpener } from "../src/opener-variant.mjs";
import { loadPreset } from "../src/presets.mjs";
import { readJSON, writeJSON } from "../src/util.mjs";

function proPlan(footage) {
  const plan = fixturePlan(footage);
  plan.style = loadPreset("pingel-pro");
  plan.preset = plan.style.name;
  plan.video.hasAudio = true;
  plan.audio.tracks = [{ id: "music", src: "assets/music.m4a", start: 0, duration: 10, volume: 0.2 }];
  plan.proGraphics = [{ id: "teaching-card", type: "stat", start: 3, duration: 2, end: 5, place: { x: 180, y: 240 }, phrases: [{ text: "10" }] }];
  return plan;
}

const finishedReports = ["gate.json", "gate.txt", "textcheck.json", "preflight.json", "preflight.txt", "watch.json", "master-check.json", "master-check.txt"];

function finishedJob(t) {
  const root = fs.mkdtempSync(path.resolve("test/.opener-variant-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const job = path.join(root, "job");
  const footage = path.join(job, "clean.mp4");
  const plan = proPlan(footage);
  const file = path.join(root, "redacted proof.PNG");
  const original = path.join(job, "renders", `${plan.name}.mp4`);
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.writeFileSync(original, "finished render");
  fs.writeFileSync(footage, "edited footage");
  fs.writeFileSync(file, "redacted proof bytes");
  writeJSON(path.join(job, "plan.json"), plan);
  const assets = path.join(job, "project", "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "music.m4a"), "baked music");
  for (const report of finishedReports) fs.writeFileSync(path.join(job, report), "old report");
  return { root, job, plan, file, original };
}

test("withProofOpener copies the plan and adds only the opener and the new name", () => {
  const plan = proPlan("fixture.mp4");
  const before = structuredClone(plan);
  const file = "assets/redacted proof.PNG";
  const variant = withProofOpener(plan, { file });
  assert.deepEqual(variant, { ...before, name: `${before.name}-proof-first`, opener: { src: file, kind: "image", duration: 2 } });
  assert.notEqual(variant.hook, plan.hook);
  assert.deepEqual(plan, before);
  assert.deepEqual(withProofOpener(plan, { file: "assets/proof.MOV", duration: 1.5 }).opener, { src: "assets/proof.MOV", kind: "video", duration: 1.5 });
});

test("the only page changes are the title and the timed proof layer beneath the hook, captions and cards", () => {
  const plan = proPlan("fixture.mp4");
  const footage = "assets/footage.mp4";
  const base = projectHTML(plan, footage);
  assert.doesNotMatch(base, /id="proof-opener"/);
  for (const [file, tag, end] of [["assets/proof.png", "img", 2], ["assets/proof.mov", "video", 1.25]]) {
    const variant = withProofOpener(plan, { file, duration: end });
    const html = projectHTML(variant, footage);
    const layer = html.match(/\n +<(img|video) id="proof-opener"[^\n]+/);
    assert.ok(layer);
    assert.equal(layer[1], tag);
    assert.ok(layer[0].includes(`src="${file}" data-start="0" data-duration="${end}"`));
    // Fitted whole between the hook and the captions, on an obsidian ground: a record is never cropped or captioned over.
    assert.match(layer[0], /object-fit:contain/);
    const ground = html.match(/\n +<div id="proof-opener-ground"[^\n]+/);
    assert.ok(ground && ground.index < layer.index && /background:#0B0B0D/.test(ground[0]) && ground[0].includes(`data-duration="${end}"`));
    if (tag === "video") assert.match(layer[0], / muted playsinline>/);
    assert.ok(layer.index > html.indexOf('id="footage"'));
    for (const id of ["hook", "captions", "teaching-card"]) {
      assert.ok(html.indexOf(`id="${id}"`) > layer.index, id);
    }
    assert.equal(html.replace(layer[0], "").replace(ground[0], "").replace(`<title>${variant.name}</title>`, `<title>${plan.name}</title>`), base);
  }
});

test("unsupported proof extensions and invalid durations are rejected before a build", async (t) => {
  const { job, file } = finishedJob(t);
  const deps = { buildProject: () => assert.fail("must not build") };
  await assert.rejects(makeProofFirst(job, "record.pdf", { deps }), /unsupported proof opener file type \(\.pdf\)/i);
  await assert.rejects(makeProofFirst(job, file, { duration: 0, deps }), /positive number/);
  assert.equal(fs.existsSync(`${job}-proof-first`), false);
});

for (const form of ["edit", "variant"]) {
  test(`reel ${form} copies a finished job and prints both render paths`, async (t) => {
    const { job, plan, file, original } = finishedJob(t);
    const dest = `${job}-proof-first`;
    const output = path.join(dest, "renders", `${plan.name}-proof-first.mp4`);
    const log = t.mock.method(console, "log", () => {});
    let edits = 0;
    let builds = 0;
    const deps = {
      runEdit: async (input, options) => {
        edits++;
        assert.equal(input, plan.video.src);
        assert.deepEqual(options, { out: job });
        return { workDir: job, output: original };
      },
      buildProject: async (workDir, options) => {
        builds++;
        assert.equal(workDir, dest);
        assert.deepEqual(options, {});
        for (const entry of ["renders", ...finishedReports]) assert.equal(fs.existsSync(path.join(dest, entry)), false, entry);
        const next = readJSON(path.join(dest, "plan.json"));
        assert.equal(next.opener.duration, form === "edit" ? 1.5 : 2);
        const project = path.join(dest, "project");
        composeProject(next, project);
        assert.equal(fs.readFileSync(path.join(project, "assets", "proof-opener.png"), "utf8"), fs.readFileSync(file, "utf8"));
        assert.match(fs.readFileSync(path.join(project, "index.html"), "utf8"), /src="assets\/proof-opener\.png"/);
        assert.equal(fs.readFileSync(path.join(project, "assets", "music.m4a"), "utf8"), "baked music");
        return { output };
      },
    };
    const args = form === "edit"
      ? [form, plan.video.src, "--out", job, "--proof-first", file, "--opener-seconds", "1.5"]
      : [form, job, "--proof-first", file];
    await main(args, deps);
    assert.equal(edits, form === "edit" ? 1 : 0);
    assert.equal(builds, 1);
    assert.deepEqual(log.mock.calls.map((call) => call.arguments), [[original], [output]]);
    assert.deepEqual(readJSON(path.join(job, "plan.json")), plan);
    assert.equal(fs.readFileSync(original, "utf8"), "finished render");
    assert.equal(fs.readFileSync(path.join(job, "gate.json"), "utf8"), "old report");
  });
}

for (const [ext, outputExt, command] of [["HEIC", "png", "sips"], ["MOV", "mp4", "ffmpeg"]]) {
  test(`makeProofFirst prepares ${ext} media for the renderer`, async (t) => {
    const { root, job } = finishedJob(t);
    const file = path.join(root, `proof.${ext}`);
    fs.writeFileSync(file, "source proof");
    const deps = {
      run: async (program, args) => {
        assert.equal(program, command);
        assert.ok(args.includes(file));
        if (command === "ffmpeg") {
          assert.ok(args.includes("-an"));
          assert.equal(args[args.indexOf("-t") + 1], "1.75");
        }
        fs.writeFileSync(args.at(-1), "prepared proof");
      },
      buildProject: async (workDir) => {
        const plan = readJSON(path.join(workDir, "plan.json"));
        const project = path.join(workDir, "project");
        composeProject(plan, project);
        assert.equal(fs.readFileSync(path.join(project, "assets", `proof-opener.${outputExt}`), "utf8"), "prepared proof");
      },
    };
    await makeProofFirst(job, file, { duration: 1.75, deps });
    assert.equal(fs.readFileSync(file, "utf8"), "source proof");
  });
}

test("a build that changes the matched edit reports the mismatch", async (t) => {
  const { job, file } = finishedJob(t);
  const deps = {
    buildProject: async (workDir) => {
      const planPath = path.join(workDir, "plan.json");
      const plan = readJSON(planPath);
      writeJSON(planPath, { ...plan, masterTrim: 0.2 });
    },
  };
  await assert.rejects(makeProofFirst(job, file, { deps }), /checks changed the matched edit/);
});


test("the opener box sits under the pro hook and above the first captions shown while it is up", async () => {
  const { openerBox } = await import("../src/compose.mjs");
  const plan = { opener: { duration: 2 }, hook: { lines: [3, 4], fontSize: 100 }, captions: [{ start: 0.2, end: 1, y: 1248 }, { start: 5, end: 6, y: 900 }] };
  const box = openerBox(plan, 1920);
  assert.ok(Math.abs(box.top - (176 + 2 * 106 + 32 + 24)) < 0.01, JSON.stringify(box));
  assert.ok(Math.abs(box.top + box.height - (1248 - 24)) < 0.01);
  assert.equal(openerBox({ ...plan, opener: null }), null);
});

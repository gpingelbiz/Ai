/**
 * One pass of the Dropbox -> Opus Clip -> Dropbox loop. launchd runs it every 5 minutes (bin/opus-dropbox.mjs run).
 *
 *   1. A video dropped in the drop folder is sent to Opus as a public Dropbox link (the video never passes through
 *      this Mac). At most `maxInFlight` videos sit in Opus at once (Opus Pro and Max run 4 projects in parallel).
 *   2. Each run asks Opus how its projects are doing.
 *   3. A finished project's clips go into `<finished>/<video name>/` as "Clip 1 - <title>.mp4" plus
 *      "Clip 1 - caption.txt" (Opus's title, description and hashtags). Dropbox fetches each clip from Opus itself.
 *   4. The original moves to `<drop>/Done`. A video that fails moves to `<drop>/Needs a look` with a note saying what
 *      happened; moving it back into the drop folder sends it again.
 *
 * A video is never sent to Opus twice by accident: Opus bills every project (10 credits at least), so when a send
 * might have gone through (the run died mid-send, or Opus gave no clear answer) the video goes to Needs a look and a
 * person checks Opus before sending it again.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as pump } from "node:stream/promises";
import { DONE, STALLED, OpusError } from "./opus.mjs";
import { DropboxError } from "./dropbox.mjs";

export const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi)$/i;
export const S = {
  WAITING: "waiting",     // found, not sent yet
  EXISTING: "existing",   // was in the folder when the tool was set up; left alone (`opus-dropbox send <name>` sends it)
  SENDING: "sending",     // the send to Opus started and has no answer written down yet
  IN_OPUS: "in_opus",     // Opus is making the clips
  DELIVERING: "delivering", // Opus is done; clips are going into Dropbox
  DONE: "done",
  FAILED: "failed",
};

export const join = (...parts) => ("/" + parts.join("/")).replace(/\/+/g, "/").replace(/\/$/, "") || "/";
export const baseName = (name) => String(name).replace(/\.[^.]+$/, "");

/** A file or folder name Dropbox and Finder both take, at most 80 characters. */
export function safeName(s, fallback = "Clip") {
  const out = String(s || "").replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[\s.]+$/, "");
  return out || fallback;
}

/** What goes in a clip's caption.txt: Opus's title, description and hashtags, a blank line between each. */
export function captionText(clip) {
  return [clip.title, clip.description, clip.hashtags].map((x) => String(x || "").trim()).filter(Boolean).join("\n\n") + "\n";
}

const MIGHT_BE_IN_OPUS = "so it may already be in your Opus projects. Check Opus first: if the project is there, download its clips from Opus. If it is not, move the video back into the drop folder to send it again.";

export async function runOnce({ c, state, dropbox, opus, now = () => Date.now(), log = () => {}, notify = () => {}, save = () => {}, fetch = globalThis.fetch }) {
  const items = (state.items ||= {});
  const report = { found: 0, sent: 0, delivered: 0, failed: 0, inOpus: 0, waiting: 0, blocked: "" };
  const drop = join(c.folders.drop);
  const doneDir = join(drop, c.folders.done);
  const lookDir = join(drop, c.folders.needsLook);
  const stamp = () => new Date(now()).toISOString();
  const set = (id, fields) => { items[id] = { ...items[id], ...fields, updatedAt: stamp() }; save(); };

  async function fail(id, why) {
    const it = items[id];
    set(id, { status: S.FAILED, error: why, failedAt: stamp(), filed: false });
    report.failed++;
    log("failed", { name: it.name, why });
    try {
      await dropbox.createFolder(lookDir);
      const to = await dropbox.move(id, join(lookDir, it.name));
      await dropbox.upload(join(lookDir, `${safeName(baseName(it.name))} - what happened.txt`),
        `${it.name}\n\n${why}\n\nTo send it again, move the video back into ${drop}.\n`);
      set(id, { filed: true, path: to });
    } catch (e) {
      log("file_error", { name: it.name, error: e.message });
    }
    notify("A video needs a look", `${it.name}: ${why.split(". ")[0]}.`);
  }

  // 1) A send that never got its answer written down may have gone through: never send it again by itself.
  for (const [id, it] of Object.entries(items)) {
    if (it.status === S.SENDING) await fail(id, `The tool stopped while sending this video to Opus, ${MIGHT_BE_IN_OPUS}`);
  }

  // 2) What is in the drop folder now.
  const here = new Set();
  for (const e of await dropbox.list(drop)) {
    if (e[".tag"] !== "file" || e.name.startsWith(".") || !VIDEO.test(e.name)) continue;
    here.add(e.id);
    report.found++;
    const it = items[e.id];
    if (!it) {
      set(e.id, { name: e.name, path: e.path_display, size: e.size, status: S.WAITING, seenAt: stamp() });
      log("found", { name: e.name, size: e.size });
    } else if ((it.status === S.FAILED || it.status === S.DONE) && it.filed) {
      // The tool filed it away and a person moved it back: that means "do it again".
      set(e.id, { name: e.name, path: e.path_display, size: e.size, status: S.WAITING, seenAt: stamp(), tries: (it.tries || 1) + 1,
        projectId: null, error: null, filed: false, dest: null, saved: [], order: null, stage: null, stuckNoted: false });
      log("again", { name: e.name });
    } else if (it.status === S.WAITING) {
      set(e.id, { name: e.name, path: e.path_display, size: e.size });
    }
  }
  // A waiting video someone took out of the folder before it was sent is forgotten.
  for (const [id, it] of Object.entries(items)) {
    if ((it.status === S.WAITING || it.status === S.EXISTING) && !here.has(id)) { delete items[id]; save(); }
  }

  // 3) Send waiting videos, oldest first.
  let inFlight = Object.values(items).filter((it) => it.status === S.IN_OPUS).length;
  const waiting = Object.entries(items).filter(([, it]) => it.status === S.WAITING).sort(([, a], [, b]) => String(a.seenAt).localeCompare(String(b.seenAt)));
  for (const [id, it] of waiting) {
    if (inFlight >= c.maxInFlight) break;
    let link, linkKind = "shared";
    try {
      link = await dropbox.publicLink(id);
    } catch (e) {
      // A team that blocks public links still allows a 4-hour download link, which is all Opus needs to import it.
      if (!(e instanceof DropboxError) || e.status !== 409 || /not_found/.test(e.summary)) { log("link_error", { name: it.name, error: e.message }); continue; }
      try { link = await dropbox.tempLink(id); } catch (e2) { log("link_error", { name: it.name, error: e2.message }); continue; }
      linkKind = "temporary";
    }
    set(id, { status: S.SENDING, sendingAt: stamp() });
    let projectId;
    try {
      projectId = await opus.create({ ...c.opus.project, videoUrl: link });
    } catch (e) {
      if (e instanceof OpusError && [401, 402, 403, 429].includes(e.status)) {
        // Nothing was made: a bad key, no API on the plan, the month's API minutes used up, or too many requests.
        set(id, { status: S.WAITING });
        report.blocked = e.status === 429 ? "Opus asked us to slow down" : `Opus would not take new videos (${e.message})`;
        log("blocked", { name: it.name, status: e.status, error: e.message });
        const last = Date.parse(state.blockedNotifiedAt || 0);
        if (e.status !== 429 && now() - last > 12 * 3600 * 1000) {
          notify("Opus is not taking videos", e.status === 401 ? "The Opus API key does not work any more." : "Check the Opus plan: API access or this month's API minutes.");
          state.blockedNotifiedAt = stamp(); save();
        }
        break;
      }
      if (e instanceof OpusError && e.status >= 400 && e.status < 500) await fail(id, `Opus would not take this video (${e.message}).`);
      else await fail(id, `Opus did not answer clearly when this video was sent (${e.message}), ${MIGHT_BE_IN_OPUS}`);
      continue;
    }
    set(id, { status: S.IN_OPUS, projectId, linkKind, sentAt: stamp(), stage: "PENDING" });
    inFlight++;
    report.sent++;
    log("sent", { name: it.name, projectId, linkKind });
  }

  // 4) Ask Opus how its projects are doing.
  for (const [id, it] of Object.entries(items)) {
    if (it.status !== S.IN_OPUS) continue;
    let p;
    try { p = await opus.project(it.projectId); }
    catch (e) {
      if (e instanceof OpusError && e.status === 404) await fail(id, `Opus no longer has the project for this video (${it.projectId}).`);
      else log("check_error", { name: it.name, error: e.message });
      continue;
    }
    if (p.orgId && !it.orgId) set(id, { orgId: p.orgId }); // a key with several Opus orgs must name the org to list clips
    if (p.stage === DONE) {
      set(id, { status: S.DELIVERING, stage: DONE, finishedAt: stamp() });
      log("finished", { name: it.name, projectId: it.projectId });
    } else if (p.stage === STALLED) {
      await fail(id, `Opus could not finish this video${p.error ? ` (${p.error})` : ""}. Look at the project in Opus (${it.projectId}).`);
    } else {
      set(id, { stage: p.stage });
      if (!it.stuckNoted && now() - Date.parse(it.sentAt) > c.stuckHours * 3600 * 1000) {
        set(id, { stuckNoted: true });
        log("slow", { name: it.name, stage: p.stage });
        notify("Opus is taking a long time", `${it.name} has been in Opus for over ${c.stuckHours} hours (${p.stage}).`);
      }
    }
  }

  // 5) Put finished clips into Dropbox, then file the original.
  async function saveClip(file, url) {
    try { await dropbox.saveUrl(file, url); return; }
    catch (e) { log("save_url_failed", { file, error: e.message }); }
    // Dropbox could not fetch it itself: bring it down to this Mac and upload it.
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "opus-dropbox-")), "clip.mp4");
    try {
      const r = await fetch(url);
      if (!r.ok || !r.body) throw new Error(`clip download answered ${r.status}`);
      await pump(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
      await dropbox.upload(file, { file: tmp });
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  }

  async function deliver(id) {
    const it = items[id];
    // Opus's download links are signed and expire, so the list is read fresh every time. Right after COMPLETE the list
    // can still be empty: that counts as a delivery try, and six empty tries in a row fail the video.
    const clips = await opus.clips(it.projectId, { orgId: it.orgId });
    if (!clips.length) throw new Error("Opus has not listed any clips for this project");
    // Clip numbers stay put between runs even if Opus lists the clips in a different order next time.
    const order = { ...(it.order || {}) };
    let next = Math.max(0, ...Object.values(order)) + 1;
    for (const cl of clips) { const key = cl.curationId || cl.id; if (!(key in order)) order[key] = next++; }
    if (!it.dest) set(id, { dest: await dropbox.createFolder(join(c.folders.finished, safeName(baseName(it.name), "Video")), { autorename: true }) });
    set(id, { order });
    const saved = new Set(items[id].saved || []);
    for (const cl of clips) {
      const key = cl.curationId || cl.id;
      if (saved.has(key)) continue;
      if (!cl.uriForExport) throw new Error(`Opus gave no download link for clip ${order[key]}`);
      const k = order[key];
      const file = join(items[id].dest, `Clip ${k} - ${safeName(cl.title, `Clip ${k}`)}.mp4`);
      // save_url never replaces a file (it adds "Clip 1 (1).mp4"), so a clip saved before an interruption is kept as is.
      if (!(await dropbox.exists(file))) await saveClip(file, cl.uriForExport);
      await dropbox.upload(join(items[id].dest, `Clip ${k} - caption.txt`), captionText(cl));
      saved.add(key);
      set(id, { saved: [...saved] });
    }
    let filed = false, to = it.path;
    try {
      await dropbox.createFolder(doneDir);
      to = await dropbox.move(id, join(doneDir, it.name));
      filed = true;
    } catch (e) {
      log("file_error", { name: it.name, error: e.message }); // most often a person already moved the original
    }
    set(id, { status: S.DONE, clips: clips.length, doneAt: stamp(), filed, path: to, deliverErrors: 0 });
    report.delivered++;
    log("delivered", { name: it.name, clips: clips.length, dest: items[id].dest });
    notify("Opus clips are ready", `${clips.length} clip${clips.length === 1 ? "" : "s"} from ${it.name} are in ${items[id].dest}.`);
  }

  for (const [id, it] of Object.entries(items)) {
    if (it.status !== S.DELIVERING) continue;
    try { await deliver(id); }
    catch (e) {
      const n = (items[id].deliverErrors || 0) + 1;
      set(id, { deliverErrors: n, lastError: e.message });
      log("deliver_error", { name: it.name, error: e.message, tries: n });
      if (n >= 6) await fail(id, `The clips could not be put into Dropbox after ${n} tries (${e.message}). They are still in Opus (project ${it.projectId}).`);
    }
  }

  // Finished videos are forgotten after 120 days (moving one back into the drop folder after that sends it as new).
  for (const [id, it] of Object.entries(items)) {
    if (it.status === S.DONE && now() - Date.parse(it.doneAt) > 120 * 86400 * 1000) delete items[id];
  }
  for (const it of Object.values(items)) {
    if (it.status === S.WAITING) report.waiting++;
    if (it.status === S.IN_OPUS) report.inOpus++;
  }
  state.lastRun = stamp();
  state.lastReport = report;
  save();
  return report;
}

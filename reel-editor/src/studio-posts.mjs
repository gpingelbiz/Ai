import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadStudio, readPosts, logPost, takeLock } from './content-studio.mjs';
import { runDaily, retryable, zonedNow, addDays, recordPostSuccess, failPublish } from './daily.mjs';
import { postInput } from './studio-metricool.mjs';
import { stop } from './publish-folder.mjs';
import { detachedHost, hostChild, outsideClaude } from './studio-publish.mjs';
import { PKG_ROOT, readJSON, writeJSON } from './util.mjs';
const stateFile = s => path.join(s.paths.state, 'posts-make.json');
const read = file => { try { return readJSON(file); } catch { return {}; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
export function makeState(s) {
  const state = read(stateFile(s));
  if (state.running && !alive(state.pid)) {
    const next = { running: false, error: 'The make process stopped before finishing.' };
    writeJSON(stateFile(s), next); return next;
  }
  return state;
}
export function readyPosts(s, { now = new Date() } = {}) {
  if (s.config.publish.mode === "off") return [];
  return retryable(readPosts(s.paths), { tz: s.config.timezone, now })
    .filter(p => p.status === 'made' && !p.uncertain && !['reel', 'trial'].includes(p.format) && p.preflight?.verdict === 'schedule')
    .sort((a,b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`))
    .map(p => {
      const c = s.config;
      // The caption goes out exactly as written: no tracking marker in what the client's followers read.
      const text = p.text;
      const input = postInput({ blogId: c.metricool.blogId, day: p.day, time: p.time, tz: c.timezone, text, media: p.files.map(() => ''), altText: p.altText, kind: p.format, ai: p.ai, draft: c.publish.mode === 'draft' || !!p.draftWhy, trial: p.trial, networks: p.format === 'story' ? ['instagram'] : c.metricool.networks, title: p.hook || '', coverMs: p.coverMs });
      const info = JSON.parse(input.info); info.media = [];
      return { id: p.id, day: p.day, time: p.time, format: p.format, date: input.date, blogId: input.blogId, info };
    });
}
export function scanPosts(s, { now = new Date() } = {}) {
  const day = zonedNow(s.config.timezone, now).day;
  const daily = read(path.join(s.paths.state, 'daily.json'));
  const ready = readyPosts(s, { now });
  return { work: s.config.publish.mode !== 'off' && (!(daily.day === day && daily.completed && !daily.error) || ready.length > 0), day, through: addDays(day, Number(s.config.daysAhead)), timezone: s.config.timezone, blogId: s.config.metricool.blogId };
}
const postAt = (s,id) => { const p = readPosts(s.paths).find(p => p.id === id && !['reel','trial'].includes(p.format)); if (!p) throw new Error('Use a post id from ready'); return p; };
export function donePost(s,id,receipt) {
  const p = postAt(s,id);
  if (!receipt.date?.startsWith(`${p.day}T${p.time}:`)) throw new Error('Receipt date must match the ready slot');
  return recordPostSuccess(s, { ...p, uncertain: false }, { id: receipt.id || '', plannerUrl: receipt.planner || '' });
}
/** notSent: nothing reached Metricool (the files could not be hosted), so the next run may send it again. */
export function failPost(s,id,why,{ notSent = false, metricoolId } = {}) {
  return failPublish(s, { ...postAt(s,id), ...(metricoolId != null && metricoolId !== '' ? { metricoolId } : {}), uncertain: !notSent }, new Error(why));
}
/** Reconcile uncertain creates only against the app's complete snapshot. Never automatically send one again. */
export function reconcilePosts(s, scheduled) {
  for (const p of readPosts(s.paths).filter(p => ['made', 'not-posted'].includes(p.status) && !['reel', 'trial'].includes(p.format) && p.preflight?.verdict === 'schedule')) {
    // Only the post id Metricool gave back proves this post landed; a matching minute or text does not. An
    // uncertain post with no id stays held for a person.
    const match = p.uncertain && scheduled.find(q =>
      p.metricoolId != null && p.metricoolId !== '' && q.id != null && String(q.id) === String(p.metricoolId));
    if (match) donePost(s,p.id,{ date: `${p.day}T${p.time}:00`, id: match.id, planner: match.plannerUrl });
    else if (p.status === 'not-posted' && !p.uncertain) logPost(s.paths, { ...p, status: 'made' });
  }
}
export async function makePosts(s, scheduled, options = {}) {
  return runDaily(s.paths.root, { ...options, noPublish: true, routine: true, scheduled, deps: { ...options.deps, beforeDaily: () => reconcilePosts(s, scheduled) } });
}
export function startMake(s, scheduled) {
  if (!Array.isArray(scheduled) || scheduled.some(p => !/^\d{4}-\d{2}-\d{2}$/.test(p.day) || !Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23 || !Number.isInteger(p.minute) || p.minute < 0 || p.minute > 59 || !['POST', 'REEL', 'TRIAL_REEL', 'STORY'].includes(p.type))) throw new Error('make needs the complete scheduled array with day, hour, minute and type');
  if (makeState(s).running) return { started: false, running: true };
  const release = takeLock(s.paths,'posts-start');
  if (!release) return { started: false, running: true };
  try {
    if (makeState(s).running) return { started: false, running: true };
    const input = path.join(s.paths.state,'posts-schedule.json'); writeJSON(input,scheduled);
    const child = spawn(process.execPath,[path.join(PKG_ROOT,'bin/reel.mjs'),'studio','posts','make-child','--studio',s.paths.root],{ detached: true, stdio: 'ignore', env: outsideClaude() });
    writeJSON(stateFile(s),{ running: true, pid: child.pid }); child.unref();
    return { started: true };
  } finally { release(); }
}
export async function waitPosts(s,{ timeoutMs = 100000 } = {}) {
  const end = Date.now()+timeoutMs;
  do { const state = makeState(s); if (!state.running) return state; await new Promise(r=>setTimeout(r,1000)); } while(Date.now()<end);
  return { running: true };
}
export function finishPosts(s,{ now = new Date() } = {}) {
  const result = makeState(s);
  if (result.running) return { running: true };
  const problems = (result.made || []).filter(p=>['failed','held'].includes(p.status)).map(p=>p.why || p.status);
  for (const p of retryable(readPosts(s.paths), { tz: s.config.timezone, now }).filter(p => !['reel','trial'].includes(p.format))) problems.push(p.why || 'Post still needs scheduling');
  if(result.error) problems.push(result.error);
  if(result.skipped) problems.push(`Make did not run: ${result.skipped}`);
  const daily = { day: zonedNow(s.config.timezone,now).day, completed: now.toISOString(), error: problems.join('; ') };
  writeJSON(path.join(s.paths.state,'daily.json'),daily); return daily;
}
export async function postsCommand(args) {
  try { await runPostsCommand(args); }
  catch (error) { console.log(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}

async function runPostsCommand(args) {
  const { values:v, positionals:[cmd,arg] } = parseArgs({ args, allowPositionals:true, options:{ ...Object.fromEntries(['studio','date','planner','id','why'].map(k=>[k,{type:'string'}])), 'not-sent':{type:'boolean'} } });
  const s = loadStudio(v.studio), state = path.join(s.paths.state,'posts-serve.json');
  let result;
  if(cmd==='scan') result=scanPosts(s);
  else if(cmd==='ready') result=readyPosts(s);
  else if(cmd==='make') {
    if (!arg) throw new Error('make needs the complete Metricool schedule JSON');
    const input = JSON.parse(arg);
    result = startMake(s, Array.isArray(input) ? input : input.scheduled);
  }
  else if(cmd==='make-child') {
    // Parent holds the startup lock until the pid is recorded.
    const startupEnd = Date.now() + 5000;
    while (Date.now() < startupEnd && (!makeState(s).pid || fs.existsSync(s.paths.lock))) await new Promise(r=>setTimeout(r,100));
    try { result=await makePosts(s,read(path.join(s.paths.state,'posts-schedule.json'))); }
    catch(e) { result={error:e.message}; }
    writeJSON(stateFile(s),{...result,running:false}); return;
  }
  else if(cmd==='wait') result=await waitPosts(s);
  else if(cmd==='done') result=donePost(s,arg,v);
  else if(cmd==='fail') result=failPost(s,arg,v.why || 'Unconfirmed create',{ notSent: v['not-sent'], metricoolId: v.id });
  else if(cmd==='finish') result=finishPosts(s);
  else if(cmd==='stop') result=await stop({state});
  else if(cmd==='serve') {
    const release = takeLock(s.paths, 'posts-serve');
    if (!release) throw new Error('Another run is working');
    try {
      if (!readyPosts(s).some(p => p.id === arg)) throw new Error('Use a post id from ready');
      logPost(s.paths, { ...postAt(s,arg), status: 'not-posted', uncertain: true, why: 'Awaiting a confirmed Metricool receipt. Check the schedule before retrying.' });
    } finally { release(); }
    result=await detachedHost({state, args:[path.join(PKG_ROOT,'bin/reel.mjs'),'studio','posts','serve-child',arg,'--studio',s.paths.root]});
    logPost(s.paths,{...postAt(s,arg),media:result.urls, status: "not-posted", uncertain: true, why: "Awaiting a confirmed Metricool receipt. Check the schedule before retrying." });
  } else if(cmd==='serve-child') {
    const p=postAt(s,arg);
    const connectors = s.config.hosting.route === 'dropbox'
      ? { dropbox: (await (await import('./studio-metricool.mjs')).detectConnectors()).dropbox?.name } : {};
    return hostChild(p.files, { state, hosting: s.config.hosting, postId: p.id, connectors });
  } else throw new Error('posts scan|make|wait|ready|serve|stop|done|fail|finish');
  console.log(JSON.stringify(result));
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initStudio, loadStudio, logPost, readPosts, takeLock, withDefaults } from '../src/content-studio.mjs';
import { studioAgents, installAgents } from '../src/studio-cli.mjs';
import { runDaily } from '../src/daily.mjs';
import { scanPosts, readyPosts, makePosts, donePost, failPost, reconcilePosts, makeState, finishPosts } from '../src/studio-posts.mjs';
import { outsideClaude } from '../src/studio-publish.mjs';
import { routinePrompt, dailyPostsPrompt, writeRoutine, allowPostsCommands } from '../src/studio-routine.mjs';
import { PKG_ROOT } from '../src/util.mjs';
const now = new Date('2026-11-08T06:00Z');
function fixture(t, config={}) {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'posts-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const root=path.join(home,'Content Studio');initStudio(root,{brandFrom:path.join(PKG_ROOT,'examples/content-studio/brand'),config:{client:'Example',timezone:'UTC',metricool:{blogId:'42',connector:'Test'},daily:{publisher:'claude'},reels:{publisher:'claude'},filming:{enabled:false},...config}});
 return {...loadStudio(root),home};
}
function post(s,extra={}) {const made=path.join(s.paths.made,'post');fs.mkdirSync(made,{recursive:true});const p={id:'one',day:'2026-11-08',time:'18:00',format:'static',made,files:[path.join(made,'1.png')],text:'Exact caption',altText:['Exact alt'],hook:'Hook',preflight:{verdict:'schedule'},status:'made',...extra};fs.writeFileSync(p.files[0],'image');logPost(s.paths,p);return p;}
test('migration independent of reels; app daily removes agent and refuses legacy publishing',async t=>{
 const s=fixture(t,{daily:{publisher:'legacy'}});assert.ok(studioAgents(s.paths.root).some(a=>a.label.includes('.daily.')));
 initStudio(s.paths.root,{config:{daily:{publisher:'claude'}}});assert.ok(!studioAgents(s.paths.root).some(a=>a.label.includes('.daily.')));
 const dir=path.join(s.home,'Library/LaunchAgents');fs.mkdirSync(dir,{recursive:true});const label='com.pingel.content-studio.daily.content-studio';fs.writeFileSync(path.join(dir,`${label}.plist`),'old');
 installAgents(s.paths.root,{home:s.home,run:()=>({status:0})});assert.equal(fs.existsSync(path.join(dir,`${label}.plist`)),false);
 assert.match((await runDaily(s.paths.root)).skipped,/Claude routine/);assert.equal(withDefaults({reels:{publisher:'claude'}}).daily.publisher,'legacy');
});
test('local scan stops on complete day; ready preserves exact info and expires',t=>{
 const s=fixture(t);fs.writeFileSync(path.join(s.paths.state,'daily.json'),JSON.stringify({day:'2026-11-08',completed:'yes',error:''}));assert.equal(scanPosts(s,{now}).work,false);
 post(s);assert.equal(scanPosts(s,{now}).work,true);const r=readyPosts(s,{now})[0];assert.deepEqual(r.info.media,[]);assert.deepEqual(r.info.mediaAltText,['Exact alt']);assert.match(r.info.text,/^Exact caption\n\n\[reel:[a-f0-9]{32}\]$/);assert.equal(r.info.text,readyPosts(s,{now})[0].info.text);assert.deepEqual(readyPosts(s,{now:new Date('2026-11-09T06:00Z')}),[]);
});
test('passed schedule fills a slot; make uses daily gates without schedule connector',async t=>{
 const s=fixture(t,{daysAhead:0,slots:[{time:'10:00',format:'static'}]});let calls=0;const r=await makePosts(s,[{day:'2026-11-08',hour:10,minute:0,type:'POST'}],{now,deps:{scheduledPosts:()=>{calls++;throw Error('connector called');}}});assert.equal(calls,0);assert.deepEqual(r.slots,[]);assert.deepEqual(readyPosts(s,{now}),[]);
});
test('held posts never ready; uncertain failure reconciles before retry; done writes receipt',t=>{
 const s=fixture(t);const p=post(s);failPost(s,p.id,'Uncertain result');assert.deepEqual(readyPosts(s,{now}),[]);reconcilePosts(s,[]);assert.deepEqual(readyPosts(s,{now}),[]);
 reconcilePosts(s,[{day:p.day,hour:18,minute:0,type:'POST',id:'unrelated'}]);assert.equal(readPosts(s.paths)[0].status,'not-posted');
 logPost(s.paths,{...readPosts(s.paths)[0],metricoolId:'remote'});reconcilePosts(s,[{day:p.day,hour:18,minute:0,type:'POST',id:'remote'}]);assert.equal(readPosts(s.paths)[0].status,'scheduled');assert.equal(fs.existsSync(path.join(p.made,'Not posted.txt')),false);
 post(s,{status:'held'});assert.deepEqual(readyPosts(s,{now}),[]);post(s);assert.equal(donePost(s,p.id,{date:'2026-11-08T18:00:00',id:'123'}).metricoolId,'123');assert.match(fs.readFileSync(path.join(p.made,'Scheduled.txt'),'utf8'),/18:00/);
});
test('dead child and stale lock recovery; finish keeps errors',t=>{
 const s=fixture(t);fs.mkdirSync(s.paths.lock);fs.writeFileSync(path.join(s.paths.lock,'who'),'daily 99999999');const release=takeLock(s.paths);assert.equal(typeof release,'function');release();fs.writeFileSync(path.join(s.paths.state,'posts-make.json'),JSON.stringify({running:true,pid:99999999}));assert.equal(makeState(s).running,false);assert.match(finishPosts(s,{now}).error,/stopped/);
});
test('both prompts constrain tools and setup registers both tasks; narrow allow rules',t=>{
 const s=fixture(t);const p=dailyPostsPrompt(s);assert.match(p,/getScheduledPosts/);assert.match(p,/https:\/\/static.metricool.com/);assert.match(p,/Never retry an uncertain create/);assert.doesNotMatch(p,/getBestTimeToPostByNetwork/);
 for(const prompt of [p,routinePrompt(s)])for(const line of prompt.split('\n').filter(l=>l.startsWith(process.execPath)))assert.doesNotMatch(line,/&&|[|<>]|\bcd\b/);
 const r=writeRoutine(s,{home:s.home});assert.match(r.setup,/taskId reel-publish/);assert.match(r.setup,/taskId daily-posts, cron 0 6,12/);assert.equal(fs.readFileSync(r.daily.file,'utf8'),fs.readFileSync(r.daily.skill,'utf8'));
 allowPostsCommands({home:s.home,node:'/node',bin:'/reel'});const file=path.join(s.home,'.claude/settings.json');assert.deepEqual(JSON.parse(fs.readFileSync(file)).permissions.allow,['Bash(/node /reel studio posts *)']);fs.writeFileSync(file,'broken');assert.equal(allowPostsCommands({home:s.home}),false);assert.equal(fs.readFileSync(file,'utf8'),'broken');
});
test('default daily retains launchd and original task only',t=>{const s=fixture(t,{daily:{publisher:'legacy'},reels:{publisher:'legacy'}});assert.equal(studioAgents(s.paths.root).length,3);assert.equal(writeRoutine(s,{home:s.home}).daily,null);});
test('client name scan; old delivered installer --studio remains accepted',()=>{
 for(const name of fs.readdirSync(path.join(PKG_ROOT,'kit'))) {const file=path.join(PKG_ROOT,'kit',name);if(fs.statSync(file).isFile())assert.doesNotMatch(fs.readFileSync(file,'utf8'),/Content Studio/,name);}
 for(const line of fs.readFileSync(path.join(PKG_ROOT,'scripts/studio-setup.mjs'),'utf8').split('\n').filter(l=>/\b(note|bold|ok|die)\(/.test(l)))assert.doesNotMatch(line,/Content Studio/);
 const install=fs.readFileSync(path.join(PKG_ROOT,'install.sh'),'utf8');assert.match(install,/--studio\) STUDIO=1/);assert.match(install,/scripts\/studio-setup.mjs/);assert.match(fs.readFileSync(path.join(PKG_ROOT,'kit/Install Reels.command'),'utf8'),/--brand "\$KIT\/Brand" --studio/);
});
test('make traverses preflight and holds rejected slides out of ready',async t=>{
 const { parseCopy } = await import('../src/studio-copy.mjs');
 const s=fixture(t,{daysAhead:0,slots:[{time:'18:00',format:'static'}],ai:{broll:false}});
 let checks=0;
 const result=await makePosts(s,[],{now,deps:{
  writeCopy:async()=>parseCopy(JSON.stringify({hook:'One useful check',slides:[{role:'static',headline:'One *useful* check',body:'Use the words supplied.'}],caption:'One useful check.',hashtags:[]}),{format:'static'}),
  choosePhotos:async()=>({bySlide:[null],vetoed:[],pool:{usable:[]}}),
  renderSlides:async(_,{outDir})=>{fs.mkdirSync(outDir,{recursive:true});const f=path.join(outDir,'1.png');fs.writeFileSync(f,'png');return [f];},
  preflightSlides:async({files})=>{checks++;return {verdict:'hold',slides:[{index:0,file:files[0],problems:[{code:'overlap',message:'Words overlap',fix:'none'}]}],photoHashes:[]};},
  hostFiles:()=>assert.fail('must not host'),createPost:()=>assert.fail('must not publish')
 }});
 assert.equal(checks,1);assert.equal(result.made[0].status,'held');assert.deepEqual(readyPosts(s,{now}),[]);
});
test('app daily stories enter the same ready list without a headless create',async t=>{
 const { runStories }=await import('../src/studio-extras.mjs');
 const s=fixture(t,{stories:{enabled:true,slots:['08:00']}});s.guide='Read the note. Put the phone away.';s.voice='';
 const f=path.join(s.paths.state,'story.png');fs.writeFileSync(f,'png');
 const r=await runStories(s,{now,deps:{
  writeStory:async()=>JSON.stringify({type:'ab',question:'Your pick?',left:'Read the note',right:'Put the phone away',action:'Reply with your pick'}),
  renderSlides:async()=>[f],preflightSlides:async()=>({verdict:'schedule',slides:[],photoHashes:[]}),
  hostFiles:()=>assert.fail('must not host'),createPost:()=>assert.fail('must not create')
 }});
 assert.equal(r[0].status,'made');assert.equal(readyPosts(s,{now})[0].format,'story');assert.deepEqual(readyPosts(s,{now})[0].info.providers,[{network:'instagram'}]);
});
test('detached make returns immediately, rejects overlap and wait returns its finished result',async t=>{
 const { startMake, waitPosts }=await import('../src/studio-posts.mjs');
 const s=fixture(t,{slots:[],daysAhead:0});assert.deepEqual(startMake(s,[]),{started:true});assert.deepEqual(startMake(s,[]),{started:false,running:true});
 const result=await waitPosts(s,{timeoutMs:20000});assert.equal(result.running,false);assert.deepEqual(result.made,[]);
});
test('daily CLI refusal is one line, dry-run and explicit no-publish remain usable',async t=>{
 const { spawnSync }=await import('node:child_process');
 const s=fixture(t,{slots:[],daysAhead:0});
 const r=spawnSync(process.execPath,[path.join(PKG_ROOT,'bin/reel.mjs'),'daily','--studio',s.paths.root],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim().split('\n').length,1);assert.match(r.stdout,/Claude routine/);
 assert.deepEqual((await runDaily(s.paths.root,{dryRun:true,now})).slots,[]);
 assert.deepEqual((await runDaily(s.paths.root,{noPublish:true,now})).made,[]);
});
test('app daily health retains its agent and points clients to Claude; kit links do not overwrite',async t=>{
 const { studioHealth }=await import('../src/studio-health.mjs');
 const { kitFolders }=await import('../src/studio-routine.mjs');
 const s=fixture(t,{publish:{mode:'off'}});
 assert.ok(studioAgents(s.paths.root).some(a=>a.label.includes('.health.')));
 const result=await studioHealth(s.paths.root,{now:new Date('2026-11-08T10:00Z'),deps:{claudeConnected:()=>true,notify:()=>{}}});
 assert.ok(result.issues.includes('Open the Claude app; it has to be open for your carousels and static posts to be made.'));
 kitFolders(s,{home:s.home});assert.equal(fs.lstatSync(path.join(s.home,'Desktop/Reels/Brand')).isSymbolicLink(),true);assert.equal(fs.statSync(path.join(s.home,'Desktop/Reels/Filming packs')).isDirectory(),true);
 fs.unlinkSync(path.join(s.home,'Desktop/Reels/Brand'));fs.mkdirSync(path.join(s.home,'Desktop/Reels/Brand'));kitFolders(s,{home:s.home});assert.equal(fs.lstatSync(path.join(s.home,'Desktop/Reels/Brand')).isSymbolicLink(),false);
});

test('neither a never sent post nor an uncertain post is settled by another post at its time',t=>{
  const s=fixture(t);const day='2031-01-02';
  logPost(s.paths,{id:'never',day,time:'10:00',format:'static',status:'made',made:s.paths.made,files:[],preflight:{verdict:'schedule'},text:'x'});
  logPost(s.paths,{id:'maybe',day,time:'18:00',format:'static',status:'not-posted',uncertain:true,made:s.paths.made,files:[],preflight:{verdict:'schedule'},text:'y'});
  fs.mkdirSync(s.paths.made,{recursive:true});
  reconcilePosts(s,[{day,hour:10,minute:0,type:'POST',id:'other'},{day,hour:18,minute:0,type:'POST',id:'real'}]);
  const by=Object.fromEntries(readPosts(s.paths).map(p=>[p.id,p]));
  assert.equal(by.never.status,'made');assert.equal(by.maybe.status,'not-posted');assert.equal(by.maybe.uncertain,true);
});
test('a story at the same time does not settle a feed post',t=>{
  const s=fixture(t);const day='2031-01-02';
  logPost(s.paths,{id:'maybe',day,time:'11:00',format:'static',status:'not-posted',uncertain:true,made:s.paths.made,files:[],preflight:{verdict:'schedule'},text:'y'});
  reconcilePosts(s,[{day,hour:11,minute:0,type:'STORY',id:'story'}]);
  assert.equal(readPosts(s.paths).find(p=>p.id==='maybe').status,'not-posted');
});
test('stories go to Instagram only; a post that never reached Metricool retries, an uncertain one holds',t=>{
  const s=fixture(t,{metricool:{blogId:'42',connector:'Test',networks:['instagram','tiktok']}});const day='2031-01-02';fs.mkdirSync(s.paths.made,{recursive:true});
  logPost(s.paths,{id:'st',day,time:'08:00',format:'story',status:'made',made:s.paths.made,files:['/x/a.png'],preflight:{verdict:'schedule'},text:'q',altText:['q']});
  const story=readyPosts(s,{now:new Date('2030-12-30T12:00:00Z')}).find(p=>p.id==='st');
  assert.deepEqual(story.info.providers.map(n=>n.network),['instagram']);
  logPost(s.paths,{id:'a',day,time:'10:00',format:'static',status:'made',made:s.paths.made,files:[],preflight:{verdict:'schedule'},text:'x'});
  logPost(s.paths,{id:'b',day,time:'18:00',format:'static',status:'made',made:s.paths.made,files:[],preflight:{verdict:'schedule'},text:'y'});
  failPost(s,'a','no link',{notSent:true});failPost(s,'b','timeout');
  reconcilePosts(s,[]);
  const by=Object.fromEntries(readPosts(s.paths).map(p=>[p.id,p]));
  assert.equal(by.a.status,'made');assert.equal(by.b.status,'not-posted');assert.equal(by.b.uncertain,true);
});
test('children leave the Claude session behind but keep everything else',()=>{
  const e=outsideClaude({CLAUDECODE:'1',CLAUDE_CODE_ENTRYPOINT:'x',CLAUDE_CODE_OAUTH_TOKEN:'t',PATH:'/bin',HOME:'/h'});
  assert.deepEqual(e,{CLAUDE_CODE_OAUTH_TOKEN:'t',PATH:'/bin',HOME:'/h'});
});
test('the routine never leans on a wait or serve longer than the Bash limit allows',t=>{
  const prompt=dailyPostsPrompt(fixture(t));
  assert.match(prompt,/timeout set to 600000/);assert.match(prompt,/--not-sent/);assert.match(prompt,/LOCAL_DATE set to the date returned by ready/);
});

test('our unique caption marker settles an uncertain post; matching caption words alone do not', t => {
  const s = fixture(t); const p = post(s, { text: 'A long caption. '.repeat(20) });
  const ready = readyPosts(s, { now })[0];
  const saved = readPosts(s.paths).find(q => q.id === p.id);
  assert.ok(ready.info.text.includes(saved.publishMarker));
  failPost(s, p.id, 'No confirmed reply');
  reconcilePosts(s, [{ day: p.day, hour: 18, minute: 0, type: 'POST', id: 'other', text: p.text }]);
  assert.equal(readPosts(s.paths)[0].uncertain, true);
  reconcilePosts(s, [{ day: p.day, hour: 18, minute: 0, type: 'POST', id: 'ours', text: ready.info.text }]);
  assert.equal(readPosts(s.paths)[0].metricoolId, 'ours');
  assert.equal(readPosts(s.paths)[0].uncertain, false);
});
test('a known remote id identifies an uncertain post even if its time changed', t => {
  const s = fixture(t); const p = post(s);
  failPost(s, p.id, 'Receipt was incomplete', { metricoolId: 123 });
  reconcilePosts(s, [{ day: p.day, hour: 19, minute: 30, type: 'POST', id: '123', text: 'Edited in Metricool' }]);
  assert.equal(readPosts(s.paths)[0].status, 'scheduled');
  assert.equal(readPosts(s.paths)[0].metricoolId, '123');
});

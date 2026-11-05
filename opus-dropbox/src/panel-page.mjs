/** Self contained page. Remote text only enters textContent. */
export function page(token) {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Opus Command Center</title>
<style>
:root{color-scheme:light dark;font:16px system-ui;line-height:1.5;background:light-dark(#f5f6f8,#14171d);color:light-dark(#202731,#edf1f5)}
body{max-width:960px;margin:auto;padding:24px}h1{font-size:2rem}h2{margin-top:0}section{background:light-dark(white,#202630);padding:24px;border-radius:16px;margin:20px 0}button,select{font:inherit;padding:10px;border-radius:8px;max-width:100%;margin:4px}button,a{cursor:pointer}a{color:light-dark(#1356b5,#98bfff)}article{border-top:1px solid #8886;padding:14px 0;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:inherit}.muted{opacity:.75}#message{position:sticky;top:0;background:light-dark(#fff4ce,#494027);border-radius:8px;padding:12px}#message:empty{display:none}dialog{max-width:min(480px,80vw);border:1px solid #888;border-radius:16px;padding:24px}label{display:block;margin-top:16px}@media(max-width:480px){body{padding:12px}section{padding:16px}}
</style>
<h1>Opus Command Center</h1><p>Your videos and clips on this Mac.</p>
<p id="message" role="status"></p>
<section><h2>Health</h2><div id="health">Checking...</div><button id="refresh">Refresh</button><button id="pause">Pause background job</button><button id="resume">Resume background job</button></section>
<section><h2>Videos</h2><div id="videos">Loading...</div></section>
<section><h2>Reels</h2><p>Finished clips, newest first.</p><div id="reels"></div><button id="load">Refresh reels</button><button id="more" hidden>Show more</button></section>
<section><h2>Settings</h2><p>Changes apply to videos sent from now on.</p><div id="settings">Loading...</div><p><a href="https://clip.opus.pro/brand-templates" target="_blank" rel="noreferrer">Edit brand templates in Opus</a></p><p class="muted">Edit the brand look there, then pick the template here.</p></section>
<dialog id="confirm"><h2 id="confirmTitle"></h2><p id="confirmText"></p><button id="yes">Confirm</button><button id="cancel">Cancel</button></dialog>
<script>
"use strict";
const token = "${token}";
const $ = (id) => document.getElementById(id);
const add = (parent, tag, text) => { const el = document.createElement(tag); if(text !== undefined) el.textContent = text; parent.append(el); return el; };
const message = (text) => { $("message").textContent = text; };
async function api(route, data) {
  const r = await fetch("/api/" + route, data === undefined ? {} : { method:"POST", headers:{"Content-Type":"application/json","X-Panel-Token":token}, body:JSON.stringify(data) });
  const result = await r.json();
  if(!r.ok) throw new Error(result.error || "Please try again shortly.");
  return result;
}
async function action(route, data) {
  try { message((await api(route,data)).message); await refresh(); }
  catch(e) { message(e.message); }
}
let pending;
function confirmAction(title,text,fn) { $("confirmTitle").textContent=title; $("confirmText").textContent=text; pending=fn; $("confirm").showModal(); }
$("cancel").onclick=()=>{pending=null;$("confirm").close();};
$("yes").onclick=()=>{const fn=pending;pending=null;$("confirm").close();if(fn)fn();};
$("pause").onclick=()=>confirmAction("Pause the background job?","Videos will wait until you resume it.",()=>action("job",{action:"pause",confirm:true}));
$("resume").onclick=()=>action("job",{action:"resume"});
async function section(id,fn) {
  const box=$(id); box.replaceChildren();
  try { await fn(box); } catch(e) { add(box,"p",e.message); }
}
async function health() { await section("health",async(box)=>{
  const h=await api("health");
  add(box,"strong",h.ok?"All good":"Needs a look");
  for(const p of h.problems)add(box,"p",p.replaceAll("sign-in","connection"));
  add(box,"p","Background job: "+(h.job?"on":"off"));
  add(box,"p","Last run: "+(h.lastRun?new Date(h.lastRun).toLocaleString():"never"));
  add(box,"p",Object.entries(h.counts).map(([s,n])=>s.replaceAll("_"," ")+": "+n).join(" · "));
});}
async function videos() { await section("videos",async(box)=>{
  const {items}=await api("videos");
  const groups=[["waiting","Waiting"],["sending","Being sent"],["in_opus","In Opus"],["delivering","Clips going into Dropbox"],["failed","Needs a look"],["existing","Left alone at setup"],["done","Done"]];
  for(const [status,label] of groups) {
    const list=items.filter(it=>it.status===status);
    // The done list grows every day, so it stays folded and the reels stay close to the top.
    const parent=status==="done"?add(box,"details"):box;
    if(status==="done")add(parent,"summary",label+" ("+list.length+")");
    else add(box,"h3",label+" ("+list.length+")");
    for(const it of list) {
      const row=add(parent,"article"); add(row,"strong",it.name);
      if(status==="in_opus")add(row,"p",(it.stage||"Processing")+" · "+(it.sentAt?Math.max(0,Math.floor((Date.now()-Date.parse(it.sentAt))/60000))+" minutes":"time unavailable"));
      if(status==="failed")add(row,"p",it.error||"Please check this video.");
      if(status==="delivering")add(row,"p",it.saved+" clips saved");
      if(status==="done") {
        add(row,"p",(it.clips||0)+" clips");
        if(it.filed)add(row,"button","Make another cut").onclick=()=>confirmAction("Make another cut of "+it.name+"?","This costs at least 10 Opus credits. Old clips stay and new clips get new reel folders.",()=>action("recut",{id:it.id,confirm:true}));
      }
    }
  }
});}
async function settings() { await section("settings",async(box)=>{
  const s=await api("settings");
  add(box,"p","Drop folder: "+(s.folders.drop||"not set up"));
  add(box,"p","Finished folder: "+(s.folders.finished||"not set up"));
  if(s.error)add(box,"p","Brand templates unavailable: "+s.error);
  for(const [kind,label,choices,current] of [["length","Clip length",s.lengths,s.length],["template","Brand template",s.templates,s.template]]) {
    const field=add(box,"label",label), select=add(field,"select");
    select.setAttribute("aria-label",label);
    if(current<0 || (kind==="template"&&s.error)){const opt=add(select,"option","Saved choice unavailable");opt.value="";opt.selected=true;}
    choices.forEach((text,i)=>{const opt=add(select,"option",text);opt.value=String(i);if(i===current)opt.selected=true;});
    if(kind==="template"&&s.error)select.disabled=true;
    const button=add(box,"button","Save "+label.toLowerCase());button.disabled=select.disabled;
    button.onclick=()=>action("settings",{kind,value:select.value});
  }
});}
let limit=30;
async function reels() {
  $("load").disabled=true;$("more").disabled=true;
  await section("reels",async(box)=>{
    const wait=add(box,"p","Loading reels from Dropbox, this can take a few seconds...");
    const result=await api("reels",{limit});let day;
    wait.remove();
    for(const r of result.reels) {
      if(r.day!==day){day=r.day;add(box,"h3",day);}
      const row=add(box,"article");add(row,"p",r.name);add(row,"strong",r.title||r.name);add(row,"pre",r.caption||r.error||"No caption");
      const link=add(row,"a","Open in Dropbox");
      if(r.url.startsWith("https://www.dropbox.com/home/")){link.href=r.url;link.target="_blank";link.rel="noreferrer";}
    }
    if(!result.reels.length)add(box,"p","No reels yet.");
    $("more").hidden=!result.more;
  });
  $("load").disabled=false;$("more").disabled=false;
}
$("load").onclick=()=>{limit=30;reels();};$("more").onclick=()=>{limit+=30;reels();};
async function refresh(){await Promise.all([health(),videos(),settings()]);}
$("refresh").onclick=refresh;
refresh();
reels();
</script></html>`;
}

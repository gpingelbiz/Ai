// usage: node scripts/check-placement.mjs <workdir>...  Detects faces on the FINISHED render at each placed card/overlay/slam
// and reports the slot, size, and whether the box touches a face or the caption band.
import fs from "node:fs";
import path from "node:path";
import { detectFaces } from "../src/placement.mjs";
const over = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
for (const dir of process.argv.slice(2)) {
  const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8"));
  const render = fs.readdirSync(path.join(dir, "renders")).filter((f) => f.endsWith(".mp4")).map((f) => path.join(dir, "renders", f))[0];
  const W = plan.canvas?.width || 1080, H = plan.canvas?.height || 1920;
  const items = [
    ...(plan.graphics || []).filter((g) => g.place).map((g) => ({ what: `card ${g.type}`, t0: g.start, t1: g.start + g.duration, p: g.place })),
    ...(plan.glowOverlays || []).map((o) => ({ what: `glow ${o.type}`, t0: o.start, t1: o.end, p: { slot: o.place.slot || "band", x: o.place.x, y: o.place.y, w: o.place.w * (o.place.scale || 1), h: (o.type === "stamp" ? 160 : 150) * (o.place.scale || 1) } })),
    ...(plan.slams || []).filter((s) => s.place).map((s) => ({ what: `slam "${s.text}"`, t0: s.t, t1: s.end, p: s.place })),
  ];
  console.log(`\n${path.basename(dir)}: ${items.length} placed`);
  for (const it of items) {
    const times = [0.3, 0.5, 0.8].map((f) => +(it.t0 + f * (it.t1 - it.t0)).toFixed(3));
    const det = await detectFaces(render, times);
    const faces = (det?.frames || []).flatMap((f) => f.faces || []).map((b) => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H }));
    const full = it.p.slot === "full";
    const hit = !full && faces.some((f) => over(it.p, f));
    if (hit) process.exitCode = 1;
    console.log(`  ${it.t0.toFixed(1)}s ${it.what.padEnd(22)} ${String(it.p.slot + (it.p.side && it.p.side !== "center" ? " " + it.p.side : "")).padEnd(12)} ${full ? "full screen" : `${Math.round(it.p.w)}x${Math.round(it.p.h)} at ${Math.round(it.p.x)},${Math.round(it.p.y)} scale ${it.p.scale ?? "-"}`}  face ${faces.length ? (hit ? "HIT" : "clear") : "none seen"}`);
  }
}

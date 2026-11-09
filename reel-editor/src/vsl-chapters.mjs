import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Section times are on the finished timeline, supplied by the script-card planner. */
export function vslChapters(data) {
  const sections = Array.isArray(data) ? data : data?.sections;
  if (!Array.isArray(sections)) throw new Error("VSL sections must be an array (or { sections: [...] })");
  return sections.filter((s) => Number.isFinite(s.start) && s.start >= 0 && s.id && s.title)
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      const t = Math.floor(s.start);
      const title = `${s.id} ${s.title}`.replace(/[\r\n]+/g, " ").trim();
      return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")} ${title}`;
    }).join("\n") + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(process.argv[3], vslChapters(JSON.parse(fs.readFileSync(process.argv[2], "utf8"))));
}

/** Actions shared by the command line and the local page. */
import { createDropbox } from "./dropbox.mjs";
import { createOpus } from "./opus.mjs";
import { S, join } from "./pipeline.mjs";
import { loadConfig, loadState, saveConfig, lock } from "./store.mjs";
import { setChoice } from "./setup.mjs";

// config.endpoints points the tool at other hosts (the tests' fake Dropbox and Opus); real installs never set it.
export const clients = (c) => ({
  dropbox: createDropbox({ appKey: c.dropbox.appKey, refreshToken: c.dropbox.refreshToken, pathRoot: c.dropbox.pathRoot,
    ...(c.endpoints?.dropboxApi ? { api: c.endpoints.dropboxApi, content: c.endpoints.dropboxContent } : {}) }),
  opus: createOpus({ apiKey: c.opus.apiKey, orgId: c.opus.orgId, ...(c.endpoints?.opus ? { api: c.endpoints.opus } : {}) }),
});

export async function changeSetting(kind, value) {
  if (!["template", "length"].includes(kind)) throw new Error("Use settings template <number> or settings length <number>.");
  const unlock = lock();
  if (!unlock) throw new Error("Another run is going. Try again shortly.");
  try {
    const c = loadConfig();
    const ts = kind === "template" ? await clients(c).opus.templates() : [];
    setChoice(c.opus.project, kind, value, ts);
    saveConfig(c);
    return "Settings saved. They apply only to videos sent from now on.";
  } finally { unlock(); }
}

export async function recutVideo({ name, id, confirm = false }) {
  const unlock = lock();
  if (!unlock) throw new Error("Another run is going. Try again shortly.");
  try {
    const c = loadConfig(), state = loadState();
    const hits = id !== undefined ? (Object.hasOwn(state.items || {}, id) ? [state.items[id]] : []) : Object.values(state.items || {}).filter((it) => it.name === name);
    if (hits.length !== 1) throw new Error(hits.length ? "More than one video has that name. Recut refused." : "No video has that name.");
    const it = hits[0];
    name = it.name;
    if (it.status !== S.DONE || !it.filed) throw new Error(`${name} is ${it.status} and is not a filed done video. Recut refused.`);
    if (!confirm) return `${name} would move from Done to the drop folder and go to Opus on the next run. This costs at least 10 Opus credits. Use --yes to confirm. Old clips stay; new clips get a new folder.`;
    const db = clients(c).dropbox;
    if (!await db.exists(it.path)) throw new Error(`${name} is no longer in Done. A re-cut may already be waiting. Recut refused.`);
    await db.move(it.path, join(c.folders.drop, name));
    return `${name} goes to Opus on the next run. This costs at least 10 Opus credits. Old clips stay; new clips get a new folder.`;
  } finally { unlock(); }
}

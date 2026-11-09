import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { ReadStream, WriteStream } from "node:tty";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initStudio, withDefaults, parseTime, hhmm, NETWORKS } from "./content-studio.mjs";
import { detectConnectors, metricoolBrands } from "./studio-metricool.mjs";
import { KEY_NAMES, hasKey, saveKey, removeKey, validateCredential } from "./credentials.mjs";
import { cloudflaredBin } from "./publish-folder.mjs";
import { kitFolders } from "./studio-routine.mjs";

const read = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw new Error("A saved setup file could not be read. Keep it and ask for help."); }
};
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}
const expand = (value, home) => path.resolve(String(value).trim().replace(/^~(?=\/|$)/, home));
export function protectedFolder(dir, home = os.homedir()) {
  const rel = path.relative(home, dir);
  return !rel.startsWith("..") && /^(Desktop|Documents|Downloads|Library\/Mobile Documents)(\/|$)/.test(rel);
}
const zoneOK = (zone) => { try { new Intl.DateTimeFormat("en", { timeZone: zone }); return !!zone; } catch { return false; } };
const done = (answer, details = {}) => ({ ok: true, answer, ...details });
const needs = (message, details = {}) => ({ ok: false, message, ...details });
const command = (name, home) => process.env[`REEL_${name.toUpperCase()}_BIN`] || (fs.existsSync(path.join(home, ".local", "bin", name)) ? path.join(home, ".local", "bin", name) : name);
const serviceTitles = { elevenlabs: "ElevenLabs", runway: "Runway", pixabay: "Pixabay", pexels: "Pexels" };
export const SETUP_LINKS = Object.freeze({
  claude: "https://claude.ai/", metricool: "https://claude.ai/settings/connectors",
  codex: "https://chatgpt.com/", desktop: "https://claude.com/download",
  elevenlabs: "https://elevenlabs.io/app/developers/api-keys", runway: "https://dev.runwayml.com/",
  pixabay: "https://pixabay.com/api/docs/", pexels: "https://www.pexels.com/api/",
});

/** No command here creates media or posts. Both interfaces use these exact steps. */
export function createSetupSteps({ home, studioRoot, deps, config, patch }) {
  const auth = (name) => {
    const result = deps.run(command(name, home), name === "claude" ? ["auth", "status"] : ["login", "status"], { encoding: "utf8", timeout: 15000, cwd: home });
    if (result.status !== 0) return false;
    if (name === "codex") return /chatgpt/i.test(`${result.stdout || ""} ${result.stderr || ""}`);
    try { return JSON.parse(result.stdout).loggedIn === true; } catch { return false; }
  };
  const account = (id, title, optional) => ({
    id, title, optional, skip: optional,
    async check() { return auth(id) ? done({ signedIn: true }) : needs(id === "claude" ? "Sign in to Claude Code, then check again." : "Sign in to Codex with your ChatGPT account, then check again."); },
    async run(state, answer) {
      if (answer.action === "install" && id === "claude") {
        // Anthropic's own installer puts Claude Code in the user's home folder.
        const result = deps.run("/bin/bash", ["-c", "set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash"], { stdio: "inherit", cwd: home, env: { ...process.env, HOME: home }, timeout: 180000 });
        if (result.status !== 0) return needs("Claude Code did not install. Try the official installer in Terminal.");
      } else if (answer.action === "login") {
        deps.login(command(id, home), id === "claude" ? ["auth", "login"] : ["login"]);
        return needs("Finish signing in in the vendor window, then click Check.");
      }
      return this.check(state);
    },
  });
  const brands = async () => {
    const connectors = await deps.detectConnectors();
    if (!connectors.metricool?.connected) return needs("Connect Metricool in your Claude account, then click Check.");
    const connector = connectors.metricool.name;
    const list = await deps.metricoolBrands(connector);
    return { ok: false, connector, brands: list.map((b) => ({ id: String(b.id), name: String(b.label), networks: b.networks.filter((n) => NETWORKS.includes(n)), timezone: String(b.timezone || "") })), message: "Choose your brand by name and confirm where posts will go." };
  };
  return [
    account("claude", "Claude sign in", false),
    {
      id: "metricool", title: "Your Metricool brand", optional: false, skip: false,
      check: brands,
      async run(state, answer) {
        const found = await brands();
        if (!found.brands) return found;
        const matches = found.brands.filter((b) => b.name === answer.brand && (!answer.brandId || b.id === String(answer.brandId)));
        if (answer.confirm !== true || matches.length !== 1) return needs("Choose one listed brand by its full name and confirm it.", { brands: found.brands });
        const brand = matches[0];
        const networks = answer.networks;
        if (!Array.isArray(networks) || !networks.length || new Set(networks).size !== networks.length || networks.some((n) => !brand.networks.includes(n))) return needs("Choose only connected networks shown for that brand.", { brands: found.brands });
        if (!zoneOK(brand.timezone)) return needs("This brand needs a valid time zone in Metricool. Update it there, then check again.");
        const selection = { connector: found.connector, brand: brand.name, blogId: brand.id, networks };
        patch({ metricool: selection, timezone: brand.timezone });
        return done({ ...selection, timezone: brand.timezone });
      },
    },
    {
      id: "photos", title: "Your photo folder", optional: false, skip: false,
      async check() {
        const selected = config().photos;
        const folder = expand(path.isAbsolute(selected) || selected.startsWith("~/") ? selected : path.join(studioRoot, selected), home);
        return fs.existsSync(folder) && fs.statSync(folder).isDirectory() ? done({ folder }) : needs("Choose a photo folder that exists on this Mac.");
      },
      async run(state, answer) {
        const folder = expand(answer.folder || path.join(studioRoot, "Photos"), home);
        if (protectedFolder(folder, home)) return needs("Choose a folder in Pictures or your home folder so background jobs can read it.");
        if (folder === path.join(studioRoot, "Photos")) fs.mkdirSync(folder, { recursive: true });
        if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return needs("Choose a photo folder that exists on this Mac.");
        patch({ photos: folder });
        return done({ folder });
      },
    },
    {
      id: "media", title: "How media reaches Metricool", optional: false, skip: false,
      async check() {
        const answer = { route: config().hosting.route, folder: config().hosting.folder };
        if (answer.route === "tunnel" && !deps.directReady()) return needs("The file sharing tool is missing. Ask your kit provider for a tested update, or choose an advanced route.", { answer });
        if (answer.route !== "tunnel" && (!answer.folder || !fs.existsSync(answer.folder))) return needs("Choose your shared upload folder again.", { answer });
        return done(answer);
      },
      async run(state, answer) {
        const route = answer.route || "tunnel";
        if (!["tunnel", "drive", "dropbox"].includes(route)) return needs("Choose this Mac, Google Drive or Dropbox.");
        let folder = "";
        if (route !== "tunnel") {
          folder = expand(answer.folder || "", home);
          if (!answer.folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory() || answer.shared !== true) return needs("Choose your shared upload folder and confirm that Metricool can read its links.");
        }
        patch({ hosting: { route, folder } });
        return this.check(state);
      },
    },
    {
      id: "schedule", title: "Posting and photo times", optional: false, skip: false,
      async check(state) {
        const answer = { posting: config().publish.mode, slots: config().slots };
        return state.steps.schedule?.status === "done" ? done(answer) : needs("Choose whether to keep posting off or turn it on.", { answer });
      },
      async run(state, answer) {
        if (!["off", "Turn on posting", "keep"].includes(answer.posting)) return needs("Choose Keep posting off or Turn on posting.");
        const changes = {};
        if (answer.posting === "Turn on posting") {
          if (state.steps.claude?.status !== "done" || state.steps.metricool?.status !== "done") return needs("Check Claude and choose your Metricool brand before turning on posting.");
          changes.publish = { mode: "schedule" };
        } else if (answer.posting === "off") changes.publish = { mode: "off" };
        if (answer.slots !== undefined) {
          if (!Array.isArray(answer.slots) || (answer.slots.length && answer.brandGuideComplete !== true)) return needs("Finish your brand guide before choosing photo post times.");
          const slots = [];
          for (const slot of answer.slots) {
            const time = parseTime(slot.time);
            if (!time || !["carousel", "static"].includes(slot.format)) return needs("Choose a photo type and a valid time for each slot.");
            slots.push({ format: slot.format, time: hhmm(time) });
          }
          const times = slots.map((s) => parseTime(s.time)).map((t) => t.h * 60 + t.m).sort((a, b) => a - b);
          if (times.some((t, i) => i && t - times[i - 1] < 120)) return needs("Leave at least two hours between photo posts.");
          changes.slots = slots;
        }
        patch(changes);
        return done({ posting: config().publish.mode, slots: config().slots });
      },
    },
    ...Object.keys(KEY_NAMES).map((service) => ({
      id: `key-${service}`, title: `${serviceTitles[service]} key`, optional: true, skip: true, secret: true,
      async check() { return hasKey(service, { home }) ? done({ saved: true, verified: false }) : needs("Add a key, skip it, or add it later."); },
      async run(state, answer) {
        if (answer.action === "remove") { removeKey(service, { home }); return { ok: true, skipped: true, answer: { removed: true } }; }
        const result = await validateCredential(service, answer.value, { fetchFn: deps.fetchFn });
        if (result.status !== "valid") return needs(({ invalid: "This key was not accepted. Check it and try again.", "no-permission": "This key cannot read the account check. Review its permissions.", unreachable: "The service could not be reached. Your key has not been changed." })[result.status], { answer: { check: result.status } });
        saveKey(service, answer.value, { home });
        return done({ saved: true, verified: true });
      },
    })),
    account("codex", "ChatGPT sign in for Codex", true),
    {
      id: "health", title: "Optional health ping", optional: true, skip: true,
      async check() { return config().health.pingUrl ? done({ configured: true }) : needs("Add your own health ping address or skip it."); },
      async run(state, answer) {
        try {
          const url = new URL(answer.url);
          if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
        } catch { return needs("Use a health check address that starts with https and has no sign in details."); }
        patch({ health: { pingUrl: answer.url } });
        // Ping addresses can contain a secret. Only the settings file holds the address.
        return done({ configured: true });
      },
    },
    {
      id: "routines", title: "Check Claude routines", optional: false, skip: false,
      async check() {
        const result = await deps.verifyRoutines(studioRoot);
        const tasks = (result.tasks || []).map((t) => ({ id: String(t.id), enabled: t.enabled === true, schedule: String(t.schedule), folder: String(t.folder) }));
        return result.ok ? done({ tasks }) : needs("Posting routines still need attention in the Claude app. Open routine setup, then check again.", { tasks, desktopMissing: !deps.desktopApp() });
      },
      async run(state, answer) {
        if (answer.action === "prepare") {
          const app = deps.desktopApp();
          if (!app) return needs("Download the Claude app from the official page, then open it and sign in.", { desktopMissing: true });
          if (config().publish.mode === "off") return needs("Posting is off. Turn on posting when you are ready before preparing routines.");
          const notes = await deps.prepareRoutines(studioRoot);
          return needs("Paste the setup request into a local Code session in the Claude app, then check again.", { instructions: notes });
        }
        return this.check(state);
      },
    },
  ];
}

const defaultDeps = (home) => ({
  run: spawnSync, detectConnectors, metricoolBrands, fetchFn: globalThis.fetch,
  directReady: () => !!cloudflaredBin(),
  login(bin, args) { const child = spawn(bin, args, { stdio: "ignore", cwd: home }); child.on("error", () => {}); child.unref(); },
  desktopApp: () => ["/Applications/Claude.app", path.join(home, "Applications/Claude.app")].find((app) => fs.existsSync(app)),
  async verifyRoutines(studioRoot) {
    const routines = await import("./studio-routine.mjs");
    // Phase 2 routines builder supplies the verifier. Missing is pending, never success.
    return typeof routines.verifyRoutines === "function" ? routines.verifyRoutines(studioRoot) : { ok: false, tasks: [], problem: "Routine verification is not available yet." };
  },
  async prepareRoutines(studioRoot) {
    const routines = await import("./studio-routine.mjs");
    const { loadStudio } = await import("./content-studio.mjs");
    const studio = loadStudio(studioRoot);
    // The routines builder owns registration. Do not call the old app installer here.
    const result = routines.writeRoutine(studio, { home });
    spawnSync("pbcopy", [], { input: result.setup, encoding: "utf8" });
    const app = ["/Applications/Claude.app", path.join(home, "Applications/Claude.app")].find(fs.existsSync);
    if (app) spawnSync("open", [app]);
    return result.setup;
  },
});

export function createSetup({ home = os.homedir(), studioRoot = path.join(home, "Content Studio"), brandFrom, deps: overrides = {} } = {}) {
  studioRoot = expand(studioRoot, home);
  if (brandFrom) brandFrom = expand(brandFrom, home);
  const configFile = path.join(studioRoot, "studio.json"), stateFile = path.join(studioRoot, "setup-state.json");
  if (!fs.existsSync(configFile)) {
    if (brandFrom && !fs.existsSync(path.join(brandFrom, "brand.json"))) throw new Error("The kit Brand folder is missing brand.json.");
    const brand = brandFrom ? read(path.join(brandFrom, "brand.json"), {}) : {};
    const paths = initStudio(studioRoot, { brandFrom, config: { client: brand.name || "Your studio", slots: [], publish: { mode: "off" }, daily: { publisher: "claude" }, reels: { rawIntake: false, publisher: "claude" } } });
    kitFolders({ paths, config: read(configFile, {}) }, { home });
  }
  let state;
  const reload = () => {
    state = read(stateFile, { version: 1, steps: {} });
    if (state.version !== 1 || !state.steps || typeof state.steps !== "object" || Array.isArray(state.steps)) throw new Error("This saved setup needs a newer version of Reels.");
  };
  reload();
  const config = () => withDefaults(read(configFile, {}));
  const patch = (changes) => {
    const current = read(configFile, {});
    for (const [key, value] of Object.entries(changes)) current[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...current[key], ...value } : value;
    if (Object.keys(changes).length) atomic(configFile, current);
  };
  const deps = { ...defaultDeps(home), ...overrides };
  const steps = createSetupSteps({ home, studioRoot, deps, config, patch });
  let busy = false;
  const snapshot = () => {
    reload();
    const current = config();
    const photos = expand(path.isAbsolute(current.photos) || current.photos.startsWith("~/") ? current.photos : path.join(studioRoot, current.photos), home);
    return { version: state.version, studioRoot, steps: steps.map(({ id, title, optional, skip, secret }) => ({ id, title, optional, skip, secret: !!secret, status: "needs-you", ...(state.steps[id] || {}) })), posting: current.publish.mode, slots: current.slots, photos, hosting: current.hosting };
  };
  return {
    steps, stateFile, studioRoot, snapshot,
    next: () => { reload(); return steps.find((s) => !["done", "skipped"].includes(state.steps[s.id]?.status)); },
    async answer(id, answer = {}) {
      if (busy) throw new Error("A setup check is already running. Wait for it to finish.");
      const step = steps.find((s) => s.id === id);
      if (!step) throw new Error("Choose a listed setup step.");
      if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw new Error("Choose an answer for this step.");
      busy = true;
      const lock = path.join(studioRoot, ".setup.lock");
      let held = false;
      try {
        try { fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 }); held = true; }
        catch (error) {
          if (error.code !== "EEXIST") throw error;
          const pid = Number(fs.readFileSync(lock, "utf8"));
          let dead = false;
          if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (e) { dead = e.code === "ESRCH"; } }
          if (!dead) throw new Error("Another setup check is running. Wait for it to finish.");
          fs.unlinkSync(lock);
          fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 }); held = true;
        }
        reload();
        let result;
        if (["skip", "later"].includes(answer.action)) {
          result = step.skip ? { ok: true, skipped: true, answer: { choice: answer.action } } : needs("This step still needs your attention. You can finish setup later.");
        } else {
          try { result = answer.action === "check" ? await step.check(state) : await step.run(state, answer); }
          catch { result = needs("This check could not finish. Your saved answers are kept. Try again when you are ready."); }
        }
        state.steps[id] = { status: result.skipped ? "skipped" : result.ok ? "done" : "needs-you", answer: result.answer || {}, ...(result.message ? { message: result.message } : {}), ...(result.brands ? { brands: result.brands } : {}), ...(result.tasks ? { tasks: result.tasks } : {}), ...(result.desktopMissing ? { desktopMissing: true } : {}), ...(result.instructions ? { instructions: result.instructions } : {}) };
        atomic(stateFile, state);
        return snapshot();
      } finally { if (held) fs.unlinkSync(lock); busy = false; }
    },
  };
}

/** Kept for callers that already use this question helper. Empty means no photo posts. */
export async function askDailySlots(ask, slots = []) {
  const next = [];
  for (const format of ["carousel", "static"]) {
    const value = await ask(`Time for the ${format}, or none:`, slots.find((s) => s.format === format)?.time || "none");
    if (/^none$/i.test(value)) continue;
    const time = parseTime(value);
    if (!time) throw new Error("Choose a valid time or none.");
    next.push({ format, time: hhmm(time) });
  }
  return next;
}

/** Questions are injected in tests; secrets never go through a normal echoed question. */
export async function runTerminalSetup(setup, { ask, askSecret, write = console.log } = {}) {
  const saved = setup.snapshot().steps.filter((s) => s.status !== "needs-you");
  for (const item of saved) write(`${item.title}: ${item.status === "done" ? "Done" : "Skipped"}. ${describeSetupAnswer(item.id, item.answer)}`);
  let edit;
  if (saved.length) {
    saved.forEach((item, i) => write(`${i + 1}) ${item.title}`));
    const choice = await ask("To change a saved answer, type its number. Leave empty to continue:", "");
    if (choice) {
      if (!/^\d+$/.test(choice) || !saved[Number(choice) - 1]) { write("Choose a listed number next time. Your answers are kept."); return setup.snapshot(); }
      edit = setup.steps.find((s) => s.id === saved[Number(choice) - 1].id);
    }
  }
  for (let step = edit || setup.next(); step; step = setup.next()) {
    write(`\n${step.title}`);
    const checked = ["photos", "media", "schedule"].includes(step.id) ? setup.snapshot() : await setup.answer(step.id, { action: "check" });
    const view = checked.steps.find((s) => s.id === step.id);
    if (view.status === "done" && !["photos", "media", "schedule"].includes(step.id) && !edit) continue;
    edit = null;
    if (view.message) write(view.message);
    let answer;
    if (step.secret) {
      const choice = await ask("Add, Skip, or Add later?", "later");
      answer = /^add$/i.test(choice) ? { value: await askSecret("Paste your key:") } : { action: /^skip$/i.test(choice) ? "skip" : "later" };
    } else if (step.id === "metricool" && view.brands?.length) {
      for (const b of view.brands) write(`${b.name} (${b.id}): ${b.networks.join(", ")}; timezone ${b.timezone}`);
      const brand = await ask("Type the full brand name, or leave empty to finish later:", "");
      if (!brand) break;
      const matches = view.brands.filter((b) => b.name === brand);
      const brandId = matches.length > 1 ? await ask("Type the brand id shown above:", "") : matches[0]?.id;
      const networks = (await ask("Type the connected network names you want, separated by commas:", "")).split(",").map((s) => s.trim()).filter(Boolean);
      const confirm = /^yes$/i.test(await ask("Use this brand and these networks? Type yes to confirm:", ""));
      answer = { brand, brandId, networks, confirm };
    } else if (step.id === "photos") answer = { folder: await ask("Photo folder:", checked.photos) };
    else if (step.id === "media") {
      write(describeSetupAnswer("media", checked.hosting));
      const choice = await ask("Leave empty to keep this route, type mac for this Mac, or advanced for Google Drive and Dropbox:", "");
      if (!choice) answer = { ...checked.hosting, shared: true };
      else if (choice === "mac") answer = { route: "tunnel" };
      else if (choice === "advanced") {
        answer = { route: await ask("Type drive or dropbox:", ""), folder: await ask("Shared upload folder:", "") };
        answer.shared = /^yes$/i.test(await ask("Can Metricool read links from this folder? Type yes:", ""));
      } else answer = { route: "unlisted" };
    } else if (step.id === "schedule") {
      answer = { posting: await ask("Type off, keep, or Turn on posting:", "keep") };
      if (/^yes$/i.test(await ask("Have you finished the brand guide and want to choose photo times? Type yes:", ""))) { answer.brandGuideComplete = true; answer.slots = await askDailySlots(ask, checked.slots); }
    } else if (step.id === "health") {
      const url = await ask("Your health ping address, or leave empty to skip:", "");
      answer = url ? { url } : { action: "skip" };
    } else {
      if (step.id === "routines") write(`Claude app download: ${SETUP_LINKS.desktop}`);
      const action = await ask(step.id === "routines" ? "Type prepare, check, or later:" : "Type login, check, install, or later:", "later");
      if (action === "later" && !step.skip) break;
      answer = { action };
    }
    const result = await setup.answer(step.id, answer);
    const after = result.steps.find((s) => s.id === step.id);
    if (after.instructions) write(after.instructions);
    if (after.message) write(after.message);
    if (after.status === "needs-you" && !/^yes$/i.test(await ask("Try this step again? Type yes, or leave empty to finish later:", ""))) break;
  }
  write(`Setup saved. Posting is ${setup.snapshot().posting === "off" ? "off" : "on"}. Run reel setup to continue or change an answer.`);
  return setup.snapshot();
}

export async function setupCommand(args = [], { terminal = false } = {}) {
  const opt = (key) => { const at = args.indexOf(key); return at < 0 ? undefined : args[at + 1]; };
  const installedBrand = process.env.REEL_CLIENT_MODE === "1" && fs.existsSync(path.join(os.homedir(), ".reel", "brand.json")) ? path.join(os.homedir(), ".reel") : undefined;
  const setup = createSetup({ studioRoot: opt("--dir") || opt("--studio"), brandFrom: opt("--brand") || installedBrand });
  if (!terminal && !args.includes("--terminal")) {
    const { openSetupPage } = await import("./setup-page.mjs");
    return openSetupPage(setup);
  }
  if (args.includes("--yes")) { console.log("Setup saved. Run reel setup to choose your accounts. Posting settings are kept."); return setup.snapshot(); }
  let input, output;
  try { input = new ReadStream(fs.openSync("/dev/tty", "r")); output = new WriteStream(fs.openSync("/dev/tty", "w")); }
  catch { input?.destroy(); throw new Error("Open Terminal and run reel setup to continue."); }
  const tty = readline.createInterface({ input, output, terminal: true });
  const ask = (q, fallback = "") => new Promise((resolve, reject) => {
    const closed = () => reject(new Error("Setup saved. Run reel setup to continue."));
    tty.once("close", closed);
    tty.question(`${q} `, (value) => { tty.removeListener("close", closed); resolve(value.trim() || fallback); });
  });
  const askSecret = (question) => new Promise((resolve, reject) => {
    output.write(`${question} `);
    // readline still handles editing; only its output is muted while the key is typed.
    const original = tty._writeToOutput;
    const closed = () => { tty._writeToOutput = original; reject(new Error("Setup saved. Run reel setup to continue.")); };
    tty.once("close", closed);
    tty._writeToOutput = () => {};
    tty.question("", (value) => { tty.removeListener("close", closed); tty._writeToOutput = original; output.write("\n"); resolve(value); });
  });
  tty.on("SIGINT", () => tty.close());
  input.on("error", () => tty.close());
  try { return await runTerminalSetup(setup, { ask, askSecret }); }
  finally { tty.close(); input.destroy(); output.destroy(); }
}

export function describeSetupAnswer(id, answer = {}) {
  if (answer.choice) return answer.choice === "later" ? "Add later." : "Skipped.";
  if (answer.signedIn) return "Signed in.";
  if (id === "metricool" && answer.brand) return `${answer.brand}: ${answer.networks.join(", ")}. Time zone: ${answer.timezone}.`;
  if (id === "photos") return answer.folder || "";
  if (id === "media") return answer.route === "tunnel" ? "Directly from this Mac." : `${answer.route === "drive" ? "Google Drive" : "Dropbox"}: ${answer.folder}`;
  if (id === "schedule") return `Posting is ${answer.posting === "off" ? "off" : "on"}. Photo times: ${answer.slots?.map((s) => `${s.format} at ${s.time}`).join(", ") || "None"}.`;
  if (answer.saved) return answer.verified ? "Key saved and checked." : "Key already saved. It has not been checked here.";
  if (answer.removed) return "Key removed.";
  if (answer.configured) return "Health ping address saved.";
  return "";
}

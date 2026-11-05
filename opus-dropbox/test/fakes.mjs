// A fake Dropbox (API + content hosts) and a fake Opus on localhost, close enough to the real ones for the pipeline.
import http from "node:http";

const listen = (handler) =>
  new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
const body = (req) => new Promise((r) => { const parts = []; req.on("data", (d) => parts.push(d)); req.on("end", () => r(Buffer.concat(parts))); });
const json = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const lower = (p) => p.toLowerCase();
const parent = (p) => p.slice(0, p.lastIndexOf("/")) || "";
const leaf = (p) => p.slice(p.lastIndexOf("/") + 1);

export async function fakeDropbox() {
  const fx = {
    nodes: new Map(), // path_lower -> { id, tag, path, bytes }
    nextId: 1,
    calls: [],
    links: new Map(), // id -> url
    blockPublic: false,
    failSaveUrl: false,
    failUploads: 0,
    badArgHeaders: 0,
    jobs: new Map(),
    put(path, bytes = "video") { return add(path, "file", Buffer.from(bytes)); },
    folder(path) { return add(path, "folder"); },
    get(path) { return fx.nodes.get(lower(path)); },
    text(path) { return fx.get(path)?.bytes?.toString(); },
    names(dir) { return [...fx.nodes.values()].filter((n) => lower(parent(n.path)) === lower(dir)).map((n) => leaf(n.path)).sort(); },
    move(from, to) { const n = resolve(from); fx.nodes.delete(lower(n.path)); n.path = to; fx.nodes.set(lower(to), n); },
  };
  function add(path, tag, bytes) {
    for (let p = parent(path); p && !fx.nodes.has(lower(p)); p = parent(p)) fx.nodes.set(lower(p), { id: `id:${fx.nextId++}`, tag: "folder", path: p });
    const n = { id: `id:${fx.nextId++}`, tag, path, bytes };
    fx.nodes.set(lower(path), n);
    return n;
  }
  function resolve(p) {
    if (p.startsWith("id:")) return [...fx.nodes.values()].find((n) => n.id === p);
    return fx.nodes.get(lower(p));
  }
  const meta = (n) => ({ ".tag": n.tag, id: n.id, name: leaf(n.path), path_display: n.path, path_lower: lower(n.path), ...(n.tag === "file" ? { size: n.bytes.length } : {}) });
  // Dropbox's autorename: "a.mov" -> "a (1).mov", a folder "a" -> "a (1)".
  const free = (p) => {
    const m = leaf(p).match(/^(.*?)(\.[^.]+)?$/);
    let out = p, i = 1;
    while (fx.nodes.has(lower(out))) out = `${parent(p)}/${m[1]} (${i++})${m[2] || ""}`;
    return out;
  };
  const conflict = (res, what) => json(res, 409, { error_summary: `${what}/..`, error: { ".tag": what } });

  // Like the real save_url, a taken path is not replaced: the new file gets " (1)".
  async function fetchInto(path, url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    add(free(path), "file", Buffer.from(await r.arrayBuffer()));
  }

  const api = await listen(async (req, res) => {
    const raw = await body(req);
    const route = req.url.replace(/^\/2\//, "");
    if (req.url === "/oauth2/token") {
      const f = new URLSearchParams(raw.toString());
      fx.tokenForms = [...(fx.tokenForms || []), Object.fromEntries(f)];
      if (f.get("grant_type") === "authorization_code") return json(res, 200, { access_token: "tok", expires_in: 14400, refresh_token: `refresh-for-${f.get("code")}` });
      return json(res, 200, { access_token: "tok", expires_in: 14400 });
    }
    if (req.headers.authorization !== "Bearer tok") return json(res, 401, { error_summary: "invalid_access_token/" });
    const b = raw.length ? JSON.parse(raw) : null;
    fx.calls.push({ route, body: b, pathRoot: req.headers["dropbox-api-path-root"] });
    switch (route) {
      case "users/get_current_account": return json(res, 200, { email: "client@example.com", name: { display_name: "Client" }, root_info: { ".tag": "user", root_namespace_id: "1", home_namespace_id: "1" } });
      case "files/list_folder": {
        const dir = b.path === "" ? "" : resolve(b.path)?.path;
        if (dir === undefined) return conflict(res, "path/not_found");
        const entries = [...fx.nodes.values()].filter((n) => lower(parent(n.path)) === lower(dir)).map(meta);
        // two per page, so list_folder/continue gets used
        return json(res, 200, { entries: entries.slice(0, 2), has_more: entries.length > 2, cursor: JSON.stringify({ dir, at: 2 }) });
      }
      case "files/list_folder/continue": {
        const { dir, at } = JSON.parse(b.cursor);
        const entries = [...fx.nodes.values()].filter((n) => lower(parent(n.path)) === lower(dir)).map(meta);
        return json(res, 200, { entries: entries.slice(at, at + 2), has_more: entries.length > at + 2, cursor: JSON.stringify({ dir, at: at + 2 }) });
      }
      case "files/get_metadata": { const n = resolve(b.path); return n ? json(res, 200, meta(n)) : conflict(res, "path/not_found"); }
      case "files/create_folder_v2": {
        if (fx.nodes.has(lower(b.path)) && !b.autorename) return conflict(res, "path/conflict/folder");
        return json(res, 200, { metadata: meta(add(free(b.path), "folder")) });
      }
      case "files/move_v2": {
        const n = resolve(b.from_path);
        if (!n) return conflict(res, "from_lookup/not_found");
        const to = b.autorename ? free(b.to_path) : b.to_path;
        fx.move(n.id, to);
        return json(res, 200, { metadata: meta(n) });
      }
      case "sharing/create_shared_link_with_settings": {
        const n = resolve(b.path);
        if (!n) return conflict(res, "path/not_found");
        if (fx.blockPublic) return conflict(res, "settings_error/not_authorized");
        if (fx.links.has(n.id)) return json(res, 409, { error_summary: "shared_link_already_exists/metadata/..", error: { ".tag": "shared_link_already_exists", shared_link_already_exists: { metadata: { url: fx.links.get(n.id), link_permissions: { effective_audience: { ".tag": "public" } } } } } });
        const url = `https://www.dropbox.com/scl/fi/${n.id.slice(3)}/${encodeURIComponent(leaf(n.path))}?dl=0`;
        fx.links.set(n.id, url);
        return json(res, 200, { url, link_permissions: { effective_audience: { ".tag": "public" } } });
      }
      case "files/get_temporary_link": { const n = resolve(b.path); return json(res, 200, { link: `https://dl.dropboxusercontent.com/temp/${n.id.slice(3)}` }); }
      case "files/save_url": {
        const job = `job${fx.jobs.size + 1}`;
        fx.jobs.set(job, fx.failSaveUrl ? Promise.reject(new Error("nope")) : fetchInto(b.path, b.url));
        fx.jobs.get(job).catch(() => {});
        return json(res, 200, { ".tag": "async_job_id", async_job_id: job });
      }
      case "files/save_url/check_job_status": {
        try { await fx.jobs.get(b.async_job_id); return json(res, 200, { ".tag": "complete", path_display: "x" }); }
        catch { return json(res, 200, { ".tag": "failed", failed: { ".tag": "download_failed" } }); }
      }
      default: return json(res, 404, { error_summary: `no such route ${route}` });
    }
  });

  const content = await listen(async (req, res) => {
    const raw = await body(req);
    const argHeader = req.headers["dropbox-api-arg"];
    if (!/^[\x20-\x7e]*$/.test(argHeader)) fx.badArgHeaders++;
    const arg = JSON.parse(argHeader);
    const route = req.url.replace(/^\/2\//, "");
    fx.calls.push({ route, body: arg });
    if (fx.failUploads > 0) { fx.failUploads--; return json(res, 409, { error_summary: "path/insufficient_space/.." }); }
    if (route === "files/download") {
      const n = resolve(arg.path);
      if (!n) return json(res, 409, { error_summary: "path/not_found" });
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(n.bytes);
    }
    if (route === "files/upload") {
      const n = fx.get(arg.path);
      if (n) n.bytes = raw; else add(arg.path, "file", raw);
      return json(res, 200, meta(fx.get(arg.path)));
    }
    return json(res, 404, { error_summary: "no such route" });
  });

  const base = (s) => `http://127.0.0.1:${s.address().port}`;
  fx.api = base(api);
  fx.content = base(content);
  fx.close = () => { api.close(); content.close(); };
  return fx;
}

export async function fakeOpus() {
  const fx = {
    projects: new Map(),
    created: [],
    orgHeaders: [],
    createError: null, // { status, message } for the next create
    clipCount: 2,
    reverseClips: false,
    finish(id) { fx.projects.get(id).stage = "COMPLETE"; },
    stall(id, error) { Object.assign(fx.projects.get(id), { stage: "STALLED", error }); },
  };
  const server = await listen(async (req, res) => {
    const raw = await body(req);
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/files/")) { res.writeHead(200, { "Content-Type": "video/mp4" }); return res.end(`bytes of ${u.pathname}`); }
    if (req.headers.authorization !== "Bearer opus-key") return json(res, 401, { message: "bad key" });
    if (req.method === "GET" && u.pathname === "/api/brand-templates") return json(res, 200, [{ templateId: "t1", name: "Brand", isDefault: true }]);
    if (req.method === "POST" && u.pathname === "/api/clip-projects") {
      if (fx.createError) { const e = fx.createError; fx.createError = null; return json(res, e.status, { message: e.message }); }
      const b = JSON.parse(raw);
      const id = `P${fx.projects.size + 1}`;
      fx.created.push(b);
      fx.projects.set(id, { projectId: id, stage: "QUEUED", body: b });
      return json(res, 201, [{ projectId: id, stage: "QUEUED" }]);
    }
    const m = u.pathname.match(/^\/api\/clip-projects\/(.+)$/);
    if (req.method === "GET" && m) { const p = fx.projects.get(decodeURIComponent(m[1])); return p ? json(res, 200, p) : json(res, 404, { message: "not found" }); }
    if (req.method === "GET" && u.pathname === "/api/exportable-clips") {
      fx.orgHeaders.push(req.headers["x-opus-org-id"]);
      const pid = u.searchParams.get("projectId");
      let clips = Array.from({ length: fx.clipCount }, (_, i) => ({
        id: `${pid}.c${i + 1}`, curationId: `c${i + 1}`, projectId: pid, title: `Hook number ${i + 1}: why?`, description: `Description ${i + 1}`, hashtags: "#one #two",
        uriForExport: `${fx.url}/files/${pid}/${i + 1}.mp4`,
      }));
      if (fx.reverseClips) clips = clips.reverse();
      const page = Number(u.searchParams.get("pageNum")), size = Number(u.searchParams.get("pageSize"));
      const list = clips.slice((page - 1) * size, page * size);
      return json(res, 200, fx.plainClipList ? list : { data: list }); // the live API wraps the list
    }
    return json(res, 404, { message: "no route" });
  });
  fx.url = `http://127.0.0.1:${server.address().port}`;
  fx.close = () => server.close();
  return fx;
}

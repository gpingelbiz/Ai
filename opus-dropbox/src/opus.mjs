/**
 * The OpusClip Open API calls the pipeline needs (https://help.opus.pro/api-reference/overview). Needs an Opus plan
 * with API access (Pro, Max or Business). Every project bills at least 10 credits, however short the video.
 *
 * A project moves PENDING -> QUEUED -> IMPORT -> CURATE -> REFINE -> RENDER -> UPLOAD -> COMPLETE, or ends STALLED.
 * Clips come from /api/exportable-clips; each one's uriForExport is a signed download link that needs no login.
 */
export const API = "https://api.opus.pro";
export const DONE = "COMPLETE";
export const STALLED = "STALLED";

export class OpusError extends Error {
  constructor(status, message, body) {
    super(`Opus ${status}: ${message}`);
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createOpus({ apiKey, orgId, api = API, fetch = globalThis.fetch, wait = sleep }) {
  /**
   * One call. Reads retry on rate limits and server errors. Creating a project retries ONLY on a rate limit: after a
   * server error Opus may have taken the video anyway, and a second send would bill it twice.
   */
  async function call(method, path, { query, body, safeToRetry = method === "GET", org = orgId } = {}) {
    const url = new URL(path, api);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(org ? { "x-opus-org-id": org } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const again = r.status === 429 || (safeToRetry && r.status >= 500);
      if (again && attempt < 3) { await wait(Math.min(60000, (Number(r.headers.get("retry-after")) || 2 ** attempt) * 1000)); continue; }
      const text = await r.text();
      let j;
      try { j = text ? JSON.parse(text) : null; } catch { j = text; }
      if (!r.ok) throw new OpusError(r.status, (j && (j.message || j.error)) || text || r.statusText, j);
      return j;
    }
  }

  return {
    /** The account's brand templates: [{ templateId, name, isDefault }]. Also the cheapest way to test a key. */
    templates: () => call("GET", "/api/brand-templates", { query: { q: "mine" } }),

    /** Start a clip project. Returns the project id. */
    async create(body) {
      const r = await call("POST", "/api/clip-projects", { body, safeToRetry: false });
      const p = Array.isArray(r) ? r[0] : r; // the live API has answered with a one-item array
      const id = p?.projectId || p?.id;
      if (!id) throw new OpusError(200, `Opus answered without a project id: ${JSON.stringify(r).slice(0, 300)}`, r);
      return id;
    },

    project: (id) => call("GET", `/api/clip-projects/${encodeURIComponent(id)}`),

    /** Every clip of a finished project, in the order Opus lists them. orgId: the project's org (from its project record). */
    async clips(projectId, { orgId: org } = {}) {
      const out = [];
      const size = 50;
      for (let page = 1; ; page++) {
        const r = await call("GET", "/api/exportable-clips", { query: { q: "findByProjectId", projectId, pageNum: page, pageSize: size }, org: orgId || org });
        const items = Array.isArray(r) ? r : r?.data || []; // the live API wraps the list as { data: [...] }
        out.push(...items);
        if (items.length < size) return out;
      }
    },
  };
}

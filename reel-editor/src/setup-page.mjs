import fs from "node:fs";
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";

const equalToken = (given, token) => {
  const a = Buffer.from(String(given || "")), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Kept separate from listen so request security is testable without opening a port. */
export function createSetupHandler(setup, { token, origin, onFinish = () => {} }) {
  const expectedOrigin = () => typeof origin === "function" ? origin() : origin;
  return async (req, res) => {
    const nonce = randomBytes(24).toString("base64");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    const reply = (code, body) => {
      res.statusCode = code;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
    };
    try {
      const allowed = new URL(expectedOrigin());
      if (req.headers.host !== allowed.host || (req.headers.origin && req.headers.origin !== allowed.origin)) return reply(403, { error: "Open the setup link from Terminal again." });
      if (req.method !== "GET" && req.headers.origin !== allowed.origin) return reply(403, { error: "Open the setup link from Terminal again." });
      if (!req.url?.startsWith("/") || req.url.startsWith("//")) return reply(403, { error: "This setup address is not allowed." });
      const url = new URL(req.url, allowed.origin);
      if (url.origin !== allowed.origin || !equalToken(req.headers["x-reel-setup-token"] || url.searchParams.get("token"), token)) return reply(403, { error: "Open the setup link from Terminal again." });
      if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(fs.readFileSync(new URL("./setup-page.html", import.meta.url), "utf8").replaceAll("__NONCE__", nonce));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") return reply(200, setup.snapshot());
      if (req.method !== "POST" || !["/api/answer", "/api/finish"].includes(url.pathname)) return reply(404, { error: "This setup page was not found." });
      if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") return reply(415, { error: "Send this answer from the setup page." });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 16384) return reply(413, { error: "This answer is too long." });
        chunks.push(Buffer.from(chunk));
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return reply(400, { error: "This answer could not be read. Please try again." }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Choose an answer on the setup page." });
      if (url.pathname === "/api/finish") {
        res.once("finish", onFinish);
        return reply(200, { finished: true });
      }
      const state = await setup.answer(body.id, body.answer);
      return reply(200, state);
    } catch {
      // Never return raw provider errors or request bodies: they can contain keys.
      return reply(400, { error: "This step could not finish. Your answers are saved. Please try again." });
    }
  };
}

export async function openSetupPage(setup, { open = (url) => spawnSync("open", [url]), write = console.log } = {}) {
  const token = randomBytes(32).toString("hex");
  let origin;
  const server = http.createServer(createSetupHandler(setup, { token, origin: () => origin, onFinish: () => { server.close(); server.closeIdleConnections(); } }));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  }).catch((cause) => { throw new Error("The setup page could not open. Run reel setup with the Terminal option to continue.", { cause }); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/?token=${token}`;
  write(`Open this setup page on this Mac: ${url}`);
  try { open(url); } catch { /* The printed link also works when no browser can be opened. */ }
  return { server, url, finished: new Promise((resolve) => server.once("close", resolve)) };
}

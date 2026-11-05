import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { signInRequest, pathRootOf, dropboxSignIn } from "../src/setup.mjs";
import { plist, LABEL } from "../src/launchd.mjs";
import { fakeDropbox } from "./fakes.mjs";

test("the Dropbox sign-in link asks for a long-lived PKCE sign-in back to this Mac", () => {
  const r = signInRequest("app123");
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, "https://www.dropbox.com/oauth2/authorize");
  assert.equal(u.searchParams.get("client_id"), "app123");
  assert.equal(u.searchParams.get("token_access_type"), "offline");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:53682/dropbox");
  const expect = crypto.createHash("sha256").update(r.verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(u.searchParams.get("code_challenge"), expect);
  assert.equal(u.searchParams.get("state"), r.state);
});

test("the Allow click comes back to this Mac and is traded for a refresh token", async () => {
  const dbx = await fakeDropbox();
  try {
    let page;
    const token = await dropboxSignIn("app123", {
      port: 53699, api: dbx.api, say: () => {},
      // stands in for the browser: Dropbox redirects to the Mac with the code and the same state
      openUrl: async (url) => {
        const u = new URL(url);
        const back = new URL(u.searchParams.get("redirect_uri"));
        back.searchParams.set("code", "c0de");
        await fetch(`${back.origin}${back.pathname}?code=nope&state=wrong`); // a stale link is refused
        back.searchParams.set("state", u.searchParams.get("state"));
        page = await (await fetch(back)).text();
      },
    });
    assert.equal(token, "refresh-for-c0de");
    const form = dbx.tokenForms.at(-1);
    assert.equal(form.grant_type, "authorization_code");
    assert.equal(form.client_id, "app123");
    assert.equal(form.redirect_uri, "http://localhost:53699/dropbox");
    assert.ok(form.code_verifier.length >= 43);
    await new Promise((r) => setTimeout(r, 20));
    assert.match(page, /Dropbox is connected/);
  } finally { dbx.close(); }
});

test("team accounts use the team root; personal accounts do not", () => {
  assert.equal(pathRootOf({ root_info: { ".tag": "team", root_namespace_id: "9", home_namespace_id: "4" } }), "9");
  assert.equal(pathRootOf({ root_info: { ".tag": "user", root_namespace_id: "4", home_namespace_id: "4" } }), "");
  assert.equal(pathRootOf({ root_info: { ".tag": "user", root_namespace_id: "9", home_namespace_id: "4" } }), "9");
});

test("the background job runs one pass every 5 minutes", () => {
  const xml = plist({ node: "/usr/local/bin/node", script: "/x/bin/opus-dropbox.mjs", home: "/h & co" });
  assert.match(xml, new RegExp(`<string>${LABEL}</string>`));
  assert.match(xml, /<string>\/usr\/local\/bin\/node<\/string><string>\/x\/bin\/opus-dropbox.mjs<\/string><string>run<\/string>/);
  assert.match(xml, /<integer>300<\/integer>/);
  assert.match(xml, /\/h &amp; co\/launchd.log/);
});

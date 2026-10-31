import { test } from "node:test";
import assert from "node:assert/strict";
import { hasGregIdentity, identityLeaks, maskHome } from "../src/speaker-guard.mjs";
import { assertNoGreg } from "../src/speaker-intake.mjs";

test("speaker guard: a client's files under the operator's home folder are not Greg's identity", () => {
  assert.equal(hasGregIdentity("/Users/gregpingel/Clients/Julee Gracey/brand.json"), false);
  assert.equal(hasGregIdentity("file:///Users/gregpingel/Reels/speaker-clients/julee-gracey/proof/logo.png"), false);
  assert.equal(maskHome('{"file":"/Users/gregpingel/x"}'), '{"file":"/Users/local/x"}');
  const manifest = { brand: { file: "/Users/gregpingel/Clients/Julee Gracey/brand.json" }, identity: { name: "Julee Gracey" } };
  assert.equal(assertNoGreg(manifest, "manifest"), manifest);
});

test("speaker guard: Greg's name, handle and brand still fail anywhere in the copy", () => {
  for (const text of ["Greg Pingel", "greg  pingel", "@officialgregpingel", "pingel-brand look", "Book via Pingel Consulting"]) {
    assert.equal(hasGregIdentity(text), true, text);
  }
  assert.deepEqual(identityLeaks({ items: [{ card: { name: "Greg Pingel" } }] }, "plan"), ["plan.items.0.card.name"]);
  assert.throws(() => assertNoGreg({ identity: { tagline: "Coached by Greg Pingel" } }, "manifest"), /manifest.identity.tagline/);
});

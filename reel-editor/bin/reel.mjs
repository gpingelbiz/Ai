#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PKG_ROOT } from "../src/util.mjs";
import { main } from "../src/cli.mjs";

// `elevenlabs onboard` writes ELEVENLABS_API_KEY to .env.local; a value already in the environment wins.
const envFile = path.join(PKG_ROOT, ".env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

main(process.argv.slice(2)).catch((err) => {
  console.error("[reel] error:", err?.message || err);
  if (process.env.REEL_DEBUG) console.error(err);
  process.exit(1);
});

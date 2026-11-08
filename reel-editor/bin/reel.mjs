#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PKG_ROOT } from "../src/util.mjs";

async function start() {
  const args = process.argv.slice(2);
  if (args[0] === "accept") {
    const { acceptCommand } = await import("../src/acceptance.mjs");
    process.exitCode = await acceptCommand(args.slice(1));
    return;
  }
  // `elevenlabs onboard` writes this file; the offline editing check needs no keys.
  const envFile = path.join(PKG_ROOT, ".env.local");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const { main } = await import("../src/cli.mjs");
  await main(args);
}

start().catch((err) => {
  console.error("[reel] error:", err?.message || err);
  if (process.env.REEL_DEBUG) console.error(err);
  process.exit(1);
});

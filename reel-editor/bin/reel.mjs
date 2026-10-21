#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).catch((err) => {
  console.error("[reel] error:", err?.message || err);
  if (process.env.REEL_DEBUG) console.error(err);
  process.exit(1);
});

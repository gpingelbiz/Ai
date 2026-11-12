#!/usr/bin/env node
import { scanStitch } from "../src/stitch-watch.mjs";
const [root, seen, job, envFile = ""] = process.argv.slice(2);
try { await scanStitch(root, { seen, job, envFile }); }
catch (error) { console.error(`[reel] stitch scan: ${error.message}`); process.exitCode = 1; }

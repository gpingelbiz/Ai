#!/usr/bin/env node
// install.sh keeps this Terminal entry point. The browser uses the same saved steps.
import { pathToFileURL } from "node:url";
import { setupCommand } from "../src/setup-steps.mjs";
export { protectedFolder, askDailySlots } from "../src/setup-steps.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setupCommand(process.argv.slice(2), { terminal: true }).catch(() => {
    console.error("Setup stopped. Your answers are saved. Run reel setup to continue.");
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
// install.sh keeps this Terminal entry point. The browser uses the same saved steps.
import { pathToFileURL } from "node:url";
import { setupCommand } from "../src/setup-steps.mjs";
import { isMain } from "../src/util.mjs";
export { protectedFolder, askDailySlots } from "../src/setup-steps.mjs";

if (isMain(import.meta.url)) {
  setupCommand(process.argv.slice(2), { terminal: true }).catch(() => {
    console.error("Setup stopped. Your answers are saved. Run reel setup to continue.");
    process.exitCode = 1;
  });
}

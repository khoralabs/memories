#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };
import { dispatch } from "./commands/handlers.ts";
import { handleHelp } from "./commands/help.ts";
import { boolFlag, parseArgv } from "./lib/argv.ts";

async function main(): Promise<void> {
  const { positional, flags } = parseArgv(process.argv.slice(2));
  if (boolFlag(flags, "version", "V")) return void console.log(pkg.version);
  if (positional.length === 0 || boolFlag(flags, "help", "h")) {
    handleHelp();
    process.exit(positional.length === 0 && !boolFlag(flags, "help", "h") ? 1 : 0);
  }
  await dispatch(positional, flags);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

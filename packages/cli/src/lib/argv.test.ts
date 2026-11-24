import { describe, expect, test } from "bun:test";
import { boolFlag, parseArgv, strFlag } from "./argv.ts";

describe("parseArgv", () => {
  test("positional, valued, inline, and boolean flags", () => {
    const { positional, flags } = parseArgv([
      "skills",
      "install",
      "-y",
      "--db",
      "a.db",
      "--limit=5",
      "--json",
    ]);
    expect(positional).toEqual(["skills", "install"]);
    expect(boolFlag(flags, "yes", "y")).toBe(true);
    expect(boolFlag(flags, "json")).toBe(true);
    expect(strFlag(flags, "db")).toBe("a.db");
    expect(strFlag(flags, "limit")).toBe("5");
  });
});

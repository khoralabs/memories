import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectExportEntries,
  fixDeclarationSpecifiers,
  srcPathToDistPaths,
  toPublishedExports,
} from "./build-package";

describe("srcPathToDistPaths", () => {
  test("maps ts entry to js + d.ts", () => {
    expect(srcPathToDistPaths("./src/index.ts")).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    });
  });
});

describe("toPublishedExports", () => {
  test("rewrites export map to dist", () => {
    expect(
      toPublishedExports({
        ".": {
          types: "./src/index.ts",
          import: "./src/index.ts",
          default: "./src/index.ts",
        },
        "./persistence": {
          types: "./src/persistence/index.ts",
          import: "./src/persistence/index.ts",
          default: "./src/persistence/index.ts",
        },
      }),
    ).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      },
      "./persistence": {
        types: "./dist/persistence/index.d.ts",
        import: "./dist/persistence/index.js",
        default: "./dist/persistence/index.js",
      },
    });
  });
});

describe("collectExportEntries", () => {
  test("reads src entries from package.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "memories-build-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src/index.ts"), "export {}\n");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        exports: {
          ".": { import: "./src/index.ts" },
        },
      }),
    );
    expect(collectExportEntries(dir)).toEqual(["./src/index.ts"]);
  });
});

describe("fixDeclarationSpecifiers", () => {
  test("rewrites .ts and @/ in d.ts", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "memories-dts-"));
    const dist = path.join(dir, "dist");
    mkdirSync(path.join(dist, "components"), { recursive: true });
    const file = path.join(dist, "components/button.d.ts");
    writeFileSync(file, `export * from "../canonical.ts";\nimport { cn } from "@/lib/utils";\n`);
    fixDeclarationSpecifiers(file, dist);
    expect(readFileSync(file, "utf8")).toBe(
      `export * from "../canonical.js";\nimport { cn } from "../lib/utils.js";\n`,
    );
  });
});

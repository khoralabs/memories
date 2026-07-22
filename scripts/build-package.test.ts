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

describe("bun nested export * from external", () => {
  // Bun preserves top-level `export * from "pkg"` on an entry, but nested
  // `export * from "pkg"` inside a re-exported barrel becomes `__reExport(ns, name)`
  // without binding `name` — which throws at runtime. Keep external star re-exports
  // on the package entry root (see packages/node/src/index.ts).
  async function buildWithFakeExternal(entrySource: Record<string, string>): Promise<string> {
    const dir = mkdtempSync(path.join(tmpdir(), "memories-reexport-"));
    const pkgName = "@test/external-mod";
    mkdirSync(path.join(dir, "node_modules", pkgName), { recursive: true });
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "node_modules", pkgName, "package.json"),
      JSON.stringify({ name: pkgName, type: "module", exports: { ".": "./index.js" } }),
    );
    writeFileSync(path.join(dir, "node_modules", pkgName, "index.js"), `export const value = 1;\n`);
    for (const [rel, source] of Object.entries(entrySource)) {
      const abs = path.join(dir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, source.replaceAll("__PKG__", pkgName));
    }
    const outdir = path.join(dir, "out");
    const result = await Bun.build({
      entrypoints: [path.join(dir, "src/index.ts")],
      outdir,
      packages: "external",
      target: "node",
    });
    expect(result.success).toBe(true);
    return readFileSync(path.join(outdir, "index.js"), "utf8");
  }

  test("top-level export * from external is preserved", async () => {
    const js = await buildWithFakeExternal({
      "src/index.ts": `export * from "__PKG__";\nexport const local = 2;\n`,
    });
    expect(js).toContain('export * from "@test/external-mod"');
    expect(js).not.toContain("__reExport");
  });

  test("nested export * from external becomes broken __reExport", async () => {
    const js = await buildWithFakeExternal({
      "src/core.ts": `export * from "__PKG__";\nexport const local = 2;\n`,
      "src/index.ts": `export * from "./core.ts";\n`,
    });
    expect(js).toContain("__reExport");
  });
});

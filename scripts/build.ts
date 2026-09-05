/**
 * Build memories packages for npm:
 * - JS: bun bundler (export entries, packages external)
 * - types: tsc --emitDeclarationOnly
 *
 * Usage: bun run scripts/build.ts [pkgDir]   (default: every publishable package)
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export type PublishablePackage = {
  name: string;
  dir: string;
  /** No TypeScript build step; published as-is. */
  noBuild?: boolean;
};

/** Publishable packages in dependency order (build + publish order). */
export const PUBLISH_ORDER: PublishablePackage[] = [
  { name: "@khoralabs/memories-node", dir: "packages/node" },
  { name: "@khoralabs/memories-otel", dir: "packages/otel" },
  { name: "@khoralabs/memories-service", dir: "packages/service" },
  { name: "@khoralabs/memories-agents", dir: "packages/agents" },
  { name: "@khoralabs/memories-spec", dir: "packages/spec", noBuild: true },
];

export type ExportTarget = {
  types?: string;
  import?: string;
  default?: string;
  [key: string]: unknown;
};

export function srcPathToDistPaths(srcPath: string): {
  types: string;
  import: string;
  default: string;
} {
  if (!srcPath.startsWith("./src/")) {
    throw new Error(`expected ./src/… export path, got ${srcPath}`);
  }
  const withoutExt = srcPath.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, "");
  return {
    types: `${withoutExt}.d.ts`,
    import: `${withoutExt}.js`,
    default: `${withoutExt}.js`,
  };
}

export function toPublishedExports(
  exportsMap: Record<string, ExportTarget | string>,
): Record<string, ExportTarget | string> {
  const out: Record<string, ExportTarget | string> = {};
  for (const [key, value] of Object.entries(exportsMap)) {
    if (typeof value === "string") {
      out[key] = value.startsWith("./src/") ? srcPathToDistPaths(value) : value;
      continue;
    }
    const importPath =
      (typeof value.import === "string" && value.import) ||
      (typeof value.default === "string" && value.default) ||
      (typeof value.types === "string" && value.types);
    if (!importPath || typeof importPath !== "string" || !importPath.startsWith("./src/")) {
      out[key] = value;
      continue;
    }
    out[key] = srcPathToDistPaths(importPath);
  }
  return out;
}

/** Collect ./src/… entry files from package.json exports (paths relative to pkgDir). */
export function collectExportEntries(pkgDir: string): string[] {
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
    exports?: Record<string, ExportTarget | string>;
  };
  const entries = new Set<string>();
  for (const value of Object.values(pkg.exports ?? {})) {
    const src =
      typeof value === "string"
        ? value
        : (typeof value.import === "string" && value.import) ||
          (typeof value.default === "string" && value.default) ||
          (typeof value.types === "string" && value.types) ||
          undefined;
    if (!src?.startsWith("./src/")) continue;
    const abs = path.join(pkgDir, src);
    if (!existsSync(abs)) throw new Error(`export entry missing: ${src}`);
    entries.add(src);
  }
  if (entries.size === 0) throw new Error(`no ./src export entries in ${pkgDir}`);
  return [...entries];
}

/**
 * tsc leaves .ts extensions and @/ aliases in .d.ts; fix those for npm consumers.
 * (Bun already emits clean JS.)
 */
export function fixDeclarationSpecifiers(filePath: string, distRoot: string): void {
  const original = readFileSync(filePath, "utf8");
  const rewritten = original.replace(
    /(?<=(?:from\s+|import\s*\(\s*|import\s+)["'])([^"']+)(?=["'])/g,
    (spec) => {
      if (spec.startsWith("@/")) {
        let rel = path.relative(path.dirname(filePath), path.join(distRoot, spec.slice(2)));
        rel = rel.split(path.sep).join("/");
        if (!rel.startsWith(".")) rel = `./${rel}`;
        return `${rel.replace(/\.tsx?$/, "")}.js`;
      }
      if (spec.startsWith(".") && /\.tsx?$/.test(spec)) return spec.replace(/\.tsx?$/, ".js");
      return spec;
    },
  );
  if (rewritten !== original) writeFileSync(filePath, rewritten);
}

function walkDts(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkDts(full, out);
    else if (name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function walkJs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkJs(full, out);
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Fail if dist still imports the development JSX runtime (breaks NODE_ENV=production hosts). */
export function assertDistNoJsxDevRuntime(distDir: string): void {
  const offenders: string[] = [];
  for (const file of walkJs(distDir)) {
    const src = readFileSync(file, "utf8");
    if (src.includes("jsx-dev-runtime")) {
      offenders.push(path.relative(distDir, file));
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `dist contains react/jsx-dev-runtime (use bun build --production): ${offenders.join(", ")}`,
    );
  }
}

export async function buildPackage(pkgDir: string): Promise<void> {
  const distDir = path.join(pkgDir, "dist");
  const tsconfigPath = path.join(pkgDir, "tsconfig.build.json");
  if (!existsSync(tsconfigPath)) {
    throw new Error(`missing ${tsconfigPath}`);
  }

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const entries = collectExportEntries(pkgDir);
  const js =
    await Bun.$`bun build ${entries} --outdir=dist --root=src --target=node --format=esm --packages=external --production`
      .cwd(pkgDir)
      .nothrow();
  if (js.exitCode !== 0) {
    console.error(js.stderr.toString() || js.stdout.toString());
    throw new Error(`bun build failed: ${pkgDir}`);
  }
  assertDistNoJsxDevRuntime(distDir);

  const dts = await Bun.$`tsc -p ${tsconfigPath} --emitDeclarationOnly`.cwd(pkgDir).nothrow();
  if (dts.exitCode !== 0) {
    console.error(dts.stderr.toString() || dts.stdout.toString());
    throw new Error(`tsc --emitDeclarationOnly failed: ${pkgDir}`);
  }

  for (const file of walkDts(distDir)) {
    fixDeclarationSpecifiers(file, distDir);
  }

  pruneTestArtifacts(distDir);
}

/** Remove any *.test.* emit that slipped into dist. */
function pruneTestArtifacts(distDir: string): void {
  const stack = [distDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        stack.push(full);
        continue;
      }
      if (name.includes(".test.")) rmSync(full, { force: true });
    }
  }
}

export function applyPublishedPackageJson(pkgDir: string): () => void {
  const pkgPath = path.join(pkgDir, "package.json");
  const original = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(original) as {
    exports?: Record<string, ExportTarget | string>;
    files?: string[];
    main?: string;
    types?: string;
    module?: string;
  };

  if (pkg.exports) {
    pkg.exports = toPublishedExports(pkg.exports);
    const root = pkg.exports["."];
    if (root && typeof root === "object") {
      if (typeof root.import === "string") pkg.main = root.import;
      if (typeof root.types === "string") pkg.types = root.types;
      pkg.module = typeof root.import === "string" ? root.import : pkg.module;
    }
  }
  pkg.files = ["dist", "README.md"];

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return () => writeFileSync(pkgPath, original);
}

/** Build every publishable package that has a TypeScript build. */
export async function buildAllPackages(): Promise<void> {
  const root = path.join(import.meta.dir, "..");
  let built = 0;
  for (const pkg of PUBLISH_ORDER) {
    if (pkg.noBuild) {
      console.log(`skip ${pkg.name} (no TS build)`);
      continue;
    }
    console.log(`→ building ${pkg.name}`);
    await buildPackage(path.join(root, pkg.dir));
    console.log(`  ok ${pkg.dir}/dist`);
    built += 1;
  }
  console.log(`\nBuilt ${built} package(s).`);
}

if (import.meta.main) {
  const target = process.argv[2];
  if (target) {
    const pkgDir = path.resolve(target);
    await buildPackage(pkgDir);
    console.log(`built ${path.join(pkgDir, "dist")}`);
  } else {
    await buildAllPackages();
  }
}

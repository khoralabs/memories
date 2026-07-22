export * from "./core/index";
// Top-level `export *` from externals is preserved by Bun's bundler.
// Nested `export *` inside a re-exported barrel becomes a broken `__reExport(ns, name)`
// with no `import * as name` binding — see scripts/build-package.test.ts.
export * from "./persistence/core/persistence";

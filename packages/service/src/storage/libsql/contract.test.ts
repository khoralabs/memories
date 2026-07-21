import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMemoriesDatabaseBackendContractTests } from "../../testing/index";
import { createLocalLibsqlBackend, createLocalLibsqlBackendFactory } from "./local-libsql-backend";

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-libsql-storage-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

runMemoriesDatabaseBackendContractTests(
  "libsql",
  () => {
    const dataDir = makeTempDataDir();
    return createLocalLibsqlBackend({
      strategy: {
        kind: "libsql",
        dataDir,
        encryptionKey: "test-libsql-encryption-key",
      },
    });
  },
  {
    canEnumerate: true,
    supportsCheckpoint: true,
    supportsSnapshot: false,
    requiresSyncHandle: false,
    deleteClearsExistence: true,
  },
);

describe("createLocalLibsqlBackendFactory", () => {
  test("rejects non-libsql strategies", () => {
    const factory = createLocalLibsqlBackendFactory();
    expect(() => factory.create({ kind: "sqlite", dataDir: makeTempDataDir() })).toThrow(
      "Expected libsql strategy",
    );
  });

  test("creates a libsql backend", () => {
    const factory = createLocalLibsqlBackendFactory();
    const backend = factory.create({
      kind: "libsql",
      dataDir: makeTempDataDir(),
      encryptionKey: "k",
    });
    expect(backend.strategy.kind).toBe("libsql");
  });
});

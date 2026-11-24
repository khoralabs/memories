import { MemoriesClientAsync } from "@khoralabs/memories-node";
import { defineOntology, type LabelSchemaMap } from "@khoralabs/memories-node/ontology";
import {
  createMemoriesPersistenceAsync,
  openMemoriesDatabase,
} from "@khoralabs/memories-node/sqlite";
import { z } from "zod";
import { DB_KEY_ENV } from "./config.ts";

const emptyProps = z.object({});

/** Baseline agent ontology (mirrors memories-service minimal-agent-ontology; no service dependency). */
export const minimalOntology = defineOntology({
  nodeLabels: { Memory: emptyProps.describe("Generic text memory.") },
  edgeLabels: { References: emptyProps.describe("Default peer link.") },
});

export function openStore(dbPath: string, env = process.env) {
  const sqlCipherKey = env[DB_KEY_ENV]?.trim();
  const db = openMemoriesDatabase(dbPath, sqlCipherKey ? { sqlCipherKey } : {});
  const client = new MemoriesClientAsync<LabelSchemaMap, LabelSchemaMap>(
    createMemoriesPersistenceAsync(db),
    minimalOntology,
  );
  return { client, close: () => db.close() };
}

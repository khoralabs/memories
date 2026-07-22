import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { openEncryptedDatabaseSync } from "@khoralabs/sqlite-crypto";
import type {
  MemoriesDatabaseId,
  MemoriesDatabaseOntologyStore,
  OntologyLinkRecord,
  StoredOntologyJsonSchema,
} from "../../storage/core/index";
import {
  currentLinkForRows,
  hashStoredOntology,
  listOntologyLabelKinds,
  normalizeStoredOntologyJsonSchema,
  ontologyMatchesLabelKinds,
  parseDatabaseKey,
  validateMemoriesDatabaseId,
} from "../../storage/core/index";

const ONTOLOGY_SCHEMA = `
CREATE TABLE IF NOT EXISTS ontologies (
  ontology_hash TEXT PRIMARY KEY,
  ontology_json TEXT NOT NULL,
  node_kinds_json TEXT NOT NULL,
  edge_kinds_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS database_ontology_links (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  ontology_hash TEXT NOT NULL REFERENCES ontologies(ontology_hash),
  linked_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_links_database ON database_ontology_links(kind, owner_key, linked_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_links_hash ON database_ontology_links(ontology_hash);
`;

function parseOntology(json: string): StoredOntologyJsonSchema {
  return JSON.parse(json) as StoredOntologyJsonSchema;
}

function currentLinkRow(
  rows: Array<{ ontology_hash: string; linked_at_ms: number; link_id: number }>,
): { ontology_hash: string; linked_at_ms: number; link_id: number } | undefined {
  const indexed = rows.map((row) => ({
    ...row,
    linkedAtMs: row.linked_at_ms,
    linkId: row.link_id,
  }));
  return currentLinkForRows(indexed);
}

export type SqliteOntologyStoreOptions = {
  registryPath: string;
  sqlCipherKey: string;
};

export function createSqliteOntologyStore(
  opts: SqliteOntologyStoreOptions,
): MemoriesDatabaseOntologyStore {
  mkdirSync(path.dirname(opts.registryPath), { recursive: true });
  const db = openEncryptedDatabaseSync(opts.registryPath, { create: true }, opts.sqlCipherKey);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  db.exec(ONTOLOGY_SCHEMA);

  const now = () => Date.now();
  const insertOntology = db.prepare(`
    INSERT OR IGNORE INTO ontologies (ontology_hash, ontology_json, node_kinds_json, edge_kinds_json, created_at_ms)
    VALUES (?, ?, ?, ?, ?)
  `);
  const selectOntology = db.prepare(`
    SELECT ontology_json FROM ontologies WHERE ontology_hash = ?
  `);
  const insertLink = db.prepare(`
    INSERT INTO database_ontology_links (kind, owner_key, ontology_hash, linked_at_ms)
    VALUES (?, ?, ?, ?)
  `);
  const selectLinksForDatabase = db.prepare(`
    SELECT link_id, ontology_hash, linked_at_ms
    FROM database_ontology_links
    WHERE kind = ? AND owner_key = ?
    ORDER BY linked_at_ms ASC, link_id ASC
  `);
  const selectAllLinks = db.prepare(`
    SELECT link_id, kind, owner_key, ontology_hash, linked_at_ms
    FROM database_ontology_links
  `);
  const ontologyExists = db.prepare(`
    SELECT 1 FROM ontologies WHERE ontology_hash = ?
  `);

  function register(schema: StoredOntologyJsonSchema): { hash: string } {
    const normalized = normalizeStoredOntologyJsonSchema(schema);
    const hash = hashStoredOntology(normalized);
    const kinds = listOntologyLabelKinds(normalized);
    insertOntology.run(
      hash,
      JSON.stringify(normalized),
      JSON.stringify(kinds.nodeKinds),
      JSON.stringify(kinds.edgeKinds),
      now(),
    );
    return { hash };
  }

  function currentLinksByDatabase(): Map<string, { hash: string; linkedAtMs: number }> {
    const rows = selectAllLinks.all() as Array<{
      link_id: number;
      kind: string;
      owner_key: string;
      ontology_hash: string;
      linked_at_ms: number;
    }>;
    const grouped = new Map<
      string,
      Array<{ ontology_hash: string; linked_at_ms: number; link_id: number }>
    >();
    for (const row of rows) {
      const key = `${row.kind}\0${row.owner_key}`;
      const bucket = grouped.get(key);
      const entry = {
        ontology_hash: row.ontology_hash,
        linked_at_ms: row.linked_at_ms,
        link_id: row.link_id,
      };
      if (bucket === undefined) grouped.set(key, [entry]);
      else bucket.push(entry);
    }
    const current = new Map<string, { hash: string; linkedAtMs: number }>();
    for (const [key, bucket] of grouped) {
      const latest = currentLinkRow(bucket);
      if (latest !== undefined) {
        current.set(key, { hash: latest.ontology_hash, linkedAtMs: latest.linked_at_ms });
      }
    }
    return current;
  }

  return {
    async registerOntology(schema) {
      return register(schema);
    },

    async getOntology(hash) {
      const row = selectOntology.get(hash) as { ontology_json: string } | null;
      if (row == null) return undefined;
      return parseOntology(row.ontology_json);
    },

    async linkDatabase(id, hash) {
      const validated = validateMemoriesDatabaseId(id);
      if (ontologyExists.get(hash) == null) {
        throw new Error(`Unknown ontology hash: ${hash}`);
      }
      insertLink.run(validated.kind, validated.ownerKey, hash, now());
    },

    async getCurrentLink(id) {
      const validated = validateMemoriesDatabaseId(id);
      const rows = selectLinksForDatabase.all(validated.kind, validated.ownerKey) as Array<{
        link_id: number;
        ontology_hash: string;
        linked_at_ms: number;
      }>;
      const current = currentLinkRow(rows);
      if (current === undefined) return undefined;
      return { hash: current.ontology_hash, linkedAtMs: current.linked_at_ms };
    },

    async listLinkHistory(id) {
      const validated = validateMemoriesDatabaseId(id);
      const rows = selectLinksForDatabase.all(validated.kind, validated.ownerKey) as Array<{
        link_id: number;
        ontology_hash: string;
        linked_at_ms: number;
      }>;
      return rows.map(
        (row): OntologyLinkRecord => ({
          linkId: row.link_id,
          hash: row.ontology_hash,
          linkedAtMs: row.linked_at_ms,
        }),
      );
    },

    async listDatabasesByOntologyHash(hash) {
      const ids: MemoriesDatabaseId[] = [];
      for (const [key, link] of currentLinksByDatabase()) {
        if (link.hash !== hash) continue;
        const id = parseDatabaseKey(key);
        if (id !== undefined) ids.push(id);
      }
      return ids;
    },

    async listDatabasesByLabelKinds(filter) {
      const ids: MemoriesDatabaseId[] = [];
      for (const [key, link] of currentLinksByDatabase()) {
        const schema = await this.getOntology(link.hash);
        if (schema === undefined) continue;
        if (!ontologyMatchesLabelKinds(schema, filter)) continue;
        const id = parseDatabaseKey(key);
        if (id !== undefined) ids.push(id);
      }
      return ids;
    },
  };
}

export function openOntologyRegistryDb(registryPath: string, sqlCipherKey: string): Database {
  mkdirSync(path.dirname(registryPath), { recursive: true });
  const db = openEncryptedDatabaseSync(registryPath, { create: true }, sqlCipherKey);
  db.exec(ONTOLOGY_SCHEMA);
  return db;
}

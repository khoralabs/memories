import type { StoredOntologyJsonSchema } from "./ontology";
import {
  hashStoredOntology,
  listOntologyLabelKinds,
  normalizeStoredOntologyJsonSchema,
  ontologyMatchesLabelKinds,
} from "./ontology";
import type { MemoriesDatabaseId } from "./types";
import { validateMemoriesDatabaseId } from "./validate";

export type OntologyLinkRecord = {
  hash: string;
  linkedAtMs: number;
  linkId: number;
};

export type MemoriesDatabaseOntologyStore = {
  registerOntology(schema: StoredOntologyJsonSchema): Promise<{ hash: string }>;
  getOntology(hash: string): Promise<StoredOntologyJsonSchema | undefined>;
  linkDatabase(id: MemoriesDatabaseId, hash: string): Promise<void>;
  getCurrentLink(id: MemoriesDatabaseId): Promise<Omit<OntologyLinkRecord, "linkId"> | undefined>;
  listLinkHistory(id: MemoriesDatabaseId): Promise<OntologyLinkRecord[]>;
  listDatabasesByOntologyHash(hash: string): Promise<MemoriesDatabaseId[]>;
  listDatabasesByLabelKinds(filter?: {
    nodeKinds?: string[];
    edgeKinds?: string[];
  }): Promise<MemoriesDatabaseId[]>;
};

type StoredOntologyRecord = {
  schema: StoredOntologyJsonSchema;
  nodeKinds: string[];
  edgeKinds: string[];
};

type LinkRow = OntologyLinkRecord & {
  kind: string;
  ownerKey: string;
};

function databaseKey(id: MemoriesDatabaseId): string {
  const validated = validateMemoriesDatabaseId(id);
  return `${validated.kind}\0${validated.ownerKey}`;
}

function parseDatabaseKey(key: string): MemoriesDatabaseId | undefined {
  const [kind, ownerKey] = key.split("\0");
  if (kind === undefined || ownerKey === undefined) return undefined;
  return { kind, ownerKey };
}

function currentLinkForRows(rows: LinkRow[]): LinkRow | undefined {
  if (rows.length === 0) return undefined;
  return rows.reduce((latest, row) => {
    if (row.linkedAtMs > latest.linkedAtMs) return row;
    if (row.linkedAtMs < latest.linkedAtMs) return latest;
    return row.linkId > latest.linkId ? row : latest;
  });
}

export function createInMemoryOntologyStore(): MemoriesDatabaseOntologyStore {
  const ontologies = new Map<string, StoredOntologyRecord>();
  const links: LinkRow[] = [];
  let nextLinkId = 1;

  function storeOntology(schema: StoredOntologyJsonSchema): { hash: string } {
    const normalized = normalizeStoredOntologyJsonSchema(schema);
    const hash = hashStoredOntology(normalized);
    if (!ontologies.has(hash)) {
      const kinds = listOntologyLabelKinds(normalized);
      ontologies.set(hash, {
        schema: normalized,
        nodeKinds: kinds.nodeKinds,
        edgeKinds: kinds.edgeKinds,
      });
    }
    return { hash };
  }

  function linksForDatabase(id: MemoriesDatabaseId): LinkRow[] {
    const key = databaseKey(id);
    return links.filter((row) => `${row.kind}\0${row.ownerKey}` === key);
  }

  function currentLinksByDatabase(): Map<string, LinkRow> {
    const grouped = new Map<string, LinkRow[]>();
    for (const row of links) {
      const key = `${row.kind}\0${row.ownerKey}`;
      const existing = grouped.get(key);
      if (existing === undefined) {
        grouped.set(key, [row]);
      } else {
        existing.push(row);
      }
    }
    const current = new Map<string, LinkRow>();
    for (const [key, rows] of grouped) {
      const latest = currentLinkForRows(rows);
      if (latest !== undefined) current.set(key, latest);
    }
    return current;
  }

  return {
    async registerOntology(schema) {
      return storeOntology(schema);
    },

    async getOntology(hash) {
      return ontologies.get(hash)?.schema;
    },

    async linkDatabase(id, hash) {
      if (ontologies.get(hash) === undefined) {
        throw new Error(`Unknown ontology hash: ${hash}`);
      }
      const validated = validateMemoriesDatabaseId(id);
      links.push({
        linkId: nextLinkId++,
        kind: validated.kind,
        ownerKey: validated.ownerKey,
        hash,
        linkedAtMs: Date.now(),
      });
    },

    async getCurrentLink(id) {
      const current = currentLinkForRows(linksForDatabase(id));
      if (current === undefined) return undefined;
      return { hash: current.hash, linkedAtMs: current.linkedAtMs };
    },

    async listLinkHistory(id) {
      return linksForDatabase(id)
        .slice()
        .sort((a, b) => {
          if (a.linkedAtMs !== b.linkedAtMs) return a.linkedAtMs - b.linkedAtMs;
          return a.linkId - b.linkId;
        });
    },

    async listDatabasesByOntologyHash(hash) {
      const ids: MemoriesDatabaseId[] = [];
      for (const [key, row] of currentLinksByDatabase()) {
        if (row.hash !== hash) continue;
        const id = parseDatabaseKey(key);
        if (id !== undefined) ids.push(id);
      }
      return ids;
    },

    async listDatabasesByLabelKinds(filter) {
      const ids: MemoriesDatabaseId[] = [];
      for (const [key, row] of currentLinksByDatabase()) {
        const ontology = ontologies.get(row.hash)?.schema;
        if (ontology === undefined) continue;
        if (!ontologyMatchesLabelKinds(ontology, filter)) continue;
        const id = parseDatabaseKey(key);
        if (id !== undefined) ids.push(id);
      }
      return ids;
    },
  };
}

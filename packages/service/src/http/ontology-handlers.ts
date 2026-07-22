import type {
  MemoriesDatabaseId,
  MemoriesDatabaseOntologyStore,
  StoredOntologyJsonSchema,
} from "../storage/core/index";

import { HttpError, parseDatabaseIdBody } from "./handlers";

function parseStoredOntologySchema(body: unknown): StoredOntologyJsonSchema {
  if (body === null || typeof body !== "object") {
    throw new HttpError("schema must be a JSON object", 400);
  }
  const record = body as Record<string, unknown>;
  if (record.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new HttpError("schema must be a stored ontology JSON Schema document", 400);
  }
  return record as StoredOntologyJsonSchema;
}

export async function handleOntologyRegister(
  ontology: MemoriesDatabaseOntologyStore,
  body: unknown,
): Promise<Response> {
  const record = body as { schema?: unknown };
  if (record.schema === undefined) {
    throw new HttpError("schema is required", 400);
  }
  const result = await ontology.registerOntology(parseStoredOntologySchema(record.schema));
  return Response.json(result);
}

export async function handleOntologyGet(
  ontology: MemoriesDatabaseOntologyStore,
  body: unknown,
): Promise<Response> {
  const record = body as { hash?: unknown };
  if (typeof record.hash !== "string" || record.hash.trim().length === 0) {
    throw new HttpError("hash is required", 400);
  }
  const schema = await ontology.getOntology(record.hash.trim());
  if (schema === undefined) {
    throw new HttpError("ontology not found", 404);
  }
  return Response.json({ hash: record.hash.trim(), schema });
}

export async function handleOntologyListDatabases(
  ontology: MemoriesDatabaseOntologyStore,
  body: unknown,
): Promise<Response> {
  const record = body as {
    hash?: unknown;
    nodeKinds?: unknown;
    edgeKinds?: unknown;
  };
  if (typeof record.hash === "string" && record.hash.trim().length > 0) {
    const databases = await ontology.listDatabasesByOntologyHash(record.hash.trim());
    return Response.json({ databases });
  }
  const nodeKinds = Array.isArray(record.nodeKinds)
    ? record.nodeKinds.filter((kind): kind is string => typeof kind === "string")
    : undefined;
  const edgeKinds = Array.isArray(record.edgeKinds)
    ? record.edgeKinds.filter((kind): kind is string => typeof kind === "string")
    : undefined;
  const databases = await ontology.listDatabasesByLabelKinds({
    ...(nodeKinds !== undefined && nodeKinds.length > 0 ? { nodeKinds } : {}),
    ...(edgeKinds !== undefined && edgeKinds.length > 0 ? { edgeKinds } : {}),
  });
  return Response.json({ databases });
}

export async function handleDatabaseOntologyLink(
  ontology: MemoriesDatabaseOntologyStore,
  body: unknown,
): Promise<Response> {
  const record = body as { database?: unknown; hash?: unknown };
  const database = parseDatabaseIdBody(record.database);
  if (typeof record.hash !== "string" || record.hash.trim().length === 0) {
    throw new HttpError("hash is required", 400);
  }
  await ontology.linkDatabase(database, record.hash.trim());
  return Response.json({ ok: true, database });
}

export async function handleDatabaseOntologyCurrent(
  ontology: MemoriesDatabaseOntologyStore,
  body: unknown,
): Promise<Response> {
  const database = parseDatabaseIdBody((body as Record<string, unknown>).database);
  const link = await ontology.getCurrentLink(database);
  return Response.json({ database, link: link ?? null });
}

export async function handleDatabaseHash(
  ontology: MemoriesDatabaseOntologyStore,
  body: unknown,
): Promise<Response> {
  const database = parseDatabaseIdBody((body as Record<string, unknown>).database);
  const link = await ontology.getCurrentLink(database);
  return Response.json({ database, hash: link?.hash ?? null });
}

export async function handleDatabaseOntologyHistory(
  ontology: MemoriesDatabaseOntologyStore,
  body: unknown,
): Promise<Response> {
  const database = parseDatabaseIdBody((body as Record<string, unknown>).database);
  const history = await ontology.listLinkHistory(database);
  return Response.json({ database, history });
}

export type { MemoriesDatabaseId };

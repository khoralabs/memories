import type { AuthorizeScope } from "../auth/types";

export function scopeDatabase(): AuthorizeScope {
  return { kind: "database" };
}

function asRecord(body: unknown): Record<string, unknown> | undefined {
  if (body === null || typeof body !== "object") return undefined;
  return body as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  if (record === undefined) return undefined;
  const v = record[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function paramsRecord(body: unknown): Record<string, unknown> | undefined {
  const record = asRecord(body);
  if (record === undefined) return undefined;
  return asRecord(record.params);
}

function recursiveMode(recursive: unknown): "exact" | "subtree" {
  return recursive === false ? "exact" : "subtree";
}

function searchMode(body: unknown): "exact" | "subtree" {
  const record = asRecord(body);
  const params = paramsRecord(body);
  const raw =
    stringField(record, "searchScopeMode") ??
    stringField(params, "searchScopeMode") ??
    stringField(record, "scope") ??
    stringField(params, "scope");
  if (raw === "pathSubtree" || raw === "subtree") return "subtree";
  return "exact";
}

function readNamespace(body: unknown): string | undefined {
  const record = asRecord(body);
  const params = paramsRecord(body);
  return stringField(record, "namespace") ?? stringField(params, "namespace");
}

function readAdditionalNamespaces(body: unknown): string[] {
  const record = asRecord(body);
  const params = paramsRecord(body);
  const raw = record?.additionalNamespaces ?? params?.additionalNamespaces;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.length > 0) out.push(item);
  }
  return out;
}

function dedupePreserve(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function isSearchEntireDatabase(body: unknown): boolean {
  const record = asRecord(body);
  const params = paramsRecord(body);
  return record?.searchEntireDatabase === true || params?.searchEntireDatabase === true;
}

/**
 * Scope for memory ops and search: merge, delete-memory, suppress-memory, search, and similar bodies
 * that carry `namespace` / `params.namespace` / `additionalNamespaces` / `searchEntireDatabase`.
 */
export function scopeFromMemoryBody(body: unknown): AuthorizeScope {
  if (isSearchEntireDatabase(body)) {
    return { kind: "unscoped" };
  }

  const primary = readNamespace(body);
  const extras = readAdditionalNamespaces(body);
  const namespaces = dedupePreserve([...(primary !== undefined ? [primary] : []), ...extras]);
  const mode = searchMode(body);

  if (namespaces.length === 0) return scopeDatabase();
  if (namespaces.length === 1) {
    const namespace = namespaces[0];
    if (namespace === undefined) return scopeDatabase();
    return { kind: "namespace", namespace, mode };
  }
  return { kind: "namespaces", namespaces, mode };
}

/**
 * Namespace get / upsert (exact path).
 * For delete, use {@link scopeFromNamespaceDelete}.
 */
export function scopeFromNamespaceMutation(body: unknown): AuthorizeScope {
  const namespace = readNamespace(body);
  if (namespace === undefined) return scopeDatabase();
  return { kind: "namespace", namespace, mode: "exact" };
}

/** Namespace delete: `recursive !== false` → `subtree` (matches persistence default). */
export function scopeFromNamespaceDelete(body: unknown): AuthorizeScope {
  const record = asRecord(body);
  const namespace = readNamespace(body);
  if (namespace === undefined) return scopeDatabase();
  return { kind: "namespace", namespace, mode: recursiveMode(record?.recursive) };
}

/** Literal rename (`from`, `to`, optional `recursive`). */
export function scopeFromRename(body: unknown): AuthorizeScope {
  const record = asRecord(body);
  const from = stringField(record, "from");
  const to = stringField(record, "to");
  if (from === undefined || to === undefined) return scopeDatabase();
  return {
    kind: "namespaceRename",
    from,
    to,
    mode: recursiveMode(record?.recursive),
  };
}

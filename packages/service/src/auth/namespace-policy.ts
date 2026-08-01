import type { MemoriesDatabaseId } from "../storage/core/index";
import {
  type AuthorizeInput,
  type AuthorizeScope,
  AuthStrategyError,
  type DatabaseAction,
} from "./types";

/**
 * Host grant shape (reference for `app-policy` / future DID grants).
 * Omit `namespaces` or pass `[]` for database-wide access (covers `database` and `unscoped`).
 */
export type HostGrant = {
  /** If set, grant applies only to this database; omit for any database. */
  database?: MemoriesDatabaseId;
  /** Allowed namespace prefixes; empty/omitted = database-wide. */
  namespaces?: string[];
  actions: DatabaseAction[];
};

const ACTION_RANK: Record<DatabaseAction, number> = {
  read: 1,
  write: 2,
  manage: 3,
};

/** `manage` ⊇ `write` ⊇ `read`. */
export function actionAllowed(granted: DatabaseAction[], required: DatabaseAction): boolean {
  let max = 0;
  for (const a of granted) {
    const r = ACTION_RANK[a];
    if (r > max) max = r;
  }
  return max >= ACTION_RANK[required];
}

/** Segment-prefix cover (equality included). Same semantics as `isPrefixOf` for valid paths. */
export function namespaceCovered(allowedPrefixes: string[], target: string): boolean {
  return allowedPrefixes.some((prefix) => isPathPrefix(prefix, target));
}

function isPathPrefix(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const a = ancestor.split("/");
  const d = descendant.split("/");
  if (a.length === 0 || a.some((s) => s.length === 0)) return false;
  if (a.length > d.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== d[i]) return false;
  }
  return true;
}

function databaseMatches(grant: HostGrant, database: MemoriesDatabaseId | undefined): boolean {
  if (grant.database === undefined) return true;
  if (database === undefined) return false;
  return grant.database.kind === database.kind && grant.database.ownerKey === database.ownerKey;
}

function isDatabaseWide(grant: HostGrant): boolean {
  return grant.namespaces === undefined || grant.namespaces.length === 0;
}

function grantsForInput(
  grants: readonly HostGrant[],
  input: Pick<AuthorizeInput, "action" | "database">,
): HostGrant[] {
  return grants.filter(
    (g) => databaseMatches(g, input.database) && actionAllowed(g.actions, input.action),
  );
}

function allowNamespace(applicable: HostGrant[], target: string): boolean {
  for (const g of applicable) {
    if (isDatabaseWide(g)) return true;
    if (g.namespaces !== undefined && namespaceCovered(g.namespaces, target)) return true;
  }
  return false;
}

function allowDatabaseWide(applicable: HostGrant[]): boolean {
  return applicable.some(isDatabaseWide);
}

function deny(message: string): never {
  throw new AuthStrategyError(message, 403);
}

/**
 * Reference host algorithm: match `AuthorizeInput` against grants.
 * Throws {@link AuthStrategyError} with status 403 on deny.
 */
export function authorizeScopeAgainstGrants(
  grants: readonly HostGrant[],
  input: Pick<AuthorizeInput, "action" | "database" | "scope">,
): void {
  const applicable = grantsForInput(grants, input);
  if (applicable.length === 0) {
    deny(`action ${input.action} not granted`);
  }

  const scope: AuthorizeScope = input.scope;
  switch (scope.kind) {
    case "database":
    case "unscoped": {
      if (!allowDatabaseWide(applicable)) {
        deny(
          scope.kind === "unscoped"
            ? "unscoped access requires a database-wide grant"
            : "database-scoped access requires a database-wide grant",
        );
      }
      return;
    }
    case "namespace": {
      if (!allowNamespace(applicable, scope.namespace)) {
        deny(`namespace not allowed: ${scope.namespace}`);
      }
      return;
    }
    case "namespaces": {
      for (const ns of scope.namespaces) {
        if (!allowNamespace(applicable, ns)) {
          deny(`namespace not allowed: ${ns}`);
        }
      }
      return;
    }
    case "namespaceRename": {
      if (!allowNamespace(applicable, scope.from)) {
        deny(`rename source not allowed: ${scope.from}`);
      }
      if (!allowNamespace(applicable, scope.to)) {
        deny(`rename destination not allowed: ${scope.to}`);
      }
      return;
    }
    default: {
      const _exhaustive: never = scope;
      deny(`unknown scope: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

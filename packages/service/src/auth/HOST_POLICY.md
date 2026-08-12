# Host policy contract (authorize scope v1)

HTTP always calls `authorize` with a typed `scope` (`AuthorizeScope`). Hosts using `app-policy` should interpret it as below. Reference helpers: `actionAllowed`, `namespaceCovered`, `authorizeScopeAgainstGrants` from `@khoralabs/memories-service/auth`.

## Actions

Convention for helpers: **`manage` ⊇ `write` ⊇ `read`**.

## Scope kinds

| `scope.kind` | Meaning | Host matching |
|---|---|---|
| `database` | DB lifecycle / list namespaces / capabilities / ontology link | Require a **database-wide** grant (no `namespaces` restriction) |
| `unscoped` | `searchEntireDatabase` | Same as database-wide; **deny by default** without such a grant |
| `namespace` | Single path; `mode` is `exact` or `subtree` | Allow if some grant prefix covers the path (`namespaceCovered`) |
| `namespaces` | Multi-root search (`namespace` + `additionalNamespaces`) | **Every** listed path must be allowed |
| `namespaceRename` | Literal rename `from` → `to` | Both `from` and `to` must be allowed for `write` |

`mode: "subtree"` means the operation includes descendants (default recursive delete/rename). Authz still checks the **root** path(s), not every child.

Authorize only from `input.scope` (and `input.action` / `input.database`). There is no top-level `AuthorizeInput.namespace` mirror.

## Grant shape

```ts
type HostGrant = {
  database?: MemoriesDatabaseId; // omit = any DB
  namespaces?: string[];         // omit or [] = database-wide
  actions: DatabaseAction[];
};
```

This is not a service registry — hosts store grants themselves (and later DID grants map onto the same shape).

## Errors

- `authenticate` failures → `AuthStrategyError` **401**
- `authorize` denials → `AuthStrategyError` **403**

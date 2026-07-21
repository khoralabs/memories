/**
 * Ordered publishable packages for unified releases.
 * Primary packages first (dependency order), then deprecated shims.
 */
export type PublishablePackage = {
  name: string;
  dir: string;
  /** Primary product packages vs deprecated alias shims. */
  kind: "primary" | "shim";
};

export const PUBLISH_ORDER: PublishablePackage[] = [
  // Leaf / foundations
  {
    name: "@khoralabs/memories-persistence-core",
    dir: "packages/persistence/core",
    kind: "primary",
  },
  { name: "@khoralabs/memories-ontologies", dir: "packages/ontologies", kind: "primary" },
  { name: "@khoralabs/memories-node", dir: "packages/node", kind: "primary" },
  { name: "@khoralabs/memories-service", dir: "packages/service", kind: "primary" },
  { name: "@khoralabs/memories-agents", dir: "packages/memories-agents", kind: "primary" },
  { name: "@khoralabs/memories-react-graph", dir: "packages/react/graph", kind: "primary" },
  { name: "@khoralabs/memories-spec", dir: "packages/spec", kind: "primary" },

  // Deprecated shims (re-export the packages above)
  { name: "@khoralabs/memories-core", dir: "packages/core", kind: "shim" },
  { name: "@khoralabs/memories-sqlite", dir: "packages/persistence/sqlite", kind: "shim" },
  { name: "@khoralabs/memories-libsql", dir: "packages/persistence/libsql", kind: "shim" },
  {
    name: "@khoralabs/memories-turso-serverless",
    dir: "packages/persistence/turso-serverless",
    kind: "shim",
  },
  {
    name: "@khoralabs/memories-persistence-contract",
    dir: "packages/persistence/contract",
    kind: "shim",
  },
  { name: "@khoralabs/memories-projections", dir: "packages/projections/core", kind: "shim" },
  {
    name: "@khoralabs/memories-projections-sqlite",
    dir: "packages/projections/sqlite",
    kind: "shim",
  },
  {
    name: "@khoralabs/memories-projections-libsql",
    dir: "packages/projections/libsql",
    kind: "shim",
  },
  {
    name: "@khoralabs/memories-projections-turso",
    dir: "packages/projections/turso",
    kind: "shim",
  },
  {
    name: "@khoralabs/memories-projections-contract",
    dir: "packages/projections/contract",
    kind: "shim",
  },
  { name: "@khoralabs/memories-attestation", dir: "packages/attestation", kind: "shim" },
  { name: "@khoralabs/memories-autolink", dir: "packages/autolink", kind: "shim" },
  { name: "@khoralabs/memories-tools", dir: "packages/agents/tools", kind: "shim" },
  { name: "@khoralabs/memories-adapter", dir: "packages/agents/adapter", kind: "shim" },
  { name: "@khoralabs/memories-integrator", dir: "packages/agents/integrator", kind: "shim" },
  { name: "@khoralabs/memories-investigator", dir: "packages/agents/investigator", kind: "shim" },
  {
    name: "@khoralabs/memories-service-client",
    dir: "packages/memories-service/client",
    kind: "shim",
  },
  { name: "@khoralabs/memories-service-http", dir: "packages/memories-service/http", kind: "shim" },
  { name: "@khoralabs/memories-service-auth", dir: "packages/memories-service/auth", kind: "shim" },
  {
    name: "@khoralabs/memories-service-storage-core",
    dir: "packages/memories-service/storage/core",
    kind: "shim",
  },
  {
    name: "@khoralabs/memories-service-storage-contract",
    dir: "packages/memories-service/storage/contract",
    kind: "shim",
  },
  {
    name: "@khoralabs/memories-service-storage-sqlite",
    dir: "packages/memories-service/storage/sqlite",
    kind: "shim",
  },
  {
    name: "@khoralabs/memories-service-storage-libsql",
    dir: "packages/memories-service/storage/libsql",
    kind: "shim",
  },
  {
    name: "@khoralabs/memories-service-storage-turso-serverless",
    dir: "packages/memories-service/storage/turso-serverless",
    kind: "shim",
  },
];

export function isSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version);
}

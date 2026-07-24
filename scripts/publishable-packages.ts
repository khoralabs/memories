/**
 * Ordered publishable packages for unified releases (dependency order).
 */
export type PublishablePackage = {
  name: string;
  dir: string;
};

export const PUBLISH_ORDER: PublishablePackage[] = [
  { name: "@khoralabs/memories-node", dir: "packages/node" },
  { name: "@khoralabs/memories-otel", dir: "packages/otel" },
  { name: "@khoralabs/memories-service", dir: "packages/service" },
  { name: "@khoralabs/memories-agents", dir: "packages/agents" },
  { name: "@khoralabs/memories-react-graph", dir: "packages/react/graph" },
  { name: "@khoralabs/memories-spec", dir: "packages/spec" },
];

export function isSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version);
}

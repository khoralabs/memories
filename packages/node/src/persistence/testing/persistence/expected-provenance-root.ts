import { computeAuditCommitId } from "../../core/audit-commit";
import type { MemoriesPersistence } from "../../core/persistence";
import {
  GENESIS_PARENT_HEX,
  type MemoryProvenanceEvent,
  nextProvenanceRoot,
} from "../../core/provenance";

/**
 * Expected `root_hex` for `event` appended on `parent`: linear chain link, or the audit commit id
 * (over the current state root) when the backend advertises `auditCommitDag`.
 */
export async function expectedProvenanceRoot(
  persistence: {
    capabilities?: MemoriesPersistence["capabilities"];
    getStateRootHex?: () => string | undefined | Promise<string | undefined>;
  },
  parent: string | undefined,
  event: MemoryProvenanceEvent,
): Promise<string> {
  if (!persistence.capabilities?.auditCommitDag) return nextProvenanceRoot(parent, event).root_hex;
  return computeAuditCommitId({
    parents: parent ? [parent] : [],
    stateRootHex: (await persistence.getStateRootHex?.()) ?? GENESIS_PARENT_HEX,
    event,
  });
}

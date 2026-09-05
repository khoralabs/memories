import { useEdgeBillboard } from "@/components/memories/edge-billboard";
import { useMemoriesMemory } from "@/components/memories/memories-memory-provider";
import { MemoryDetailOntology } from "@/components/memories/memory-detail-ontology";
import { MemoryMetadata } from "@/components/memories/memory-metadata";
import { useNodeBillboard } from "@/components/memories/node-billboard";

/** Compact ontology labels for a node billboard (merged projection + preview labels). */
export function GraphNodeBillboardOntology() {
  const { ontologyLabels, loading } = useNodeBillboard();
  if (ontologyLabels.length === 0) {
    if (loading) return null;
    return <p className="text-xs text-muted-foreground">No ontology labels.</p>;
  }
  return <MemoryDetailOntology labels={ontologyLabels} variant="node" compact />;
}

/** Compact ontology labels for an edge billboard (from preview / edge). */
export function GraphEdgeBillboardOntology() {
  const { ontologyLabels, loading } = useEdgeBillboard();
  if (ontologyLabels.length === 0) {
    if (loading) return null;
    return <p className="text-xs text-muted-foreground">No ontology labels.</p>;
  }
  return <MemoryDetailOntology labels={ontologyLabels} variant="edge" compact />;
}

/**
 * Node metadata for billboards. Uses {@link useNodeBillboard}.`properties`
 * from the preview fetch (no second `getMemoryPreview`).
 */
export function GraphNodeBillboardMetadata() {
  const { point, namespace, properties, ontologyLabels } = useNodeBillboard();
  const { getMemory } = useMemoriesMemory();
  const suppressed = getMemory(point.key)?.suppressed === true;
  const hasProps = properties != null && Object.keys(properties).length > 0;

  return (
    <MemoryMetadata
      kind="node"
      memoryKey={point.key}
      namespace={namespace}
      suppressed={suppressed}
      labelKinds={ontologyLabels.map((lb) => lb.kind)}
      properties={properties}
      showList={hasProps}
      className={hasProps ? "border-t border-border/60 pt-2" : undefined}
    />
  );
}

/** Edge metadata for billboards using {@link useEdgeBillboard}.`properties`. */
export function GraphEdgeBillboardMetadata() {
  const { edge, namespace, properties, ontologyLabels } = useEdgeBillboard();
  const { getEdge } = useMemoriesMemory();
  const suppressed = getEdge(edge.edgeId)?.suppressed === true;
  const hasProps = properties != null && Object.keys(properties).length > 0;

  return (
    <MemoryMetadata
      kind="edge"
      memoryKey={edge.edgeId}
      namespace={namespace}
      suppressed={suppressed}
      labelKinds={ontologyLabels.map((lb) => lb.kind)}
      properties={properties}
      showList={hasProps}
      className={hasProps ? "border-t border-border/60 pt-2" : undefined}
    />
  );
}

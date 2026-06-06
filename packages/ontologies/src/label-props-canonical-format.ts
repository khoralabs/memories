import type { LabelPropsSearchFormatter, LabelPropsSearchRole } from "@khoralabs/memories-core";

function s(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function nl(parts: string[]): string {
  return parts.filter((p) => p.length > 0).join("\n");
}

/** Readable lines for canonical ontology kinds; return "" to use generic {@link propsToHumanSearchText}. */
export const canonicalLabelPropsSearchFormatter: LabelPropsSearchFormatter = (
  kind: string,
  role: LabelPropsSearchRole,
  props: Record<string, unknown>,
): string => {
  if (role === "node") {
    switch (kind) {
      case "person":
        return nl([
          `Person named ${s(props.name)}.`,
          props.role ? `Role: ${s(props.role)}.` : "",
          props.organization ? `Organization: ${s(props.organization)}.` : "",
          props.timezone ? `Timezone: ${s(props.timezone)}.` : "",
        ]);
      case "place":
        return nl([
          `Place: ${s(props.name)}.`,
          props.kind ? `Kind: ${s(props.kind)}.` : "",
          props.country ? `Country: ${s(props.country)}.` : "",
        ]);
      case "preference":
        return nl([
          `Preference on ${s(props.topic)}: ${s(props.stance)}.`,
          props.detail ? `Detail: ${s(props.detail)}.` : "",
        ]);
      case "event":
        return nl([
          props.title ? `Event: ${s(props.title)}.` : "Event.",
          props.startsAt ? `Starts: ${s(props.startsAt)}.` : "",
          props.endsAt ? `Ends: ${s(props.endsAt)}.` : "",
          props.status ? `Status: ${s(props.status)}.` : "",
        ]);
      case "fact":
        return nl([
          `Fact: ${s(props.subject)} ${s(props.predicate)} ${s(props.object)}.`,
          props.source ? `Source: ${s(props.source)}.` : "",
        ]);
      case "observation":
        return nl([
          `Observation: ${s(props.summary)}`,
          props.confidence ? `Confidence: ${s(props.confidence)}.` : "",
          props.observedAt ? `Observed at: ${s(props.observedAt)}.` : "",
        ]);
      case "belief":
        return nl([
          `Belief: ${s(props.claim)}`,
          props.certainty !== undefined ? `Certainty: ${s(props.certainty)}.` : "",
          props.basis ? `Basis: ${s(props.basis)}.` : "",
        ]);
      case "temporal":
        return nl([
          `Time window: ${s(props.label)}.`,
          props.anchor ? `Anchor: ${s(props.anchor)}.` : "",
          props.grain ? `Precision: ${s(props.grain)}.` : "",
        ]);
      default:
        return "";
    }
  }

  switch (kind) {
    case "references":
      return props.context ? `Reference context: ${s(props.context)}.` : "";
    case "affects":
      return nl([
        props.impact ? `Impact: ${s(props.impact)}.` : "",
        props.aspect ? `Affected aspect: ${s(props.aspect)}.` : "",
      ]);
    case "causes":
      return props.mechanism ? `Causal mechanism: ${s(props.mechanism)}.` : "";
    case "describes":
      return props.facet ? `Describes facet: ${s(props.facet)}.` : "";
    case "before":
    case "after":
      return props.orderingConfidence
        ? `Temporal ordering confidence: ${s(props.orderingConfidence)}.`
        : "";
    case "during":
      return props.overlap ? `Time overlap: ${s(props.overlap)}.` : "";
    case "includes":
      return props.part ? `Part or role in aggregate: ${s(props.part)}.` : "";
    default:
      return "";
  }
};

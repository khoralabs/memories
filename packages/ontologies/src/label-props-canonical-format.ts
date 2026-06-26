import type { LabelPropsSearchFormatter } from "@khoralabs/memories-persistence-core";
import { canonicalEntityLabelPropsSearchFormatter } from "./families/entities";
import { canonicalKnowledgeLabelPropsSearchFormatter } from "./families/knowledge";
import { canonicalPreferenceLabelPropsSearchFormatter } from "./families/preferences";
import { canonicalRelationLabelPropsSearchFormatter } from "./families/relations";
import { canonicalTemporalLabelPropsSearchFormatter } from "./families/temporal";

const canonicalFamilyLabelPropsSearchFormatters = [
  canonicalEntityLabelPropsSearchFormatter,
  canonicalPreferenceLabelPropsSearchFormatter,
  canonicalTemporalLabelPropsSearchFormatter,
  canonicalKnowledgeLabelPropsSearchFormatter,
  canonicalRelationLabelPropsSearchFormatter,
] as const;

/** Readable lines for canonical ontology kinds; return "" to use generic {@link propsToHumanSearchText}. */
export const canonicalLabelPropsSearchFormatter: LabelPropsSearchFormatter = (
  kind,
  role,
  props,
): string => {
  for (const formatter of canonicalFamilyLabelPropsSearchFormatters) {
    const text = formatter(kind, role, props);
    if (text.length > 0) {
      return text;
    }
  }
  return "";
};

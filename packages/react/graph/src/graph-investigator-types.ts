export type InvestigatorCitation = {
  memory_key: string;
  rationale?: string;
};

export type InvestigatorAnswer = {
  answer: string;
  citations?: InvestigatorCitation[];
  follow_up_queries?: string[];
};

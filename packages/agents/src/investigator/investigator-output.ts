import z from "zod";

const zCitation = z.object({
  memory_key: z.string(),
  rationale: z.string().optional().describe("Why this memory supported the answer."),
});

export const zInvestigatorAnswerWire = z.object({
  answer: z.string().describe("Synthesized answer to the user question."),
  citations: z
    .array(zCitation)
    .optional()
    .describe("Optional list of memory keys used as evidence."),
  follow_up_queries: z
    .array(z.string())
    .optional()
    .describe("Optional suggested searches if evidence was incomplete."),
});

export type InvestigatorAnswerWire = z.infer<typeof zInvestigatorAnswerWire>;

export function parseInvestigatorAnswerWire(data: unknown): InvestigatorAnswerWire {
  return zInvestigatorAnswerWire.parse(data);
}

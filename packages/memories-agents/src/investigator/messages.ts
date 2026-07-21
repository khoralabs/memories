/** User message wrapping the investigation question. */
export function buildMemoryInvestigatorUserMessage(args: { question: string }): {
  role: "user";
  content: string;
} {
  return {
    role: "user",
    content: `Question:\n\n${args.question}\n\nUse memory_search as needed, then output the structured answer.`,
  };
}

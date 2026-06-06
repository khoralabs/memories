/** User message wrapping content to integrate. */
export function buildMemoryIntegratorUserMessage(args: { content: string }): {
  role: "user";
  content: string;
} {
  return {
    role: "user",
    content: `Integrate the following content into the memory graph. Use memory_search as needed, then output the structured plan.\n\n---\n\n${args.content}`,
  };
}

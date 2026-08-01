/** Default tag for untrusted text in LLM user messages. */
export const USER_CONTENT_TAG = "user_content";

/**
 * Wrap untrusted text in XML-like tags and neutralize closing-tag breakouts
 * so the model can treat the interior as data, not instructions.
 */
export function fenceUntrustedText(text: string, tag: string = USER_CONTENT_TAG): string {
  const close = `</${tag}>`;
  const neutralized = text.replace(
    new RegExp(close.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    "",
  );
  return `<${tag}>\n${neutralized}\n</${tag}>`;
}

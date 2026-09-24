/** Extract and validate literal paragraph text when a prompt supplies it. */
export function explicitParagraphLiteral(prompt: string) {
  const match = prompt.match(
    /\b(?:append|add|insert|write)\b[\s\S]{0,240}?\bparagraph\b[^:\n]{0,120}:\s*(?:["“]([^"”]+)["”]|(.+?))(?=\.\s+(?:preserve|keep|do not|make no other edits)\b|$)/i,
  );
  const literal = (match?.[1] ?? match?.[2] ?? "").trim();
  return literal || undefined;
}

function collectStrings(value: unknown, output: string[], depth = 0) {
  if (depth > 24 || value === null || value === undefined) return;
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectStrings(child, output, depth + 1);
    return;
  }
  if (typeof value === "object")
    for (const child of Object.values(value))
      collectStrings(child, output, depth + 1);
}

export function assertExplicitParagraphLiteralPresent(
  prompt: string,
  proposedContent: unknown,
) {
  const literal = explicitParagraphLiteral(prompt);
  if (!literal) return;
  const strings: string[] = [];
  collectStrings(proposedContent, strings);
  if (!strings.some((value) => value.includes(literal)))
    throw new Error(
      "The proposed document edit omitted the exact paragraph text requested.",
    );
}

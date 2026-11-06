import { inlineContentFitsNesting } from "./convex-nesting.mjs";

/**
 * A rich document can nest deeper than a Convex row allows, so an operation
 * keeps content like that as text and every reader unpacks it. The content is
 * still the exact authored value, so digests over the stored row keep holding.
 */
type PackedContent = { spectraPackedContent: string };

const row = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function isPacked(value: unknown): value is PackedContent {
  return typeof row(value).spectraPackedContent === "string";
}

export function packOperationInput<T>(input: T): T {
  const content = row(input).content;
  if (content === undefined || content === null || isPacked(content) || inlineContentFitsNesting(content)) return input;
  return { ...input, content: { spectraPackedContent: JSON.stringify(content) } };
}

export function unpackOperationInput<T>(input: T): T {
  const content = row(input).content;
  if (!isPacked(content)) return input;
  return { ...input, content: JSON.parse(content.spectraPackedContent) };
}

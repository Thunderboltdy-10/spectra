import type { CommandAttachment } from "../components/command-bar";

/** Preserve source files across a same-thread steering continuation. */
export function mergeContinuationAttachments(
  previous: readonly CommandAttachment[],
  next: readonly CommandAttachment[],
) {
  const seen = new Set<string>();
  return [...previous, ...next]
    .filter((attachment) => {
      if (seen.has(attachment.id)) return false;
      seen.add(attachment.id);
      return true;
    })
    .slice(0, 4);
}

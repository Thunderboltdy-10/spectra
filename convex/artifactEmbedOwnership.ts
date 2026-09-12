import type { Doc } from "./_generated/dataModel";

/**
 * A source can become unavailable without its placement being removed.  Only
 * removedAt ends the placement's ownership of a pinned version; source
 * tombstones are deliberately kept on a separate field.
 */
export function isSurvivingEmbed(
  embed: Pick<Doc<"artifactEmbeds">, "removedAt">,
) {
  return embed.removedAt === undefined;
}

export function isSurvivingPinnedEmbed(
  embed: Pick<Doc<"artifactEmbeds">, "removedAt" | "pinnedVersionId">,
) {
  return isSurvivingEmbed(embed) && embed.pinnedVersionId !== undefined;
}

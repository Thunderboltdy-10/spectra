/**
 * Whether an embed's live runtime should be on the page.
 *
 * A code runtime waits until it first comes near the viewport, so a long
 * thread doesn't start every visualisation at once. Once it has run it stays
 * mounted: scrolling away, switching tabs or alt-tabbing back must never reload
 * it or swap it for a placeholder (the iframe pauses its own animation frames
 * while hidden).
 */
export function shouldMountArtifactEmbedRuntime(input: {
  sourceType?: string;
  nearViewport: boolean;
  /** It has already been mounted once. */
  mounted?: boolean;
}) {
  return input.sourceType !== "code" || Boolean(input.mounted) || input.nearViewport;
}

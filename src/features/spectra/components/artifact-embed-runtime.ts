export function shouldMountArtifactEmbedRuntime(input: {
  sourceType?: string;
  nearViewport: boolean;
  pageVisible: boolean;
}) {
  return (
    input.sourceType !== "code" || (input.nearViewport && input.pageVisible)
  );
}

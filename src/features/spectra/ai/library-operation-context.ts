export function resolveLibraryDestinationId(
  explicitDestinationId: unknown,
  currentLibraryNodeId: unknown,
) {
  const explicit =
    typeof explicitDestinationId === "string"
      ? explicitDestinationId.trim()
      : "";
  if (explicit) return explicit;
  const current =
    typeof currentLibraryNodeId === "string" ? currentLibraryNodeId.trim() : "";
  return current || undefined;
}

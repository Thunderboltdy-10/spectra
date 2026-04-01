export function resolveWorkstreamTransfer<T>(params: {
  currentWorkstreamId: T | undefined;
  requestedWorkstreamId: T | null | undefined;
  requestIncludesWorkstreamId: boolean;
  isActive: boolean;
}) {
  if (!params.isActive || !params.requestIncludesWorkstreamId) {
    return null;
  }

  const nextWorkstreamId = params.requestedWorkstreamId ?? undefined;
  if (params.currentWorkstreamId === nextWorkstreamId) {
    return null;
  }

  return {
    from: params.currentWorkstreamId,
    to: nextWorkstreamId,
  };
}

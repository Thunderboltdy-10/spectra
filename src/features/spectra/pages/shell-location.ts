export type SpectraShellLocation = {
  surface: "library" | "workspace";
  workspaceId?: string;
  artifactId?: string;
};

function decodePathSegment(value: string | undefined) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value) || undefined;
  } catch {
    return undefined;
  }
}

export function workspaceIdFromSpectraPath(pathname: string) {
  if (!pathname.startsWith("/workspace/")) return undefined;
  return decodePathSegment(
    pathname.slice("/workspace/".length).split("/", 1)[0],
  );
}

export function artifactIdFromSpectraPath(pathname: string) {
  if (!pathname.startsWith("/library/")) return undefined;
  return decodePathSegment(pathname.slice("/library/".length).split("/", 1)[0]);
}

/** Canonical URL for the long-lived Library/Workspace shell. */
export function spectraShellHref({
  surface,
  workspaceId,
  artifactId,
}: SpectraShellLocation) {
  const base = workspaceId
    ? `/workspace/${encodeURIComponent(workspaceId)}`
    : surface === "library"
      ? "/library"
      : "/workspace";
  if (!artifactId) return base;
  const query = new URLSearchParams({ artifactId });
  return `${base}?${query.toString()}`;
}

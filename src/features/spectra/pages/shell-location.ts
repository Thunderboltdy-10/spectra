export type SpectraShellLocation = {
  surface: "library" | "workspace";
  workspaceId?: string;
  artifactId?: string;
  /** The Library folder open behind the work, kept so a reload lands back in it. */
  nodeId?: string;
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

/**
 * Read the work named by the browser's actual location.
 *
 * Next's search-param snapshot may trail a native history write by one render.
 * Close and in-editor navigation both need the synchronous browser value during
 * that gap, or the old query is mistaken for a fresh deep link and re-opened.
 */
export function artifactIdFromSpectraLocation(
  pathname: string,
  search: string,
) {
  return (
    artifactIdFromSpectraPath(pathname) ??
    new URLSearchParams(search).get("artifactId") ??
    undefined
  );
}

/**
 * Where a workspace is: a place in the Library, like any folder, so stepping
 * into one never leaves the Library (LIBRARY.md, "Workspaces are places").
 * /workspace/<id> only redirects here.
 */
export function workspaceHref(workspaceId?: string) {
  return workspaceId ? `/library?workspaceId=${encodeURIComponent(workspaceId)}` : "/workspace?home=1";
}

/** Canonical URL for the long-lived Library shell. */
export function spectraShellHref({
  surface,
  workspaceId,
  artifactId,
  nodeId,
}: SpectraShellLocation) {
  const base = workspaceId || surface === "library" ? "/library" : "/workspace";
  const query = new URLSearchParams();
  if (workspaceId) query.set("workspaceId", workspaceId);
  if (nodeId && base === "/library") query.set("nodeId", nodeId);
  if (artifactId) query.set("artifactId", artifactId);
  const rest = query.toString();
  return rest ? `${base}?${rest}` : base;
}

/** Retire only the unavailable work named by the current URL, keeping its scope. */
export function retireShellArtifactLocation(pathname: string, search: string, artifactId: string) {
  if (artifactIdFromSpectraLocation(pathname, search) !== artifactId) return null;
  const query = new URLSearchParams(search);
  query.delete("artifactId");
  const base = artifactIdFromSpectraPath(pathname) ? "/library" : pathname;
  const rest = query.toString();
  return rest ? `${base}?${rest}` : base;
}

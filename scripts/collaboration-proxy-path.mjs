const COLLABORATION_PREFIX = "/_spectra/realtime";
const COLLABORATION_HEALTH = "/_spectra/health";

export function isCollaborationProxyRequest(url = "/") {
  const path = (url.split("?")[0] ?? "/");
  return (
    path === COLLABORATION_PREFIX ||
    path.startsWith(`${COLLABORATION_PREFIX}/`) ||
    path === COLLABORATION_HEALTH
  );
}

export function collaborationPath(url = "/") {
  const pathOnly = url.split("?")[0] ?? "";
  if (
    pathOnly === COLLABORATION_HEALTH ||
    pathOnly.startsWith(`${COLLABORATION_HEALTH}/`)
  ) {
    const stripped = url.slice(COLLABORATION_HEALTH.length);
    if (!stripped) return COLLABORATION_HEALTH;
    return stripped.startsWith("?") || stripped.startsWith("/")
      ? `${COLLABORATION_HEALTH}${stripped}`
      : `${COLLABORATION_HEALTH}/${stripped}`;
  }
  const stripped = url.slice(COLLABORATION_PREFIX.length);
  if (!stripped) return "/";
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

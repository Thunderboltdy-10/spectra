const COLLABORATION_PREFIX = "/_spectra/realtime";

export function collaborationPath(url = "/") {
  const stripped = url.slice(COLLABORATION_PREFIX.length);
  if (!stripped) return "/";
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

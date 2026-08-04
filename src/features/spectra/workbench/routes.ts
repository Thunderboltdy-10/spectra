export function canonicalSpectraPath(pathname: string) {
  if (pathname === "/artifacts") return "/library";
  if (pathname.startsWith("/artifacts/")) return `/library/${pathname.slice(11)}`;
  if (pathname === "/timetable" || pathname.startsWith("/timetable/")) return "/calendar";
  if (pathname === "/memory" || pathname.startsWith("/memory/")) return "/settings?section=privacy";
  return pathname;
}

export function workspacePath(workspaceId: string) {
  return `/workspace/${encodeURIComponent(workspaceId)}`;
}

export function libraryWorkPath(workId: string) {
  return `/library/${encodeURIComponent(workId)}`;
}

import { isHomePath } from "../chat/home-routes";

/*
 * /workspace opens the Library shell when the address names something to
 * open; without one it sends on to Home. Home itself is /home (chat/home-routes).
 */

const SHELL_TARGETS = ["workspaceId", "artifactId", "threadId", "nodeId", "collection", "create"] as const;

export function isLibraryTarget(has: (key: string) => boolean) {
  return SHELL_TARGETS.some(has);
}

/** Home, with no thread open in it yet: the day, before a conversation takes the page. */
export function isHomeRoute(pathname: string, has: (key: string) => boolean) {
  return isHomePath(pathname) && !has("threadId");
}

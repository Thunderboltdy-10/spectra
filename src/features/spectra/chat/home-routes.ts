/*
 * Home is the conversation page: its greeting, week and work give way to a
 * thread when one is started or opened there. Every link to a thread, or to
 * a new one, is built here; /chat and the old /workspace home redirect.
 */

export const HOME_PATH = "/home";

export function threadHref(threadId: string) {
  return `${HOME_PATH}?threadId=${encodeURIComponent(threadId)}`;
}

/** Whether a path is Home, where threads open in place. */
export function isHomePath(pathname: string) {
  return pathname === HOME_PATH || pathname === "/chat";
}

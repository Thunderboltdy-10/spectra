/*
 * Where a work was brought to its full view from. It opens on the Library's own
 * route whatever surface it came from, so that route alone cannot say where
 * "back" is. Remembered per work for the sitting.
 */

const origins = new Map<string, string>();

export function rememberFullViewOrigin(workId: string, href: string) {
  origins.set(workId, href);
}

export function fullViewOrigin(workId: string) {
  return origins.get(workId) ?? null;
}

/*
 * "Open full" from a surface the Library does not host lands on the work's own
 * Library link. That link alone opens the work beside the Library, so the press
 * is remembered once here and the Library opens it full (F05).
 */
const fullViewRequests = new Set<string>();

export function requestFullView(workId: string) {
  fullViewRequests.add(workId);
}

export function takeFullViewRequest(workId: string) {
  return fullViewRequests.delete(workId);
}

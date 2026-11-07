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

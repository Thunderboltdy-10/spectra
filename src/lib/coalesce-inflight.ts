type InFlightEntry<T> = { at: number; promise: Promise<T> };

export function coalesceInFlight<T>(
  map: Map<string, InFlightEntry<T>>,
  key: string,
  ttlMs: number,
  start: () => Promise<T>,
  options: { force?: boolean } = {},
): Promise<T> {
  if (options.force) map.delete(key);
  const existing = map.get(key);
  if (existing && Date.now() - existing.at < ttlMs) return existing.promise;
  const promise = start();
  map.set(key, { at: Date.now(), promise });
  void promise.catch(() => {
    if (map.get(key)?.promise === promise) map.delete(key);
  });
  return promise;
}

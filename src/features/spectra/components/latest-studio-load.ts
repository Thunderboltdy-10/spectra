/** One selected detail request. Completed bodies are held only by the mounted host. */
export function createLatestStudioLoad<Value>(
  read: (id: string, signal: AbortSignal) => Promise<Value>,
) {
  let active: { id: string; controller: AbortController; promise: Promise<Value | null> } | null = null;
  const cancel = () => {
    const previous = active;
    active = null;
    previous?.controller.abort();
  };
  return {
    cancel,
    load(id: string): Promise<Value | null> {
      if (active?.id === id) return active.promise;
      cancel();
      const controller = new AbortController();
      const request = { id, controller, promise: null as unknown as Promise<Value | null> };
      active = request;
      request.promise = Promise.resolve()
        .then(() => controller.signal.aborted ? null : read(id, controller.signal))
        .then((value) => active === request ? value : null)
        .catch((error: unknown) => {
          if (active !== request) return null;
          throw error;
        })
        .finally(() => {
          if (active === request) active = null;
        });
      return request.promise;
    },
  };
}

/** One selected detail request. Completed bodies are held only by the mounted host. */
export function createLatestStudioLoad<Value, Target = string>(
  read: (target: Target, signal: AbortSignal) => Promise<Value>,
  keyOf?: (target: Target) => unknown,
) {
  let active: { id: unknown; controller: AbortController; promise: Promise<Value | null> } | null = null;
  const cancel = () => {
    const previous = active;
    active = null;
    previous?.controller.abort();
  };
  return {
    cancel,
    load(target: Target): Promise<Value | null> {
      const id = keyOf ? keyOf(target) : target;
      if (active && active.id === id) return active.promise;
      cancel();
      const controller = new AbortController();
      const request = { id, controller, promise: null as unknown as Promise<Value | null> };
      active = request;
      request.promise = Promise.resolve()
        .then(() => controller.signal.aborted ? null : read(target, controller.signal))
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

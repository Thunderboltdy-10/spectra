type ContractMap = Record<string, unknown>;
type Listener<T> = (payload: T) => void | Promise<void>;

export class TypedSpectraBus<
  Commands extends ContractMap,
  Events extends ContractMap,
  Queries extends ContractMap,
> {
  private commandHandlers = new Map<keyof Commands, Set<Listener<unknown>>>();
  private eventListeners = new Map<keyof Events, Set<Listener<unknown>>>();
  private queryState = new Map<keyof Queries, unknown>();
  private queryListeners = new Map<keyof Queries, Set<Listener<unknown>>>();

  handle<K extends keyof Commands>(key: K, listener: Listener<Commands[K]>) {
    return this.add(this.commandHandlers, key, listener);
  }

  command<K extends keyof Commands>(key: K, payload: Commands[K]) {
    return this.dispatch(this.commandHandlers, key, payload);
  }

  /** Await every semantic command consumer before reporting completion. */
  async commandAsync<K extends keyof Commands>(key: K, payload: Commands[K]) {
    return this.dispatchAsync(this.commandHandlers, key, payload);
  }

  on<K extends keyof Events>(key: K, listener: Listener<Events[K]>) {
    return this.add(this.eventListeners, key, listener);
  }

  emit<K extends keyof Events>(key: K, payload: Events[K]) {
    this.dispatch(this.eventListeners, key, payload);
  }

  setQuery<K extends keyof Queries>(key: K, value: Queries[K]) {
    this.queryState.set(key, value);
    this.dispatch(this.queryListeners, key, value);
  }

  getQuery<K extends keyof Queries>(key: K) {
    return this.queryState.get(key) as Queries[K] | undefined;
  }

  subscribe<K extends keyof Queries>(key: K, listener: Listener<Queries[K]>) {
    return this.add(this.queryListeners, key, listener);
  }

  private add<K extends PropertyKey, T>(
    registry: Map<K, Set<Listener<unknown>>>,
    key: K,
    listener: Listener<T>,
  ) {
    const listeners = registry.get(key) ?? new Set<Listener<unknown>>();
    listeners.add(listener as Listener<unknown>);
    registry.set(key, listeners);
    return () => {
      listeners.delete(listener as Listener<unknown>);
      if (!listeners.size) registry.delete(key);
    };
  }

  private dispatch<K extends PropertyKey, T>(
    registry: Map<K, Set<Listener<unknown>>>,
    key: K,
    payload: T,
  ): number {
    const listeners = registry.get(key);
    if (!listeners) return 0;
    for (const listener of listeners) listener(payload);
    return listeners.size;
  }

  private async dispatchAsync<K extends PropertyKey, T>(
    registry: Map<K, Set<Listener<unknown>>>,
    key: K,
    payload: T,
  ): Promise<number> {
    const listeners = registry.get(key);
    if (!listeners) return 0;
    await Promise.all([...listeners].map((listener) => listener(payload)));
    return listeners.size;
  }
}

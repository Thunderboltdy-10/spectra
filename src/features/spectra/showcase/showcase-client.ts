import { getFunctionName, type FunctionReference } from "convex/server";

/*
 * Spectra without a server: the stand-in the landing page gives the app's own
 * components where they would read Convex. Each query is answered by name from
 * the story's world, and answers again whenever the story changes it, so a
 * real Home, calendar or studio renders and updates exactly as it does for a
 * signed-in student. Mutations are the story's to handle; any it does not
 * know succeed quietly, so a visitor pressing a real button never sees an
 * error from a server that is not there.
 */

type Args = Record<string, unknown>;
export type ShowcaseQuery = (args: Args) => unknown;
export type ShowcaseMutation = (args: Args) => unknown;

const nameOf = (reference: unknown) =>
  typeof reference === "string" ? reference : getFunctionName(reference as FunctionReference<"query">);

/** A Convex function name ("module:fn") as the story writes it. */
export const fn = (module: string, name: string) => `${module}:${name}`;

export class ShowcaseConvexClient {
  private queries = new Map<string, ShowcaseQuery>();
  private mutations = new Map<string, ShowcaseMutation>();
  private listeners = new Set<() => void>();
  private missing = new Set<string>();
  /** Bumped whenever the world changes, so every open watch reads again. */
  private version = 0;
  /** One answer per query and arguments until the world changes. Convex hands
   * every watch of the same query the same result object; a fresh one per
   * watch would read as a change and render the reader again, forever. */
  private answers = new Map<string, { version: number; value: unknown }>();

  constructor(world: { queries?: Record<string, ShowcaseQuery>; mutations?: Record<string, ShowcaseMutation> } = {}) {
    for (const [name, answer] of Object.entries(world.queries ?? {})) this.queries.set(name, answer);
    for (const [name, handle] of Object.entries(world.mutations ?? {})) this.mutations.set(name, handle);
  }

  /** Answer (or stop answering) a query; every watcher of it reads again. */
  answer(name: string, query: ShowcaseQuery | null) {
    if (query) this.queries.set(name, query);
    else this.queries.delete(name);
    this.changed();
  }

  handle(name: string, mutation: ShowcaseMutation) {
    this.mutations.set(name, mutation);
  }

  /** The world moved: read every query again. */
  changed() {
    this.version += 1;
    this.answers.clear();
    for (const listener of [...this.listeners]) listener();
  }

  private read(name: string, args: Args) {
    const query = this.queries.get(name);
    if (!query) {
      if (process.env.NODE_ENV !== "production" && !this.missing.has(name)) {
        this.missing.add(name);
        console.debug(`[showcase] no answer for ${name}`);
      }
      return undefined;
    }
    try {
      return query(args);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private answerFor(name: string, args: Args) {
    const key = `${name}:${JSON.stringify(args)}`;
    const cached = this.answers.get(key);
    if (cached && cached.version === this.version) return cached.value;
    const value = this.read(name, args);
    this.answers.set(key, { version: this.version, value });
    return value;
  }

  watchQuery(reference: unknown, args: Args = {}) {
    const name = nameOf(reference);
    const current = () => this.answerFor(name, args);
    return {
      onUpdate: (callback: () => void) => {
        this.listeners.add(callback);
        return () => {
          this.listeners.delete(callback);
        };
      },
      localQueryResult: () => {
        const result = current();
        if (result instanceof Error) throw result;
        return result;
      },
      localQueryLogs: () => undefined,
      journal: () => undefined,
    };
  }

  watchPaginatedQuery(reference: unknown, args: Args = {}) {
    const watch = this.watchQuery(reference, args);
    let source: unknown;
    let shaped: unknown;
    return {
      ...watch,
      localQueryResult: () => {
        const page = watch.localQueryResult() as { page?: unknown[] } | unknown[] | undefined;
        if (page === undefined) return undefined;
        if (page !== source) {
          source = page;
          const results = Array.isArray(page) ? page : (page?.page ?? []);
          shaped = { results, status: "Exhausted", loadMore: () => false };
        }
        return shaped;
      },
    };
  }

  async query(reference: unknown, args: Args = {}) {
    const value = this.read(nameOf(reference), args);
    if (value instanceof Error) throw value;
    return value;
  }

  async mutation(reference: unknown, args: Args = {}) {
    const handle = this.mutations.get(nameOf(reference));
    const result = handle ? await handle(args) : null;
    this.changed();
    return result;
  }

  async action(reference: unknown, args: Args = {}) {
    return this.mutation(reference, args);
  }

  prewarmQuery() {}

  setAuth(_fetchToken: unknown, onChange?: (isAuthenticated: boolean) => void) {
    queueMicrotask(() => onChange?.(true));
  }

  clearAuth() {}

  connectionState() {
    return {
      hasInflightRequests: false,
      isWebSocketConnected: true,
      timeOfOldestInflightRequest: null,
      hasEverConnected: true,
      connectionCount: 1,
      connectionRetries: 0,
      inflightMutations: 0,
      inflightActions: 0,
    };
  }

  subscribeToConnectionState() {
    return () => undefined;
  }

  get url() {
    return "https://showcase.spectra.invalid";
  }

  async close() {}
}

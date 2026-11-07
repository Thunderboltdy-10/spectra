/*
 * Each document is read from the database once per function.
 *
 * Convex bills a whole document on every read, and the same row is often read
 * many times in one transaction: by the permission check, by the mutation, and
 * twice more by convex-helpers triggers around every patch. This remembers what
 * a function has read and keeps it current with what the function writes, so a
 * patch to a large artifact costs its one read rather than three.
 *
 * Index queries still go to the database, so they always see the transaction's
 * own writes. A nested ctx.runMutation is a sub-transaction this can't see into,
 * so everything remembered is dropped when one returns.
 */

type Doc = Record<string, unknown>;
type Reader = {
  get(...args: unknown[]): Promise<unknown>;
  normalizeId(...args: unknown[]): unknown;
  query(...args: unknown[]): unknown;
  system: unknown;
  insert?(...args: unknown[]): Promise<unknown>;
  patch?(...args: unknown[]): Promise<void>;
  replace?(...args: unknown[]): Promise<void>;
  delete?(...args: unknown[]): Promise<void>;
};

/** The id and the rest, for both `get(id)` and `get(table, id)`. */
function idOf(args: unknown[], valueArity: number) {
  return String(args[args.length - 1 - valueArity]);
}

function withoutUndefined(doc: Doc): Doc {
  const kept: Doc = {};
  for (const [key, value] of Object.entries(doc)) if (value !== undefined) kept[key] = value;
  return kept;
}

export function readOnceDb<Db>(db: Db): { db: Db; forget: () => void } {
  const inner = db as unknown as Reader;
  const seen = new Map<string, Promise<Doc | null>>();
  const remember = (id: string, update: (doc: Doc) => Doc) => {
    const prior = seen.get(id);
    if (!prior) return;
    seen.set(id, prior.then((doc) => (doc ? update(doc) : null)));
  };
  const wrapped: Reader = {
    get(...args) {
      const id = idOf(args, 0);
      let read = seen.get(id);
      if (!read) {
        read = inner.get(...args) as Promise<Doc | null>;
        seen.set(id, read);
        // A refused read isn't an answer; the next one asks again.
        read.catch(() => seen.delete(id));
      }
      // A copy, so a caller changing what it read doesn't change what's remembered.
      return read.then((doc) => (doc ? { ...doc } : null));
    },
    normalizeId: (...args) => inner.normalizeId(...args),
    query: (...args) => inner.query(...args),
    get system() {
      return inner.system;
    },
  };
  if (inner.insert) {
    wrapped.insert = (...args) => inner.insert!(...args);
    wrapped.patch = async (...args) => {
      const id = idOf(args, 1);
      const value = args[args.length - 1] as Doc;
      await seen.get(id);
      await inner.patch!(...args);
      remember(id, (doc) => withoutUndefined({ ...doc, ...value }));
    };
    wrapped.replace = async (...args) => {
      const id = idOf(args, 1);
      const value = args[args.length - 1] as Doc;
      await seen.get(id);
      await inner.replace!(...args);
      remember(id, (doc) => withoutUndefined({ ...value, _id: doc._id, _creationTime: doc._creationTime }));
    };
    wrapped.delete = async (...args) => {
      const id = idOf(args, 0);
      await inner.delete!(...args);
      seen.set(id, Promise.resolve(null));
    };
  }
  return { db: wrapped as unknown as Db, forget: () => seen.clear() };
}

/** The function's ctx with each document read once. */
export function withReadOnce<Ctx extends { db: unknown; runMutation?: unknown }>(ctx: Ctx): Ctx {
  const { db, forget } = readOnceDb(ctx.db);
  const next = { ...ctx, db };
  if (typeof ctx.runMutation === "function") {
    const run = ctx.runMutation as (...args: unknown[]) => Promise<unknown>;
    (next as { runMutation: unknown }).runMutation = async (...args: unknown[]) => {
      try {
        return await run(...args);
      } finally {
        forget();
      }
    };
  }
  return next;
}

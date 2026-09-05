/**
 * An in-memory stand-in for `ctx.db`, so the real tree writers in
 * `convex/orgTreeShared.ts` can be tested without a deployment.
 *
 * This is deliberately a fake *database*, not a fake tree: every test drives
 * the production functions, and the only thing simulated is storage. It models
 * the three Convex behaviours the tree logic actually depends on —
 *
 *   - an index is a sort order, so `.order("desc").take(1)` returns the row
 *     with the highest trailing field, not an arbitrary one;
 *   - `patch` with an `undefined` value *removes* the field, which is how a
 *     restore clears `deletedAt`;
 *   - reads return copies, so a caller cannot mutate stored state by accident.
 */

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

/** The index field lists the tree relies on, in index order. */
const INDEXES: Record<string, Record<string, string[]>> = {
  orgNodes: {
    by_account_parent_order: ["accountId", "parentId", "orderKey"],
    by_parent: ["parentId"],
    by_account_kind_source: ["accountId", "kind", "sourceId"],
    by_kind_source: ["kind", "sourceId"],
    by_account_workspace: ["accountId", "workspaceContextId"],
    by_workspace_context: ["workspaceContextId"],
    by_account_deleted: ["accountId", "deletedAt"],
    by_trashed_root: ["trashedRootId"],
    by_account_trash_root: ["accountId", "isTrashRoot", "deletedAt"],
  },
  artifactUserStates: {
    by_artifact_updated: ["artifactId", "updatedAt"],
  },
  spectraArtifactLinks: {
    by_source: ["sourceArtifactId"],
    by_target: ["targetArtifactId"],
  },
  spectraMessages: {
    by_thread: ["threadId"],
  },
  spectraWorkspaces: {
    by_account_starter: ["ownerAccountId", "starterKey"],
    by_account_status: ["ownerAccountId", "status"],
  },
  spectraArtifacts: {},
  spectraArtifactSummaries: {
    by_artifact: ["artifactId"],
    by_account_status_updated: ["ownerAccountId", "status", "updatedAt"],
    by_account_blueprint_status_updated: [
      "ownerAccountId",
      "blueprintKey",
      "status",
      "updatedAt",
    ],
  },
  spectraThreads: {},
};

function compare(a: unknown, b: unknown) {
  if (a === b) return 0;
  /* Convex sorts undefined and null before every value; the tree stores a
     root-level `parentId` as null and an absent `deletedAt` as undefined, and
     both must sort ahead of real ids for "last child" to mean what it says. */
  const rank = (value: unknown) =>
    value === undefined ? 0 : value === null ? 1 : 2;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

class FakeQuery {
  constructor(
    private rows: Row[],
    private fields: string[] = [],
    private descending = false,
  ) {}

  withIndex(_name: string, build?: (q: IndexBuilder) => IndexBuilder) {
    const builder = new IndexBuilder();
    if (build) build(builder);
    const filtered = this.rows.filter((row) =>
      builder.equalities.every(
        ([field, value]) => (row[field] ?? undefined) === (value ?? undefined),
      ),
    );
    return new FakeQuery(filtered, this.fields, this.descending);
  }

  order(direction: "asc" | "desc") {
    return new FakeQuery(this.rows, this.fields, direction === "desc");
  }

  private sorted() {
    const keys = [...this.fields, "_creationTime"];
    const rows = [...this.rows].sort((a, b) => {
      for (const key of keys) {
        const result = compare(a[key], b[key]);
        if (result !== 0) return result;
      }
      return 0;
    });
    return this.descending ? rows.reverse() : rows;
  }

  async collect() {
    return this.sorted().map((row) => ({ ...row }));
  }

  async take(count: number) {
    return this.sorted()
      .slice(0, count)
      .map((row) => ({ ...row }));
  }

  async paginate({
    cursor,
    numItems,
  }: {
    cursor: string | null;
    numItems: number;
  }) {
    const rows = this.sorted();
    const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const page = rows.slice(start, start + numItems).map((row) => ({ ...row }));
    const next = start + numItems;
    const isDone = next >= rows.length;
    return {
      page,
      isDone,
      continueCursor: isDone ? "" : String(next),
    };
  }

  async first() {
    return this.sorted().map((row) => ({ ...row }))[0] ?? null;
  }

  async unique() {
    const rows = this.sorted();
    if (rows.length > 1) {
      throw new Error(`unique query returned ${rows.length} documents`);
    }
    return rows[0] ? { ...rows[0] } : null;
  }
}

class IndexBuilder {
  equalities: Array<[string, unknown]> = [];
  eq(field: string, value: unknown) {
    this.equalities.push([field, value]);
    return this;
  }
}

export class FakeDb {
  private tables = new Map<string, Map<string, Row>>();
  private sequence = 0;
  /** Every patch, so a test can assert a move touched only metadata (I4). */
  patches: Array<{ id: string; keys: string[] }> = [];

  private table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  private tableOf(id: string) {
    return this.table(id.split(":")[0]!);
  }

  query(name: string) {
    /* The index field list is per-table, and every query names its index, so
       resolve fields lazily at withIndex time by handing them all in. */
    const rows = [...this.table(name).values()];
    return new IndexedQuery(rows, INDEXES[name] ?? {});
  }

  async get(id: string | null | undefined) {
    if (!id) return null;
    const row = this.tableOf(id).get(id);
    return row ? { ...row } : null;
  }

  async insert(name: string, doc: Record<string, unknown>) {
    this.sequence += 1;
    const _id = `${name}:${this.sequence}`;
    const row: Row = { ...doc, _id, _creationTime: this.sequence };
    for (const [key, value] of Object.entries(row))
      if (value === undefined) delete row[key];
    this.table(name).set(_id, row);
    return _id;
  }

  async patch(id: string, partial: Record<string, unknown>) {
    const row = this.tableOf(id).get(id);
    if (!row) throw new Error(`patch on missing document ${id}`);
    this.patches.push({ id, keys: Object.keys(partial) });
    for (const [key, value] of Object.entries(partial)) {
      /* Convex treats an explicit undefined as "remove this field". */
      if (value === undefined) delete row[key];
      else row[key] = value;
    }
  }

  async replace(id: string, doc: Record<string, unknown>) {
    const row = this.tableOf(id).get(id);
    if (!row) throw new Error(`replace on missing document ${id}`);
    this.tableOf(id).set(id, {
      ...doc,
      _id: row._id,
      _creationTime: row._creationTime,
    } as Row);
  }

  async delete(id: string) {
    this.tableOf(id).delete(id);
  }

  normalizeId(name: string, candidate: string) {
    return candidate.startsWith(`${name}:`) ? candidate : null;
  }

  /** Every row in a table, unsorted — for assertions, not for production paths. */
  all(name: string) {
    return [...this.table(name).values()].map((row) => ({ ...row }));
  }
}

class IndexedQuery {
  constructor(
    private rows: Row[],
    private indexes: Record<string, string[]>,
  ) {}

  withIndex(name: string, build?: (q: IndexBuilder) => IndexBuilder) {
    const fields = this.indexes[name];
    if (!fields) throw new Error(`unknown index ${name}`);
    return new FakeQuery(this.rows, fields).withIndex(name, build);
  }

  async collect() {
    return new FakeQuery(this.rows, []).collect();
  }
}

/** A ctx whose only real surface is the database, which is all the tree uses. */
export function fakeCtx() {
  const db = new FakeDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db, ctx: { db } as any };
}

/** An account with its General workspace absent: the tree must create it. */
export async function seedAccount(db: FakeDb) {
  return (await db.insert("accounts", { name: "Test" })) as string;
}

export async function seedWorkspace(
  db: FakeDb,
  accountId: string,
  title: string,
  starterKey?: string,
) {
  const now = Date.now();
  const id = await db.insert("spectraWorkspaces", {
    ownerAccountId: accountId,
    title,
    starterKey,
    status: "active",
    defaultView: "library",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
  return (await db.get(id))!;
}

export async function seedArtifact(
  db: FakeDb,
  accountId: string,
  title: string,
) {
  const now = Date.now();
  return (await db.insert("spectraArtifacts", {
    ownerAccountId: accountId,
    title,
    blueprintKey: "document",
    content: { blocks: [], outline: [] },
    tags: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
  })) as string;
}

export async function seedThread(
  db: FakeDb,
  accountId: string,
  title: string,
) {
  const now = Date.now();
  return (await db.insert("spectraThreads", {
    ownerAccountId: accountId,
    title,
    origin: "workspace",
    status: "active",
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  })) as string;
}

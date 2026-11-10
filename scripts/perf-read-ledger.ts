/** Test-only observer of rows crossing the Convex db API boundary.
 * Counts returned documents (including repeated reads), not index entries scanned,
 * physical database bytes, cache hits, billing, or network transfer. Filters may
 * hide engine reads: their presence is recorded, never inferred as free.
 */
export type ReadSample = {
  table: string;
  index: string | null;
  operation: string;
  postIndexFilter: boolean;
  documentsReturned: number;
  serializedDocumentBytes: number;
};

export const serializedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function observeDatabase<T extends object>(database: T) {
  const reads: ReadSample[] = [];
  const writes: { operation: string; argumentBytes: number }[] = [];
  const record = (value: unknown, detail: Omit<ReadSample, "documentsReturned" | "serializedDocumentBytes">) => {
    const rows = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
    reads.push({ ...detail, documentsReturned: rows.length,
      serializedDocumentBytes: rows.reduce<number>((sum, row) => sum + serializedBytes(row), 0) });
  };
  const query = (target: object, table: string, index: string | null = null, postIndexFilter = false): object => new Proxy(target, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      if (property === Symbol.asyncIterator) return async function* () {
        const iterable = target as AsyncIterable<unknown>;
        for await (const row of iterable) {
          record(row, { table, index, postIndexFilter, operation: "iterate" });
          yield row;
        }
      };
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        const operation = String(property);
        if (["collect", "take", "first", "unique", "paginate"].includes(operation)) {
          return Promise.resolve(Reflect.apply(member, target, args)).then((result) => {
            if (operation === "paginate" && (!result || typeof result !== "object" || !("page" in result) || !Array.isArray(result.page)))
              throw new Error("Unrecognized pagination result; metrics cannot be collected");
            record(operation === "paginate" ? (result as { page: unknown[] }).page : result, { table, index, postIndexFilter, operation });
            return result;
          });
        }
        if (!["withIndex", "withSearchIndex", "filter", "order", "fullTableScan"].includes(operation))
          throw new Error(`Uninstrumented query method: ${operation}`);
        return query(Reflect.apply(member, target, args), table,
          operation === "withIndex" || operation === "withSearchIndex" ? String(args[0]) : index,
          postIndexFilter || operation === "filter");
      };
    },
  });
  const db = new Proxy(database, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      if (typeof member !== "function") return member;
      if (property === "query") return (table: string) => query(Reflect.apply(member, target, [table]), table);
      if (property === "get") return async (...args: unknown[]) => {
        const result = await Reflect.apply(member, target, args);
        // Convex IDs are opaque; do not guess the table from an ID's text.
        record(result, { table: args.length > 1 ? String(args[0]) : "(id lookup)", index: null, operation: "get", postIndexFilter: false });
        return result;
      };
      if (["insert", "patch", "replace", "delete"].includes(String(property))) return async (...args: unknown[]) => {
        const result = await Reflect.apply(member, target, args);
        writes.push({ operation: String(property), argumentBytes: serializedBytes(args) });
        return result;
      };
      return member.bind(target);
    },
  });
  return { db, reads, writes, snapshot: () => ({
    semantics: "Convex API returned rows / UTF-8 JSON bytes; not engine scans, physical DB I/O or billing",
    calls: reads.length,
    documentsReturned: reads.reduce((sum, row) => sum + row.documentsReturned, 0),
    serializedDocumentBytes: reads.reduce((sum, row) => sum + row.serializedDocumentBytes, 0),
    writes: writes.length,
    reads: reads.map((row) => ({ ...row })),
  }) };
}

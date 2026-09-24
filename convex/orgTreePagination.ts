import type { PaginationOptions, PaginationResult } from "convex/server";

/** Bind opaque database cursors to the account, scope and filters that made them. */
export function treePagination(options: PaginationOptions, scope: unknown[]) {
  const key = JSON.stringify(scope);
  const decode = (cursor: string | null | undefined) => {
    if (cursor == null) return cursor;
    try {
      const value: unknown = JSON.parse(cursor);
      if (Array.isArray(value) && value.length === 2 && value[0] === key && typeof value[1] === "string")
        return value[1];
    } catch { /* A foreign or malformed cursor must never broaden a listing. */ }
    throw new Error("This listing changed. Reload it to continue.");
  };
  const encode = (cursor: string) => JSON.stringify([key, cursor]);
  return {
    options: {
      ...options,
      numItems: Math.max(1, Math.min(options.numItems, 50)),
      cursor: decode(options.cursor) ?? null,
      ...(options.endCursor !== undefined ? { endCursor: decode(options.endCursor) } : {}),
      maximumRowsRead: 50,
    },
    result<T>(result: PaginationResult<T>): PaginationResult<T> {
      return {
        ...result,
        continueCursor: encode(result.continueCursor),
        ...(result.splitCursor ? { splitCursor: encode(result.splitCursor) } : {}),
      };
    },
  };
}

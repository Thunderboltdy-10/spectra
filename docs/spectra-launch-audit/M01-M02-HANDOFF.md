# Intake and deletion integration boundary

2026-09-10 parent decision; used by both completion prompts. This is a narrow contract design, not a new framework or executable placeholder.

## Ownership and sequence

M02 completes asset/import/evidence intake and its retained-reference cleanup helper first. M01 then consumes the finished M02 candidate in its own checkout, repairs the deletion/read/placement/polling paths and verifies the shared boundary. Primary stays at the accepted baseline until parent integration. Preserve both original candidate commits and report the exact revised/consumed hashes.

M02 owns asset and import receipt rows, media/original/staging objects, intake metering and their idempotent reference-release mechanics. M01 owns artifact deletion identity/generation, writer fencing, placements, snapshot/version disposition, Bridge/run/collaboration descendants and the overall job's progress. Native conversion operations remain M03; durable AI execution remains M04.

## Narrow helper expected from M02

Export releaseArtifactIntakePage from convex/artifactIntakeLifecycle.ts, following existing typed Convex helper conventions:

```ts
releaseArtifactIntakePage(
  ctx: MutationCtx,
  args: {
    artifactId: Id<"spectraArtifacts">;
    ownerAccountId: Id<"accounts">;
    cursor: string | null;
  },
): Promise<{
  cursor: string | null;
  done: boolean;
  deletedRows: number;
  releasedBytes: number;
}>;
```

Use existing storage/snapshot/payload abstractions underneath. The helper must read and validate the matching owner artifact's deleted/tombstoned state in the same transaction. Missing or active work is not permission to delete. It is an internal helper, not a new public endpoint. M01 validates job identity/generation and passes the persisted cursor in that transaction; do not couple the helper to a deletion-job schema absent from M02's checkout.

The cursor is opaque, versioned and scoped to this artifact/cleanup traversal. Each invocation has an explicit bounded read/write budget and advances through the rows it processes. Retries must not double-release an object or double-count metering. done means the owned traversal has finished and every remaining retained reference has a durable, documented lifecycle, not that a caller-supplied object was deleted. releasedBytes counts verified release once; a patch or refcount decrement with retained bytes is not byte release.

Do not accept candidateStorageId as ownership proof. A trusted upload boundary must have bound the actually stored object to the receipt. Preserve objects retained by native packages, active uses or allowed pinned snapshots. When a retained object outlives the owner artifact, its authoritative retention owner and eventual release mechanism must remain reachable without the deleted asset/job row. Authority to view retained content remains separately checked. Document this disposition for each intake family.

If the existing abstractions require a small signature adjustment, document it explicitly in M02's contract/report for M01 to consume; do not add a stub or move the work to the other package.

## M01 coordinator obligations

- Create/reuse a durable owner deletion receipt, deny new writes and hide deleted work immediately through existing authority/summary readers.
- Retain the tombstone needed by this helper, late acknowledgements and offline reconnect until those lifecycle obligations are satisfied. Completed cleanup need not imply physically deleting the last tombstone.
- Front-door work is bounded. Bulk placement invalidation, memory redaction, children and retained references have explicit bounded phases.
- Worker phase/cursor/generation updates and any new schedule are transactional. A repeated old worker cannot reclaim current work. Retryable failures have an authorized recovery path and backoff.
- Process terminal Bridge request rows once; retaining an audit row cannot keep the job perpetually selecting it.
- Pass M02's returned counts/cursor through one owning phase; never independently delete the same asset/import bytes.
- Both direct delete and owner Trash purge call this coordinator. A peer placement removal remains a placement removal.
- Derive user status from actual job state and retain thread history concerning surviving work.

## Shared acceptance

Use a local owner fixture with an imported document image, an original native package, a retained version and an embed in a peer container. Include a lost upload acknowledgement, an interrupted import commit, a revoked grant, a pinned retained reference, a queued native write, an offline reconnect and deletion retry. Verify authority, surviving references, canonical saved content, terminal job progress and metering. These are a small linked corpus, not a new broad audit.

M02 proves actual import/media save and reload before M01 relies on the contract. M01 proves cleanup of the same kind of valid intake objects. Fixtures and mocks remain clearly distinguished from real-local-Convex and device evidence.

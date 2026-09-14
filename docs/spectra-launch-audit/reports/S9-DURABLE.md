# S9-DURABLE — large Office durable path audit

Date: 2026-09-14 (Europe/Madrid)
Branch: `grokbot/launch-review/native-durable` (from `cb277f3`)
Status: **OPEN** for capacity redesign; **honesty seam repaired** in this branch. Dual-gate (Atlas+Spectra) still required. No push, no merge, no Actions, no original-file mutation.

## Measured root cause (not “just raise the limit”)

Accepted Office content, live Yjs, Convex rows, and native materialization do not share one byte budget. Dense workbooks and formal papers therefore open in the lens and later enter reconnect/unsynchronized collaboration, or require compaction before import persistence.

| Boundary | Constant / check | Units | Where enforced |
| --- | --- | --- | --- |
| Durable Yjs append / bootstrap / snapshot row | `MAX_DURABLE_UPDATE_BYTES` = `760 * 1024` | UTF-8/binary **bytes** | `scripts/collaboration-update-envelope.mjs`; gateway `beforeHandleMessage`; Convex `MAX_GATEWAY_UPDATE_BYTES` in `convex/collaborationGatewayStore.ts` |
| Realtime WebSocket frame | `MAX_REALTIME_MESSAGE_BYTES` = `1024 * 1024` | bytes | gateway `websocketOptions.maxPayload` / unauthenticated queue |
| Projection JSON (legacy) | `900_000` via `.length` | JS string length (UTF-16 code units), **not** UTF-8 bytes | gateway `artifactProjection`; Convex `parseGatewayProjection`; bridge `text(..., 900_000)` |
| Product persisted-content ceiling | `MAX_PERSISTED_CONTENT_BYTES = 900_000` | named “bytes” in `shared/intake-limits.ts` | import/product paths; historically conflated with projection `.length` |
| Sheet “chunking” | `SHEET_CELLS_CHUNK_SIZE = 256` | array partitions **inside one Convex value** | `shared/sheet-cells.ts` — does **not** partition the document or reduce total bytes |
| Cloudflare worker room | `MAX_UPDATE_BYTES = 1_048_576` | bytes | `workers/collaboration/src/protocol.ts` (separate from self-hosted durable envelope) |
| Bridge outer envelope | `MAX_COLLABORATION_BRIDGE_PAYLOAD_CHARACTERS = 2_000_000` | characters | `shared/collaboration-bridge.ts` |

**UTF-8 vs character mismatch (confirmed):** a projection of ~500k `"é"` characters is 500k `.length` but >900k UTF-8 bytes. Before this branch, character gates could admit JSON that Convex cannot store. This branch fails closed on **either** char or UTF-8 byte bound (`projectionExceedsDurableBound`).

**Merged-batch inflation (confirmed):** `persistAcceptedMessages` merges same-batch updates with `Y.mergeUpdates` and appends without a pre-merge `MAX_DURABLE_UPDATE_BYTES` check (`scripts/collaboration-gateway.mjs`). Individually legal deltas can combine past 760 KiB; Convex then rejects with `COLLABORATION_GATEWAY_UPDATE_SIZE`.

**Compaction silence (confirmed):** room snapshot compaction returns early when encoded snapshot >760 KiB or state vector >128 KiB (`collaboration-gateway.mjs` ~250) with no UI signal — large rooms stop compacting quietly.

## Reconnect / lost-ack honesty (pre-fix)

| Path | Pre-fix behavior | After this branch |
| --- | --- | --- |
| Oversized canonical delta in `beforeHandleMessage` | Closed `4409` **without** `spectra.durable_failed` | `rejectPeerUpdate` sends `spectra.durable_failed` then closes `4409` |
| Client `onDisconnect` for `4409` | Treated like ordinary disconnect; **cleared** `error`; could show `reconnecting` with `pending === 0` | Always `unsynchronized` with truthful user message; `unsynchronizedChanges` at least 1 |
| `COLLABORATION_PROJECTION_SIZE` / `_INVALID` on append | **Not** matched by `permanentPersistenceFailure` → retried as transient up to 12× then thrown **without** `forceCanonicalReconnect` | Treated permanent → `forceCanonicalReconnect` |
| Exhausted transient retries (`attempt >= 12`) | Threw without room-wide durable_failed | Calls `forceCanonicalReconnect` before throw |
| Permanent size/forbidden failures | Already `forceCanonicalReconnect` | Unchanged |

Acknowledgement still means durable Convex append (`spectra.durable_ack`). Network receipt alone is insufficient — preserved.

## Large native Office seams (still OPEN — Collab)

1. **Import → Yjs init → canonical update:** Formal paper (~695 equations) needed compaction (`compactDocxProjectionForStorage`) to fit persistence; W9-00 fixed no-op regeneration, not end-to-end capacity.
2. **200k-cell workbook:** Lens opens projection; collaboration hits durable/realtime envelope and reconnect stress (V8-04 / WAVE-9). `sheet-cells` chunking is cosmetic for Convex document size.
3. **Checkpoint / saved version / native materialization:** Immediate AI/native-init projections ride the same 900k gate; deferred human checkpoints can omit projection then later fail size. Snapshot compaction cannot land >760 KiB full state.
4. **Small edits on large artifacts:** Sync step 2 can send a near-1 MiB realtime frame; `canonicalDurableUpdate` correctly persists only the delta, but a **genuinely large first import/bootstrap** still cannot fit one append + projection + metadata set under Convex’s ~1 MiB document ceiling.

Raising 760 KiB or 900k alone cannot establish end-to-end capacity. Required design (handoff below): immutable payload/blob + versioned manifest, hot metadata separate, digest-verified commit/replay, bounded chunks with authorization at adopt/read/replay.

## What changed on this branch

Surgical honesty + bound reconciliation **without** rewriting the gateway orchestrator:

- `scripts/collaboration-update-envelope.mjs` — projection UTF-8/char helpers + shared durable-failure message/close code
- `scripts/collaboration-persist.mjs` — permanent projection size/invalid
- `scripts/collaboration-gateway.mjs` — `rejectPeerUpdate`, exhausted-retry reconnect, projection bound helper (no partition redesign)
- `convex/collaborationGatewayStore.ts` — UTF-8-aware projection gate
- `src/features/spectra/collaboration/hocuspocus-transport.ts` — `4409` honesty
- Tests locking the seams in `collaboration-gateway.test.ts` and `hocuspocus-transport-lifecycle.test.ts`

## Explicit Collab handoff (`C-Collab+Share`)

Do **not** solo-rewrite `scripts/collaboration-gateway.mjs` as a monolith. Proposed partition:

1. **Durable storage adapter** — payload/blob + manifest for large native Office; keep Yjs ledger authority; digest-verified versions; migration/read fallback for small legacy rows.
2. **Append pipeline** — pre-check merged batch bytes; split or spill to payload refs when `Y.mergeUpdates` exceeds `MAX_DURABLE_UPDATE_BYTES` (`persistAcceptedMessages` ~415–446).
3. **Projection path** — stream/chunk native projection separate from hot artifact row; reconcile `MAX_PERSISTED_CONTENT_BYTES` (true UTF-8) with bridge `text(..., 900_000)` character gate (`collaborationGatewayBridge.ts`).
4. **Compaction** — replace silent >760 KiB skip (~250) with spill-to-payload snapshot or truthful degraded health.
5. **Worker parity** — Cloudflare `MAX_UPDATE_BYTES = 1 MiB` vs self-hosted durable 760 KiB; document which provider large Office uses at launch.

Evidence anchors: `collaboration-gateway.mjs:250`, `:415–446`, `:725–759`, `:985–1022`, `:270–288`; `collaboration-persist.mjs:20–26`; `collaborationGatewayStore.ts` projection/append guards; `shared/sheet-cells.ts:1–84`; V8-04 200k / Maths EE fixtures.

## Verification run this session

- Focused Vitest: collaboration-gateway + hocuspocus-transport-lifecycle (see commit evidence)
- `npm run check:capabilities` / `npm run check:architecture` after code changes
- **NOT run:** full `local:start:all`, live 200k workbook, formal-paper native round-trip, two-session lost-ack live Convex, AI large-item edit, pin/source-delete retention against new storage (storage not redesigned)

## Remaining OPEN for S9-DURABLE / Spectra

- End-to-end capacity for formal paper + 200k workbook (open/edit/save/reload/reconnect/native readback)
- Payload/manifest storage design + migration
- Merged-batch and compaction structural fixes (Collab)
- Live latency/byte report for small vs large fixtures
- Dual-gate Atlas+Spectra sign-off; no merge until Collab capacity path lands or is explicitly deferred with truthful product limits

## Suggested Audit scale-room status (Atlas/Spectra)

S9-DURABLE remains OPEN on capacity: 760 KiB durable append, 900k projection (now UTF-8-honest), and in-value sheet chunking still cannot host dense Sheets/Word state end-to-end — Collab needs payload/manifest partitioning, not threshold bumps. This branch closed concrete honesty gaps (pre-apply `durable_failed`, permanent projection failures, exhausted-retry reconnect, client `4409` unsynchronized messaging) under ≤2 commits without a gateway rewrite; live 200k/formal-paper acceptance and dual-gate are still outstanding.

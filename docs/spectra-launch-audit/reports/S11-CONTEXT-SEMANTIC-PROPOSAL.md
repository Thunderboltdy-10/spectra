# S11 concrete semantic memory implementation proposal

**Proposed, not implemented. Schema and cross-file allocation require coordinator approval.** Evidence: `S11-CONTEXT-SEMANTIC.md` (537 synthetic input tokens, real OpenRouter/OpenAI 256-dimensional responses). The small held-out corpus supports learned ranking, not a universal cosine cutoff or production-quality claim.

## One store, one queue, current provider

Keep `memoryClaims`, the existing `memoryJobs` queue/leases/idempotency index, `memory.contextForRun`, and `memory.contextForRunBase`. Add a small Node action module `convex/memoryEmbeddings.ts` for OpenRouter requests, SHA-256 input identity and a bounded process-local query-vector cache. It uses the existing `convex/env.ts:getOpenRouterApiKey` boundary. RUNTIME verifies that the existing key is configured in the action runtime; no new credential store or unauthenticated HTTP bridge is proposed.

Pin `openai/text-embedding-3-small`, provider `OpenAI`, 256 dimensions, no provider fallbacks. This leaves the current chat model/fallback unchanged. A single immutable tag, `openrouter:OpenAI:text-embedding-3-small:256:v1`, describes provider, model, dimensionality and input-format version.

## Exact proposed schema changes

`memoryClaims`:

```ts
// Reuse the existing optional embedding vector; do not double stored vectors.
embeddingVersion: v.optional(v.string()),
embeddingInputHash: v.optional(v.string()),
embeddingUpdatedAt: v.optional(v.number()),
```

Extend existing `by_embedding` filter fields from `[accountId, schoolId, status]` to `[accountId, schoolId, status, scope, workspaceId, artifactId, embeddingVersion]`. Every learned vector search must constrain `embeddingVersion` to the exact tag and `status` to active, plus the relevant account/school/scope/destination. Existing hashed vectors have no tag and are excluded; no approximate classifier guesses their origin.

Add `search_normalized_proposition`, with `searchField: normalizedProposition` and filters `[accountId, schoolId, status, scope, workspaceId, artifactId]`, for bounded literal fallback. This uses the existing persisted normalized text, not a new document copy or a hand-written concept dictionary. RUNTIME must account for index build/readiness during coordinated publication; fallback remains available if learned vectors are not ready.

`memoryJobs`: add `embed` to `kind`, and add `by_kind_status_available: [kind, status, availableAt]`. The existing payload stores `{claimId, inputHash, embeddingVersion}`; no duplicated proposition is retained in the job row. Existing lease, attempt, status and error fields are reused. No new table is proposed.

## Scheduled generation and stale-job protection

- On a new accepted claim, enqueue one job keyed by account + claim ID + SHA-256 of the exact stored proposition + model-version tag. A repeated confirmation that does not change the stored proposition does not enqueue another job. Corrections already create a new claim; they receive their own job. Legacy active claims are handled by an explicit bounded backfill, not a full request-time scan.
- Remove the current synchronous hash generation in `upsertClaim` and the `maintain` unembedded-row hash writer. They must not overwrite a learned vector or silently leave it mistagged. Keep the fingerprint implementation only for historical benchmark tests until no callers remain.
- Extend the existing maintainer with an explicit embedding dispatch branch. Use the new kind/status index so embedding backlog cannot consume the non-embedding capture/delete quota. Initial bound: at most two embedding jobs dispatched per maintenance turn, preserving existing non-embedding processing. Dispatch only through `ctx.scheduler.runAfter`; never wait for provider I/O inside a mutation.
- The action obtains the current job lease and a fresh permitted proposition through an internal query/mutation seam. Validate active claim, account/school, memory preferences, and current source evidence before provider submission. Record a unique lease token using the existing lease owner field.
- Commit the returned vector in one internal mutation only if the job lease token still matches, the claim remains active/permitted, the exact stored proposition hashes to `inputHash`, and the requested model-version is current. Recheck source authority there. Deleted, corrected, reclassified, disabled or superseded work must not publish a stale vector. Update vector, hash and version atomically; preserve the claim's semantic `updatedAt` so indexing does not make an old memory look newly confirmed.
- Retry only transient timeout/429/5xx failures, at most three total attempts, with scheduled backoff. A lost/expired lease can retry; an old completion loses its compare-and-swap check. Terminal failures retain literal service and an honest indexing status. No infinite retry loop and no status that implies a vector was saved before commit.

## Optional query embedding and retrieval

`contextForRun` is invoked on demand by the existing retrieval tool; initial orientation continues to skip it. Its input remains query + optional workspace/artifact + token budget. After authenticating, obtain one query vector through `memoryEmbeddings`, then query only matching versioned vector partitions. Scope partitions are selected from authenticated identity and exact requested destinations; a workspace ID is not itself authority.

Use a process-local, action-only LRU for query vectors: at most 128 entries, five-minute lifetime, keyed by the exact query text actually submitted plus the immutable provider/model/dimension tag (and account namespace). Cache only vectors, never claims, permissions, source rows or retrieval results. Entries expire on lookup and are evicted at capacity. Process reuse is best effort; isolate replacement safely causes a cache miss. This avoids paying database reads/writes for an embedding whose measured query cost was $0.00000028, while making no unsupported promise of cross-worker cache hits. First/repeated provider behavior remains measured separately.

Bound each authorized partition's vector candidate count, merge/deduplicate before hydration, and cap total candidate identities at 80. Literal fallback uses the new text index, at most 20 identities; explicit claim references use at most eight exact lookups. Apply current claim scope/lifecycle/category and source checks **after every retrieval path**. The final model-visible candidate text is capped by the existing token budget and a small claim limit. Do not retain the current unconditional 500 owned + 200 workspace + 200 artifact row scan or fill unused budget with recent unrelated claims.

On timeout/missing key/indexing lag, return the bounded literal/exact result with explicit fallback/truncation status. Do not silently substitute hashed cosine, invent semantic confidence, or return an entire memory catalog. No model/provider switch occurs.

Relations are expanded only through already-authorized candidates, with a bounded per-direction edge count and finite two-hop frontier; a revoked intermediary cannot influence a later neighbor. Account/school and endpoint identities are checked on each edge. The final rendered citation/scope text—not proposition-only length—is charged against the context budget.

These results are **candidate evidence**. The existing main-model tool loop decides applicability and may use none. Retrieval receipts must distinguish returned candidates from actually used claims. The measured cutoff is not installed as a universal gate. Any change to receipt/use reporting belongs to a coordinated tool adapter hunk, rather than pretending every returned candidate was used.

## Source-checked implementation boundaries

The existing source adds several requirements to the design above. These are proposal details, not additional implemented behavior.

| Existing behavior | Required implementation boundary |
| --- | --- |
| `canReadClaim` allows account-owned `private_global` and `system` claims without requiring their creation school to match the current school. | Partition those scopes by account and scope, without a blanket current-school filter. `private_school` remains account/current-school scoped. Workspace/artifact partitions use the exact destination and claim scope; do not constrain their author account to the reader. Reapply the existing `scopeSchoolId`, destination authority and source checks to every result. Index filters narrow candidates; they do not redefine authority. |
| `retrievalIdentity` currently returns identity without checking memory preferences. | Check enabled preferences before provider submission. A disabled-memory call returns without a query embedding. Cache lookup does not substitute for this current check. |
| `maintain` deletes completed `memoryJobs` after 30 days. | Before enqueueing, compare the claim's committed `embeddingVersion` and `embeddingInputHash` with the expected identity. Queue idempotency alone cannot prevent unchanged claims being embedded again after job retention expires. A merged near-duplicate uses the actual retained proposition, not the incoming paraphrase, for this comparison. |
| The current maintainer selects all job kinds through `by_status_available`. | Move non-embedding selection to bounded kind-specific queries using the proposed index as well as giving embeddings a separate dispatch quota. Filtering `embed` rows after a 20-row `take` would let an embedding backlog starve capture/delete work. Preserve a finite aggregate non-embedding processing bound. |
| Every currently processed job adds its account to `touchedAccounts`, whose capsule rebuild reads all active claims. | Embedding dispatch/completion must not enter that branch or invalidate capsules. A vector update changes neither proposition text nor semantic confirmation time. Reusing the job table must not introduce a full-account read for every embedded claim. |
| The proposal's Node action cannot be imported into Convex mutation modules. | Keep identity constants and SHA-256 calculation in a small runtime-neutral helper if shared. Use the repository's existing Web Crypto digest pattern in mutations; the Node action performs provider I/O only through internal action references. Generated API updates remain coordinated with RUNTIME. |

The embedding action must validate successful response identity, exact 256-element finite vector shape, and finite values before commit. A provider success with a malformed or mismatched response is a failure, never a learned-vector write. Provider error text retained in the queue must be bounded and sanitized; it must not persist credentials, headers, or the submitted proposition.

Lease acquisition and completion are separate internal mutations. The lease token identifies one attempt, expires on a bounded schedule, and is checked again at completion. The final mutation re-reads the claim, preferences and evidence, recomputes the exact stored-input hash, and verifies current lifecycle/scope authority. It cannot rely on the earlier action-read result. An unchanged proposition may retain its vector across harmless metadata updates; correction, deletion, or an authority change that now denies the source rejects the completion.

Additional deterministic acceptance cases follow directly: unchanged confirmation after completed-job retention schedules no request; retained near-duplicate text supplies the embedding identity; an embedding-only batch triggers no capsule rebuild; a saturated embedding queue leaves capture/delete admission available; disabled memory sends no provider request; global memory survives a school change where its source remains allowed; and readable shared claims authored by another account remain discoverable without admitting private claims from that account.

## Proposed owned files and acceptance

- `convex/memory.ts`: enqueue/dispatch, bounded candidate union, source checks, token accounting and internal CAS seams.
- `convex/memoryEmbeddings.ts` (new): provider request, bounded retries and exact query-vector LRU.
- `convex/schema.ts`: only the fields/kind/index changes above, coordinated with DATA/SECURITY.
- Focused memory/action tests and a frozen expanded semantic corpus. A narrow `retrieve_memory` tool-result/receipt adapter hunk in `plan.ts` requires ENGINE allocation.

Required deterministic cases: repeated unchanged confirmation schedules once; learned and hashed versions never mix; delayed completion after correction/forget/source revoke does nothing; lease loss/retry cannot overwrite newer work; query cache expires and is model/account separated; provider failure preserves literal retrieval; no inaccessible intermediary traversal; complete rendered budget is respected; no-source direct answer performs zero memory calls. Measure returned DB documents/bytes as well as network/provider cost. Run model applicability tests against a larger frozen corpus without tuning to its held-out set.

## Artifact and thread applicability is a separate path

This proposal repairs personal memory retrieval only. The active `search_objects` still searches artifacts, and `read_thread` still exposes only recent history. Artifact content changes have different revision/Yjs identities and thread content is paginated; neither can safely inherit memory's proposition hash or queue semantics. A later bounded unit must index canonical artifact revision snapshots and thread message ranges, preserve workspace placement, and reauthorize exact sources on every hit. Existing live source-read tools remain the authority. No claim of artifact/thread semantic retrieval or 256k compaction is made here.

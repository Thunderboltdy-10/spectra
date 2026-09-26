# S11 DATA — active workspace analytics

2026-09-25. Worker `01a0d846-6897-7c12-a054-cff221fe04f3`; coordinator `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.

## Completed unit

Personal analytics now counts active workspaces through the existing `(ownerAccountId, status, lastActivityAt)` index. Previously, retained archived workspaces consumed the 2,001-row sample before the handler filtered for active status. A real-handler fixture with 2,010 archived and 12 active workspaces returned **0 / partial** instead of **12 / available** and read approximately 3 MB of rows. The repaired query returns 12 and reads approximately 4.6 KB. The metric registry identifies the new source index.

This is a finite correctness and cost repair, not a conclusion that all Convex reads are economical or that launch acceptance is complete.

- Checkout: `<local-workspace>`, branch `codex/s11-data-analytics`, starting HEAD `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`.
- Effective session metadata and coordinator verification: `gpt-6-astra`, `xhigh`, `danger-full-access`, approval `never`.
- Owned changes: `convex/analytics.ts`, new `convex/s11-data-cost.test.ts`, one source-index string in `src/features/spectra/administration/metric-registry.ts`, this report. Coordinator approved the additional registry string before its edit.
- No schema change, new table, migration, trigger, UI layout, service start, backend publication, browser/native action, school record change, or provider change. The primary dependency directory is only referenced by a junction; RUNTIME performed dependency restoration.

## Reproduction and measurement

`convex/s11-data-cost.test.ts` invokes the actual `personalOverview` handler against `convex-test`, using the existing `scripts/perf-read-ledger.ts` observer around the real database API. The fixture first measures 12 active rows, inserts 2,010 archived rows with earlier in-range activity and retained descriptions, then measures again. The baseline test failed at the **user-visible count/state assertion**, not at a source-code or index-name assertion. The two other tests passed before the repair.

| Same fixture shape | Active result | API read calls | Returned rows, including identity | Returned-row UTF-8 JSON bytes | Serialized response bytes | Query writes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Before, 12 active only | 12 / available | 7 | 15 | 4,556 | 1,447 | 0 |
| Before, plus 2,010 archived | 0 / partial | 7 | 2,004 | 3,002,335 | 1,459 | 0 |
| After, 12 active only | 12 / available | 7 | 15 | 4,550 | 1,447 | 0 |
| After, plus 2,010 archived | 12 / available | 7 | 15 | 4,550 | 1,447 | 0 |

The workspace query itself changed from **2,001 rows / 3,001,573 bytes** to **12 rows / 3,788 bytes**. Total returned-row bytes fell **99.85%** in the archive-heavy fixture; API-call count stayed seven. The few-byte difference between the two sparse baselines comes from separately generated fixture identities. Within each run, the active-only and archive-heavy repaired samples are byte-for-byte equal.

These are serialized database documents returned to the function, including repeated reads. They are **not** physical engine I/O, index entries scanned, cache hits, hosted billing, measured HTTP traffic, or browser latency. The workspace queries use explicit index ranges and no Convex post-index filter. Engine scan counts remain unobserved. The nearly unchanged response size did not reveal the failure.

Private evidence remains in this worker's ignored `.spectra-local/launch-s11/data/`:

- `analytics-workspaces-before.json`: source SHA-256 `253d85a2afac6528faa69e0d665eae86a38bb219275151b9c01e7f16540148d5`.
- `analytics-workspaces-after.json`: source SHA-256 `1f1bdf4f9f244a279bd6d094f8d98ccbfeeb24998aada0d6f64fa7b6fd8c078c`.

Each JSON contains both sparse and archive-heavy samples, the exact read ledger, count/state and source hash. These hashes describe the measured working-file bytes; Git may normalize CRLF on checkout. No generated fixtures or logs are committed.

Reproduction from the worker checkout, using the centrally restored dependencies:

```powershell
$env:SPECTRA_S11_DATA_EVIDENCE = 'after'
node node_modules/vitest/vitest.mjs run convex/s11-data-cost.test.ts convex/analytics-bounded.test.ts convex/s10-perf.test.ts --maxWorkers=1 --no-file-parallelism
```

To reproduce the failure in a separate disposable checkout, apply only the new regression file to starting HEAD and set the evidence label to `before`. Do not reset a shared checkout or alter the shared database.

## Contracts and verification

The metric remains account-private and counts currently active workspaces whose **last activity**, not creation time, falls within the inclusive requested range. An archive outside that set does not consume its budget. More than 2,000 eligible active rows still returns a partial metric with the existing narrowing guidance. No continuation, exact-total claim or array contract is changed. Other metrics and their preparation markers are unchanged.

The new tests cover:

- Active rows behind archived history; retained descriptions growing above 100 KB; 120 foreign-account and 120 out-of-range active rows; all 2,010 archived records still present.
- Archive and restore; activity immediately outside and exactly on both date boundaries; owner transfer away and back; reader deactivation after successful reads.
- 2,001 eligible active rows retaining explicit `partial` status instead of silently claiming a complete count.

Post-repair **10/10 tests passed in three files** in 18.32 seconds, one worker. Existing analytics coverage also exercises artifact/run body independence, migration incompleteness, bounded continuation and cursor rejection, nonempty counts, status/ownership/deletion maintenance and heartbeat no-op behavior. `convex/s10-perf.test.ts` independently exercises compact Library and analytics handlers. Scoped ESLint passed for all three changed TypeScript files, and `git diff --check` passed. The final test-file change after the run is comment-only.

No full TypeScript/build/suite, live Convex billing, browser subscription count or native acceptance is claimed. Full checks and publication remain coordinator/RUNTIME work. The served web, Convex, gateway and Bridge revisions were not changed or certified by this unit.

## Historical decisions reviewed

Read the complete S11 charter and user brief, the original request via coordinator `read_thread`, S9-DURABLE and S10-CONVEX/PLATFORM/PERF reports, actual historical task messages and relevant current callers/diffs. The current repository calls the earlier DATA report **S10-CONVEX.md**; there is no S10-DATA.md at starting HEAD.

| Source and original decision | Current evidence | Verdict and consequence | Verification / remaining boundary |
| --- | --- | --- | --- |
| S9-DURABLE `01a0be88-d3ae-77f3-877f-802928ba00a7`: full 43 MB workbook in prompt/preview and native reopen overwrites discovered; integration `0ff1f359` and acceptance `2532be1e` retained digest-checked bodies and small deltas. | `artifactContent.read/adopt` returns a storage reference only after current authority/integrity checks; summaries do not include canonical content. | **Keep the storage boundary.** Do not reintroduce bodies into list/analytics responses or replace retention to lower cost. | Historical live byte/Office evidence belongs to S9. Full protocol review is DURABLE/COLLAB/OFFICE ownership, not newly certified here. |
| S9 integration task `01a0ca2d-f84b-7d71-af6f-82acb272d4bc`, turn `01a0cb39-7c28-7110-a3db-c9aa4d6776b4`: protect bytes with other storage owners. | `durableStorageBindings`, `durablePayloadOwnership`, and `artifactContent` still check owners and preserve the release grace. | **Keep.** An apparently orphaned payload is not permission to delete a pinned/journal-owned body. | Source/diff review. Cost work does not change any owner or grace policy. |
| S9 acceptance task `01a0cb5e-daed-7563-915d-a746b6da993d`, commit `2532be1e`: deletion read all history to find pinned versions; cursor also used unavailable `Buffer`. | Reviewed commit diff and current `artifactIntakeLifecycle.retainedReferences`: exact pin-version IDs and version-indexed builds, runtime-safe cursor, unresolved pinned content conservatively retained. | **Keep the directed lookup and runtime-safe cursor.** A row bound alone did not fix the historical runtime error. | Pin enumeration/build lists can still grow. HISTORY/DURABLE own bounded continuation preserving every owner. |
| S10 DATA `01a0d33b-5342-7922-84bd-55c133b259c7`, turns `01a0d356-b008-7120-8567-96dfedf7d4c2` and `01a0d35e-e8b8-7400-9f55-0bcb8531ebc2`: identity-only boot, compact catalogs and bounded authority checks. Integrated via `eac1567b`. | `src/app/api/spectra/route.ts` preserves bootstrap and page endpoints; `catalogPages.ts` reads versioned summaries and current grant/placement proofs. | **Keep.** Cheap discovery must not load bodies or treat incomplete empty pages as empty catalogs. | Existing focused PERF control rerun; full catalog browser rollout and encryption/runtime proof are not part of this unit. |
| S10 DATA turn `01a0d364-1dc7-7542-a3fa-8e25556f62ec` and final owned-scope turn `01a0d380-60e9-7cf3-81f6-3f1bb79241b9`: school density makes each artifact page advance one inaccessible candidate; add explicit owned scope. | `catalogPages.artifactPage` still reads up to 25 summaries, performs at most one eight-placement page, then breaks. Owned scope uses its account/status keyset. | **Keep the distinct owned contract; replace school scanning as an initial discovery strategy where still used.** Shared discovery must not silently become owned-only. | Historical 10,001-request consequence is not a fresh S11 executed workload. Caller completion and explicit scope remain follow-on work. |
| S10 PLATFORM `01a0d338-89d6-7a01-bb52-5e000de103de`, turn `01a0d365-4277-7300-aebc-86c89e0d81a8`: PERF exposed small-response/full-body analytics; compact rows and explicit backfills implemented. | `analytics.ts`, `analyticsReadModels.ts`, `orgNodeMutation.ts` and their integrated `eac1567b` diff retain compact artifact/run sources and heartbeat guard. | **Keep.** Missing migration must remain null/partial; heartbeat must not rewrite analytics. | Existing 7 analytics/PERF tests rerun alongside 3 new tests. No hosted migration claim. |
| Same PLATFORM unit left workspace filtering after the date-range sample; workspace Library list already used the active-status index. | Actual `personalOverview` failure above; `spectraWorkspaces.list` provided the existing suitable index precedent. | **Replace in this unit.** Read eligible status/date rows before the aggregation limit. | Measured failed baseline, repaired count and byte equality, retained data, state transitions and overflow. |
| S10 PERF `01a0d338-7faf-7652-85cb-5f5b63d3fdee`, turns `01a0d379-b6b6-7713-82e3-aec37ebe3b59` / `01a0d380-1176-7ce1-b4bd-16576ac395f7`: response bytes concealed tab hydration and sparse catalog cost. | Existing `observeDatabase` explicitly records returned rows, bytes and post-index filters. | **Keep the measurement distinction.** A tiny response cannot certify cheap reads; query bounds do not guarantee affordable total traversal. | Reused the actual observer; no missing engine fields replaced with zero. |

## Current read and subscription inventory

This inventory distinguishes source findings from newly measured behavior. Excluded domains are handed back to their owners rather than changed here.

| Path | Current read boundary | Cost/completeness implication |
| --- | --- | --- |
| Personal analytics | Up to 2,001 rows per artifact, active workspace, run and meter stream. Artifact/run streams require migration completion. | Workspace archive cost is repaired. Active workspace descriptions/previews are still full canonical row fields. Rich artifact summary effects/search text are still read although analytics needs fewer fields. Row limits do not establish a byte bound at maximum legal row size. |
| Analytics client | `AnalyticsShell` fetches `/api/spectra/analytics` on mount, range change and explicit refresh; route calls `analytics:personalOverview`. | This path is request-driven, not a persistent Convex client subscription. No subscription reduction is claimed for this repair. |
| Library/tree | `tree-client.ts` uses paginated `listChildren`, `containersPage`, `searchPage`, `quickViewPage`; disabled branches pass `skip`. `listChildren` uses account/parent/live/sort indexes. | Compact metadata and bounded raw pages are sound. Actual mount/unmount counts are PERFORMANCE's runtime task; source `skip` alone is not a measured subscription count. |
| Artifact catalog | `catalogPages.artifactPage`: 24 candidates plus lookahead, bounded placement expansion, explicit owned/school scope, current authority each request. | No body fallback. School density still multiplies requests and rereads; empty nonfinal pages must continue. |
| Workspace catalog | `catalogPages.workspacePage`: at most 24 school-indexed canonical workspace rows, then authorization/search and projected response. | Small returned JSON does not make large descriptions/previews cheap. School-wide density remains a discovery cost; an owned-only replacement cannot preserve all shares by itself. |
| Legacy arrays and detail | `spectraArtifacts.list`, `spectraWorkspaces.list` still have live API route callers; artifact candidates/grants/placements are enriched before final slicing. `spectraArtifacts.get` loads canonical work plus all share invitations. | Do not retire arrays until callers preserve full discovery and rich contracts. Detail legitimately needs content, but audience history should not be coupled to every body/detail read. |
| Version list | `spectraArtifacts.listVersions` collects all version rows, selects the tail, hydrates before/after snapshots and run rows, and derives ordinals from the full list. | Highest-priority neighboring history cost. A simple descending take would lose stable ordinals/complete contract; requires metadata paging and separate selected-version hydration. HISTORY owns implementation. |
| Retention | Daily snapshot maintenance reads payload-bearing snapshot rows; pin access/intake enumerate source pins, then directed versions/builds. Durable release keeps the existing grace and owner checks. | Budget both fanout and bytes without dropping owners. Retained large payloads are not leaks merely because the source artifact is gone. Source review only; no fresh storage-byte or physical-GC measurement. |

## Ranked next units

1. **History list/detail separation (HISTORY).** Measure all-history reads and selected snapshot/run hydration on a growing version corpus. Add compact paged version metadata with stable ordinals and current permission checks; hydrate one selected version. Preserve legacy caller behavior until migrated.
2. **Catalog caller completion and sparse shared discovery (DATA with PERFORMANCE).** Inventory each remaining array/picker caller, distinguish owned/personal-placement/shared-workspace discovery, measure total requests to a late legitimate match, and eliminate school-density rereads without hiding shares. Existing body-size independence is not enough.
3. **Maximum-row analytics and workspace page costs (DATA).** The repaired active path still reads full workspace descriptions/previews; artifact analytics reads richer Library summaries. Measure legal large fields at the 2,001-row boundary before selecting compact workspace/analytics models or aggregates. Include transactional maintenance/backfill/write and storage overhead in the comparison; do not add another summary merely from a small toy fixture.
4. **Detail audience enrichment and retention fanout (DATA coordinated with SECURITY/HISTORY/DURABLE).** Separate metadata/activity reads from all invitation rows; measure many pins/builds and snapshot maintenance with unchanged retention. Never cap an ownership search and treat the missing tail as absent.
5. **Live cost attribution (RUNTIME/PERFORMANCE).** Observe cold/warm open, repeated Library/Board navigation, idle subscriptions and engine completion fields on coordinator-confirmed revisions. Keep missing engine data unknown and separate concurrent Bridge/AI/cron traffic.

No alternative storage provider is recommended. This repair reduces unnecessary database reads using an already-maintained index, with no extra stored rows or writer maintenance. A provider move lacks measured total economics for storage, requests, egress, authorization, migration and operations. Backend publication and any later rollout belong to coordinator/RUNTIME; this unit needs no backfill.

## Second unit — sparse catalog traversal

Coordinator approved bounded option A: `catalogPages.ts`, a complete-traversal regression, adaptation of the historical S10 density assertion, and this report. Coordinator also approved the deletion-continuation fixture and typed PERF fixture correction below. The schema, authority helpers, cursor format and API scope contract stay intact. Shared dependency corruption caused a test hold while source and fixtures were prepared; no result from that contaminated baseline is used here. All measurements below come from the later guarded slot after RUNTIME restored dependencies.

The old artifact page reads up to 25 summaries but stops unconditionally after the first candidate requiring placement discovery. The repair uses the minimal two-row indexed prefix that can prove a placement set empty or singular. All returned prefix rows count against the existing eight-placement-row budget. Larger unresolved sets use the remaining budget for one native pagination call; repeated prefix rows also count. Exhausting the budget before a candidate leaves the prior key intact, and exhausting it on an unresolved prefix retains a pending cursor with no permission result. Current grants, overrides, workspace lifecycle and source metadata are checked on every request. This supersedes the one-candidate behavior recorded in the earlier historical inventory.

The new fixture traverses 128 and 1,024 newer private artifacts plus an older private tail, visiting every page to `isDone`. Each private artifact has one inaccessible placement; the newer timestamps deliberately tie. It requires owned unplaced work, an inherited share in the eighteenth placement and an unplaced direct share, in that order, exactly once. It records actual first-visible request/time, complete request count, returned rows/bytes, response bytes and maximum placement rows/native pagination calls. A second case covers replay, grant revocation while pending, source deletion and actor deactivation.

### Executed baseline and repaired traversal

The original `catalogPages.ts` was temporarily restored in this disposable worker checkout for the baseline run, with the repaired source restored in `finally`. Both baseline traversals completed and retained all three results. The regression then failed the intended first-visible request budget: **expected 129 to be less than 64**. The repaired source passed that budget and the complete-traversal budget for both sizes. This is a real failed baseline, not a request-count extrapolation from a prefix.

| Newer private / older private tail | Metric | Before | After |
| --- | --- | ---: | ---: |
| 128 / 16 | First visible request | 129 | 19 |
| 128 / 16 | Complete traversal requests | 147 | 24 |
| 128 / 16 | Database API read calls | 1,850 | 896 |
| 128 / 16 | Returned documents, including repeated reads | 4,257 | 803 |
| 128 / 16 | Returned-row UTF-8 JSON bytes | 2,464,500 | 436,974 |
| 128 / 16 | Serialized response bytes, summed across pages | 60,378 | 11,079 |
| 128 / 16 | First visible elapsed milliseconds | 316.39 | 103.05 |
| 128 / 16 | Complete traversal elapsed milliseconds | 358.49 | 122.01 |
| 1,024 / 128 | First visible request | 1,025 | 147 |
| 1,024 / 128 | Complete traversal requests | 1,155 | 168 |
| 1,024 / 128 | Database API read calls | 13,955 | 6,514 |
| 1,024 / 128 | Returned documents, including repeated reads | 35,489 | 6,132 |
| 1,024 / 128 | Returned-row UTF-8 JSON bytes | 20,696,025 | 3,412,635 |
| 1,024 / 128 | Serialized response bytes, summed across pages | 464,361 | 68,791 |
| 1,024 / 128 | First visible elapsed milliseconds | 11,767.77 | 4,837.40 |
| 1,024 / 128 | Complete traversal elapsed milliseconds | 13,062.00 | 5,473.29 |

Every sample returned exactly three legitimate results in order, with a maximum of **eight returned placement rows and one native pagination call per request**, and zero query writes. At the larger size, total requests fell 85.45% and returned-row bytes fell 83.51%. The S10 density fixture now checks that a request processes multiple placement rows within the existing eight-row budget; its obsolete derived 10,001-request claim was removed.

These are actual handlers in synthetic `convex-test` fixtures using the existing database observer. API calls, returned documents and serialized bytes are not physical index scans, hosted billing, network traffic or browser latency. Timings are single local observations under shared machine load, not repeated benchmarks or an SLA. No hosted engine scan count is available, and none is inferred from the request reduction.

Private evidence remains in this worker's ignored `.spectra-local/launch-s11/data/`:

- `catalog-traversal-before.json`: measured source SHA-256 `5f43b429d75faf6ae1e9dff66d06bc36834075e41d5ff0600127a0a2b448f747`.
- `catalog-traversal-after.json`: measured source SHA-256 `782cce128693106fdb87dbbe2829224964cc75f89dd150130078cd46a43f2682`.
- `catalogPages.before.ts` and `catalogPages.after.ts`: exact measured source backups. Git may normalize line endings independently of these working-file hashes.

This is a bounded reduction of rereads and requests, **not** independence from school density. **147 requests to the first visible result is still not launch-efficient school-wide initial discovery.** Two-or-more-placement private candidates can still require native continuations. A subsequent actor-owned/direct-grant/shared-workspace discovery design needs an explicit ordering and completeness contract; simply substituting owned scope would hide legitimate shares. This unit adds no stored projection, backfill, writer maintenance or schema change.

Caller inventory confirms this unit does not switch frontend defaults: legacy `getSpectraArtifacts` is used by Agent Library, `getSpectraWorkspaces` by Agent Library, the app shell and the conversation workspace picker, and `/api/spectra` search/overview still call the old arrays. AI `gather.ts` and `plan.ts` have their own list calls owned by CONTEXT/AI. Library organization already uses actor-scoped tree pages. A complete caller migration remains separate work; no live user-interface speedup is inferred from the new endpoint fixture.

### Isolated baseline corrections

Commit `67e4b644` imports the already-exported `DISSOLVE_CHILD_BATCH = 20` into `spectraWorkspaces.ts`, fixing the unresolved identifier in the scheduled `move_children` branch without changing its cap. It also types the real handler adapters and common page result in `s10-perf-pages.test.ts`; the observer and every assertion remain unchanged, with no blanket `any` or suppression. These two paths were committed separately for coordinator typecheck integration during the test hold. The final PERF correction uses a typed `readPages` map and tuple entries so `Object.fromEntries` retains each measurement's page result type; the coordinator's two remaining DATA unknown-result/rest diagnostics no longer appear in the scoped check.

The new `s11-workspace-delete.test.ts` drives the actual persisted job across 21 child folders, including a repeated original delete request, the first 20-child move, scheduled completion and a repeated completed dispatch. It checks that every child identity survives in General. The earlier P9 provenance test only checked state immediately after the now-asynchronous start call and did not exercise this scheduled branch.

### Guarded validation

After dependency recovery, **20/20 tests passed in four files in 14.01 seconds**, using one worker and no file parallelism: the complete catalog traversal, current authority/cursor cases, scheduled workspace deletion, historical catalog suite and PERF page suite. The deletion fixture exercises the previously unresolved constant at runtime. The initial scoped TypeScript check found seven cascading diagnostics from that fixture's untyped child array; its final type-only correction uses the actual `createFolder` mutation return type. The guarded recheck passed with **zero diagnostics across eight owned files**, covering this unit and the two separately committed baseline test corrections. Scoped ESLint on those same eight paths passed. No runtime assertions were removed or weakened. The two approved baseline test files also passed **37/37 in 2.72 seconds**; their correction is recorded separately below.

RUNTIME's filesystem guard was mandatory for every Node verification command in the restored slot:

```powershell
$env:S11_SHARED_DEPS = '<local-workspace>
$env:S11_PRIVATE_DEPS = '<local-workspace>
$env:NODE_OPTIONS = '--require=<local-workspace>
$env:SPECTRA_S11_CATALOG_EVIDENCE = 'after'
node node_modules/vitest/vitest.mjs run convex/s11-catalog-discovery.test.ts convex/s11-workspace-delete.test.ts convex/s10-catalog.test.ts convex/s10-perf-pages.test.ts --maxWorkers=1 --no-file-parallelism
```

The private scoped checker resolves imports but checks syntactic and semantic diagnostics only for `catalogPages.ts`, `spectraWorkspaces.ts`, the four test files above, `convex/p9-summary-writer-integration.test.ts` and `src/features/spectra/__tests__/org-tree-invariants.test.ts`. `git diff --check` passed. Full repository typecheck, suites, served revisions and launch acceptance remain coordinator/RUNTIME work. No shared service, backend or production deployment was started or published, and no original file or school data was mutated.

## Separate baseline test-contract corrections

The finite catalog unit is commit `b5e295af91877969ad6536128380092fb591d11c`. After that unit, coordinator explicitly assigned two existing failing tests for a separate test-only correction. The failures were read from RUNTIME's restored guarded baseline at `<local-workspace>`. No new product change or relaxed preservation invariant was needed.

- **P9 provenance:** `convex/p9-summary-writer-integration.test.ts` checked `createdFrom.workspaceId` immediately after starting an asynchronous workspace deletion. The baseline returned the still-present workspace ID instead of `undefined`. The corrected test advances the actual scheduled functions, asserts the persisted job is complete with one artifact detached and the workspace is absent, verifies both artifact and summary still exist, then retains both original provenance assertions.
- **Crowded shelf:** `src/features/spectra/__tests__/org-tree-invariants.test.ts` expected `remaining` to report 15 and 5, while the bounded helper at starting HEAD already returned a 0/1 continuation flag after reading `limit + 1` children. The corrected test checks that flag independently of exact source-child counts **15 / 5 / 0** and moved counts **10 / 10 / 5**. It still prevents early workspace-node deletion and now compares all **25 original child IDs** with the retained children in General. This helper test is synchronous; it must not be confused with waiting for a deletion job.

With the same mandatory filesystem guard shown above, the two complete test files passed **37/37 in 2.72 seconds**:

```powershell
node node_modules/vitest/vitest.mjs run convex/p9-summary-writer-integration.test.ts src/features/spectra/__tests__/org-tree-invariants.test.ts --maxWorkers=1 --no-file-parallelism
```

Scoped TypeScript and ESLint then passed across all eight owned TypeScript files, including these two. No full suite is claimed; the second validation slot was explicitly released immediately after the executable checks.

## Actor-graph prototype — recovery DATA-R, 2026-09-26

Recovery task `01a0dd89-8c59-7591-8826-2f90b3d41537` continues the same clean `6505` checkout and `codex/s11-data-analytics` branch from `b14e30ed`. The earlier two candidates are already integrated as `603824e8`/`f405c09b`; they are not repeated. Read the original DATA task's actual earlier and final turns, the exact private `discovery-proposal.md`, current authority/discovery/schema code, the coordinator's actual user brief and current charter/fleet/integration ledger. The coordinator accepted the following candidate-union proof before implementation, including omission of the redundant personal-placement stream and keeping public-agent discovery separate.

This unit adds `convex/catalogGraph.ts` and `convex/s11-catalog-graph.test.ts`. It is an **unregistered prototype**, with no endpoint, caller, schema, storage, dependency or service change. Source review and `git diff --check` are complete. **Executable validation and measurements are pending an explicitly allocated guarded slot.** None of the prior pass counts or cost tables certify this new source.

### Candidate-union proof

| Current authority path | Bounded candidate source | Current proof and exclusion |
| --- | --- | --- |
| Same-school artifact ownership | Summary `by_account_status_updated_id` | Current owner/school/type/status and summary version; cross-school nominal ownership alone is insufficient. |
| Explicit artifact or agent invitation | Both account and current-school `accessGrants.by_principal_resource_source`, `source=direct` | Correct actual blueprint resource type, current principal, no truthy revocation, absent/zero/future expiry. Foreign-school source requires the account principal. Current authority permits school-less sources through direct grants. |
| Workspace inheritance | Account/school direct workspace grants, then only that active same-school workspace's `orgNodes.by_workspace_context_live_kind_activity` live work nodes | Current grant/workspace/node/source; `accessProjection=true` or legacy source-owner/workspace-owner equality; indexed per-artifact override. Deny removes inheritance; restrict/read preserves read. A separate direct grant remains independent. |
| Personal placement | No additional stream required | Placement alone is not authority. Every eligible personal candidate is already in the ownership/direct/granted-workspace union. Owning a workspace alone does not grant another owner's artifact. Negative regression covers this. |
| Public | No ordinary-catalog path | `directAccess`, `hasDirectReadGrant`, inherited authority and ordinary catalog do not accept public principals. Legitimate `listPublicAgents` uses policy, live link/domain and published release checks in its separate endpoint, preserved unchanged. |
| Workspace picker | Account-owned workspace indexes plus account/school direct workspace grant streams | Same-school ownership or current direct grant, status/search; explicit account grant can expose a foreign workspace, which is never expanded for artifact inheritance. |
| Invitations / cached inherited grants | No independent path | Pending/accepted invitation metadata and `source=workspace_inheritance` rows are not current direct authority. |

Source anchors: `authorityShared.ts` direct/inherited/evaluateLoadedArtifactAuthority rules; `spectraArtifacts.ts` ordinary `list` and separate `listPublicAgents`; `catalogPages.ts` current compact page; `identityShared.ts` verified account and active membership; indexes in `schema.ts`. Deleted artifacts are not emitted by this authority-based prototype. Summary migration is mandatory; no canonical-body fallback is hidden in discovery.

### Continuation, ordering and budget

The cursor binds version, actor, active membership, school, resource kind, limit and every supported filter. It holds the previous emitted `(updatedAt, artifactId)` or `(lastActivityAt, workspaceId)` boundary, current source/native continuation, at most one nested workspace continuation and at most `limit+1` distinct candidate IDs with proof references and compact authority fingerprints. It contains no projection, body or cached allow decision. Existing authenticated encryption keeps un-emitted private candidate IDs confidential; encoded cursors above the existing 16,384-character limit fail explicitly.

Grant order and placement activity are not artifact update order. Every applicable unsorted stream therefore finishes before emission. The owned-artifact index can stop after `limit+1` qualifying rows; its index has the exact final sort. The owned-workspace index's implicit creation-time ties differ from workspace-ID ties, so that stream is also completed before emission. Top-K deduplicates canonical IDs across grants and placements without an unbounded seen-ID set. Search is applied throughout traversal, including late matches; shared quiz answers and timetable internal search text remain excluded.

Each request calls at most one native `paginate`, with an explicit `maximumRowsRead` and at most eight requested rows (one outer workspace grant while nesting). Every database call reserves its worst-case returned-row count before execution, including empty/negative proofs, account, exact indexed membership-invariant detection via `take(2)`, school, migration, summary, grant, workspace, placement and override. The total reservation ceiling is 256 rows; this is a conservative **row/call ceiling, not a byte or billing ceiling**. Variable-size summaries/workspaces remain a cost to measure. No full audience or body helper is called.

Responses expose `scanning`, `revalidating`, `restarted` or `ready`. Progress pages are empty and nonfinal. Before an ordered page is emitted, every retained candidate including the lookahead is hydrated and reauthorized in one current query snapshot. Changed keys/proofs restart assembly from the last emitted boundary; after three restarts the caller must explicitly refresh rather than loop forever. Replaying an unchanged cursor is idempotent. This is stable-corpus complete keyset traversal, **not a cross-request snapshot**: insertions/updates above an already emitted/scanned boundary require refresh, and ongoing mutation can require restart.

### Authored regression and cost harness — not yet executed

The harness invokes the real prototype against `convex-test` and observes every database API read/write using the existing ledger. Its authority oracle runs separately and is never hidden inside measured request cost. It checks:

- Fixed reachable graph while unrelated private artifacts grow through **0 / 128 / 1,024 / 10,000**; exact ordered IDs, complete traversal, first visibility, row bytes, calls, response bytes and cursor/row-budget maxima.
- Current authority across ownership, account/school/public principals, real agent/artifact type, zero timestamps, revoke/expiry, no-school/foreign-school sources, eighteenth-placement inheritance, legacy projection, personal placements, deny/restrict, archived workspaces and cached inherited grant rows.
- Unsorted/tied streams, duplicate placements, complete late search, workspace ties and cross-school direct workspace discovery.
- Current proof revalidation after grant revoke/expiry, workspace archive, projection removal, override deny and source deletion; mutated recency, replay/tampering, actor deactivation, school changes, multiple active memberships and bounded repeated restarts.
- Separately scaled live direct grants, revoked history, visible workspaces, duplicate workspace grants and result page count. Duplicate workspace grants deliberately reveal repeated node scans rather than hiding them behind an unbounded dedupe cache.
- Actual existing `syncSourceNodes` maintenance with 0/32/128 grants and 0/8/32 placements plus two links per placement. A separate labeled estimate adds hypothetical recency/status fields to existing direct grant documents; it counts extra grant writes/backfill rows and serialized field bytes, without claiming actual index storage or an implemented mirror.

Current `syncSourceNodes` reads every source placement and link, stamps node/link activity with `Date.now()`, and does not update direct grants. A mirrored recency design would add source-update fanout over applicable direct grant rows, indexes and backfill, plus restore/regrant maintenance. Async propagation cannot guarantee exact-current ordering without a pending/restart contract. No new index/store is proposed for integration until the graph-scaling evidence justifies that tradeoff.

### Remaining acceptance and migration boundaries

Guarded focused Vitest, scoped TypeScript and ESLint are queued; no Node command has run in this recovery unit. Evidence will be written privately to `graph-density.json`, `graph-scaling.json` and `graph-maintenance.json` under `.spectra-local/launch-s11/data/` only during an allocated run. No current number is claimed before those files exist.

The prototype supports ordinary artifact `all`/`shared` and workspace discovery. Artifact `inbox`/`workspace` filters require complete negative placement proof and are explicitly unsupported here. Public/installed agent discovery, owner/release/placement action fields, the eight-second/focus polling lifecycle and complete filter metadata remain separate caller work. The first accepted migration remains workspace API cache → app-shell and conversation workspace refresh, preserving selected workspace hydration and continuing empty nonfinal pages. CONTEXT owns AI gather/plan. No UI speed, hosted billing, live backend or launch acceptance is inferred from source completion.

# S7-COST — compact authoritative hot reads

Date: 2026-09-12

Status: implemented on `codex/s7-cost-read-model`, based on the integrated V7-00 head `e14812cc`.

No hosting, deployment, billing, Actions, database-vendor, or storage-provider change was made. The existing local stack was not rebuilt or redeployed.

## Outcome

Spectra list, tree, search, thread-context, run-tab, and result-card/recent reads now use small authoritative projections. Permission facts remain fresh: the hot rows carry only stable ownership/school/lifecycle authority, while grants, placements, and policy overrides are checked live. Explicit editor/detail reads still hydrate the canonical artifact; collaboration/Yjs and native-storage workflows remain on their existing canonical paths.

The implementation adds:

- Versioned `spectraArtifactSummaries` rows with bounded display metadata, authority facts, revision/hash metadata, and no body/protected content.
- Versioned `spectraResultCardSummaries` rows for card/status lists; canonical cards remain available for explicit detail/trace reads.
- Version-2 run-tab projections with flat artifact identity and bounded dock/status data.
- Targeted run-tab indexes for thread, workspace, artifact, and surface reads, with the client passing the narrowest known target.
- A resumable, bounded result-card migration fence so legacy canonical fallback exists during rollout but does not persist in steady state after backfill completion.

## Representative fixture measurement

The S7 test seeds two artifacts, two runs, two tabs, and two cards. One artifact, run, and card contain deliberately large private payloads. Values are UTF-8 serialized JSON byte lengths from actual `convex-test` database/query results and returned query values; they are deterministic fixture proxies, not hosted billing counters.

| Hot path | Prior canonical row used by the old path | New authoritative read model | Measured result |
| --- | ---: | ---: | --- |
| Artifact library/tree/search/authority | Large artifact: 728,802 B | Large artifact summary: 2,564 B | Summary remains under 10 KB; large/small summary delta is under 1,600 B despite the large body. |
| Run tabs and dock status | Large canonical run: 284,203 B | Large tab row: 8,594 B | Targeted tab response: 9,219 B; no plan or context marker is returned. |
| Result cards and recent status | Large canonical card: 133,641 B | Large card summary: 8,664 B | Card response: 2,811 B; no evidence marker is returned. |
| Workspace compact listing | Canonical artifact rows were eligible for hydration | `spectraArtifactSummaries` plus live authority | Response: 2,768 B; no artifact body marker is returned. |

The fixture had the expected counts after migration: 2 canonical artifacts / 2 summaries, 2 runs / 2 tabs, 2 canonical cards / 2 card summaries, and one completed read-model migration fence. The test also proves selected `spectraArtifacts.get` still contains the large canonical body.

These are bounded-row measurements, not a claim that historical hosted database I/O has been measured. The local `convex-test` API used here does not expose a supported hosted read-meter or subscription-profiler result, so no dollar, egress, latency, or production-traffic claim is invented.

## Authority, writers, and workflow preservation

The read models are maintained transactionally by the existing mutation wrapper/trigger path. Artifact, AI-run, thread, and result-card changes update or delete their corresponding summaries in the same transaction. Raw canonical artifact writers in agents, Bridge sync, calendar, change groups, collaboration, replicas, and deletion modules now use that wrapper without changing their public mutation contracts. Existing explicit placement/workspace sync remains idempotent.

The compact authority evaluator uses the owner account, school boundary, artifact blueprint/status, current direct grants, inherited placement access, and active policy facts. A peer grant/revoke assertion hides the artifact immediately in the S7 fixture. A deletion assertion leaves both canonical and summary rows as deleted tombstones. Import creates a v2 summary. Existing backend regression suites continue to cover collaboration, replicas, Bridge, permissions, native promotion, deletion/restore, and integrated run workflows.

Hot responses are allowlisted and exclude artifact content/protected content, run plans, run context snapshots, and card evidence/provenance payloads. Selected artifact/detail paths reuse their already-loaded canonical row for authorization and return the full body. Yjs/native payloads and storage-provider boundaries were not moved or rewritten.

## Migration and mixed-record behavior

Backfills are internal, bounded, cursor-resumable, and safe to retry:

- `internal.spectraArtifacts.backfillSummaries` repairs artifact summaries in pages.
- `internal.spectraRuns.backfillRunTabProjections` repairs v2 tab projections, with a maximum page size of 100.
- `internal.spectraRuns.backfillResultCardReadModels` repairs card summaries, records progress in `spectraReadModelMigrations`, and marks the card fence complete only after the final page.

The S7 fixture runs each backfill with `limit: 1` over two records, then retries from a null cursor. Both retries are idempotent and make no updates. Missing or old artifact summaries take one bounded canonical fallback read and an explicit allowlisted projection; current v2 rows stay summary-only. Missing canonical rows are treated as unavailable rather than inferred. Card/recent lists retain canonical fallback only while the migration fence is not complete, preventing an unnecessary canonical tail read after rollout.

## Client and query changes

The Spectra API now accepts `threadId`, `workspaceId`, `artifactId`, and `surface` for run-tab discovery. The active-run hook supplies the most specific target available; the global live dock retains its compact owner-scoped index. Cache keys include the target parameters, and no blanket polling or workflow action was removed. This preserves active-run refresh, sharing/revocation, selection/detail hydration, and collaboration behavior while reducing unnecessary client hydration and duplicate canonical reads.

## Verification

- Convex TypeScript: `tsc --noEmit -p convex/tsconfig.json` — passed.
- Backend suite: `vitest run convex --reporter=dot` — 26 files, 151 tests passed.
- S7 and focused regression suite — passed, including migration retry, mixed records, permissions, tombstones, import, compact-output exclusions, and selected-body hydration.
- Client Spectra regression suite — 4 files, 53 tests passed.
- Changed-file ESLint with `--max-warnings=0` — passed.
- `git diff --check` — no whitespace errors; only normal LF/CRLF conversion warnings.

Remaining cost evidence is intentionally operational: run hosted counters and subscription/latency measurements on the existing deployment after this code is deployed through the normal release process. Choosing a host, plan, region, database vendor, object store, or native-storage boundary is outside S7-COST and was not changed here.

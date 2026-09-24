# S10-CONVEX — catalog reads and shell bootstrap

2026-09-24. Isolated worktree: `<local-workspace>`.

## Result and integration

The immediate catalog timeout repair is integrated into the coordinator's primary checkout and has independent served evidence. The bounded page APIs are implemented in `adbb326d`; the separately approved fast owned scope is implemented and tested in `3351cdf3543de5a65b98b4a1350efd2a07ae6a2a`. Their metadata migration and browser acceptance remain pending. No runtime, database, provider setting, original document or main index was changed by this task.

| Commit | Scope |
| --- | --- |
| `9501da5e` | Reconstructed saved S9 baseline on `898229c8`: checked/applied baseline.patch, copied only the 13 named untracked files. **Do not integrate this baseline commit.** |
| `ce575b2f` | Direct-grant index selection, one authenticated actor per workspace list, preloaded workspace authority, same-school owner fast path. |
| `7feea08c` | Identity-only `GET /api/spectra?action=bootstrap`; explicit `needsSchool`. |
| `53b6a612` | Test-only typing correction for actual-handler instrumentation. |
| `adbb326d` | Bounded catalog pages, encrypted cursors, indexed read proofs, migration readiness and targeted tests. |
| `a4ee7bcb` | Actual sparse-school regression measurement; no production changes. |
| `3351cdf3` | Explicit owner-indexed scope, scope-bound cursors and full authenticated 10k-density fast-path regression. |

## Evidence

AI owner measured the earlier served source: artifact list `{placement:'all',limit:60}` failed after **15,126 ms** with too many system operations; workspace list `{includeArchived:false,limit:30}` took **14,101 ms** for eight rows; HTTP overview failed after **35,129 ms**. The old served source was not verified to contain the saved uncommitted baseline.

PERF independently measured the coordinator's frozen local backend publication at **12:34:46Z**, containing the first three improvement commits above. Existing authenticated Profile A was a school-admin/operator identity; these are authenticated product queries, not ordinary-student live proof:

| Query | Result | Elapsed | UTF-8 response bytes |
| --- | --- | ---: | ---: |
| Artifact list, limit 60 | success, 60 items | 860.7 ms | 46,962 |
| Workspace list, limit 30 | success, 8 items | 31.3 ms | 5,797 |
| Recent runs | success, 12 items | 59.2 ms | 10,760 |

This is one served sample, not a cold/warm SLA or hosted-cost estimate. Engine read bytes/counts were unavailable. PERF evidence: primary `.spectra-local/launch-audit/evidence/S10-PERF/direct-convex-after-frozen-publication.json` (reported by PERF; preserve its exact source marker).

Deterministic actual-handler checks use a database proxy that counts returned documents and serialized row bytes while keeping real Convex-test queries. With **0 versus 1,200 historical inherited grants**, the minimal artifact list reads one current direct grant, authenticates the account once and performs one `get` (school), with **zero canonical artifact reads**. A direct share remains discoverable beyond the former principal-wide cap and disappears immediately after revocation.

For new pages, **32-byte versus 300,000-byte bodies**, with 1,200 historical inherited grants in both fixtures, require one grant query/row, one school `get`, summary bytes under **5,000**, response under **2,000**, and zero canonical body reads. Workspace page requires one school `get` and no audience/invitation reads. A share behind **18 placements** is found in three requests; each reads at most **8 placement rows** and **9 gets**, and revocation is checked again when resuming. A tied-timestamp corpus returns **84 distinct artifacts exactly once** with seven-item requests. Empty filtered pages remain nonfinal and reach later matches.

Final focused coverage is **39 passing tests across five files** (37 together, then the changed catalog/API files rerun with the two additional route cases: 27/27). Files: `convex/s10-catalog.test.ts`, `authority-shared.test.ts`, `p9-library-efficiency.test.ts`, `s7-cost-read-model.test.ts`, and `src/features/spectra/__tests__/api-route.test.ts`. Cases include legacy zero expiry/revocation timestamps, expired grant history, cross-school owner denial, account deactivation, encrypted cursor tampering/scope mismatch, and explicit migration-not-ready failure. Full isolated `tsc --noEmit --incremental false`, scoped ESLint and `git diff --check` passed. Adding the explicit catalog migration marker required updating the existing S7 expected migration-row count from one to two; its other assertions remain intact.

## Architecture and contracts

The previous artifact list selected up to three times the requested owned summaries, up to 1,000 grants per principal, up to three times the limit in **every** granted workspace, then looked up/authorized/enriched candidates before its final slice. Stale summaries could read canonical Office bodies; agent release enumeration and invitation enrichment were also before final selection. Workspace list repeated actor/resource loading and collected invitation audiences. The minimal repair removes obsolete inherited grants from discovery at the index and eliminates redundant owner authority work without changing cross-school policy.

`bootstrap` now returns `{actor,needsSchool:false}` independently of collections; no-school returns `{actor:null,needsSchool:true}`. Actual authentication errors still fail. This endpoint does not pretend that an unavailable catalog is empty.

New endpoints map to `spectraArtifacts:listPage` and `spectraWorkspaces:listPage`:

- `artifactPage`: `scope` (`school/owned`, default `school`), `status`, `blueprintKey`, `placement` (`all/shared/inbox/workspace`), `search` (maximum 200 characters), `limit`, `cursor`. Its response also identifies `scope`.
- `workspacePage`: `includeArchived`, `search`, `limit`, `cursor`.
- Both return `{items,continueCursor:string|null,isDone}`. A short or empty page with a cursor is incomplete. No global total is asserted.

Artifact ordering uses indexed `(schoolId,status,updatedAt,artifactId)` descending keysets, with a unique tie-breaker. At most **24 raw candidates plus one lookahead** are read. At most one candidate expands **8 live placement nodes** in a request; continuation can resume within that artifact. Workspace pages read at most 24 records, with active status in the index for ordinary requests. All results belong to the same active-school discovery universe as the previous catalog; direct cross-school resource access is not broadened or removed.

Read proofs use the current authenticated account, membership/school, source summary, explicit account/school grants, workspace lifecycle and `accessProjection`, and the artifact deny override. Deny overrides narrow inherited access only, preserving an independent direct grant. Restricted inherited access still permits a metadata read. No cursor stores an authorization result. Picker rows deliberately omit maximum `accessLevel`, capability lists, audience counts and agent-release history. Direct/owned rows may omit placement information; consumers must not interpret that omission as Inbox. A returned visible placement is one proven placement and carries `placementsComplete:false`.

Grant probes are exact indexed `first()` reads. A prefix probe makes the ordinary no-grant case two queries; historical expiry/revocation can require up to **14 bounded probes per resource**. This bounds rows and fan-out but does not make every page one operation. No payload storage, Yjs state, native content, version history or Office body is fetched by the new catalog path.

Cursors use standard WebCrypto AES-GCM with authenticated actor/query scope and a domain-separated HMAC-derived key from the existing server-only `SPECTRA_SECRET_BRIDGE_KEY`. HMAC-derived 128-bit nonces bind the full plaintext, avoiding nonce reuse from replayed query RNG seeds. Private scanned identities/activity are encrypted, not merely encoded. Missing configuration fails explicitly; rotation or a changed scope requires restarting search. The coordinator confirmed existing instance configuration without exposing the value. Live Convex encryption compatibility remains to be exercised with the new endpoint.

## Rollout and remaining limits

Five additive schema indexes are in the page commit: `accessGrants.by_resource_principal_live_expiry`; `spectraWorkspaces.by_school_activity` and `by_school_status_activity`; `spectraArtifactSummaries.by_school_status_updated_id`; `orgNodes.by_kind_source_live`. Apply these hunks without replacing the primary schema: REVIEW-DURABLE, BRIDGE and PLATFORM have separately coordinated additions.

New artifact pages require the versioned `catalog-artifact-summaries` completion marker. Run internal `spectraArtifacts:backfillSummaries` from `{cursor:null,limit:10}`, then continue with each returned cursor until `done`. Pages default to 10, cap at 25 rows and 2 MB; only a contiguous full traversal records completion. Arbitrary tail repairs cannot certify completeness. The canonical mutation/trigger seams continue maintaining summaries. The new query never falls back to loading bodies when the migration is missing or stale.

The old array APIs remain compatible; callers requiring complete discovery must move to pages. LIBRARY owns organization paging and the coordinator owns shell/client bootstrap wiring. New page APIs and encrypted continuations need served validation after integration and migration. Root should verify expired/revoked/direct/inherited shares, a late search match, same-timestamp continuation and key rotation in that runtime before retiring old picker paths.

School-wide candidate scanning has a real density tradeoff: total pages to a visible match grow with inaccessible school-local metadata. One heavily placed inaccessible artifact may consume several nonfinal requests. Per-request bounds are proved; independence of total discovery work from school size is **not** claimed. The first implementation preserves exact continuation instead of silently truncating. Primary Library already uses account/tree-scoped paging, so it does not need this school catalog for initial navigation. Live keysets are not snapshot isolation: refresh after concurrent reorder/update and deduplicate by artifact identity.

Existing summary search text is bounded to 1,400 characters; metadata search is not whole-document search. New artifact search covers metadata plus that permitted bounded text, not every placement title. Existing rich detail/audience/agent-release APIs retain their current costs. No new hosting, billing, storage architecture, retention policy, native write or original IBDP1 mutation was introduced.

## Follow-up: sparse-school picker failure

The coordinator requested a concrete density case after reviewing the new page design. An actual disposable fixture contains **10,000 newer private artifacts**, each placed in an inaccessible workspace, and **24 older owned artifacts**. Seeding took 1,214 ms. Three actual prefix requests took **114.5 / 104.6 / 86.5 ms** in Convex-test, returned empty nonfinal pages, and each consumed exactly **one** private candidate while reading **25 summaries, one orgNode, 10 query terminals and two gets**. Each page returned 15,711 serialized summary bytes from its database queries. These are handler/fixture timings and returned-row bytes, not real Convex engine timings or billing.

The verified one-candidate progress and fixed loop imply **10,001 requests before the first owned result**, with **250,000 summary document reads, 100,000 query terminals and 20,000 gets before that result**. The summary rereads are roughly 157 MB for this small fixture. Only three requests were executed; the total is an exact algorithmic consequence for this static corpus, not a completed 10,001-request measurement. Evidence is `.spectra-local/s10-convex/density.json`; the reproducible test is in `convex/s10-catalog.test.ts`.

**Do not make school-wide `artifactPage` the initial picker source.** Its bounded requests are useful for exhaustive continuation, but this density case is unusable for initial discovery. The immediate recommendation is an explicitly actor-owned or personally placed scope for initial results, using existing actor indexes or the Library's account-scoped tree pages, while shared workspace discovery is a separate explicit scope. Accepted direct artifact/agent shares create a personal work node (`authority.ts::placeAcceptedShare`); accepted workspace shares create only the workspace node, so a personal work stream cannot honestly claim to include every inherited shared artifact. Preserve that distinction rather than silently hiding inherited resources. The coordinator is deciding the default picker contract; no production code was changed during this measurement.

SECURITY independently reviewed the finite page/cursor/read-proof implementation and reran its 13 tests at 14:48. It reported no blocking objection. Its review covered authenticated encrypted scope, domain separation, no permission caching, current revocation/placement checks and same-school discovery. Ciphertext equality and length are not hidden.

## Implemented response: explicit owned scope

The coordinator approved `scope:'owned'` as a separate labeled discovery contract. Commit `3351cdf3` adds the single index `spectraArtifactSummaries.by_account_status_updated_id` on `(ownerAccountId,status,updatedAt,artifactId)` and uses it for the same bounded keyset reader. `school` remains the default exhaustive contract; no All label silently changes to Mine. The scope is part of authenticated encrypted cursor binding and appears in the response. A cursor cannot move between scopes.

The **complete authenticated owned page** against the original 10,000-private/24-owned corpus returns all **24 owned artifacts on the first request**, including **12 with no placement node**. It performs **four query terminals and one school get**, reads **24 summaries totaling 14,801 serialized bytes**, and reads **zero grants and zero orgNodes**. The observed handler time was **39.0 ms in Convex-test**; this is time to first visible owned results in that fixture, not a served latency claim. The school-scope counterexample remains in the same test to prevent pretending that one scope repairs the other.

Further checks traverse **83 tied-timestamp owned rows exactly once**, reject an owned cursor in school scope, and retain a direct share with no personal node in explicit school discovery. Existing inherited-share continuation remains covered. Owned scope intentionally excludes other owners' direct and inherited resources; use the personally placed Library tree and explicit shared-workspace browsing alongside it. Label the scope **Your work** or **Owned**.

The final owned delta passed **30/30 catalog and API tests**, full isolated TypeScript checking, scoped ESLint and diff validation. It is stable and was sent to the coordinator and PERF for independent review. Its six-file delta includes the API validator/forwarder and tests; apply it after `adbb326d` and the density-test commit `a4ee7bcb`, preserving primary AI changes and peer schema additions. New endpoint/migration/live cursor acceptance remains a coordinator-owned integration step.

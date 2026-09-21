# W9 post-step-1 review — recovery coordinator

2026-09-21. Review in progress; this is not launch acceptance.

## Source interval and integration

User-accepted V9-00 ends at `bf8b0c62`. The intervening audit branch originally diverged at `f7106da4`, before W9-01 `614109fb`, W9-02 `8e54045d` and V9-00. Review covers all audit changes `f7106da4..2600e44a`, the durability continuation `2600e44a..7e720624`, and later fixes/integration as they land. `7d5ce3b0` merges the accepted `bf8b0c62` predecessor into current primary. Comparing Calendar to accepted V9-00 now shows its bounded read implementation restored; this does not by itself prove the integration passed live acceptance.

## Open findings

### R1 — legitimate remote content is silently ignored by the hollow guard

Priority: high. Owner: S9-DURABLE (shared collaboration/reconciliation).

Introduced/expanded by `7aeb86db`. On primary `7e720624`, `studioContentLooksHollow` uses content-length/quality heuristics to reject incoming snapshots before version/acknowledgement semantics. `decideRemoteStudioIncoming` returns `ignore` even for a clean studio. `artifact-studio.tsx` also has a second unconditional guard for the same artifact.

Direct execution of the actual exported helpers reproduced all three cases:

| Current | New authoritative content | Actual decision |
| --- | --- | --- |
| Task description `Read chapter 5` | Description `Read` | `ignore` |
| Deck with explanatory text | Deck containing only an editable numeric chart | `ignore` |
| Quiz containing one question | Empty question list after peer deletion | `ignore` |

This can leave a peer showing stale content and can allow a later edit from that stale draft to reintroduce removed content. Empty bootstrap protection must be gated by authoritative version/hydration provenance; authored short text, charts/media and deliberate clears must remain valid. Fix both entry points and test true provisional bootstrap versus newer committed empty/short/nontext updates, plus local acknowledgements. Evidence is a direct deterministic helper reproduction, not browser acceptance.

### R2 — Calendar pagination omits rows or crashes

Priority: high. Repair owner: school reviewer in isolated checkout; integrate through coordinator/DURABLE.

Current `convex/calendar.ts` keyset filtering occurs after `take(limit + 1)` in unscheduled/partial-time reads. Five tasks sharing updatedAt with limit 2 produce pages 2, 1, 0, 0 and repeat a non-null cursor; the corresponding official-event path crashes on page three. Title discovery rereads the same bounded prefix and stalls independently of timestamp ties. Wide range rows have no continuation: three events spanning more than 370 days, queried on day 450 with limit 2, return two rows and a null visible cursor. These are current restored predecessor bugs; the intervening merge did not fix them.

Four passing defect reproductions use the actual Convex handlers in ignored `.shots/missions/W9-RECOVERY/reviewer-school/calendar-pagination.test.ts`. Fix pagination at indexed query boundaries with complete continuations for every contributing source and test full traversal without duplicates or omission.

### R3 — adopting another artifact's storage can delete its retained content

Priority: high. Owner: S9-DURABLE.

Current `convex/artifactContent.ts` adopt accepts an arbitrary existing storage ID after checking its size/digest and authority on the destination artifact. It does not establish that this upload belongs to the adopting actor. Actual Convex reproductions show that an actor denied source access can bind its storage to an owned destination, then a 24-hour GC deletes source bytes despite an active source owner. If the actor already has an equal-content dedup row, supplying the source storage ID deletes it immediately in the dedup branch. The internal `collaborationDurablePayload.put` path has a related provenance/dedup concern.

Two defect reproductions passed in ignored `.shots/missions/W9-RECOVERY/reviewer-collab/storage-probe.test.ts` using its adjacent test config. Require upload provenance and safe immutable storage ownership before adoption or redundant-upload deletion; ensure GC cannot delete a blob still bound by another live payload.

### R4 — deselected Keep class is deleted by the next selected-class sync

Priority: high. Repair owner: school reviewer in isolated checkout; integrate through coordinator/DURABLE.

Actual-handler reproduction: select A+B, materialize, import A timetable, deselect A with Keep (release reports kept=1 and A event stays active), then complete a valid full timetable sync for remaining B with no rows. A source becomes tombstoned and its Calendar event removed. The route deliberately fetches selected classes, but `completeSync` scopes deletion only by account/record type and deletes unseen kept-class records that were intentionally not fetched. This violates the existing Keep promise to preserve the schedule and stop updates.

Ignored reproduction `.shots/missions/W9-RECOVERY/reviewer-school/managebac-retention.test.ts` passed against actual Convex handlers. Reconciliation must be fenced to the exact selected/reconciled class scope while preserving unrelated kept data and still removing genuine missing records within scope.

### R5 — gateway startup disrupts existing listeners and ignores instance configuration

Priority: high. Owner: startup repair agent, private checkout.

`serve-collaboration-gateway.mjs` unconditionally attempts to terminate an existing healthy Spectra listener, irrespective of `--force`, using Bash/ss/lsof and without handling a spawn error. `load-collaboration-env.mjs` overwrites caller-supplied selected-instance keys with the root env file; default launcher file ports are ignored. Gateway Server also fails to apply the configured host. Repair must preserve the selected instance, avoid terminating another runtime, bind the configured local address and report collisions truthfully with cross-platform regression coverage. No real runtime was disturbed to reproduce this source-level finding.

### R6 — deactivated collaboration actor retains its cached grant

Priority: high. Owner: S9-DURABLE.

`collaborationGatewayStore.ts` authorization returns unavailable for a deactivated account. `refreshAuthorization` treats unavailable as a transient infrastructure error and preserves cached canModify. An active artifact's unchanged policy does not revoke that cached actor grant during sweep, so it persists until JWT expiry. Reproduced with real Convex authorization/policy queries and the actual extracted gateway refresh function. This is inherited from before the reviewed interval but remains a launch-relevant authority gap. Separate definite actor denial from network/service failure and test prompt grant revocation.

### R7 — unsupported cached formulas retain clean downstream caches

Priority: medium. Owner: cache repair agent, private checkout.

An A1 → cached XLOOKUP B1 → cached XLOOKUP C1 dependency chain only marks B1 stale when A1 changes; C1 keeps its old cached result labelled clean. The direct-overlay fix in `7e720624` leaves transitive invalidation open. A deterministic test against actual Sheets operations reproduces this in ignored reviewer-collab/cache-probe.test.ts. Propagate staleness through the dependency graph with cycle handling and efficient bounded work; verify neighbors and unsupported-cache truth.

## Validation log

- Git ancestry and merge/source comparison completed.
- R1 deterministic helper reproduction completed on `7e720624` (Node 24.11.1 + tsx).
- Root TypeScript on `7e720624` passed; 80 existing tests across 12 authority, Calendar, school, import, embed and reconciliation files passed. Those tests did not cover R1–R4.
- Independent storage review ran 49 existing focused tests successfully plus four passing defect probes for R3/R6/R7. Capability and architecture gates pass on primary. No source changes or runtime/native tests are implied by those baseline results.
- Other audit areas and final integrated checks are pending; no blanket bug-free or optimization claim.

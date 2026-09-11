# Wave 6: deliver user workflows in parallel

2026-09-11. The five W5 tasks and D01/D02 have finished. Parent read all current reports, the combined lineage and relevant source. Main is c375fd55, including auth repair 00c6bdc4. Combined unaccepted candidate is e492458466cbb38788e5af2e20f007631b71b753 in codex/d02-cleanup-and-placement. Reports are evidence submissions, not acceptance.

## Progress, plainly

W4 collaboration/checkpoint recovery, Sheets persistence/font/cache basics, navigation/chat recovery, invitation and sharing repairs remain integrated. W5-AUTH is also integrated: healthy providers no longer remount on Clerk factor routes. Its three boundary regressions and adjacent tests passed; the task did not complete a real credentialed login.

W5's other four tasks delivered substantial candidate implementations: real Convex pagination and saved-result/active-run consumers; connection-pinned source fetching, exact evidence and bounded cache; actual archive inflation bounds and PDF/XML compatibility; Bridge polling/backoff/local wake. Reported private suites passed (18 thread/UI, 45 source/neighbor, 88 parser/Office tests, and Bridge Rust/timing/replay checks; counts overlap and are not a combined pass). No changed shared-runtime acceptance yet.

D01 restored a large-file streaming route, digest normalization, peer upload intents and import preconditions. D02 added traversal phases, retry and provisional embeds. These contain useful code, but source inspection finds material gaps below. Repeating the same two broad manual completion prompts is no longer the plan. Specific repairs go to Luna, and independent user capabilities advance now.

## New source findings: exact repair ownership

| Finding | Evidence in e4924584 | Owner |
| --- | --- | --- |
| Untrusted storage provenance | Public artifactIntakeActions accepts an arbitrary storageId with matching bytes/hash; content identity alone cannot attest which upload created it. Final commit checks active state, not current uploader capability. | W6-01 |
| Retry/media gaps | getUploadIntent only accepts uploading, blocking terminal replay; concurrent uploads create objects; direct materialization is limited to 4MB. Signature validator omits allowed audio/video/font types. | W6-01 |
| Commit causality | Import captures version plus state-vector hash, which misses unapplied updates and Yjs delete-set changes with unchanged vector. complete still precedes canonical commit; a random commitReceipt is not itself proof. | W6-01 |
| Cross-family cursors | D02 passes a previous table's continueCursor into versions/intake/runtime/etc; intake tries decoding it as its own cursor. Collaboration can paginate snapshots and rooms in one mutation, violating the actual runtime's one-pagination constraint. | W6-02 |
| Remaining cleanup loss | Nested take(PAGE) then parent deletion leaves later links, notifications and run children; target-side links are omitted; replicas/sync rows are deleted without payload release. Room cursor handling can skip a room. | W6-02 |
| Retention is unwired | retentionOwnerAccountId appears in schema and skip checks, with no writer/release trigger. tombstoneArtifactEmbeds marks pinned rows removed before pinned-version evaluation; helper then deletes ordinary bytes from row fields. | W6-02 with W6-01 trusted-object binding |
| Front-door and retry | Synchronous tombstoneArtifactEmbeds still collects all placements/requests; duplicate schedules and terminal workers lack a complete claim boundary; catching a page error can commit earlier partial writes without advancing counters/cursor. | W6-02 |
| Confirmation is only a claim | confirmPlacement accepts optional arbitrary insertionReceipt; UI awaiting a local callback is not evidence of a canonical writer receipt. | W6-02 |
| Test did not cover its claim | parent-m01-boundaries still has zero Bridge request rows in its 'terminal Bridge request' test. D02 added no high-fan-out lifecycle regression. D01's four tests do not run route upload -> verification -> canonical reload. | W6-01/02 must exercise actual boundaries |
| Read-cost claims exceed evidence | W5 list still calls requireArtifactCapability, which loads the artifact body. getActiveExecution returns the whole run. Backfill collects all messages per legacy thread. Moving initial message windows need continuity proof. | W6-00 |

These are source findings, not newly executed failures. Parent does not claim a fresh test run or a real backend result this turn. Relevant earlier counterexamples remain in review-cases. The right response is implementation with the smallest representative checks, not another global audit.

## Product and architecture decisions

- Keep one semantic operation path. Human toolbar, K-bar and AI use the existing command/capability registry; different entry points can offer different parameter UX without different permissions or mutation implementations.
- Keep separate outcome facts: upload accepted, canonical work saved, native file verified, visible surface mounted. Reuse existing operation/run/version IDs. A receipt is validated against the owning store, never generated merely to imply success.
- Editors own rich semantic editing. Format adapters translate that same model into new, imported and retained Office packages. Bridge owns stable file identity, local grants, conditional writes and replay. It should not become a second Office conversion engine.
- Collaboration owns causal sequencing. Equal text or state vectors do not establish that two writes are the same operation; include append head/room generation and acknowledged operation identity.
- AI owns interpretation and recovery, not extra authority. It should resolve vague follow-ups using committed work identity, ask only on real ambiguity and recover bounded transient failures. It must never conceal a default empty deliverable behind successful progress.
- Follow choreography is optional presentation of durable actions. It waits for actual target readiness; manual input suspends focus/navigation choreography while durable work continues unless explicitly stopped.
- ManageBac supplies selected source facts; the student owns completion, notes and schedule intent. Source refresh must not overwrite personal planning. Resources load on demand.
- Bridge default setup should use the already supported managed-copy isolation and understandable trust presets, with advanced controls available. Cloud/native location is a policy, not artifact identity. Missing/offline local files must not automatically become global deletion. Preserve current semantics until the stronger Bridge/convergence task completes the hard transitions.
- Costs must be separated: database rereads, retained file bytes, response bandwidth and polling. A smaller JSON response or deleting cloud bytes does not prove lower database I/O. No vendor/self-hosting decision is made in this wave.

## Released Luna xhigh implementations

| Task | Scope |
| --- | --- |
| W6-00 | Integrate the independently useful W5 query/UI, source, parser and Bridge slices into main; repair remaining scoped history/runtime incompatibilities, with one small real-local acceptance. |
| W6-01 | Trusted server upload binding, current authority/retry/media support, causal canonical imports. |
| W6-02 | Finite deletion/retention and real embed confirmation, with populated boundary fixtures. |
| W6-03 | Shared rich Word editing/import/export: runs/fonts/styles/lists/tables/links/media. |
| W6-04 | Shared workbook structure/formulas/styles and real editable chart data. |
| W6-05 | Shared presentation text/objects/tables/notes and genuine native charts. |
| W6-06 | Selected-class ManageBac, account-scoped sync leases and personal task/calendar flow. |
| W6-07 | Universal contextual K-bar, shared action parameters and acknowledged viewport navigation. |
| W6-08 | Connect trusted research and verify useful persisted AI deliverables; durable attachment references. |
| W6-09 | Browser-first Bridge presets/setup, no startup terminal and portable Windows/macOS packaging configuration. |

All are implementation owners, not observers. W6-COMMON.md and individual prompts give scopes and collisions. Only W6-00 may integrate its reviewed subset into primary and touch the single runtime. All others use private tests. They do not wait for one another or spawn more tasks.

## Stronger manual tasks after the batch

Only two are released: S6-AI implements durable clarification/steering/retry/execution orchestration after the Luna quality/action work; S6-OFFICE-BRIDGE implements equation interchange and reconciles the format writers with causal native sync/trust transitions. They may work in separate worktrees after the batch; their ownership is disjoint except small additive contracts. They do not merge to primary. Their prompts define how to consume exact W6 reports/commits and concrete acceptance.

Parent then reviews the combined implementations and integrates the ready parts. Run short shared-runtime verification sequentially on the changed checkout. The older V5 prompts remain a useful case set but are not released against the still-broken full D02 candidate. W6-00 can verify its narrow accepted subset now; later acceptance combines repaired intake/deletion and the new educational journeys, without retesting the whole app after every patch.

## Boundaries

No new hosted engine, storage migration, production deployment, external messages, original school-file mutations or Actions execution. Windows and macOS remain launch requirements. macOS packaging source/compile evidence is not a signed distribution or real Mac test; the friend's actual Mac check remains at the end. Landing, broad admin polish and Notion stay excluded.

The earlier M03/M04/M05/M06 all-or-nothing serial schedule is superseded by these parallel slices and two focused hard integrations. Further work depends on results; no percentage or promised final task count is claimed.


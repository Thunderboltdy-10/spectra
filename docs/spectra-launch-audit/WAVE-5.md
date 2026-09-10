# Wave 5: implement the foundation gaps

2026-09-11. W4 product work remains accepted on main. M01 completion `884b755b` and M02 completion `8071a0cf` were read with their source; neither is accepted wholesale. Their combined remediation base is **c832d8f3fe6c5019044bec9f4a08f6fe89d52d66**, branch `codex/launch-foundation-review2`, private checkout `<local-workspace>`. This base preserves useful work and parent counterexamples. It is deliberately not a production-ready merge.

This wave supersedes the repeated broad M01/M02 completion prompts. Execute fixes against known failures. No repeat inventory audit.

## What the second review established

The candidates repaired several earlier cases: same-timestamp pagination in a small fixture, initial backfill progress, deletion status authorization, terminal Bridge-row looping, missing import size constant, import commit replay, cancellation and mapped-private-address rejection. They also added bounded upload request reading, media materialization and a capped Bridge sleep. These are useful changes, but the claimed end-to-end contracts still do not hold.

Parent executed six additional depth cases in convex-test. Before parent amendments all six failed: a 1,000-message history exposed only 305 messages; a 700-thread backfill migrated only 296; a redacted memory claim kept deletion in its children phase after 20 invocations; an ordinary active asset remained after intake cleanup reported done; an untrusted original storage ID could be recorded as a quarantined candidate; and terminal original-upload replay bypassed authentication. The active-asset fixture expresses eventual release for genuinely owned unreferenced bytes; strengthen it using D01's actual trusted receipt rather than inferring ownership from an old row.

The private remediation base includes small parent fixes for the last two authority holes and replaces Node crypto imports in mixed Convex modules with Web Crypto. A focused rerun passed five cases (three existing M02 boundary cases plus two new authority cases); four depth cases were skipped in that filtered run and remain open. Initial typecheck found only a new test's reference missing from stale generated API types; that test reference was corrected, but no subsequent full typecheck is claimed. Depth reproductions are stored as .test.ts.txt, outside automatic test discovery. Tasks must port their relevant cases into passing regressions.

### Source findings that define the implementation work

- History/backfill/list/trace queries take a fixed first window before cursor filtering. Larger data is unreachable. Document-ID string order is not proof of index order. The active-run endpoint has no mounted client consumer; get returns traces:[] while conversation UI still reads detail.traces, removing saved results.
- Summary lookup follows full artifact authorization reads in list, so a small response does not prove small database I/O. The supplied measurement is response size and convex-test elapsed time, not hosted read bytes or a monthly bill.
- Deletion still performs unbounded placement work at its front door. Retained rows hide later rows; memory redaction selects itself forever; failure records do not schedule recovery. Replica payload references, sync operations/conflicts, runtime metering, empty collaboration rooms and cross-artifact run history require explicit disposition.
- Intake cleanup excludes all normal active media/import originals without implementing an eventual retention owner. Cursor/provenance/metering proof is incomplete. A candidate storage field is not ownership proof.
- Asset action finalization requires artifact ownership even for an authorized peer uploader. Original finalization does not refresh target authority adequately. Concurrent upload retries can store multiple objects; action success and receipt mutation are separate failure boundaries. New successful internal paths skip previous audit/meter increments.
- Import materialization calls the action directly, bypassing route-only signature checks, and can consume quarantined output. Completing parsing is still separable from canonical saved content. Blank/live-Yjs target changes are not fenced by merely checking an optional version ID.
- The new 16,000,000-byte binary-action cap replaces larger accepted file limits without proving encoded transport headroom or a product decision. Do not silently ratify this reduced capability.
- Earlier parent guidance treated storage SHA-256 as hexadecimal. Installed SDK comments and convex-test's base64 metadata disagree; actual local-backend representation was not observed. D01 must establish the real metadata contract and normalize only supported encodings. Do not turn a mistaken assumption into a validator.
- ZIP checks execute after unzipSync allocates the archive, so they do not bound actual inflation. Duplicate/canonical path collisions and other reachable parsers remain outside the guard.
- Research DNS validation is separate from socket connection. Initial DNS and extraction lack a complete deadline; excerpt/offset/hash truncation can disagree; cache freshness is absent. DNS pinning is implementable here, not an external-only prerequisite.
- Embed creation marks confirmation before insertion and callers do not forward/confirm its operation key. Bridge's total cap improved, but identical jitter and missing wake paths still require actual timing behavior.
- A replacement parent Bridge cleanup test contains no Bridge requests. Restore real queued/terminal rows; do not preserve an empty fixture as proof.

## Architectural decisions and connections

1. Preserve the existing protocol. A byte-upload receipt, parse result, canonical commit, native write and cleanup receipt are distinct facts linked by existing IDs. AI retry, editor reload, import, Bridge and deletion must consume the relevant fact. A toast or changed hash is not a saved deliverable.
2. Make cheaper reads lossless. Separate initial history, on-demand traces and live execution, but finish all consumers in the same slice. Database I/O, response bytes, retained file storage and idle polling are different costs; do not infer a storage-vendor decision from only one.
3. Keep source/native packages and semantic projections connected through one format adapter per Office family. Broad native editing remains required. Shared intake and deletion repairs unblock that path; they are not a reason to replace Yjs, the ledger or Bridge. The next Office package must deliver editable Word/Excel/PowerPoint vertical slices with semantic readback, rather than another capability inventory.
4. Bound cleanup by traversal progress, not by how many rows changed. A retained or terminal row must not hide later work. Keep a durable tombstone and explicit retention owner; do not choose between leaking every active object and deleting pinned/shared bytes.
5. Test the code actually being served. Parallel worktrees perform isolated tests without extra stacks. Once the combined candidate is integrated, one shared Convex/dev/Bridge runtime receives sequential changed-flow verification. A localhost visit from a worktree proves nothing about its unmerged patch.

## Released implementation owners

| Owner | Work | Runtime |
| --- | --- | --- |
| W5-AUTH, Luna xhigh | Fix Clerk step reset, preserve healthy provider state and invitation return | Sole exception: integrate its small scoped fix into main and verify immediately |
| W5-01, Luna xhigh | Lossless history/list/backfill/trace pagination and actual UI subscriptions/results | Private tests; live verification after integration |
| W5-02, Luna xhigh | Pinned source transport, cancellation/deadline, provenance and bounded cache | Controlled network fixtures |
| W5-03, Luna xhigh | Actual inflation bounds and reachable parser compatibility | Portable real parser fixtures |
| W5-04, Luna xhigh | Complete Bridge polling backoff/wake/error timing | Rust/controlled transport tests |
| D01, manually selected stronger agent | Trusted upload -> media -> canonical import commit and release ownership handoff | Starts after W5 tasks; no extra backend |
| D02, manually selected stronger agent | Deletion traversal/retention, durable embed insertion, offline fencing | Starts after D01; same candidate lineage |

Exact assignments live in prompts/W5-*.md and prompts/D01-*.md / D02-*.md. W5-COMMON.md defines ownership, evidence and one-stack rules. Four implementation tasks start from the private remediation base plus current main; auth starts from main only. New W5 reports must distinguish candidate code from integrated code.

After D02, return to the parent for one combined source/contract integration, then run prompts/V5-01-shared-runtime.md and V5-02-lifecycle-runtime.md **one at a time**, as manually launched Luna xhigh tasks. These are small verification-and-repair tasks, not a new global audit. Do not run them on an old served checkout. Auth's real login may still need Pablo's credential interaction; no extra account or auth bypass is required.

## Progress and remaining scope

Accepted progress remains W4's collaboration recovery, Sheets semantic persistence/font/cache basics, chat/navigation repairs, invitation recovery and share authority. Candidate foundation work adds useful primitives; this wave finishes the broken boundaries with named owners.

The next substantive implementation work remains broad Office editing/conversion and equations; selected-class ManageBac and personal scheduling; durable AI ambiguity/steering/attachments, shared actions/K-bar and viewport acknowledgements; Bridge trust/local-cloud transitions and Windows/macOS packaging. These are connected implementation packages, not another pass over every screen. Reuse prior findings and the completed foundations. Preserve short W4 browser cases in their relevant future editor/AI journeys.

Hosting/storage migration is undecided. macOS is a launch requirement, with no local Mac or developer account; prepare portable code/build configuration, do not run Actions now, and reserve real package/start/edit/reconnect proof for the friend's Mac. No signing/notarization or native rendering claim is inferred from source/build success. Landing, broad admin polish and Notion remain outside this wave.


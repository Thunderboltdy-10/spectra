# W4 integration and next implementation decision

2026-09-10. Parent read all five complete reports and reviewed the source changes together. The combined implementation was prepared in the existing private W4-01 checkout, preserving its original branch and dependency installation, then fast-forwarded into primary main. Source integration ends at dc1261d9. The user's newer local:start:all launcher commit is preserved.

## Progress toward launch

The audit has produced working repairs, not just an issue inventory. W2 established several shared authority, native preservation, error-reporting and navigation foundations. W3 supplied live evidence distinguishing saved work from optimistic UI and exposed shared intake, conversion and execution boundaries. W4 now integrates the bounded source fixes below.

| Area | Integrated behaviour | Remaining evidence or larger work |
| --- | --- | --- |
| Collaboration and cost | Sequence-aware recovery after a durable append, including unchanged content; same-transaction hydration reuse; loaded-resource identity checks | Large thread/event reads, hot-row costs, polling and deletion remain M01 |
| Sheets and native basics | Non-cell metadata changes are detected without a whole-workbook hash; stale native formula caches are removed; concrete native font family names replace CSS stacks | Real chart lifecycle against changed runtime; broader Office conversion/editing remains M03 |
| Workspace and chat | Stale route loads cannot replace the current conversation; refresh errors retain readable prior messages; dock blank regions no longer claim pointer input; narrow Library uses a collapsible sheet | Pointer/focus/geometry confirmation and CodeMirror persistence remain short explicit cases |
| Onboarding and sync | Invitation retry, readable recovery, retained sync history during no-match, representation-aware timetable refresh and legacy row reuse | Real provider remains no-match; populated route evidence uses an HTTP fixture plus convex-test, not the running Convex service. Selected polling/identity/personal overlays remain M05 |
| Sharing and agents | Verified JWT identity gates restricted links; owner publishing works with an empty capability list while server evaluation/content gates remain | Full authenticated share return/ordinary owner browser journey still needs live confirmation |
| Dependencies | Reviewed Next/Convex/helper/lock alignment integrated with private compatibility evidence | Reachable AI/editor/parser/mail/UI advisories remain assigned to consumer packages; security closure is not claimed |

## Parent corrections before integration

1. **Share return durability:** W4-05 cleared the temporary token after a successful sign-in return to `/public` without restoring a fragment. The next focus/poll/reload then lost the link. Restore the fragment before clearing temporary storage, retain the token on transient errors, clear it for terminal missing links, and guard late reads. The newer Next lint also required the existing internal sign-in navigation to use the app router. Added behavioural return, retry, refresh and navigation tests.
2. **Sheets acknowledgement:** W4-02 retained up to 80 emitted snapshots indefinitely and rejected semantically matching incoming states. A later collaborator undo could therefore be dropped. Clear acknowledged/superseded entries and consume pending echoes. Added a local A -> acknowledge -> local B -> acknowledge -> collaborator A regression. This bounded correction is not a substitute for explicit causal revision identity throughout the future Office contract.
3. **Authority compatibility:** W4-01 placed an agent/artifact scope guard inside the common evaluator, inadvertently rejecting established generic artifact reads for agent work, including workspace/replica callers. Keep strict discovery preload binding at its dedicated helper and preserve generic loadResource semantics. Added an ordinary agent-owner regression; scoped grants remain checked.
4. **Workbook intent:** Formula-cache invalidation must not switch an existing manual calculation preference to automatic. Preserve the original mode while invalidating old results and requesting recalculation; package readback verifies the mode.
5. **Sync busy guard held:** The new beginSync guard looked at the latest 30 runs across an entire integration before matching the account, so other users can push the relevant run out of view. Rows without a lease never expire under its predicate, potentially preventing recovery after an interrupted request. Removed only this new guard and its acceptance assertion from integration. The UI duplicate-action protection remains. Account-scoped claims, lease expiry, resume/cancel and old-worker fencing belong together in M05; adding an arbitrary timeout alone would permit overlapping old/new writers.
6. **Product copy:** Replaced `Archive projection` with `Archive in Spectra`. Users should understand the action without knowing the projection model.

## Verification and limits

Each task supplied focused tests and, where applicable, its private build. Parent ran 13 combined suites / 93 passing tests while reviewing integration; after the remaining amendments and withholding the busy guard, the final targeted follow-through passed 8 suites / 38 tests (these overlap, so do not sum them as unique tests). TypeScript and parent-changed-file lint passed. The first lint run exposed the new Next navigation rule, which was fixed and verified. No broad production rebuild or exhaustive browser campaign was repeated.

W4-03 reports four incumbent Live Dock source-string assertions failing against older expected copy/layout; this is not a blanket green suite. Their intended behaviour should be reconciled in M04, not made green by copying current strings. W4-03's actual pointer/narrow/CodeMirror attempts were blocked at expired Clerk state. W4-05 proved a mocked denial/return preview and trusted identity fixtures, not completed real sign-in. W4-02 has native ZIP/package evidence, not native Office recalculation or a Mac run. These limits remain explicit; they do not justify another general audit wave.

The running environment was left alone at Pablo's request: no health polling, process investigation, restart, primary dependency installation, database reset or hosted change. For future starts use `npm run local:start:all`. Main contains the integrated source and manifest; this report does not claim that already-running processes have loaded every new dependency or that a new production build was served.

## Next decision

Release **M01 data cost/lifecycle and M02 durable intake/evidence** for manual execution on the integrated source. They can run in parallel in separate worktrees. Their outputs should establish working, authorized persistence and bounded reads before we expand rich Office/AI workflows on top of them. No additional general Luna audit batch is needed now.

The current six-package roadmap remains useful, but later prompt scope and parallelism will be reconsidered after this pair returns. Office broad editing, AI reliable continuation/output plus K-bar/orchestration, selected ManageBac sync/personal planning, and Bridge filesystem/Mac completion are still substantial implementation work. Future evidence may alter the slices; no percentage-complete or guaranteed remaining task count is asserted.

Carry a small changed-runtime acceptance set into the next integrations: Sheets chart lifecycle, actual dock/rail pointer/focus, one CodeMirror saved edit, verified share return/owner publish, and a changed-backend collaboration receipt. Combine these with the responsible package's acceptance rather than launching another exhaustive verification wave. The final friend-Mac run and explicit hosting/distribution decisions remain reserved.

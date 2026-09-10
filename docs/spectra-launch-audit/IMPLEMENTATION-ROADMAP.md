# Compact implementation roadmap

Status 2026-09-10: W4 reviewed and integrated into main through dc1261d9, including parent corrections in WAVE-4-SYNTHESIS.md. M01/M02 are ready for manual execution in parallel. The running environment was left alone; future starts use `npm run local:start:all`. Later stages remain a dependency plan that will be revised from the next results, not a fixed estimate of all remaining work.

The launch objective is reliable educational work across web, AI, collaboration and broad native Office editing on Windows and macOS. This is an implementation sequence, not a request for another inventory audit. Landing, broad admin polish, Notion, hosted Office adoption and hosting migration are excluded unless Pablo changes the scope.

## Stage A: five bounded Luna tasks

Auto-launch GPT-5.6 Luna / xhigh, one actual Codex task per row. All start from the current project default branch in separate worktrees. Their full instructions are in WAVE-4-ASSIGNMENTS.json.

| Task | Implement now | Deliberately larger follow-through |
| --- | --- | --- |
| W4-01 | Reviewed dependency alignment, sequence-safe collaboration repair, authority-preserving hydration reuse | M01 read cost/lifecycle |
| W4-02 | Sheets non-cell persistence without dense-workbook hashing regression; honest formula caches; native font family mapping | M03 shared Office adapters and richer editing |
| W4-03 | Chat failure/retry state, dock pointer interception, narrow Library allocation, focus return, diagnose CodeMirror real input | M04 shared viewport/action acknowledgements |
| W4-04 | Invitation retry and truthful sync recovery, timetable ID refresh, actual-route populated provider fixture | M05 scoped selected sync and personal overlays |
| W4-05 | Peer authority regressions, authenticated domain-restricted links, ordinary owner Agent publish blockers | M04 action availability and M05 educational sharing |

Every task fixes owned bounded defects and returns commits plus relevant checks. No dedicated observer/recovery task, no broad test sweep. Parent stops immediately after dispatch and resumes when Pablo says the batch has finished.

## Stage B: manual foundation pair

W4 source integration is complete. Start from current main, including the newer local:start:all launcher and W4 parent amendments; do not use the old W3-only source. Paste the complete contents of these files into manually created tasks, preferably using the strongest model/reasoning setting available to Pablo. No particular model is imposed. Use private dependencies and distinguish changed-checkout tests from the shared running app.

1. [M01 — Read cost and deletion](prompts/M01-data-cost-and-lifecycle.md): bounded thread reads, selective subscriptions, Bridge polling, owner deletion and durable embed placement cleanup. Deliver measured before/after workload results and explicit migration/rollback handling.
2. [M02 — Durable intake and evidence](prompts/M02-durable-intake-and-evidence.md): shared asset receipt, rich import commit, bounded parsers, reliable attachment references and truthful fetched-source evidence. This is the prerequisite for reliable rich outputs.

M01 and M02 can run together in separate worktrees. M01 owns general read/deletion coordination; M02 owns upload/import/evidence receipt semantics. Both may need small schema additions; use separately named fields/tables through the existing schema conventions and reconcile at integration. Neither rewrites the other's lifecycle. M02 exports reference/cleanup hooks that M01 calls; the parent resolves this one integration boundary before Stage C.

## Stage C: Office and educational sync

After integrating Stage B:

3. [M03 — Native Office editing convergence](prompts/M03-office-editing-convergence.md): retained-package and new-package paths share semantic writers; implement document/workbook/presentation feature families with native package readback. This is the main fidelity work, including equation conversion and real charts. Use internal milestones in one task rather than launching a separate audit for each format.
4. [M05 — ManageBac and personal planning](prompts/M05-managebac-and-personal-planning.md): canonical scoped identity, selected polling, onboarding/discovery and personal overlays. Reuse M02 on-demand assets and M01 lifecycle. This may run alongside M03 because it owns provider/source logic rather than Office writers.

## Stage D: complete interaction and desktop path

After integrating Stage C:

5. [M04 — AI, actions and K-bar](prompts/M04-ai-actions-and-kbar.md): exact durable continuation, verified output/recovery, shared action inventory, K-bar, viewport/follow orchestration, attachments and professional deliverables. Existing basic AI work remains usable throughout; this package can now target proven Office and sync operations.
6. [M06 — Bridge trust and Mac readiness](prompts/M06-bridge-trust-and-macos.md): stable-file write protocol, moves/deletions/offline/provider transitions, browser-first presets/setup, Windows no-console behaviour and Mac packaging readiness. Reuse Office proofs rather than implementing a second Office parser in Rust. This can run alongside M04; M06 publishes typed browser setup/permission actions for M04 to consume.

These six manual prompts group the currently known complex workload by authority and dependency. Their later scope and parallelism will be reconsidered after the first pair returns; they are not a guaranteed final task count. Do not split them into dozens of automatic tasks. If implementation demonstrates that a major hosted engine, storage vendor, new canonical model or material launch-scope tradeoff is necessary, bring Pablo concrete alternatives before adopting it.

## Local acceptance and finish

- Each package records exact commits, changed contracts, migration behaviour, focused tests, a short real-user browser journey, canonical readback and native package readback where relevant. It must state which checks used a fixture, private preview, shared runtime or native device.
- Parent integration checks only changed boundaries and their direct neighbours. A schema/API integration gets a short real Convex check after integration; do not rerun every past artifact scenario.
- Functional regressions block that slice. Cosmetic differences with usable controls do not trigger endless polish. Keep each UI pass bounded to a batched desktop/narrow inspection, one repair batch, and a confirmation, unless a new functional failure justifies another check.
- A held/unsupported operation is not silently counted as complete. No placeholder, preview, successful HTTP status, toast or stale health badge substitutes for the user's saved result.
- Final gate: fresh ordinary-user onboarding/share/sync; one realistic AI deliverable with vague follow-up/steering; document/workbook/presentation native save/reopen; deletion/offline replay; a representative narrow crowded workspace; package/start/edit/reconnect on the friend's Mac. Reuse existing case evidence and check only current changed behaviour.
- Mac public distribution/signing and final hosting economics remain explicit launch decisions. No Actions execution, deployment, billing change, external message or original school-file mutation is authorized by these prompts.

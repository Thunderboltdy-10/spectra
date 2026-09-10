# Compact implementation roadmap

Status 2026-09-11: W4 remains integrated. Both M01/M02 completion reports and actual source have now been reviewed. Read WAVE-5.md for the resulting implementation decisions; the old broad completion prompts are superseded. W5 fixes auth plus four independently owned boundaries, followed by the focused manual D01/D02 implementation pair. Use one shared runtime only, with sequential verification after integration. Future starts use `npm run local:start:all`; no routine environment monitoring.

The launch objective is reliable educational work across web, AI, collaboration and broad native Office editing on Windows and macOS. This is an implementation sequence, not a request for another inventory audit. Landing, broad admin polish, Notion, hosted Office adoption and hosting migration are excluded unless Pablo changes the scope.

## Stage A: five bounded Luna tasks — completed and integrated

Auto-launch GPT-5.6 Luna / xhigh, one actual Codex task per row. All start from the current project default branch in separate worktrees. Their full instructions are in WAVE-4-ASSIGNMENTS.json.

| Task | Implement now | Deliberately larger follow-through |
| --- | --- | --- |
| W4-01 | Reviewed dependency alignment, sequence-safe collaboration repair, authority-preserving hydration reuse | M01 read cost/lifecycle |
| W4-02 | Sheets non-cell persistence without dense-workbook hashing regression; honest formula caches; native font family mapping | M03 shared Office adapters and richer editing |
| W4-03 | Chat failure/retry state, dock pointer interception, narrow Library allocation, focus return, diagnose CodeMirror real input | M04 shared viewport/action acknowledgements |
| W4-04 | Invitation retry and truthful sync recovery, timetable ID refresh, actual-route populated provider fixture | M05 scoped selected sync and personal overlays |
| W4-05 | Peer authority regressions, authenticated domain-restricted links, ordinary owner Agent publish blockers | M04 action availability and M05 educational sharing |

Every task fixes owned bounded defects and returns commits plus relevant checks. No dedicated observer/recovery task, no broad test sweep. Parent stops immediately after dispatch and resumes when Pablo says the batch has finished.

## Stage B: focused foundation implementations — released in W5

Preserve W4's parent corrections and launcher. WAVE-5.md contains the completed second review, four new depth failures and two narrowly repaired authority holes. The private remediation base c832d8f3 combines useful candidate work without accepting it on main. W5-COMMON.md defines precise ownership and single-runtime rules.

1. W5-AUTH, Luna xhigh: fix Clerk factor-route remounts and verify the small change directly on main. W5-01 through W5-04, parallel Luna xhigh implementations: lossless history/results, pinned source transport/provenance, bounded parsers and Bridge poll/wake timing. They use private tests and do not publish separate backends.
2. AFTER the Luna tasks: [D01 — Upload to saved work](prompts/D01-upload-to-saved-work.md), manually run with Pablo's stronger chosen agent. Integrate the four finished scoped candidates privately, complete actual transport/ownership/media/canonical-save/release contracts.
3. AFTER D01: [D02 — Cleanup and placement](prompts/D02-cleanup-and-placement.md), manually run with a stronger agent against D01's exact final candidate. Complete bounded progress, every retained family, durable placement and offline fencing.
4. Parent integrates the combined candidate once, then manually run [V5-01](prompts/V5-01-shared-runtime.md) and [V5-02](prompts/V5-02-lifecycle-runtime.md), sequentially, against the single changed local Convex/dev/Bridge stack. They verify and fix small defects in the linked journeys; no broad new audit.

The earlier broad M01/M02 tasks are history, not instructions to repeat them. Submitted completion reports are preserved; WAVE-5.md supersedes their unsupported completion claims. D01 owns trusted intake/release and D02 owns artifact-wide coordination, with an explicit handoff. No storage/vendor migration is chosen. Response-size measurements do not stand in for actual database read cost.

## Stage C: Office and educational sync

After integrating Stage B:

3. [M03 — Native Office editing convergence](prompts/M03-office-editing-convergence.md): retained-package and new-package paths share semantic writers; implement document/workbook/presentation feature families with native package readback. This is the main fidelity work, including equation conversion and real charts. Use internal milestones in one task rather than launching a separate audit for each format.
4. [M05 — ManageBac and personal planning](prompts/M05-managebac-and-personal-planning.md): canonical scoped identity, selected polling, onboarding/discovery and personal overlays. Reuse M02 on-demand assets and M01 lifecycle. This may run alongside M03 because it owns provider/source logic rather than Office writers.

## Stage D: complete interaction and desktop path

After integrating Stage C:

5. [M04 — AI, actions and K-bar](prompts/M04-ai-actions-and-kbar.md): exact durable continuation, verified output/recovery, shared action inventory, K-bar, viewport/follow orchestration, attachments and professional deliverables. Existing basic AI work remains usable throughout; this package can now target proven Office and sync operations.
6. [M06 — Bridge trust and Mac readiness](prompts/M06-bridge-trust-and-macos.md): stable-file write protocol, moves/deletions/offline/provider transitions, browser-first presets/setup, Windows no-console behaviour and Mac packaging readiness. Reuse Office proofs rather than implementing a second Office parser in Rust. This can run alongside M04; M06 publishes typed browser setup/permission actions for M04 to consume.

M03/M05/M04/M06 remain the later implementation grouping, not currently dispatched tasks or a guaranteed final count. Their concrete scopes will be refreshed against completed W5/D01/D02 contracts. Reuse existing investigations; do not launch another global discovery wave. If a hosted engine, storage vendor, new canonical model or material launch-scope tradeoff is necessary, bring Pablo concrete alternatives before adopting it.

## Local acceptance and finish

- Parallel implementations record exact commits, changed contracts, migrations and focused private tests. Changed browser/backend journeys run sequentially after integration on the one shared stack, with canonical/native readback where relevant. Every report distinguishes fixture, shared runtime and native device evidence; an unmerged worktree cannot verify its code by visiting main's localhost.
- Parent integration checks only changed boundaries and their direct neighbours. A schema/API integration gets a short real Convex check after integration; do not rerun every past artifact scenario.
- Functional regressions block that slice. Cosmetic differences with usable controls do not trigger endless polish. Keep each UI pass bounded to a batched desktop/narrow inspection, one repair batch, and a confirmation, unless a new functional failure justifies another check.
- A held/unsupported operation is not silently counted as complete. No placeholder, preview, successful HTTP status, toast or stale health badge substitutes for the user's saved result.
- Final gate: fresh ordinary-user onboarding/share/sync; one realistic AI deliverable with vague follow-up/steering; document/workbook/presentation native save/reopen; deletion/offline replay; a representative narrow crowded workspace; package/start/edit/reconnect on the friend's Mac. Reuse existing case evidence and check only current changed behaviour.
- Mac public distribution/signing and final hosting economics remain explicit launch decisions. No Actions execution, deployment, billing change, external message or original school-file mutation is authorized by these prompts.

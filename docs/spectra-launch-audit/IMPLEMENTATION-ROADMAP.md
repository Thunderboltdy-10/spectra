# Compact implementation roadmap

Status 2026-09-10: W4 remains integrated through dc1261d9. The first M01/M02 candidates were reviewed and held after nine reproduced boundary failures and additional incomplete contracts. Read M01-M02-REVIEW.md. Run the two completion prompts below in sequence; no later stage is released yet. The running environment was left alone; future starts use `npm run local:start:all`. Later stages remain a dependency plan, not a fixed estimate of all remaining work.

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

## Stage B: manual foundation pair — complete the held candidates

W4 source integration is complete. Preserve its parent corrections and launcher. Continue the existing manual tasks using the complete prompts below, preferably with Pablo's strongest chosen model/reasoning. No new automatic batch is needed. Use private dependencies and distinguish candidate source, fixtures and actual changed-backend evidence.

1. FIRST: [M02 — Complete working intake](prompts/M02-complete-intake.md). Fix the actual PNG/original upload path, materialize media, make canonical import receipts causal and replayable, implement reference release, parser limits and authoritative evidence. The original task requirements still apply.
2. AFTER M02 finishes: [M01 — Complete reads and lifecycle](prompts/M01-complete-read-and-lifecycle.md). Consume M02's finished candidate in the M01 private checkout, then complete lossless history, actual read savings, bounded recoverable deletion, durable placement and prompt/cheap Bridge discovery.

The earlier parallel foundation plan is superseded. Review showed that each implementation deferred the same byte-retention boundary. M01-M02-HANDOFF.md now fixes ownership and a narrow helper contract; M02 implements it first, M01 consumes it second. Neither candidate is merged into primary automatically. Parent reviews the combined results and performs only the necessary changed-boundary integration checks before Stage C. Use reports/M02-COMPLETION.md and M01-COMPLETION.md for the revised contracts, not the held originals.

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

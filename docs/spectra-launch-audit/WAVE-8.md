# Wave 8: integrated functionality and finite real-user acceptance

2026-09-12. Parent reviewed all W7-01..09 reports, V7-00 including its authenticated follow-up, and S7-COST. Reviewed main integration lineage and cost/Office consumer code. This turn is source review and orchestration; parent did not run new product tests or inspect/restart services.

## Material progress

Main is e14812cc, with product follow-up 260d6fc5. All nine W7 implementations plus the preceding W6/S6 work are now integrated. This closes the previous private-branch bottleneck. The integrated reports record passing typecheck, changed-file lint and capability/architecture/design/copy gates, backend and Office/UI boundary suites, and Bridge tests. The full suite records 228 passing files, 1,949 passing tests, one skipped file/test and one failed file: scripts/local/start-all.test.mjs uses node:test but was discovered by Vitest. This is a runner ownership issue, not an empty test file; preserve and run its tests with the right runner.

Authenticated Profile A (real account, school_admin/platform operator) now proves the K-bar opens settings/Bridge/artifact and changes/restores a setting, plus a real answer-only run reaches completed in both Live Dock and its current run. V7 fixed stale active-tab state and frontend refresh ordering. It also changed command-bar positioning/trigger per its user-visible follow-up. Preserve those actual accepted behaviors. This is not ordinary-student, substantial AI, Office desktop, upload, deletion or native Bridge proof.

The implementation now includes exact clarification continuations and stop identity; separate answer/saved/native outcomes; surviving pinned placement ownership with atomic deletion workers; native claim tokens and persisted acknowledgement replay; durable Word images, section/header/footer editing and richer equations; independent PowerPoint chart/workbook clones, hyperlinks and source-linked charts; Sheets native validation/conditional formats/combo/histogram code; off-page command outcomes/Bridge handoffs and crowded-workspace allocation; normal class-selection/retention controls.

S7-COST product 1440a51e41f6ddff5497b9c9eae5b23650c716b8 is private on codex/s7-cost-read-model, checkout 047d, based on e14812cc. It adds transactional small artifact/card/tab read models and migrations. Reported fixture row proxies are artifact 728,802 -> 2,564 bytes, run 284,203 -> 8,594, card 133,641 -> 8,664. These are serialized fixture records, NOT measured billable read volume or monetary savings. It did not integrate, migrate the local deployment or complete its authenticated cost acceptance. No provider/hosting change occurred.

## Parent decisions and remaining source findings

1. Keep the compact-read approach; repair its cross-feature regressions before landing. spectraRunProjection.compactInputRequest truncates exact choice keys to 80 characters and titles to 160, while W7 accepts keys up to 120 and validates selected titles. Display text may shorten, identity/payload cannot. Its eight-option slice can also hide valid choices without a detail path. The spectraAiRuns trigger patches canonical cards through ctx.innerDb, bypassing the spectraResultCards trigger that maintains summaries; readCardRunSummary then trusts the current-version summary. This can return stale outcomes. Every run change also collects heavy canonical cards, moving cost to writes. Artifact summary contentHash/currentVersionId/updatedAt cause content updates to invalidate hot records. W8-01 owns concrete repair, writer/read instrumentation, migration and local acceptance.
2. Add the remaining everyday linked-Word operations. W7 explicitly still refuses inserting a new equation into a linked file, native equation alignment/display and retained-image deletion. Existing equation editing alone does not satisfy the user's basic Office expectations. W8-02 implements these specific operations with the current model/ledger/adapter; no expansion to a general TeX engine or full tracked-change system.
3. Native self-readback is necessary but insufficient. W7 xlsx-native.makeChartPlot emits negative c:axId values, while Microsoft defines them as unsigned. It also writes c:histogramChart/c:histogramSeries into the old DrawingML chart namespace; those are absent from that plot-area schema. Own parser acceptance can agree with its own invalid output. S8-OFFICE is the one stronger manual task: independent standards validation, valid chart/package writing, and external native acceptance where the local installed apps permit it. Preserve rich editable charts; hiding the controls or rasterizing them is not the requested fix.
4. Do not repeat another nine-feature wave. Two scoped Luna implementers run now. Then one stronger interoperability task, followed by four small sequential Luna user journeys. Each verifier fixes small failures and checks its direct neighbor. The finite case set and evidence rules prevent another integration task from substituting sidebar styling for unexecuted data/AI journeys.

Primary references checked for the chart findings: [AxisId](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.axisid?view=openxml-3.0.1) and [PlotArea child schema](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.plotarea?view=openxml-3.0.1). These establish schema issues, not an observed Excel repair dialog. No native GUI claim is made from this review.

## Execution order

| Order | Task | Execution |
| --- | --- | --- |
| Now | W8-01 compact-read repair, integration and measured local acceptance | Luna xhigh; only owner of the shared runtime in this batch |
| Now | W8-02 linked Word insertion/deletion/layout | Luna xhigh, private worktree and deterministic tests only |
| After both | S8-OFFICE independent native interoperability | Stronger manual task; integrates W8-02, repairs actual native schema/format problems and leaves primary working |
| Then | V8-01 ordinary-student onboarding/selected sync/personal scheduling | Manual Luna xhigh, sequential |
| Then | V8-02 streamed rich Word and pinned-content lifetime | Manual Luna xhigh, sequential |
| Then | V8-03 substantive AI, continuation/steering/follow and /chat | Manual Luna xhigh, sequential |
| Then | V8-04 native Bridge and linked workbook/presentation workflow | Manual Luna xhigh, sequential |

Manual bootstrap prompts and full task links are in RUN-NEXT-W8.md. Do not automatically launch stronger tasks or concurrent shared-runtime verifiers. After creating the two current tasks, parent stops; Pablo returns after completion. No polling/individual completion wakeups.

## Acceptance discipline

Each real-local task records served source, local deployment, real identity/role, actual fixture IDs, persisted/reopened results and relevant screenshots. Use Playwright CLI with unique sessions. Follow the existing Profile A session path; do not ask for extra accounts or invent credentials. Local ordinary-student role configuration is already authorized for this real identity, affects backend and frontend, is restricted to local testing and is restored. Two identities in deterministic authority tests do not prove two real people accepted an invitation.

Use native Office automation only on disposable copies and without visible unwanted windows; no lowlevel computer MCP. If Office is absent, say so once and retain an actionable exported fixture for user/friend testing, rather than simulate its rendering. Friend-Mac installation/pair/edit/reconnect and distribution decisions remain later; no Actions now. No remote school writes, external invitation sends, original file changes or hosting/storage/provider decisions.

The exit from each verifier is passed exact outcomes, repaired/retested outcomes, or a small exact reproducible blocker. Do not label merely prepared fixtures or signed-out screenshots as acceptance. No percentage-complete promise, no cosmetic perfection gate, no new global audit. Remaining advanced Office families stay explicitly tracked; broad native compatibility and live model quality are still claims to earn.

# Phase 1 Implementation Report

Date: 2026-03-21

## Scope Implemented

1. Pipeline controller scaffold + execution state
- Added `PipelineController` with `PipelineState`, stage execution plans by request class (`T0-T3`), and per-stage skip/completion tracking.
- Added class-budget envelopes (`T0: 0.001`, `T1: 0.01`, `T2: 0.05`, `T3: 0.15` USD).
- File: `src/lib/orchestrator/pipeline-controller.ts`

2. Cost-tiered controller integration in chat pipeline
- Integrated request-class-driven gating into `pipeline.ts` via `PipelineController`.
- Added early T0 detection and fast-path auto-settings skip (no prompt enhancement/search planning for trivial prompts).
- Added execution trace metadata (`stepsExecuted`, `stepsSkipped`, `requestClass`, `classificationReason`, `searchStatus`, `costBudgetUsd`) to route traces.
- Files: `src/lib/orchestrator/pipeline.ts`, `src/types/index.ts`

3. Cost gates for T0/T1 requests
- Enforced search/RAG/multi-agent cost gates for lower classes via controller (`applyCostGates`).
- Route plan is now post-processed by class gates before retrieval/search execution.
- Files: `src/lib/orchestrator/pipeline.ts`, `src/lib/orchestrator/pipeline-controller.ts`

4. forceMultiAgent guardrails
- Forced multi-agent requests are denied unless all guardrails pass: tier allows, org feature enabled, request class >= T2, budget not soft/hard limited.
- Denials are surfaced in route toolchain/trace context.
- File: `src/lib/orchestrator/pipeline.ts`

5. Routing diversity and anti-lock-in rebalance
- Updated phase router scoring weights to the Phase 1 target blend.
- Added free-model cost-fit ceiling (`0.70`) and stronger repetition penalties.
- Replaced provider streak logic with provider diversity penalty (>35% of recent provider usage).
- Added epsilon exploration (`10%`) over top candidates.
- File: `src/lib/routing/phase-router.ts`

6. Parallel SearxNG queries + tighter timeout
- Refactored SearxNG search to run in parallel batches of 3 instances (first successful result wins), preserving failure cooldown behavior.
- Reduced default timeout from `6500ms` to `4000ms`.
- File: `src/lib/search/searxng.ts`

7. RAG gating when no processed resources exist
- Retrieval now checks for processed resources before embedding/vector search.
- If only unprocessed resources exist, retrieval is skipped with explicit diagnostics reason.
- File: `src/lib/orchestrator/retrieval.ts`

8. Utility model cost preference alignment
- Memory extraction utility model selection now uses `preferCheap` without `preferFree` override.
- File: `src/lib/orchestrator/post-process.ts`

9. Dry-run route alignment
- Updated dry-run route planning path to use request-class/controller gates and expose new route trace fields.
- File: `src/app/api/chat/dry-run/route.ts`

10. Focused tests
- Added controller-level tests for T0 gating and force-multi-agent guardrails.
- File: `src/lib/__tests__/pipeline-controller.test.ts`

## Verification Notes
- Attempted:
  - `npm run test:run -- src/lib/__tests__/auto-settings.test.ts src/lib/__tests__/route-plan.test.ts src/lib/__tests__/pipeline-controller.test.ts`
  - `./node_modules/.bin/vitest run src/lib/__tests__/auto-settings.test.ts src/lib/__tests__/route-plan.test.ts src/lib/__tests__/pipeline-controller.test.ts`
- Environment remains blocked for Node test execution:
  - `npm` launches through Windows `CMD.EXE` with UNC-path failure.
  - Direct Vitest execution fails because `node` is not available in PATH.

## Notes
- Existing repo state had no unrelated staged changes before this phase.
- No destructive git operations were performed.

# NOTES

Date: 2026-03-21
Scope: Phase 6 deep review follow-up (reliability, cost, routing freshness, Convex efficiency)

## What Is Solid Now
- Core regressions reported in review are fixed and validated:
  - Clarification cache reuse only for true clarification follow-ups.
  - Mode-suggestion follow-ups send with explicit mode override.
  - Flashcard edit path recomputes card hash and severs stale progress linkage.
- Test baseline is healthy:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes (31 files, 165 tests).
  - smoke suite passes (13/13).
- Live flow checks pass for:
  - clarification + no stale context reuse,
  - branch sibling indexing,
  - flashcard hash change semantics.

## Key Improvements Added In This Pass
- Convex bandwidth/call reductions:
  - `chats.listChats` payload trimmed + indexed by `ownerUserId + updatedAt`.
  - `resources.listPersonalResources` payload trimmed.
  - `rag.getChunksByIds` no longer returns full chunk docs (drops embedding-heavy payloads).
  - Adaptive personal resource polling and in-flight dedupe in client state.
  - Reduced notification polling pressure.
- Routing/model freshness improvements:
  - Recent-model anti-repetition now considers broader recent assistant history.
  - Router scoring includes age staleness and deep-research overuse penalties.
  - Live catalog selection prioritizes newer models.
- Reliability:
  - stream `finish_reason=length` with zero visible output now triggers fallback retry.
- Memory directive robustness:
  - Generic remember statements with first-person context now parse correctly.
  - Remember keys now derive from statement content (prevents single-key overwrite).
  - Forget-target parsing strips trailing phrases like "in my memory".
  - Forget matching upgraded for acronym/phrase variants (`wwii` <-> `world war ii`).
- Gamification efficiency:
  - Added streak-level activity counters to avoid repeated full-message scans in `awardXp` hot path.

## Important Remaining Risks / Bigger-Scale Work
- Full chat pagination is still not implemented server-side.
  - Current UI reveals progressively, but initial chat fetch still pulls complete thread data.
  - For heavy users, this remains a major bandwidth risk.
- `users.me` call volume can still spike under frequent polling/API fan-out.
  - Requires request/session-level actor caching strategy across API routes.
- Convex deployment drift is still a workflow risk.
  - Local app + CLI can drift between deployments if `CONVEX_DEPLOYMENT` context is inconsistent.
  - Add startup guardrails/health checks to assert expected deployment IDs.
- Achievement system still has broad logic surface.
  - Counters reduce cost, but rule complexity would benefit from dedicated event stream + incremental materialized stats.
- Model latency variance remains noticeable.
  - Add stricter latency-aware penalties and mode-based hard latency caps.

## Suggested Next Production Steps
1. Implement cursor-based chat pagination end-to-end (`/api/chats/:id` + top-sentinel load older).
2. Add actor/session cache layer for `requireActor()` to reduce repeated Convex auth lookups.
3. Add integration tests for memory directives (`remember`, `forget`, negative-topic constraints) using full API flow.
4. Add deployment consistency check in boot diagnostics (app build/deploy should fail fast on Convex mismatch).
5. Add routing SLO instrumentation:
   - p50/p95 latency by mode,
   - fallback rate,
   - `finish=length` retry success rate,
   - model diversity ratio over rolling windows.

## Convex Cost Heuristics (Operational)
- Treat these as warning thresholds in dev:
  - `chats.listChats` DB bandwidth > 100MB/day per active tester.
  - `resources.listPersonalResources` > 5k calls/day per tester.
  - `users.me` > 10k calls/day per tester.
- If exceeded:
  - verify polling loops,
  - verify payload shapes,
  - verify duplicate fetches from mount/open effects.

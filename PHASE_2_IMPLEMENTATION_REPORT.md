# Phase 2 Implementation Report

Date: 2026-03-21

## Scope Implemented

1. Baseline verification and TypeScript regression fix (Phase 0/1 checkpoint)
- Fixed `livePhasePlan` state typing in `use-chat-state.ts` (`prev` possibly undefined compile error).
- Verified targeted Phase 0/1 tests and TypeScript checks using explicit WSL bash + nvm invocation.
- File: `src/hooks/use-chat-state.ts`

2. New memory storage fabric schema
- Added `userMemoryEntries` table with:
  - categories (`identity`, `academic`, `preference`, `topic`, `artifact`, `correction`)
  - status (`pending`, `confirmed`)
  - source type (`extraction`, `user_explicit`, `correction`)
  - vector index `by_embedding` filtered by `userId` and `orgId`
- Added org context fields: `curriculum`, `examBoard`, `gradeLevels`.
- File: `convex/schema.ts`

3. Memory backend operations and semantic retrieval
- Implemented memory write router persistence mutation (`memory:routeMemoryWrite`) with pending/confirmed promotion behavior.
- Implemented semantic retrieval action (`memory:retrieveRelevantEntries`) with:
  - similarity threshold support
  - confirmed-only topic retrieval
  - negative topic-link filtering
- Added profile/list and management operations:
  - `memory:listMemoryEntries`
  - `memory:getGlobalProfileEntries`
  - `memory:forgetMemoryEntriesByQuery`
  - `memory:forgetAllByTopic`
  - `memory:setMemoryEntryStatus`
  - `memory:removeMemoryEntry`
  - `memory:addNegativeTopicLink`
- File: `convex/memory.ts`

4. Directive pathways (forget/correction/remember/profile)
- Extended `parseUserDirectives()` to emit memory actions:
  - forget
  - negative topic association
  - remember
  - update profile
- Applied directives in pipeline before route planning/prompt construction.
- Files: `src/lib/auto-settings.ts`, `src/lib/orchestrator/pipeline.ts`

5. Memory read planner and write router orchestration
- Added `planMemoryRead()`:
  - Layer 2 profile aggregation (global profile entries + personal soul preferences)
  - Layer 3 semantic topic retrieval via vector search
  - fallback to legacy raw memory text when needed
- Added `routeMemoryWrite()`:
  - category routing
  - embedding generation
  - write-through to `userMemoryEntries`
- Added `buildDirectiveMemoryEntries()` helper for explicit user memory directives.
- File: `src/lib/orchestrator/post-process.ts`

6. RAG embedding reuse path
- Extended retrieval result payload with `queryEmbedding` so memory retrieval can reuse the same vector when available.
- File: `src/lib/orchestrator/retrieval.ts`

7. Layer 1 school context expansion in runtime prompt
- Runtime context now includes:
  - `schoolType`, `country`, `curriculum`, `examBoard`, `gradeLevels`
- Updated admin settings backend/API payload support for the new fields.
- Files: `src/lib/orchestrator/pipeline.ts`, `convex/admin.ts`, `src/app/api/admin/settings/route.ts`

8. Memory Management UI (Unified Panel)
- Added dedicated `Memory` tab to settings panel with:
  - pending entries with confirm/dismiss
  - confirmed entries grouped by confidence bands
  - per-entry delete
  - source chat link
  - “forget all about topic” action
- Added API route `/api/memory` for list + actions.
- Files: `src/components/chat/unified-panel.tsx`, `src/app/api/memory/route.ts`

9. Lifecycle cleanup alignment
- Included `userMemoryEntries` cleanup in user deletion workflow.
- File: `convex/userLifecycle.ts`

## Test / Verification

Executed via explicit WSL bash + nvm (no direct `npm`/`vitest` host invocation):

1. Phase 0/1 + Phase 2 targeted suite (pass)
```bash
bash -lc 'source ~/.nvm/nvm.sh && nvm use 24.12.0 >/dev/null && cd <local-workspace> && npx vitest run src/lib/__tests__/auto-settings.test.ts src/lib/__tests__/route-plan.test.ts src/lib/__tests__/pipeline-controller.test.ts src/lib/__tests__/post-process-memory-routing.test.ts'
```
- Result: 4 files passed, 29 tests passed.

2. TypeScript compile (pass)
```bash
bash -lc 'source ~/.nvm/nvm.sh && nvm use 24.12.0 >/dev/null && cd <local-workspace> && npx tsc --noEmit'
```
- Result: pass.

3. Additional non-gating legacy test note
- `src/lib/__tests__/memory-compaction.test.ts` currently has a pre-existing assertion mismatch (`expects <=20` while current merge cap is `40`).
- This test was not used as a Phase 2 gate and is unchanged by this implementation.


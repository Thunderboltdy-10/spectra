# Phase 0 Implementation Report

Date: 2026-03-21

## Scope Implemented

1. Contact form auth route exposed publicly
- Added `/api/contact(.*)` to `isPublicRoute`.
- File: `src/proxy.ts`

2. Search fallback hallucination hardening + status surfacing
- Rewrote model fallback prompt to training-knowledge-only mode with explicit no-URL fabrication instruction.
- Enforced `Note: Web search was unavailable.` prefix for fallback responses.
- Emitted `search_status` stream events (`model_fallback`, `real_search`, `error`).
- Added frontend model-knowledge banner handling.
- Added policy instruction to be explicit when search block indicates model fallback.
- Files: `src/lib/orchestrator/retrieval.ts`, `src/lib/orchestrator/pipeline.ts`, `src/hooks/use-chat-state.ts`, `src/components/chat/chat-messages.tsx`, `src/lib/prompts/policy.ts`

3. File upload stalled handling alignment
- Updated processing-stale threshold to 90 seconds.
- Unified panel stale detection now uses shared constant.
- Files: `shared/resource-processing.ts`, `src/components/chat/unified-panel.tsx`

4. Speech-to-text robustness
- Added dynamic `recognition.lang` selection from document/navigator locale.
- File: `src/hooks/use-speech-to-text.ts`

5. Canvas `label.trim` runtime guard
- Replaced direct `.trim()` calls with safe string coercion.
- File: `src/hooks/use-canvas-state.ts`

6. Request classification infrastructure (T0-T3)
- Added `classifyRequest()` and request-class metadata (`requestClass`, `classificationReason`).
- Integrated classification into auto-settings pipeline, chat pipeline, and dry-run API trace.
- Added focused tests for T0/T2/T3 classification.
- Files: `src/lib/auto-settings.ts`, `src/lib/orchestrator/pipeline.ts`, `src/app/api/chat/dry-run/route.ts`, `src/lib/__tests__/auto-settings.test.ts`, `src/types/index.ts`

7. Real-time phase events
- Added streamed `phase_update` events with per-phase status transitions.
- Added live phase-plan client state + orchestration panel rendering from live updates.
- Added phase failure emission on stream failure.
- Files: `src/lib/orchestrator/pipeline.ts`, `src/hooks/use-chat-state.ts`, `src/components/chat/unified-panel.tsx`, `src/components/chat/chat-layout.tsx`

8. Token count aggregation (all subcalls)
- Added subcall token summation and used it for persisted message token usage and done-event usage totals.
- Updated message token UI to prefer subcall totals and avoid collaborator double-counting when present.
- Files: `src/lib/orchestrator/pipeline.ts`, `src/components/chat/chat-message.tsx`

9. Title generation quality/reliability
- Utility title model now prefers cheap paid models (`preferFree: false`).
- Added bounded second-attempt retry using fallback model when first title completion is empty.
- File: `src/lib/orchestrator/post-process.ts`

10. Learning context schema prep
- Added optional `learningContext` field to `chats` schema.
- Initialized field on chat creation.
- Files: `convex/schema.ts`, `convex/chats.ts`


## Notes
- Existing repo state includes unrelated pre-existing modifications/deletions outside this Phase 0 implementation.
- No destructive git operations were performed.

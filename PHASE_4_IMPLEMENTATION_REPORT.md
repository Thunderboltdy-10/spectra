# Phase 4 Implementation Report

Date: 2026-03-21

## Scope Implemented

1. Generalized clarification logic
- Added a dedicated clarification module with:
  - structured `ClarificationBlock` types
  - `needsClarification()` decisioning for T2/T3 ambiguity/conflicts
  - `formatClarificationAsText()` fallback text renderer
  - recent-context cache helpers (serialize/parse/build) with 5-minute TTL
- File:
  - `src/lib/orchestrator/clarification.ts`

2. Clarification interrupt in pipeline
- Wired clarification into `runChatPipeline`:
  - removed eager auto-complete of `clarificationCheck`
  - runs real clarification decision in pipeline flow
  - if clarification is needed, short-circuits before full generation
  - persists assistant clarification response with structured metadata in `routeTrace.clarificationBlock`
  - marks generation/post-process as skipped for truthful stage trace
- File:
  - `src/lib/orchestrator/pipeline.ts`

3. Recent context cache persistence and reuse
- Added chat-level cache fields in schema:
  - `chats.recentContext`
  - `chats.recentContextAt`
- Added mutation:
  - `chats:setRecentContext`
- Behavior:
  - when clarification is triggered after retrieval/search, cache compact context
  - if user reply follows a clarification turn within 5 minutes, reuse cached retrieval/search context and clear cache
- Files:
  - `convex/schema.ts`
  - `convex/chats.ts`
  - `src/lib/orchestrator/pipeline.ts`

4. ClarificationCard UI
- Added a dedicated clarification renderer for assistant messages with structured metadata.
- Supports free text, single choice, multi choice, and confirmation inputs.
- Submits answers as a normal follow-up user message through existing `onFollowUp` flow.
- Files:
  - `src/components/chat/clarification-card.tsx`
  - `src/components/chat/chat-messages.tsx`
  - `src/types/index.ts`

5. Proactive continuity banner
- Added dismissible proactive banner for empty-chat moments.
- Banner sources:
  - unread reminders (`reminder_flashcards_due`, `reminder_streak_risk`, `reminder_study_plan`)
  - continuation suggestion for recent chat resume on new chat
- Added apply/dismiss wiring from state -> layout -> messages.
- Files:
  - `src/hooks/use-chat-state.ts`
  - `src/components/chat/chat-layout.tsx`
  - `src/components/chat/chat-messages.tsx`

6. Tests
- Added targeted unit tests for clarification and recent-context TTL logic.
- File:
  - `src/lib/__tests__/clarification.test.ts`

## Test / Verification

Executed with required WSL bash + full nvm wrapper structure.

1. Targeted phase/regression tests (pass)
```bash
bash -lc 'source ~/.nvm/nvm.sh && nvm use 24.12.0 >/dev/null && cd <local-workspace> && node -v && npm -v && npx vitest run src/lib/__tests__/clarification.test.ts src/lib/__tests__/pipeline-controller.test.ts src/lib/__tests__/route-plan.test.ts src/lib/__tests__/auto-settings.test.ts'
```
- Result: 4 files passed, 34 tests passed.

2. TypeScript compile (pass)
```bash
bash -lc 'source ~/.nvm/nvm.sh && nvm use 24.12.0 >/dev/null && cd <local-workspace> && node -v && npm -v && npx tsc --noEmit'
```
- Result: pass.

## Notes

- Clarification is intentionally gated to T2/T3 and disabled for quiz/flashcard so existing mode-native clarify behavior remains unchanged.
- Recent-context reuse is limited to clarification-follow-up turns and expires after 5 minutes to avoid stale carryover.
- Proactive banner is session-dismissable and only surfaced when the message list is empty to reduce interruption.

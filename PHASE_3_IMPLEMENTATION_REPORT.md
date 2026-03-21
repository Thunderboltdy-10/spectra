# Phase 3 Implementation Report

Date: 2026-03-21

## Scope Implemented

1. LearningContext core model and utilities
- Added a dedicated LearningContext module with:
  - coercion/parsing from JSON payloads
  - merge/dedup logic across turns
  - prompt formatting for runtime injection
  - mode transform guidance generation
  - mode suggestion chip generation
  - flashcard append intent detection
- Files:
  - `src/lib/orchestrator/learning-context.ts`
  - `src/lib/__tests__/learning-context.test.ts`

2. LearningContext extraction piggybacked on memory extraction
- Extended `maybeExtractMemory()` to request structured JSON containing:
  - `memory` entries and
  - `learningContext` payload
- Added fallback LearningContext derivation from assistant response when model JSON is absent.
- Added `persistMemory` control so the same extraction call can update LearningContext without forcing legacy memory writes.
- File:
  - `src/lib/orchestrator/post-process.ts`

3. Pipeline mode transforms using LearningContext
- Parsed stored chat LearningContext and injected it into system runtime context.
- Added mode-transform guidance block for:
  - quiz/exam (target `quizableFacts` + calibrated difficulty)
  - flashcard (candidate reuse + add-more duplicate avoidance)
  - research (prioritize `uncertaintyGaps`)
  - explain (target known misconceptions)
- Added flashcard append intent deck context (`flashcards:getLatestDeckForChat`) for anti-duplicate guidance.
- Updated quiz difficulty to consider existing LearningContext difficulty.
- Files:
  - `src/lib/orchestrator/pipeline.ts`
  - `convex/flashcards.ts`

4. LearningContext persistence and mode suggestion chips
- Added chat mutation to persist LearningContext JSON.
- Merged stored + extracted LearningContext in post-process and persisted updates.
- Generated mode suggestion chips metadata (`modeSuggestions`) on substantive tutor/explain responses when LearningContext has enough quiz/flashcard facts.
- Exposed/typed `modeSuggestions` in route trace.
- Files:
  - `convex/chats.ts`
  - `src/lib/orchestrator/pipeline.ts`
  - `src/types/index.ts`

5. Flashcard "add more" append behavior
- Updated backend save flow to detect append intent from the preceding user message and append new cards to the latest chat deck (deduped by `cardHash`) instead of replacing/regenerating a disconnected deck.
- File:
  - `convex/flashcards.ts`

6. Manual flashcard editing (inline)
- Added backend mutation/API route support for card editing:
  - `flashcards:editCard`
  - `POST /api/flashcards` action `edit_card`
- Added inline edit UI in flashcard reveal (front/back editing, save/cancel).
- Wired UI -> hook -> API flow.
- Files:
  - `convex/flashcards.ts`
  - `src/app/api/flashcards/route.ts`
  - `src/components/chat/flashcard-reveal.tsx`
  - `src/components/chat/chat-messages.tsx`
  - `src/components/chat/chat-layout.tsx`
  - `src/hooks/use-chat-state.ts`

7. Flashcard UI polish
- Removed the redundant top progress bar in card mode (dot tracker remains).
- Added explicit spacing (`pt-4`) between the main flashcard and rating/navigation controls.
- File:
  - `src/components/chat/flashcard-reveal.tsx`

8. Spaced repetition reminders on notification surface
- Verified existing reminder pipeline is active and wired:
  - daily cron `generate-study-reminders`
  - `reminder_flashcards_due` notifications
  - notification UI surface in chat sidebar/utility dock via `NotificationBell`
- No additional code change required in this phase for this item.

## Test / Verification

Executed with required WSL bash + full nvm wrapper structure:

1. Phase 3 targeted + related regression tests (pass)
```bash
bash -lc 'source ~/.nvm/nvm.sh && nvm use 24.12.0 >/dev/null && cd <local-workspace> && node -v && npm -v && npx vitest run src/lib/__tests__/learning-context.test.ts src/lib/__tests__/post-process-memory-routing.test.ts src/lib/__tests__/route-plan.test.ts src/lib/__tests__/pipeline-controller.test.ts'
```
- Result: 4 files passed, 16 tests passed.

2. TypeScript compile (pass)
```bash
bash -lc 'source ~/.nvm/nvm.sh && nvm use 24.12.0 >/dev/null && cd <local-workspace> && node -v && npm -v && npx tsc --noEmit'
```
- Result: pass.

## Notes

- LearningContext extraction now runs whenever either memory write is needed or a response is eligible for learning-context extraction, while memory persistence remains gated by `persistMemory`.
- Mode suggestion chips are emitted through route trace metadata and rendered as clickable follow-up actions in chat.

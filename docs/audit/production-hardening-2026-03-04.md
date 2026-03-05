# AI School / IXOS Production Hardening Audit (2026-03-04)

## Scope
- Discovery + architecture map for chat/orchestration/storage/rendering paths.
- P0 implementation verification for UI regressions and orchestration/model-routing hardening.
- Regression verification via lint/tests/typecheck + manual repro scripts.

## System Map (Current Runtime)

### Chat streaming pipeline
- Client composition and panel wiring: `src/components/chat/chat-layout.tsx`
- Chat state, stream handling, NDJSON events, optimistic UI: `src/hooks/use-chat-state.ts`
- API entrypoint for chat stream: `src/app/api/chat/route.ts`
- Main orchestration/runtime pipeline (routing, retrieval, capability gates, specialists, streaming): `src/lib/orchestrator/pipeline.ts`
- Streaming helpers:
  - single model stream: `src/lib/orchestrator/streaming.ts`
  - specialist graph + dynamic specialist model selection: `src/lib/orchestrator/specialists.ts`, `src/lib/orchestrator/task-graph.ts`
  - web retrieval: `src/lib/orchestrator/retrieval.ts`

### Model catalog + routing
- Live OpenRouter catalog snapshot cache: `src/lib/openrouter-catalog-cache.ts`
- Catalog metadata scoring, capability detection, reliability-aware picking: `src/lib/model-selection.ts`
- Route choice entrypoint with catalog-first adaptive branch: `src/lib/routing/heuristic.ts`
- Dry-run route now uses live catalog + runtime stats: `src/app/api/chat/dry-run/route.ts`

### Conversation + model runtime persistence (Convex)
- Schema:
  - chats/messages/memory: `convex/schema.ts`
  - runtime model metrics table: `modelRuntimeStats` in `convex/schema.ts`
- Queries/mutations for model stats:
  - `listRuntimeStats`, `recordModelRun`: `convex/models.ts`
- Chat persistence path (`appendMessage`, `createChat`, title updates) called from pipeline:
  - `convex/chats.ts`

### Attachments + vision gate
- Client upload pre-processing (compress-on-send): `src/hooks/use-chat-state.ts`
- Resource upload route: `src/app/api/resources/route.ts`
- Attachment normalization + vision gate:
  - `src/lib/attachments/normalizer.ts`
  - `src/lib/attachments/capability-gate.ts`
  - `src/lib/attachments/vision-prepass.ts`

### Markdown/math/rendering
- Renderer + math/code plugins: `src/components/chat/markdown-renderer.tsx`
- Streaming structured-mode safety (quiz/flashcards skeleton-only): `src/components/chat/chat-messages.tsx`
- Global KaTeX + chat markdown styles: `src/app/globals.css`

### Orchestration UI / right panel
- Unified panel and orchestration tree UI: `src/components/chat/unified-panel.tsx`
- Desktop dock vs mobile sheet behavior: `src/hooks/use-right-panel-dock.ts`
- Sidebar + utility dock integration: `src/components/chat/chat-sidebar.tsx`, `src/components/global-utility-dock.tsx`

## Issue Audit (Phase A + implemented status)

| ID | Repro summary | Suspected root cause | Status | Main files |
|---|---|---|---|---|
| P0.1 | Collapsed/expanded sidebar bottom section split/duplicated utility buttons | Sidebar had split utility UIs and duplicated render paths for collapsed mode | Fixed | `src/components/chat/chat-sidebar.tsx`, `src/components/chat/chat-layout.tsx` |
| P0.2 | Orchestration appeared as right panel plus separate in-chat feature | Multiple orchestration surface paths active simultaneously | Fixed to single right-panel display trigger | `src/components/chat/chat-layout.tsx`, `src/components/chat/chat-messages.tsx`, `src/components/chat/unified-panel.tsx` |
| P0.3 | Selector popovers opened but content invisible | z-index/portal layering and overflow clipping | Fixed | `src/components/chat/chat-composer.tsx`, `src/components/ui/dropdown-menu.tsx` |
| P0.4 | Missing integrated tips bar + clunky attachment expansion direction | Composer lacked unified tips rotator and upward fold section | Fixed | `src/components/chat/chat-composer.tsx`, `src/components/chat/smart-tip-rotator.tsx`, `src/app/globals.css` |
| P0.5 | Streaming lacked clear assistant/model identity and had visual jumps | Draft stream rendering/state transitions inconsistent | Fixed | `src/components/chat/chat-messages.tsx`, `src/hooks/use-chat-state.ts` |
| P0.6 | Right panel overlayed desktop instead of docking | Dock threshold/width calculation too conservative | Fixed | `src/hooks/use-right-panel-dock.ts`, `src/components/chat/unified-panel.tsx` |
| P0.7 | Math/code/structured-mode streaming quality regressions | Mixed content parser and streaming behavior leaked structured answers early | Fixed | `src/components/chat/markdown-renderer.tsx`, `src/components/chat/chat-messages.tsx`, `src/app/globals.css` |
| P0.8 | Trivial toasts noisy (“mode changed” etc.) | Toasts emitted for low-signal events | Fixed | `src/hooks/use-chat-state.ts` |
| P0.9 | Mic option missing or inconsistent | Composer controls lacked stable voice entry stub | Fixed with graceful stub fallback | `src/components/chat/chat-composer.tsx` |
| P0.10 | Model switching appeared to reset context | Model/router state updates and context carryover needed regression guard | Fixed + manual regression script added | `src/hooks/use-chat-state.ts`, `docs/manual-repro/model-switch-context-regression.md` |
| P0.11 | Vision attachments could route to non-vision model | Capability gate relied on brittle static assumptions | Fixed with catalog metadata gate + prepass fallback | `src/lib/attachments/capability-gate.ts`, `src/lib/orchestrator/pipeline.ts`, `src/hooks/use-chat-state.ts` |
| P0.12 | Chat titles were low quality | Simple prefix heuristics instead of model-generated concise title | Fixed (2-6 word async title generation) | `src/lib/orchestrator/post-process.ts`, `src/lib/orchestrator/pipeline.ts` |
| 5.x | Orchestration/sub-agent selection static and repetitive | Fixed mappings and weak runtime reliability feedback loop | Improved with dynamic role-based model picking + runtime stats | `src/lib/model-selection.ts`, `src/lib/orchestrator/specialists.ts`, `src/lib/orchestrator/streaming.ts`, `convex/models.ts` |

## Regression + Verification Results (Phase D)

### Automated checks
- `npm run -s lint`: pass
- `npm run -s test:run`: pass (19 files, 97 tests)
- `npx tsc --noEmit`: fail in `convex/__tests__/compaction.test.ts` (pre-existing role typing mismatch)

### Runtime smoke
- `node scripts/smoke-test.mjs` against existing local server returned `401` across endpoints due auth gating in this environment.
- Result: smoke script could not serve as functional pass/fail for product behavior without an authenticated session bootstrap.

## Manual Repro and Acceptance Checklist (10–20 steps)

1. Open app at desktop width >= 1920 and start a new chat.
2. Collapse sidebar and verify utility buttons appear once (no duplicates).
3. Expand sidebar and hover the bottom profile container; verify streak/XP/monthly section slides up in the same container.
4. Start streaming a message and confirm orchestration opens only in the right panel.
5. Close orchestration panel during stream and verify it remains closed until manually reopened.
6. At 1080p+, verify right panel docks and shrinks main area (not full-screen overlay).
7. On mobile width, verify right panel is sheet-style overlay.
8. Open mode/model/agent selectors; verify popover content is visible and clickable.
9. Attach 2+ files and verify attachments fold/expand upward above composer.
10. Verify tips bar shows above composer and dismisses with `X`.
11. Use mic button: supported browser starts capture; unsupported browser shows clean stub modal.
12. Send normal text response and confirm assistant avatar/model label appears during stream.
13. In quiz/flashcard mode, confirm only skeleton placeholders stream and final structured UI appears after completion.
14. Add large image attachment and send; verify upload proceeds and no oversized-image hard failure.
15. Select a text-only model with image attached; verify vision prepass warning path and successful final response.
16. Run model-switch context script in `docs/manual-repro/model-switch-context-regression.md`.
17. Confirm trivial toasts (mode switch/pin/stop) are suppressed; real error/achievement toasts still appear.
18. Confirm generated chat title updates from default/new state to meaningful 2-6 word title asynchronously.

## Remaining Gaps / Follow-up
- Full “no hardcoded model logic anywhere” is not fully complete:
  - primary chat path is now catalog-first and dynamic, but legacy fallback branches still exist in `src/lib/routing/heuristic.ts`.
- Visual before/after screenshot/GIF evidence is not included from this CLI-only run.
- End-to-end browser UX verification still required on real viewport/device matrix.

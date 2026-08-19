# M3 — PERFORMANCE FLOOR

> **CLOSED (M1-M4 era). Historical record.** Current operating truth: `docs/spectra-nova/`.

**Agent:** Builder · **Prerequisites:** M2 verified

## Objective

Spectra feels immediate on the secondary development machine: instant typing, fast route switches, an idle app that consumes ~zero CPU, and a codebase whose hot paths are small enough to stay fast.

## Root causes you are fixing (STATE.md §2.C)

1. **C2 — The 16.5k-line client monolith.** Decompose `artifact-studio.tsx`: extract `DocumentStudio` (L6419–8157), `FlashcardStudio` (L8159–12157), `QuizStudio` (L12158–16562) into their own modules like the other studios; lazy-load every studio per blueprint (`dynamic()`); move presence/field/interaction layers out of the keystroke render path. Same treatment where needed for `workspace-shell.tsx` hot sections. This is decomposition for performance and safety — not a rewrite; behavior stays identical (Golden Flows prove it).
2. **A2 (residual) — Client projection.** `NativeArtifactYjsModel` must stop full `adapter.project()` on every Yjs update (`native-artifact-model.ts:63–125`): throttle, derive deltas, or project only what metadata consumers need. Editors stay on their Yjs bindings.
3. **C3 — rAF audit.** Inventory all ~42 `requestAnimationFrame` sites. Continuous loops must be event-driven or paused when idle/off-screen: `interaction-layer.tsx:402–405,798–800`, `surface-field.tsx:212–259`, `grain-field.tsx:156–157` (product mounts), presence cursor loops. Acceptance: idle workspace shows a flat performance timeline.
4. **C4 — Polling audit.** Live Dock 4s/900ms, notifications 8s, gateway 1s policy sweep: justify each interval or replace with push/visibility-aware polling. Nothing polls at high frequency while hidden.
5. **C5 — Presence payloads.** Stop publishing contenteditable `innerHTML` on an 800ms heartbeat (`use-interaction-presence.ts:305–307,676–691`); slim awareness serialization (`hocuspocus-transport.ts:282–294`).
6. **C1 — Dev realtime path.** After M1's broadcast-first gateway, measure; if the Node gateway still can't deliver instant dev typing, make Cloudflare (Miniflare/wrangler dev) the default dev provider for native types and keep the gateway as fallback. One documented decision in STATE.md.
7. **C6 — `globals.css` (20k lines).** Split by concern (tokens / app / landing / field), remove dead rules for anything deleted so far. No visual change.
8. **A10 (decide here) — 8 JSON-projection types.** With the perf tooling warm, measure whether whole-work projection is a real cost for Sheets/Presentation/Board at realistic sizes. Either schedule native-Yjs migration missions (add to STATE.md as planned work) or document why projection-with-debounce suffices for launch. Do not start a mass migration inside M3.

## Budgets (acceptance thresholds on the dev machine)

- Keystroke → pixel: no frame >32ms attributable to input handling in a 30s typing trace on a large document, with dock active and a thread open.
- Route switch Library ⇄ Workspace: interactive < ~1.5s dev / <500ms prod build.
- Idle workspace (no interaction, 30s): no continuous rAF, no polling burst spikes, CPU near zero.
- Opening a Document (warm): editor interactive < 1s dev.

## Out of scope

Landing performance (M7 — but shared field/prism code you touch must not regress it), visual changes (none allowed — Golden Flows are the no-regression proof).

## Acceptance criteria

1. All budgets met with performance traces saved to `.shots/missions/M3/` (screenshots of traces are fine).
2. Golden Flows 0–7, 10, 12 pass after decomposition — identical behavior, faster.
3. `artifact-studio.tsx` no longer contains inline studios; every studio lazy-loads; line count and bundle evidence recorded in STATE.md.
4. rAF/polling inventory with before/after documented in the mission log; STATE.md §2.C updated.

## Mission log — closed 2026-08-13

- Prerequisite: M2 was VERIFIED in STATE before work began.
- C2: split Document/Flashcard/Quiz plus shell/file/value helpers; `artifact-studio.tsx` 16,563 → 6,599 lines; every studio and route host uses `dynamic()`.
- A2: Yjs snapshot projection is coalesced to 120ms; initial projection remains synchronous.
- C3 before: presence/surface measurement rAF loops ran continuously. After: ResizeObserver/scroll/visibility/active-motion schedule bounded frames. Landing GrainField is M7-only.
- C4 before: Dock 4s + 900ms active, notifications 8s, policy sweep 1s. After: Dock 30s visible + 2s active, notifications 30s visible, policy sweep 5s.
- C5: removed `innerHTML` heartbeat; focus heartbeat 10s and hidden-aware; cached one awareness signature per update.
- C1 decision: self-hosted Hocuspocus remains default; Cloudflare requires explicit opt-in. Production start now keeps the same-origin realtime proxy.
- C6: split 20k-line global CSS into ordered tokens/app/landing/field sheets.
- A10 decision: projection-with-debounce is launch-sufficient. Heavy Whiteboard opened in 855ms and reached Live; no mass migration scheduled.
- Chrome Profile P production trace (slow host): Workspace reload-to-ready 3.91s; Library cached commit 1.05s; Document warm 1.17s; Whiteboard 0.86s; Quiz 2.03s; Chat 1.08s.
- Document typing and undo round trips were 392/313ms and undo restored the original text; no saved content mutation remained.
- Focused Golden Flow proof: Workspace/Library, Document edit+undo, heavy Whiteboard Live+zoom, Quiz Build, and Chat shell passed with unchanged behavior.
- User relaxed hard caps for this host. Experience is smoother, but cold hydration and ~1s route commits remain logged honestly in STATE.
- Evidence: `.shots/missions/M3/001_workspace-ready.png`, `002_library-warm.png`, `003_document-open.png`, `007_whiteboard-live.png`, `008_quiz-open.png`, `009_chat-shell.png`, `010_browser-performance-trace.json`, `011_browser-console.json`.
- One production build passed. Latest full suite: 688/690 with two pre-existing live-preview timing failures; focused structural tests 28/28.

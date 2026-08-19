# N11 — IDENTITY: FIELD, PRISM, MOTION, LANDING

**Charters:** Designer (sole charter; adopt the Product Engineer's grep discipline for deletions)
**Prerequisites:** N10 accepted in `STATE.md`
**Architecture:** none new. Inputs: `docs/spectra-landing/SPECTRA_LANDING_ULTIMATE_IMPLEMENTATION_PROMPT.md` (design intent, subject to re-narration), ARCHITECTURE-AI §5–§7 (what motion must express), ARCHITECTURE-STORAGE §9 (states motion must communicate)
**Evidence:** `.shots/missions/N11/` with intermediate frames and performance traces · **Tier D throughout**

## Objective

Give the Nova product its senses: one field system that reacts to everything real (AI anywhere, files, sync, collaborators), one prism family, one motion grammar covering app-wide AI navigation and the new file/sync/command interactions, and a landing page that proves *this* product rather than the one that existed before the transformation. This is the adapted M6+M7+M8, sequenced as four workstreams in one mission because they share one aesthetic decision-maker and one performance budget.

## Why now

Identity work needed a product worth expressing. It also needed the AI plane, files and the command surface to exist, because the field must react to them, the motion must carry them, and the landing must tell their story. Doing this earlier would have produced beautiful expressions of a product that no longer exists.

## Non-negotiable budgets (acceptance criteria, not aspirations)

Idle field ≈ 0 rAF. Active field ≤ ~2ms/frame on the reference machine. Off-screen paused. Reduced-motion honoured everywhere. Compositor-only properties for product motion. No input latency added to the keystroke path (D20). No `frameloop="always"` at idle on the landing.

## Workstreams (ordered)

### W1 — One field (Tier D)

1. Inspect current truth first: `src/features/spectra/field/{grain-field.tsx,grain-renderer.ts,surface-field.tsx}`, `src/app/landing/field/*`, plus any CSS lattice fragments. Then converge to **one** implementation with three levels: cheap CSS/SVG for cards and small surfaces, a canvas renderer per major surface, and the landing API. Delete the losers in this mission (grep proof).
2. Activity signals now come from the whole Nova product, not just artifact editors: AI caret/cursor anywhere (including Library, settings, workbar), human selection and drag, run states from the Live Dock, **file and sync events** (materialization, external revision ingested, conflict opened/resolved, Bridge connect/disconnect), collaborator loci.
3. Signals arrive through the existing event/subscription plumbing — no parallel event bus (D21). The field subscribes; it never polls.
4. Local wakes, never whole-surface glows: a sync event brightens the region of the affected row/header, an AI action brightens where the actor is, a conflict is a distinct, calm signature.
5. Write `FIELD.md` beside the code: the API, the signal vocabulary, the budgets, the tuning knobs, and what deliberately does not wake the field.

### W2 — One prism family (Tier D)

1. Inspect current truth: `src/components/spectra-prism-optic.tsx`, `src/app/landing/prism/*`, `src/app/landing/prism3d/*`. Earlier planning referenced a second prism component that appears already removed — verify rather than assume, and delete whatever duplicates remain.
2. One family, several expressions: the static mark and favicon, the spinning loader, the Live Dock presence slot, and the landing optical stage. One geometry, one light model, one set of tokens.
3. Fix the landing prism slot measurement/caching path (`prism-slot.ts`) so the prism is trackable from the hero into the product dock without re-measuring on every frame.
4. Progressive enhancement stays: SVG fallback, WebGL when available, error boundary intact, no console noise.

### W3 — Motion grammar, app-wide (Tier D)

1. Consolidate `src/features/spectra/motion/*` into one documented grammar (durations, easings, primitives, reduced-motion levels) and sweep the product by interaction class rather than by file: surfaces and routes; runs and dock; editing; selection and drag; **AI presence and navigation**; **file/sync state transitions**; feedback and recovery.
2. New Nova classes that need real grammar:
   - **AI navigation and Follow AI:** cursor continuity across routes, navigate → settle → act rhythm, the hand-off when following starts/stops, the difference between a followed and an unfollowed actor's presence.
   - **Organizational motion:** folder open/close, drag into folder, move confirmation, batch reorganization by AI.
   - **Storage and sync:** the transition from Saving to Saved locally to Synced, a conflict appearing, a replica going unavailable, a Bridge reconnect. These must feel like facts settling, never like alarms.
   - **Command surface:** tab switching, density change, expansion, and AI rearranging controls.
3. Coordinate with the field so one event produces one coherent expression (motion + wake), not two competing animations.
4. Intermediate-frame audits are mandatory per class: 2–4 rapid captures mid-transition, inspected.

### W4 — The landing, re-narrated (Tier D)

1. Re-read the landing intent document, then decide the Nova story. The old narrative ("move your work into an AI app") is now wrong: the truthful, stronger story is **your work is already here — real files, alive, organized, and operable by AI**. Scenes that no longer prove anything real get replaced, not preserved out of sentiment.
2. Rebuild the scene sequence around what Spectra now is. Candidate beats, to be decided by taste: the quiet field; work appearing from a real folder; one logical piece of work with several homes; a real DOCX edited without harm; humans and AI in one surface; the AI operating the product while you follow it; the command surface deepening on demand; the reveal on the **real product shell**.
3. The reveal uses the live product (D19) — real components, real shell, no mock. If a mock shell still exists, delete it.
4. Performance: demand-driven R3F, no idle loops, scene assets budgeted, smooth-scroll trace captured, mobile behaviour honest.
5. Copy: the landing says only true things about files, privacy and AI authority (D39). No claim the product cannot demonstrate on the same page.
6. Walk the whole story forward and backward; every intermediate frame must be presentable.

## Invariants to uphold

D17 (quiet by default), D18 (one prism family), D19 (landing proves the real product), D21 (no parallel plumbing), D20 (no input cost). One field system, one prism family, one motion grammar — with deletions in this mission, not deferred.

## Out of scope

New product capability · copy for marketing beyond the landing itself · multiplayer stress (N12) · any change to sync/fidelity semantics (if motion reveals a semantic bug, log it and route it to N12).

## Acceptance gates

1. One field implementation (grep proof); `FIELD.md` committed; rest/active/mid-animation shot pairs across at least six surfaces including Library, an editor, the dock, settings and a sync-state change; idle-rAF and active-frame traces committed.
2. One prism family (grep proof); prism shown as mark, loader, dock slot and landing stage; the hero→dock track demonstrated; no re-measure-per-frame (trace note).
3. Motion inventory in the log: interaction class → treatment → files, covering all classes in W3, each with mid-transition frames.
4. AI motion evidence: a Follow AI run across three routes with continuous cursor presence, plus the unfollowed-actor case showing presence without viewport disturbance.
5. Sync/file motion evidence: Saving→Saved locally→Synced, a conflict appearing, an unavailable replica, a Bridge reconnect — each captured mid-transition and each calm.
6. Landing: full story walk forward and backward captured; the reveal proven to be the real shell (side-by-side with the running app); smooth-scroll performance trace; reduced-motion pass; mobile pass.
7. Reduced-motion verified product-wide; both colour schemes verified on every changed surface.
8. P0 and P12 unaffected (fresh runs); no regression in keystroke latency (spot trace).
9. STATE gains a field/prism/motion/landing section with per-class VERIFIED entries; mission log ≤40 lines; close-out checks green.

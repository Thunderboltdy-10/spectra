# M6 — THE FIELD

**Agent:** Designer · **Prerequisites:** M5 verified

## Objective

Build Spectra's signature ambient layer: **one** fine-grain dot-field system spanning the entire product (and consumable by the landing), alive to real activity, nearly invisible at rest, and effectively free when idle. This replaces all three existing implementations.

## What exists (consolidate, then delete the rest)

- `src/features/spectra/field/grain-renderer.ts` + `grain-field.tsx` — GPU fragment-shader halftone (landing).
- `src/features/spectra/field/surface-field.tsx` — CSS lattice, only wired into Live Dock + cards.
- CSS lattice fragments in `globals.css`.
- Reference for feel (not code): `ai-education-workspace-landing-page/src/webgl/stage.ts` — fullscreen shader plane, per-pixel halftone, `cell: 11px`, staggered rows, pointer proximity `exp(-d/150)`, prism push/shadow, 4-stop tint palette, clip-rect reveal. **Pablo finds even this too spacious — go finer.**

## The design (CANON D17 is binding)

1. **Grain spec:** cell pitch ~6–8px (test 5–9), dot radius 0.5–1.1px, staggered, subtly modulated (never graph paper), density gradient capability (denser toward surface edges/corners and toward activity) — the goal is a *grain-like gradient material*, not a dot matrix. Resting visibility 2–5% — present across the whole surface (kill the corner-only bias failure mode, STATE F1), yet unnoticeable until pointed out.
2. **Architecture — shared clock, clipped surfaces:** one field coordinator (single shared phase/time source, global reduced-motion/idle state, palette semantics). Surfaces subscribe declaratively:
   - **Level 1 (cards/panels/menus):** pure CSS/SVG mask driven by shared CSS variables — zero JS per surface, zero rAF.
   - **Level 2 (documents, studios, dock, calendar, workbench):** one canvas/GPU layer per *visible major surface*, supporting multiple simultaneous local influence regions (two AI edits + one human selection = three local wakes in one document).
   - **Level 3 (landing environment):** the same renderer at environment scale — M7 consumes it; build the API now (mood, influences, clip, pointer, prism inputs).
3. **Activity wiring (the hard, valuable part):** the field reacts to *real product signals*, locally:
   - AI editing: warm actor-colored trail behind the caret/action, fading 500–900ms after.
   - Human presence/selection: subtle identity-tinted wake at the collaborator's locus.
   - Drag/resize: compression under the moving object, relaxing wake behind.
   - Run states in dock/cards: waiting = decelerated + slightly compressed; success = one restrained convergence pass; failure = small local coral discontinuity.
   - Active/pinned/selected surfaces: quiet structural shift (e.g. corner densification), not color shouting.
   Source these from the existing presence/run/interaction systems — do not invent parallel event plumbing (CANON D21).
4. **Budgets (acceptance criteria):** idle product = zero field rAF/GPU work (verified flat trace); active field ≤ ~2ms/frame on the dev machine; off-screen/hidden surfaces provably paused; reduced-motion honored.

## Delivery order

1. Build the coordinator + renderer with a dev harness page (all levels, influence debugging).
2. Integrate Level 1 product-wide via the shared card/panel primitives (one integration point, not 50 call sites).
3. Integrate Level 2 into: Document studio, Live Dock, Quick Chat, Calendar, Library/Workspace cards, then remaining studios.
4. Wire activity signals; tune per-surface subtlety at realistic content density.
5. Delete `surface-field.tsx`, old `grain-field` mounts, and the CSS lattice fragments; migrate the landing mount to the new API (visual parity is enough — M7 does the landing tuning).
6. Full pass: walk every route and screenshot the field at rest and mid-activity (intermediate captures mandatory).

## Acceptance criteria

1. Flow F passes everywhere: field present at rest at correct subtlety on every bounded surface; wakes locally for AI edit, selection, drag, success/failure; idle trace flat. Golden Flows 0–12 unaffected (esp. Flow 12 budgets).
2. One implementation remains in the repo (grep proves it); STATE.md updated (F1 resolved, new "Field" section with per-surface verification).
3. Evidence set in `.shots/missions/M6/` incl. rest/active/mid-animation pairs per major surface, and performance traces.
4. A short `FIELD.md` beside the code: the API, the budgets, and the tuning values per surface level.

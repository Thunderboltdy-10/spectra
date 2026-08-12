# M8 — MOTION

**Agent:** Designer · **Prerequisites:** M7 verified

## Objective

A product-wide motion pass: every state change in Spectra transitions with intent — communicating cause, ownership, continuity and hierarchy — with zero performance cost to interaction. This is the brief in `SPECTRA_LANDING_ULTIMATE_IMPLEMENTATION_PROMPT.md` §29, applied to the whole product on the now-stable, field-equipped foundation.

## Method

1. **Motion grammar first.** Consolidate the existing `motion/` tokens into a small documented grammar (durations, easings, choreography rules, reduced-motion behavior) aligned with the charter's taste notes. One grammar; all surfaces consume it. Delete unused motion code.
2. **Sweep by interaction class**, not by page:
   - Surfaces: panel/inspector open-close, side-panel → fullscreen transfer, tab selection, workbench pane resize, tile add/remove, route transitions.
   - Runs: Live Dock state transitions (working → needs-input → completed/failed), required-input expansion, streaming reveal cadence (controlled, readable — never sluggish), run completion resolving with the field's convergence pass.
   - Editing: hover/focus/pressed/selected states, selection toolbars, slash menus, drag/resize (incl. calendar blocks, presentation objects, sheet charts), reference collapse/expand morphs, comment anchor pulses.
   - AI & collaboration: cursor travel, caret handoff, held-control states, waiting states, follow transitions — coordinated with field wakes (motion and field must feel like one system, not two effects).
   - Feedback: empty-state entrances, loading (prism loader integration), error appearance/recovery.
3. **Intermediate-frame audits.** For each interaction class, capture mid-transition screenshots; anything ugly halfway is broken.
4. **Performance guardrails:** compositor-only properties wherever possible; no transition may delay input response; reduced-motion honored globally; Flow 12 budgets hold.

## Rules

- No decoration motion: if it doesn't communicate state/cause/ownership/hierarchy, don't add it (charter taste notes govern).
- No per-card hover-float, no generic glow, no bouncy springs, no full-surface flashes (brief §29/§30 avoid-lists).
- Landing inherits improvements automatically through shared components — spot-check it, don't fork it.

## Acceptance criteria

1. A motion inventory in the mission log: interaction class → treatment → files, with before/after notes for the worst offenders.
2. Mid-transition evidence set in `.shots/missions/M8/` for every interaction class.
3. All Golden Flows pass; Flow 12 traces show no regression; reduced-motion verified.
4. STATE.md gains a "Motion" section with per-class VERIFIED entries.

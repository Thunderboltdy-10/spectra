# Workspace Architecture

## Primary Source of Truth

**[`WORKSPACE_FOUNDATION_V2.md`](<local-workspace>

This is the governing document for all implementation. It synthesizes the three approach explorations into one coherent direction: Magnetic Surface (B) as the primary shell, informed by Semantic Constellations (A) for overview identity and relationship language, and Focal Lenses (C) for focus choreography and transition polish.

**The three-way shell toggle is not the product direction.** The approach files below are research records and inspiration sources. V2 is the build target.

## File Status

| File | Status | Purpose |
|---|---|---|
| [`WORKSPACE_FOUNDATION_V2.md`](./WORKSPACE_FOUNDATION_V2.md) | **ACTIVE — build from this** | Synthesized source of truth |
| [`FOUNDATIONS.md`](./FOUNDATIONS.md) | Reference | Shared engine rules (superseded by V2 Section 5–11) |
| [`APPROACH_B_MAGNETIC_SURFACE.md`](./APPROACH_B_MAGNETIC_SURFACE.md) | Reference | Primary approach — the structural foundation |
| [`APPROACH_A_SEMANTIC_CONSTELLATIONS.md`](./APPROACH_A_SEMANTIC_CONSTELLATIONS.md) | Reference | Overview identity inspiration |
| [`APPROACH_C_FOCAL_LENSES.md`](./APPROACH_C_FOCAL_LENSES.md) | Reference | Focus choreography inspiration |
| [`WILDCARD_D_STRATA_CANVAS.md`](./WILDCARD_D_STRATA_CANVAS.md) | Reference | Future option if 2D overview still fails |
| [`DECISION_MATRIX.md`](./DECISION_MATRIX.md) | Reference | Original decision rationale |
| [`BACKEND_AND_EVOLUTION.md`](./BACKEND_AND_EVOLUTION.md) | Reference | Backend gaps and evolution model (incorporated into V2) |
| [`IMPLEMENTATION_GUARDRAILS.md`](./IMPLEMENTATION_GUARDRAILS.md) | Reference | Original guardrails (superseded by V2 Sections 11–15) |

## Core Non-Negotiables (from V2)

- One coherent workspace direction, not three parallel shells
- Explicit-click-only state transitions — no scroll-to-enter, no proximity-triggered camera movement
- Command surface is a singular special object, not a toolbar
- Hub is a viewport-overlay utility layer, not a canvas workstream node
- Strong scale separation between overview and focused states (2.5–4× zoom difference)
- Widgets are real rendered entities (strips, sheets, modules) — not repeated card containers
- AI always shows provenance and always allows one-click revert
- No new workstream created without explicit user confirmation

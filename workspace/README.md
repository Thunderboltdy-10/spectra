# Workspace Architecture

This folder breaks the workspace redesign into a shared engine plus distinct UX shells.

The key decision is simple:

- one canvas engine,
- one widget/artifact system,
- one right push-panel system,
- three materially different workspace shells,
- one optional wildcard for future exploration.

## Files

- [`FOUNDATIONS.md`](<local-workspace>
  Shared rules across every shell.
- [`APPROACH_A_SEMANTIC_CONSTELLATIONS.md`](<local-workspace>
  Overview-first, relationship-heavy, more atmospheric.
- [`APPROACH_B_MAGNETIC_SURFACE.md`](<local-workspace>
  Recommended. Central active workspace, hidden edge utilities, strong focus.
- [`APPROACH_C_FOCAL_LENSES.md`](<local-workspace>
  More guided and premium, using lens behavior to focus and dim.
- [`WILDCARD_D_STRATA_CANVAS.md`](<local-workspace>
  Optional future direction if 2D macro-navigation remains unsatisfying.
- [`IMPLEMENTATION_GUARDRAILS.md`](<local-workspace>
  What to build, what not to break, and how previews should be structured.
- [`DECISION_MATRIX.md`](<local-workspace>
  The critical review: what works, what fails, and why one shell should lead.
- [`BACKEND_AND_EVOLUTION.md`](<local-workspace>
  The codebase-grounded rules for workspace growth, memory, embeddings, and AI creation.

## Shared Interpretation

These files assume the following:

- The infinite canvas remains the main workspace world.
- The hub is a utility layer, not a normal workstream.
- Threads and documents still rely on the right push-panel.
- AI can create by default, but users can revert immediately.
- Customization exists, but only inside curated layout rules.
- Students and teachers use the same model with different defaults and data.

## Recommendation

If only one shell becomes production-first, it should be [`APPROACH_B_MAGNETIC_SURFACE.md`](<local-workspace>

It best fits the current product direction and the feedback you gave:

- hidden-but-reachable utilities,
- dominant active workspace,
- preserved infinite canvas,
- strong right-panel story,
- less card-heavy presentation,
- less risk of the UI collapsing into a bottom-toolbar product.

Read [`DECISION_MATRIX.md`](<local-workspace> before implementation. It is intentionally harsher than the approach files.
Read [`BACKEND_AND_EVOLUTION.md`](<local-workspace> too. It captures the backend and orchestration implications that the shell docs alone do not.

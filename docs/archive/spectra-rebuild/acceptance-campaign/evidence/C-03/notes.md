# C-03 Quick Chat context trigger

**Date:** 2026-07-24  
**Grade:** pass (target: excellent vs refs 01/05/09)

## State

`ContextFocusControl` already implements compact `size-9` square icon-only trigger with tooltip/`aria-label`, brand dot badge when non-default, popover unchanged.

## Verification (Tab P, workspace home + split document)

- Composer shows **Choose AI focus** button (no label/chevron strip).
- With artifact focused: label **Online Confirmation + 2 focus items**; badge implied by a11y description.
- `command-bar.tsx` wraps context in minimal `self-end` container (no bordered left strip).

## Residual

- Side-by-side pixel compare to reference composer treatments not run (reference assets path not present in workspace checkout).

# C-06 Scale, typography, density

**Date:** 2026-07-24  
**Grade:** pass (partial sweep)

## Repairs this session

- `workspace-shell.tsx`: People count chip `text-[10px]` → `text-[11px]`.
- `StudioTabRail`: 12px tab labels (already in place).
- `globals.css`: `prefers-reduced-motion` static AI highlight (see C-10).

## Residual (RC-10)

- Many `text-[8px]`–`text-[10px]` remain in `durable-run-tabs`, `result-card`, `managebac-integration-shell` (ManageBac surface — avoid broad edits during H/C-09).
- Hard-coded `bg-[#fbfaf8]` only in ManageBac modals.

## Next

- Tokenized micro-type scale for shell/studio only; artifact editor width at 1920×1080 pass.

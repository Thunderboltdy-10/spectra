# C-02 Rail tabs and + placement

**Date:** 2026-07-24  
**Grade:** pass (target: excellent after 8/15-tab stress screenshots)

## Repairs

- `StudioTabRail`: tab scroller `inline-flex w-max max-w-full` so the cluster sizes to content; `+` stays adjacent to last tab instead of flex-stretching across the header.
- `app-shell.tsx`: `#spectra-shell-tab-slot` uses `flex items-center overflow-hidden` for correct portal alignment.

## Verification

- Tab P Mission Control: a11y tree shows **Home** tab immediately followed by **Open a new home view** (`+`) in the shell header (uids 21_74–21_76).
- Tab buttons use `min-w-[120px]`, `text-[12px]` (prior RC-10 10px rail fix).

## Not yet exercised

- Tab counts 3, 8, 15 with horizontal scroll and reorder (if supported).

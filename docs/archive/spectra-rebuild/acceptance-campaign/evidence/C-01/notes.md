# C-01 Overflow-menu rationalization

**Date:** 2026-07-24  
**Grade:** pass (target: excellent after code-studio/sheets menu labels)

## Inventory

| Site | Before | After |
|------|--------|-------|
| `app-shell.tsx` header | (prior) `spectra:page-more` | Removed earlier; no shell three-dot in Tab P snapshot |
| `artifact-studio.tsx` studio chrome | History in overflow | Dedicated **Version history** `IconButton` with `History` icon |
| `workspace-shell.tsx` `WorkspaceHeader` | (prior) overflow | **Workspace settings** `PencilLine` icon button |
| Document toolbar | `MoreHorizontal` | **More formatting options** uses `SlidersHorizontal` (grouped popover retained) |
| Flashcard deck | `MoreHorizontal` only | **Templates** button with `LayoutTemplate` + label (menu: templates, prefs, export) |
| `code-studio.tsx` | `MoreHorizontal` | Grouped import/export menu (legitimate); still three-dot — relabel follow-up |
| `sheets-studio.tsx` | `MoreHorizontal` | Grouped formatting menu (legitimate) |

## Verification (Tab P, 1920×1080, localhost:3000)

- Opened document split studio: header shows Share, Comments, Embeds, Details, Expand, **Version history**, Close — no orphan overflow.
- Version history opens comparison overlay (see C-08 note).
- QC composer: no page-level three-dot.

## Repairs this session

- Deck menu trigger → `LayoutTemplate` + "Templates" label.
- Document toolbar overflow icon → `SlidersHorizontal`.

## Retest

- Click every remaining grouped menu item in code studio and sheets when touching those files.

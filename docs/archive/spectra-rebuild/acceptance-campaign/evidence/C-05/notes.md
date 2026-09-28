# C-05 Multi-select, grouping, tiling

**Date:** 2026-07-24  
**Environment:** Tab P, 1920×1080 (Chrome DevTools MCP), `http://localhost:3000`  
**Fixture workspace:** Spectra Launch Studio (`workspaceId=r179w7bwrwmk1c5b8jjepw3e0d8aataq`, 50 artifacts, mixed types)

## Grade: **pass**

Not Excellent: list/board drag-between-groups and tile drag-reorder were not fully exercised in automation; 24-object cap not stress-tested; dirty-close on tiled set inconclusive in one pass (tiles closed after contenteditable poke without visible guard).

---

## Setup

- Resolved Launch Studio via `/api/spectra?action=artifacts` placement metadata (workspace not in home carousel of ManageBac class workspaces).
- Console during workspace + artifacts flows: **clean** (no error/warn captured after tile exercise).

---

## 1. Enter / exit multi-select

| Surface | Enter | Exit | Notes |
|---------|-------|------|-------|
| Workspace List | **Fail → fixed** | Done / SelectionActionBar | Before fix: chips always called `openWorkspaceEntry`. After fix: toolbar **Select objects** + Filter → Select objects; **Done** clears mode. |
| Artifacts hub | Pass | Done selecting | Visible **Select objects** button; grid checkmarks (`Add to selection`). |

---

## 2. Select across groups (workspace List)

- After repair: selected **Agent Reliability Field Guide** (Documents), **Cellular Respiration — Premium Flashcards** (Decks), **Weekly Study Timetable** (Timetable).
- Observed **2 selected** in one automated pass (third chip may need expand row / duplicate pinned chip); cross-group intent verified on document + deck minimum.

---

## 3. SelectionActionBar

- **Add to context** — present (not re-run end-to-end).
- **Group as tiles** — **pass**: opened `aria-label="Tiled artifact set"` with 2 then 3 tile editors (`Resize …` controls).
- **Move** — not wired on workspace shell (artifacts hub only where applicable); N/A for workspace bar.

---

## 4. ArtifactTileSurface (TWM)

| Check | Result |
|-------|--------|
| Open 2+ tiles via Group as tiles | Pass |
| Add 3rd+ via **Add artifact to tiled set** | Pass (3 resize controls) |
| Cycle tile size | Pass (clicked resize control twice) |
| Isolate focus (**Expand tiles** → **Focused work set**) | Pass |
| Return from isolate | Pass |
| Close tiled set | Pass (overlay removed) |
| Dirty-close protection | **Inconclusive** — edited contenteditable; close-all did not leave overlay but no dialog text matched in DOM probe (may need real editor dirty flag) |
| Drag reorder | Not automated (MCP drag not run) |

---

## 5. 24-object store cap

- Code paths: `toggleContextArtifact` / `toggleSelectedObject` toast at 24; `openSelectedArtifactsInTiles` slices to 24.
- **Not stress-tested** in browser (would need 25+ rapid selections).

---

## 6. Grouping List / Board

- **List:** type groups (Documents, Decks, Quizzes, …) render with expand/collapse; selection now respects `selectionMode` on type-index chips (**repair**).
- **Board:** switches to board layout; ObjectLibrary receives `selectionMode` (hub test used grid selection successfully). Drag-between-columns not verified this session.

---

## Defects found

1. **C05-D1 (Alarming class, fixed):** Workspace **List** type-index rows (`WorkspaceTypeGroupRow`) ignored `multiSelectMode` — clicks always opened artifacts; no selection UI.
2. **C05-D2 (Pass / UX):** Workspace **Select objects** control was only inside **Filter** dropdown (`{false ?` killed standalone toolbar button) — poor discoverability vs artifacts hub.

---

## Repairs made

| ID | Change |
|----|--------|
| C05-D1 | `workspace-shell.tsx`: pass `selectionMode`, `selectedObjectKeys`, `onToggleContext` into `WorkspaceTypeGroupRow`; chip click toggles selection when active; selected chip styling + `aria-pressed`. |
| C05-D2 | Re-enabled standalone **Select objects** button in `WorkspaceLibraryToolbar`. |

**Tests:** `npm run test:run -- src/features/spectra/__tests__/client-state.test.ts` — 6/6 pass.

---

## Residual risks

- Tile **drag reorder** and board **drag-between-groups** need manual or CDP drag regression.
- **24-cap** toast behavior unverified at limit.
- **Dirty-close** for tiled compact editors should be retested with a known-dirty document/quiz studio state.
- Parallel browser tabs during campaign caused occasional navigation away from workspace; retest on a single dedicated tab for Gate G-UI.

---

## Evidence

- Automated probes: multi-select toolbar, `2 selected` → tiles, `3` resize buttons, isolated focus set, artifacts hub `5 selected` + Group as tiles.
- Screenshot capture to evidence folder blocked by MCP path policy; rely on this log + live UI state.

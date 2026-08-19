# N1 — THE ORGANIZED WORLD

**Charters:** Foundation Engineer + Product Engineer
**Prerequisites:** none (Nova opener)
**Architecture:** ARCHITECTURE-STORAGE §1, §3, §11–12 (primary); skim the rest
**Evidence:** `.shots/missions/N1/` · Tier R for migration, Tier P for UI

## Objective

Replace flat placements with the organizational tree; make Library feel like an excellent Spectra filesystem with one primary hierarchical view; give Workspace exactly List + Board; eliminate "Unplaced" via General; finish the one-shell consolidation by *replacing* the two old shells with the new surfaces; reconcile M4's real state into STATE honestly. At the end, Spectra's organizational world is the one the Bridge (N3) will pour real files into.

## Why now

Every later mission depends on where things live: the Bridge needs a tree to project mounts into, policies need nodes to inherit through, AI organization needs real folders to operate on. And M4's unfinished shell merge means the Library/Workspace frontend must be rebuilt anyway — do it once, on the new model.

## Workstreams (ordered)

### W1 — M4 reconciliation (Tier P, ≤ one day)

1. Run Golden Flows P0–P12 once against the current build; record honest statuses + evidence in `STATE.md`.
2. Close or re-own each item in STATE §1 (E9 verify, E11 decide: migrate the 4 hidden timetable artifacts' 21 events into `/calendar` data and delete the artifacts, or surface them as legacy resources — decide by inspecting their content, prefer migrate-and-delete).
3. Append the missing mission log to `docs/spectra-hq/missions/M4-one-product.md` (historical closure; last HQ write ever).

### W2 — The tree (Tier R)

1. Implement `orgNodes` per ARCHITECTURE-STORAGE §3 exactly: kinds, single primary placement, `link` nodes, fractional `orderKey`, transactional `workspaceContextId`, cycle validation, soft-delete/trash.
2. Server API: create/move/rename/delete/link, list-children (paginated), subtree queries, search-by-name; **server-side validation on every write** (charter rule).
3. Create **General** per account (undeletable workspace node). Wire creation-time placement: created-in-workspace → there; else General; threads included (D31). Update every creation path (`spectraArtifacts:create`, run-route artifact ops, thread create) — grep for `workspaceId` optionality and kill the "nothing" outcome.
4. **Migration** per §11.1: dry-run on copied data, count invariants, cutover, replace all `spectraWorkspaceItems`/`placements`/`placementStatus` call sites, delete the old table + code paths. Existing routes/share links/embeds untouched.

### W3 — Library as filesystem (Tier P)

1. One primary hierarchical view replacing the collections-and-cards model: real folder navigation (tree rail + row surface, or an equally serious single-surface design — your taste, Spectra's language), breadcrumbs, drag-move, inline rename, multi-select, keyboard navigation (arrows/Enter/F2-equivalent/Delete), context menus, new-folder/new-work-here.
2. Workspaces render as distinct folder-like nodes (workspace icon/state), movable, nestable; opening one enters its context (D32). Threads appear as placeable items.
3. Useful survivals from the old Library (Recent, Shared, Favorites, type filtering) become filters/quick views over the tree, not competing organizational systems.
4. Search: name/title/metadata over the tree, presented so semantic retrieval can later slot in without redesign (one search surface, provider-swappable behind it). Semantic search itself is **out of scope**.
5. Virtualize; N1 gate at 2k nodes without jank.

### W4 — Workspace List + Board; Canvas removed (Tier P)

1. List = the workspace's subtree, same interaction grammar as Library (it *is* the same underlying world, scoped).
2. Board = cross-hierarchy visual view: at `/workspace` root grouped by workspace; inside one workspace, all its work regardless of folder path, with the current board's useful filtering/grouping (by type, updated, etc.) preserved/improved after inspection. Child-workspace contents never merge into the parent (D32); the child appears as one entry.
3. Remove Canvas as an organization mode everywhere (Library + Workspace): delete `WorkspaceCanvasView`, `ArtifactsCanvas`, canvas layout fields' UI paths (schema fields may remain tombstoned for migration cleanliness — note in log). Persisted view prefs migrate canvas→list.
4. One shell: the new Library/Workspace surfaces share one implementation with route-level scoping; `workspace-shell.tsx` and `artifacts-shell.tsx` are deleted or reduced to thin route configs. Session continuity (tabs, splits, open threads, running AI) survives Library⇄Workspace exactly as today or better (P10).

### W5 — Live identity everywhere (Tier P)

Rename/move/metadata changes propagate to every open surface in place — open artifact header, tabs, splits, Library rows, Board cards — no remount, no lost scroll/state (D40). Build the shared subscription selectors now; every later mission relies on them.

## Invariants to uphold

I1 (no duplicate identities), I4 (moves are metadata transactions), I5 (no cycles), D29–D32, D40. Typing path untouched (D20).

## Out of scope

Bridge/local files (N3) · sync policies beyond the schema stub (N6) · command surface (N2) · semantic search · AI placement intelligence beyond the deterministic rule (N8) · visual perfection (N10).

## Acceptance gates

1. Migration: dry-run + cutover logs; count invariants pass; zero orphans; old table and old placement code deleted; existing share/embed/route IDs verified working (spot-check evidence).
2. P0–P12 pass on the new surfaces (P-flow amendments noted in PLAYBOOK §4).
3. Library: create/rename/move/delete folders, drag work between folders, nest a workspace inside a folder and inside another workspace, open it as its own context — all evidenced with screenshots including mid-drag frames.
4. No "Unplaced" anywhere: new work with no context lands in General (evidence: create from chat with no workspace → appears in General).
5. Canvas gone; List/Board only; board grouping evidence at root and inside a workspace.
6. Session continuity evidence (P10) across the new shells.
7. 2k-node Library scroll/navigation smooth (P12 note + trace if suspicious).
8. STATE updated (including §1 reconciliation complete); mission log ≤40 lines; close-out checks green.

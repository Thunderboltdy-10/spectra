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
4. Search: name/title/metadata over the tree, presented so semantic retrieval can later slot in without redesign (one search surface, provider-swappable behind it). Semantic search itself is **out of scope**. "One search surface" is literal: **one component**, used by Library, Workspace List and Board alike (D41) — not one design reimplemented per view.
5. Virtualize **and** page (D42): the surface asks the server for a window of children and pages as the reader scrolls. Opening a folder of hundreds of items costs one page, not the folder. N1 gate at 2k nodes without jank, with the request count to prove the 2k were never all fetched.

### W4 — Workspace List + Board; Canvas removed (Tier P)

1. List = the workspace's subtree, same interaction grammar as Library (it *is* the same underlying world, scoped).
2. Board = cross-hierarchy visual view: at `/workspace` root grouped by workspace; inside one workspace, all its work regardless of folder path, with the current board's useful filtering/grouping (by type, updated, etc.) preserved/improved after inspection. Child-workspace contents never merge into the parent (D32); the child appears as one entry.
   - **Columns are windowed queries, one per column** (D42, ARCHITECTURE-STORAGE §12): each column asks for its own first page with a server-side count for its header, and pages independently as it is scrolled. Changing the grouping changes the queries; it never re-partitions a fetched array. Switching List⇄Board over one scope re-fetches nothing.
   - **Columns fit the frame** (D44): the board row fills the viewport height, each column scrolls its own cards, and the page never scrolls. Cards size to their content (`grid-auto-rows: max-content` — an `auto` row in a definite-height overflowing container collapses to min-content).
   - **Each column carries its own identity colour**, derived from what the column *is* (the workspace's colour, the type's colour from the work registry, the folder's accent) so the grouping is legible at a glance — accent, not decoration.
   - **Each column ends in a create affordance that inherits the column** (D43): in a board grouped by type, the type is already decided, so it asks only where to file the new work; grouped by workspace or folder, the location is decided, so it asks only for the type. Neither ever asks for both, and the new work appears in that column.
3. Remove Canvas as an organization mode everywhere (Library + Workspace): delete `WorkspaceCanvasView`, `ArtifactsCanvas`, canvas layout fields' UI paths (schema fields may remain tombstoned for migration cleanliness — note in log). Persisted view prefs migrate canvas→list.
4. One shell: the new Library/Workspace surfaces share one implementation with route-level scoping; `workspace-shell.tsx` and `artifacts-shell.tsx` are deleted or reduced to thin route configs. Session continuity (tabs, splits, open threads, running AI) survives Library⇄Workspace exactly as today or better (P10).
5. **One chrome for both views** (D41). List and Board are two views of one scope, so they share one toolbar row containing the same components in the same places: the view switch, the search, the type filter, the grouping control, the create menu, the selection toggle, and the rail/sidebar collapse — available from both views, named once. A control that exists on only one view (inline rename, board grouping) stays there and is named in the log. Specifically forbidden: a second search box, a second "New", the same job under two names, or two dropdowns in one row with two different visual treatments.


### W5 — Live identity everywhere (Tier P)

Rename/move/metadata changes propagate to every open surface in place — open artifact header, tabs, splits, Library rows, Board cards — no remount, no lost scroll/state (D40). Build the shared subscription selectors now; every later mission relies on them.

## Invariants to uphold

I1 (no duplicate identities), I4 (moves are metadata transactions), I5 (no cycles), D29–D32, **D41–D44 (one chrome, bounded reads, inheriting creation, viewport framing)**, D40. Typing path untouched (D20).

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
8. **One chrome (D41):** the reuse audit from PLAYBOOK §5 is in the mission log — every control on List and Board inventoried, each shared one named as a single component, each view-only one justified. Screenshot evidence shows the same toolbar row on both views with the switch in the same position, and the sidebar collapse reachable from both.
9. **Bounded reads (D42):** Network-panel evidence for Library, List and Board at first paint, on scroll, and across a List⇄Board switch on the largest available workspace — request count and largest payload recorded in the log, no request returning a whole collection, no re-fetch on view switch, counts served by aggregates.
10. **Board columns (D43/D44):** evidence of full-height columns with independent scrolling and no page overflow, per-column identity colours, and the per-column create affordance used twice — once on a type-grouped board (asks location only) and once on a workspace-grouped board (asks type only), with the new work landing in that column.
11. STATE updated (including §1 reconciliation complete); mission log ≤40 lines; close-out checks green.

## Mission log — 2026-08-20

- Accepted by Pablo after the completed N1 implementation/final surface pass; evidence root `.shots/missions/N1/`.
- W1: reconciled M4; legacy Timetables remain visible resources with idempotent Calendar migration; Foundry publishes compiled instructions.
- W2: `orgNodes` is the sole organization model; migration/integrity evidence is `w2-tier-r-evidence.md`; General is deterministic and undeletable.
- W3: one filesystem organizer supplies tree rail, breadcrumbs, paging, search, quick views, rename, drag/move, trash and creation.
- W4: List/Board are route scopes of one shell; Canvas UI paths are gone (schema values remain migration tombstones).
- W5: one bounded `liveIdentities` subscription covers open work, threads and workspaces without remounting editors.
- D41 inventory: shared `SurfaceViewSwitch`, `SurfaceSearch`, `SurfaceTypeFilter`, `SurfaceNewMenu`, `SurfaceRailToggle`; List-only sort/rename; Board-only grouping.
- D42: child/filter/sort pages use selective indexes; board columns page independently; exact headers use three transactional Aggregate components.
- D43: type columns ask destination only; workspace/folder columns ask work type only; workspace creation inherits the active parent.
- D44: the board owns remaining frame height; horizontal board and vertical columns scroll independently.
- Aggregate backfill completed idempotently for 569 nodes; future node writes are trigger-maintained in the same transaction.
- Verification: focused N1 gate 52/52; `tsc`, lint and secret scan green.
- Full-suite baseline: 720/724; four unrelated failures logged in STATE for N2/N10/N11 rather than expanded into N1.

# Wave 2B UI Source-of-Truth Implementation Plan

Generated on 2026-06-18 before implementation.

## Position

Wave 2B is the corrected Wave 2 UI foundation. It is not Wave 3.

Wave 0 reset the active architecture. Wave 1 made the data and persistence path real. Wave 2 identified the workspace UX direction but did not yet implement the approved visual source of truth. Wave 2B exists to make `/workspace` and `/artifacts` match the six approved UI screenshots closely enough that future backend and AI work can build on a stable product surface.

Wave 3 remains artifact blueprint/detail experiences after this foundation is implemented.

## Visual Source of Truth

The six screenshots in `docs/spectra-rebuild/ui-source-of-truth/` are the visual contract:

- `01_workspace_cards_overview.png`: selected workspace cards overview, workspace rail, right overview inspector, command dock, activity tray.
- `02_workspace_timeline_run_inspector.png`: timeline view with selected run inspector.
- `03_artifacts_library_grouped_list.png`: artifact library grouped/list view with inbox and workspace groups.
- `04_workspace_cards_selected_artifact.png`: cards view with selected artifact inspector and linked artifacts.
- `05_workspace_canvas_soft_clusters.png`: canvas view with soft clusters, central selected object, seeded object links.
- `06_artifacts_board_columns.png`: artifact board columns by workspace.

The implementation should preserve the existing Spectra shell/sidebar and theme identity while using these screenshots for density, hierarchy, navigation structure, object treatment, inspector behavior, and command/activity surfaces.

## Scope

### `/workspace`

- Keep the global app sidebar unchanged.
- Add/finish the workspace rail with Home and workspace icons.
- Home state is the default when no workspace is explicitly selected.
- Selected workspace state has Cards, Timeline, Library, and Canvas navigation.
- Cards view represents both the broad overview and the selected-artifact card board.
- Timeline view supports selected run/activity inspector state.
- Canvas view shows soft subject clusters and seeded object relations without becoming a full graph editor.
- Inspector states:
  - workspace overview/no selection
  - selected artifact
  - selected run/activity
- Bottom command dock and compact activity tray are part of the primary surface.
- Selection changes inspector state.

### `/artifacts`

- Support grouped/list/library view from screenshot 03.
- Support board/column view from screenshot 06.
- Keep a grid/card mode only if useful as a secondary organization mode.
- Add a clear compact view switcher.
- Unplaced artifacts show Add to workspace.
- Placed artifacts show Open, Move, and remove-placement style actions instead of a generic Add.
- Controls remain compact and progressively disclosed.

### Demo Data

Seed safe local/demo data through the existing Spectra Convex path:

- workspaces: Biology, Maths EE, Spectra, Economics, English
- documents, decks, quizzes, tasks, thread references
- unplaced and placed artifacts
- pinned/active items
- timeline events and run/result-card examples
- selected inspector examples
- canvas relation/link examples

The route should avoid polluting production data with demo records.

## Object Links and Relations

The canvas screenshot introduces object/artifact links as a product primitive. This wave only needs enough relation implementation to display seeded relations in Canvas and Inspector.

Wave 2B should not build:

- AI-assisted relation suggestions
- autonomous link generation
- graph algorithms
- advanced canvas focus spaces
- semantic zoom

Later work should promote object links into a durable primitive with provenance, relation type, directionality, and AI/user origin.

## Component Targets

Avoid a single giant page by extracting or updating reusable components under `src/features/spectra/**`:

- workspace rail
- workspace header
- view navigation
- cards view
- timeline view
- canvas view
- artifact library grouped/list view
- artifact board columns
- inspector
- command dock
- activity tray
- artifact/object cards
- relation display
- shared icons/accent/theme utilities

## Validation

Manual testing should cover:

- `/workspace` opens to Workspace Home.
- Selecting Biology shows Cards view matching screenshot 01.
- Cards selection shows selected artifact inspector matching screenshot 04.
- Timeline selection shows selected run inspector matching screenshot 02.
- Canvas shows calm clusters and seeded relation display matching screenshot 05.
- `/artifacts` grouped/list view matches screenshot 03.
- `/artifacts` board view matches screenshot 06.
- Add/remove/move basics still work.
- Command dock and activity tray look intentional even before real AI execution.

## Wave Boundary

Wave 3 should not begin if the core UI regresses. Future feedback can move between waves, but no later wave should proceed by undoing this visual foundation.

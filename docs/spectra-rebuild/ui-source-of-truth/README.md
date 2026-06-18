# UI Source of Truth

These six screenshots are the approved visual contract for Wave 2B. They are not loose inspiration.

Wave 2B is the corrected Wave 2 UI foundation for `/workspace` and `/artifacts`. It is not Wave 3. Wave 3 remains artifact blueprint/detail experiences after this UI foundation is stable.

## Screenshots

- `01_workspace_cards_overview.png`: selected workspace overview, cards, right overview inspector, command dock, activity tray.
- `02_workspace_timeline_run_inspector.png`: timeline activity view and selected run inspector.
- `03_artifacts_library_grouped_list.png`: artifact library grouped/list mode with inbox and workspace groups.
- `04_workspace_cards_selected_artifact.png`: selected artifact cards view with placement, linked artifacts, and quick actions inspector.
- `05_workspace_canvas_soft_clusters.png`: soft clustered canvas and seeded object links.
- `06_artifacts_board_columns.png`: artifact board columns by workspace.

## Implementation Notes

- Preserve the global Spectra app sidebar unless a future product decision explicitly changes it.
- Rebuild only the Spectra workspace/artifact surfaces and shared components needed by those surfaces.
- Keep the existing theme identity, but match screenshot hierarchy, density, command dock, inspector behavior, workspace rail, artifact grouping, and canvas softness.
- Object/artifact links are now a planned product primitive. Wave 2B only needs enough relation data to display seeded links in Canvas and Inspector.
- AI-assisted relation suggestions, advanced canvas behavior, focus spaces, lasso, and semantic zoom are deferred.
- Later waves can move based on feedback, but no later wave should proceed if the core UI regresses from this source of truth.

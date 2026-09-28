# Wave 4.5 — Workspace/Object Surface Consolidation

Started on 2026-06-20 and completed as the pre-Wave 5 polish/performance pass on 2026-06-21.

## Product direction

`/workspace` is now Spectra's primary object and context surface. Its global Home is mission control across workspaces, recent artifact activity, unplaced objects, and the shared List/Board object library. Selecting a workspace enters a scoped working room whose default view is Library, with workspace-item pinning, Timeline as real mixed activity, and Canvas kept deliberately simple.

`/artifacts` remains functional for compatibility, but is secondary and deprioritized. New object-surface work should use shared Spectra components and land in `/workspace` first so the two routes do not become competing products.

## Preserved boundary

Wave 4's `AIRun -> Operation -> ResultCard` engine, confirmation policy, persistence, retry behavior, and compact command dock remain the execution backbone. Wave 4.5 changes object presentation and navigation, not orchestration.

## Polish completed

- Rebalanced Home and workspace toolbars: type filters remain left, search/sort/view controls sit right, and Library/Timeline/Canvas remains a compact left-aligned switcher.
- Added useful sort modes: updated, created, title, type, pinned, workspace, and activity where the underlying view supports them.
- Replaced clipped card dropdowns with viewport-aware portalled menus that close on outside click, Escape, scroll, and resize.
- Restyled pinned artifacts as elevated object cards with a restrained warm corner treatment. Pinned work is usable from Home and selected workspaces.
- Reduced Artifact Studio close, expand, and save chrome to exposed lightweight controls.
- Rebuilt Timeline around a left date spine and day-isolated responsive card grids. Artifact activity opens artifacts; run-only activity opens run detail.
- Removed the enclosing Timeline and Canvas borders. Canvas behavior itself remains unchanged.
- Added Home Create Artifact and destination selection. Global creation supports any workspace or Unplaced; workspace creation defaults to the active workspace.

## Performance and data corrections

- Removed automatic demo seeding from normal `/workspace` and `/artifacts` mounts.
- Made seeding idempotent without rewriting existing artifact, placement, and workspace `updatedAt` values. Newly seeded data receives staggered real timestamps.
- Added short-lived client metadata/workspace caches and scoped workspace refreshes. Switching retains the previous surface with a subtle progress indicator instead of blanking the page.
- Removed repeated `/artifacts` overview loads after ordinary artifact mutations.
- Replaced the artifact-placement N+1 query path with workspace-batched placement hydration.
- Added/verified owner/status/update, workspace/update, source, run, artifact, and result-card query indexes.
- Artifact edits now update the artifact, visible placement, and containing workspace activity timestamps together.
- Added schema compatibility for legacy `spectraWorkspaces.pinned`, while seed repair removes it. Pinning belongs only to `spectraWorkspaceItems.viewData.pinned`.
- Locked Spectra runs to `deepseek/deepseek-v4-pro` and added request-level OpenRouter provider routing with `order: ["deepseek"]` and `allow_fallbacks: true`. DeepSeek is attempted first; OpenRouter may use another provider only if it is unavailable. Spectra uses raw REST `fetch`, so the payload intentionally uses the documented snake_case field; OpenRouter's TypeScript SDK equivalent is `allowFallbacks`. See the [official provider-routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection).

## Removal and deletion semantics

- Removing an artifact from a workspace hides that placement and returns the artifact to Unplaced when it has no other visible placement.
- Permanent artifact deletion requires confirmation and deletes its placements and artifact-targeted run history.
- Permanent workspace deletion requires the exact phrase `Remove [workspace name] permanently`.
- Workspace deletion removes its items, runs, operations, and result cards. Artifacts exclusive to that workspace are deleted. Shared artifacts survive in their other workspaces, and their deleted-workspace provenance reference is cleared.
- The UI calls this location Unplaced/Inbox, never Trash.

## Deferred

Full persistent thread artifacts and `/chat` convergence remain Wave 5. Agents, advanced canvas behavior, complex relation intelligence, workspace ordering, and a full Artifact Studio redesign remain out of scope.

Workspace ordering is intentionally deferred to a later UI wave. Workspaces are not pinnable; only artifacts placed inside a workspace can be pinned through `WorkspaceItem.viewData.pinned`.

## Manual acceptance checklist

- Switch rapidly among Home and several workspaces; confirm content does not blank and the slim loading bar is only transient.
- Open Add to workspace near every viewport edge; confirm the menu stays visible, overlays cards, and closes correctly.
- Exercise every sort, type filter, List/Board switch, and workspace scope on `/workspace` and `/artifacts`.
- Create from Home, the command `+` menu, a selected workspace, and `/artifacts`; verify destination defaults and Unplaced behavior.
- Edit and save an artifact; verify Created and Last edited remain distinct and workspace activity advances.
- Remove a placed artifact, then permanently delete it from Unplaced.
- Delete a disposable workspace using the exact confirmation phrase; verify exclusive objects and run/result history disappear while shared artifacts survive elsewhere.
- Open Timeline artifacts and run-only entries, and verify Canvas only lost its outer border.

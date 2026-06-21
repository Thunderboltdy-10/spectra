# Wave 4.5 — Workspace/Object Surface Consolidation

Generated on 2026-06-20.

## Product direction

`/workspace` is now Spectra's primary object and context surface. Its global Home is mission control across workspaces, recent artifact activity, unplaced objects, and the shared List/Board object library. Selecting a workspace enters a scoped working room whose default view is Library, with workspace-item pinning, Timeline as real mixed activity, and Canvas kept deliberately simple.

`/artifacts` remains functional for compatibility, but is secondary and deprioritized. New object-surface work should use shared Spectra components and land in `/workspace` first so the two routes do not become competing products.

## Preserved boundary

Wave 4's `AIRun -> Operation -> ResultCard` engine, confirmation policy, persistence, retry behavior, and compact command dock remain the execution backbone. Wave 4.5 changes object presentation and navigation, not orchestration.

## Deferred

Full persistent thread artifacts and `/chat` convergence remain Wave 5. Agents, advanced canvas behavior, complex relation intelligence, and a full Artifact Studio redesign remain out of scope.

Workspace ordering is intentionally deferred to a later UI wave. Workspaces are not pinnable; only artifacts placed inside a workspace can be pinned through `WorkspaceItem.viewData.pinned`.

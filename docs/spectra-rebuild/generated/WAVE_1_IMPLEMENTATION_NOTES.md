# Wave 1 Implementation Notes

Generated during Wave 1 implementation on 2026-06-17.

## Scope Built

- Added Convex CRUD functions for `spectraWorkspaces`.
- Added Convex CRUD/listing functions for `spectraArtifacts`.
- Added Convex projection functions for `spectraWorkspaceItems`.
- Added an idempotent `spectraSeed:ensureDemoData` mutation for local/demo setup.
- Added `/api/spectra` as the Next.js adapter over the new Convex functions.
- Replaced static `/workspace` cards with live Spectra workspace/projection data.
- Replaced static `/artifacts` cards with live Spectra artifact library/inbox data.
- Added create workspace, create artifact, add artifact to workspace, and remove workspace projection flows.

## Preserved Rules

- Workspace cards are projections only.
- Hiding/removing a workspace card does not delete the artifact.
- Manual/library artifact creation leaves artifacts unplaced by default.
- Workspace-created artifacts are projected into the current workspace by default.
- `/chat` remains untouched in Wave 1.

## Deferred

- Real AI command execution.
- Artifact editor/renderers beyond cards.
- Add-to-workspace picker modal polish.
- Right run/thread hub behavior beyond live counts.
- Chat migration to shared `Thread`/`Message` primitives.
- Full blueprint-specific study/quiz/task experiences.

## Next Wave Candidate

Wave 2 should deepen the artifact library and first blueprint renderers:

- artifact open/detail surface
- blueprint-specific render cards/details for document, deck, quiz, planner task, and thread reference
- more deliberate Add to workspace picker
- basic edit/archive affordances
- library grouping/filter quality

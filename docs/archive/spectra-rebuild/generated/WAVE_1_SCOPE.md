# Wave 1 Scope

Generated after Wave 0 implementation feedback on 2026-06-17.

## Goal

Wave 1 should make the new Spectra foundation real enough to test with data. It should not rebuild AI generation yet. It should prove the object model works:

- create a workspace
- create artifacts
- add artifacts to workspace
- remove/hide workspace projections without deleting artifacts
- show artifact library data from the new tables
- show workspace cards from new projections

## Product Bar

The Wave 0 placeholders are acceptable as skeletons, but Wave 1 should raise the surface quality:

- polished, professional, cosy, and theme-respecting
- subtle motion and transitions where they clarify state
- dense enough for repeated school work
- no generic dashboard filler
- result cards compact near the command bar
- tips/status surfaces must align with the command surface and not float disconnected
- command bar affordances should feel deliberate, centered, and premium
- secondary pages remain visible in nav after a separator, but are not actively rebuilt yet

## Scope

### Backend

- Add Spectra CRUD functions for `spectraWorkspaces`.
- Add Spectra CRUD functions for `spectraArtifacts`.
- Add projection functions for `spectraWorkspaceItems`.
- Add seed/demo data mutation for local testing.
- Keep the additive `spectra*` table approach until old chat is rebuilt.
- Do not invest in old `workstreams` compatibility unless needed to keep old chat alive.

### Frontend

- Replace static workspace cards with data from the new Spectra queries.
- Replace static artifact library cards with data from the new Spectra queries.
- Add simple create flows:
  - new workspace
  - new document artifact
  - new flashcard deck artifact
  - new quiz artifact
  - new planner task artifact
- Add "Add to workspace" picker/action from `/artifacts`.
- Add "Remove from workspace" or hide projection action from `/workspace`.
- Keep `/chat` stable.

### Tests

- workspace create/list/update/archive
- artifact create/list/update/archive
- add artifact to workspace
- remove/hide projection without deleting artifact
- library shows unplaced artifacts
- workspace shows only projections
- legacy import guard remains passing

## Non-Goals

- real AI calls from command bars
- full document editor
- full quiz-taking or flashcard study flows
- canvas
- agents
- ManageBac
- admin analytics
- complex router
- deleting the old chat pipeline

## Manual Test Milestone

Pablo should be able to:

1. Open `/workspace`.
2. See seed/demo workspace content from the new tables.
3. Open `/artifacts`.
4. Create an unplaced artifact.
5. Add it to a workspace.
6. Return to `/workspace` and see it as a card.
7. Remove/hide it from the workspace.
8. Confirm it still exists in `/artifacts`.

## Completion Criteria

- `npm run lint`
- `npm run test:run`
- `npm run build`
- dev server route smoke checks for `/chat`, `/workspace`, `/artifacts`
- no new Spectra code imports old workspace/artifact/orchestrator foundations


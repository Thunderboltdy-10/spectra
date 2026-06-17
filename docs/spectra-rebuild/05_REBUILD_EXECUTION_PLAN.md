# Spectra Rebuild Execution Plan

This is the overall staged plan. The first coding-agent run should not implement; it should produce a repo-specific execution plan based on this.

## Phase -1 — Audit and extraction only

No product implementation.

Tasks:

1. Read `docs/spectra-rebuild/`.
2. Inspect repo deeply.
3. Read old root `.md` files as historical evidence.
4. Generate audit docs:
   - `generated/REPO_SOURCE_AUDIT.md`
   - `generated/OLD_IDEAS_TO_KEEP.md`
   - `generated/OLD_CODE_TO_DELETE.md`
   - `generated/NEW_ARCHITECTURE_MAP.md`
   - `generated/WAVE_0_IMPLEMENTATION_PLAN.md`
5. Stop for human review.

## Phase 0 — Foundation reset

Implementation starts only after Pablo approves.

Goals:

- establish new folder structure
- define core types
- define Convex schema/tables
- disconnect old workspace/artifact routes from active UI
- create fixed model config
- create operation schema/validator
- create AIRun lifecycle skeleton
- create ResultCard skeleton
- create Artifact blueprint registry skeleton

Expected output:

- app builds
- old workspace/artifact implementations no longer active
- new pages may be skeletal but route correctly
- no old code imported by new Spectra modules
- first smoke tests exist

Testing:

- start dev server
- open `/chat`
- open `/workspace`
- open `/artifacts`
- confirm no old WorkspaceV2 UI
- confirm no old artifact AI sidebar
- confirm route shells look aligned with theme

## Phase 1 — Core data model and seed

Goals:

- Convex tables for workspaces, artifacts, workspaceItems, threads, messages, aiRuns, operations, resultCards
- seed/demo data
- queries/mutations for core CRUD
- artifact library reads from real data
- workspace cards view reads projections

Testing:

- create workspace
- create artifact
- add artifact to workspace
- remove/hide projection
- artifact still exists in library
- workspace item is only projection

## Phase 2 — Artifact library and first blueprints

Goals:

- `/artifacts` real page
- document blueprint
- flashcard deck blueprint
- quiz blueprint
- planner task blueprint
- thread reference renderer/card
- shared ArtifactCard, ArtifactRenderer, ArtifactEditorSurface

Testing:

- create each artifact type manually
- open/edit document
- view quiz/flashcard/task cards
- unplaced artifacts show in library/inbox
- Add to workspace opens picker

## Phase 3 — Chat rebuilt on shared primitives

Goals:

- `/chat` uses Thread/Message/AIRun primitives
- fixed model call path
- compact status UI replaces ugly thinking/tool trace
- artifact creation from chat creates artifact in library/inbox
- response shows artifact card with Open / Add to workspace

Testing:

- send normal chat message
- thread persists
- assistant response persists
- create quiz/flashcards from chat
- artifact appears in library, not workspace by default
- Add to workspace picker works

## Phase 4 — Workspace command bar + result cards

Goals:

- bottom command bar
- AIRun creation from workspace
- ResultCard stack above command bar
- stream/status events
- simple operations:
  - create artifact
  - summarize selection
  - create task
  - create flashcard deck
  - create quiz
- result cards persist until hidden
- hidden cards accessible in right hub

Testing:

- command creates result card
- result card running → completed
- x hides card without deleting run
- open artifact from result card
- open thread from result card
- command bar continues active thread when opened

## Phase 5 — Right run/thread hub

Goals:

- Running
- Recent
- Pinned threads
- Hidden cards
- open thread panel
- continue thread via command bar
- pin thread to workspace

Testing:

- create multiple runs
- hide cards
- find hidden cards in hub
- continue thread
- pin thread to workspace
- thread appears as thread card

## Phase 6 — Polishing and anti-clutter rules

Goals:

- confirmation gates
- object explosion limits
- undo/hide flows
- better empty states
- keyboard shortcuts
- microinteractions
- loading skeletons
- accessibility pass

Testing:

- try to create new workspace via AI → requires confirmation
- try to create many artifacts → requires confirmation
- generated flashcards count as one artifact
- no auto workspace creation unless accepted

## Phase 7 — Canvas secondary view

Only after cards/panes works.

Goals:

- canvas view uses same workspaceItems
- semantic zoom
- drag positions
- selection
- focus space creation later

Testing:

- same artifacts visible in cards and canvas
- moving in canvas does not corrupt content
- projections remain correct

## Deferred

Do not build in first rebuild:

```txt
agents UI
ManageBac
admin analytics
complex router
multi-agent orchestration
custom blueprint builder
diagram/whiteboard/code artifacts
full canvas-first experience
```

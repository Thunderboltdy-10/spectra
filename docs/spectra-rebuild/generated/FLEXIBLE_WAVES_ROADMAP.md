# Flexible Waves Roadmap

Generated on 2026-06-17 after Wave 1. This is a living guide, not fixed law. Pablo's feedback can move between waves when product logic changes. If a wave becomes too large, split it. If a wave becomes too small, merge it. Keep every milestone substantial and testable.

## Current Baseline

Wave 0 reset the foundation and disconnected the active workspace/artifact routes from legacy WorkspaceV2 and old artifact AI surfaces.

Wave 1 made the foundation real enough to test:

- Convex-backed `spectraWorkspaces`, `spectraArtifacts`, `spectraWorkspaceItems`, `spectraAiRuns`, `spectraOperations`, and `spectraResultCards` scaffolding.
- `/workspace` reads real workspace projections.
- `/artifacts` reads real artifact library/inbox data.
- Users can create workspaces, create artifacts, add artifacts to workspaces, and remove workspace projections without deleting artifacts.

The Wave 1 UI is structurally useful but too generic. Wave 2 must spend design effort before adding more backend depth.

## Wave 2 - Workspace UX Foundation / Make It Feel Like Spectra

Goal: turn the data-backed workspace into a real working environment.

Recovery correction after rejected Wave 2 direction:

- `/workspace` must default to Workspace Home when no workspace is explicitly selected.
- Workspace Home should show all workspaces as a calm overview with recent workspaces, counts, recent activity, and continue/open actions.
- Opening a workspace must be intentional.
- A selected workspace must still have a clear route back to Workspace Home.
- Workspace navigation should use a slim left-middle vertical rail with Home, workspace icons/avatars, and a subtle create action.
- Do not use native/default workspace dropdowns in the main workspace or artifact surfaces.
- Avoid cards-inside-cards and excessive roundness.
- Use spacing, typography, subtle dividers, and layout hierarchy before adding containers.
- Use `/chat` visual language as inspiration for hierarchy, accent strips, and intentional composition.
- Use progressive disclosure: do not expose artifact creation, workspace creation, filters, search, and type controls all at once.
- Command bar/result tray must be slim and integrated. Do not put large context labels inside the command field.
- Inspector should be slim, collapsible, or only appear when useful.
- Fix API/core flows before continuing visual redesign.

Focus:

- Workspace overview/navigation so users do not feel trapped in one Biology workspace.
- Strong top workspace rail/navbar or equivalent navigation model.
- Custom Spectra workspace switcher and workspace creation entry, with no native dropdown in the main workspace surface.
- Real view switching across Cards, Timeline, and Library using the same Wave 1 data.
- Canvas disabled/coming-later unless a very lightweight placeholder is useful.
- Redesigned inspector/context panel replacing the weak focus pane.
- Selected artifact inspector state with title, type, summary, placement, quick actions, and run/thread metadata where available.
- No selection inspector state with workspace summary, recent runs/result cards, and useful quick actions.
- Command bar as the central control surface.
- Result cards/activity tray compact, attached to command bar width, real-data driven, scrollable, and non-fake.
- Card hierarchy with selected, pinned/important, normal, and type-accented states.
- Better typography, icon treatment, spacing, hover/focus motion, and visual warmth.
- Reduced redundant search/filter controls.
- Artifact library polish: clear Inbox vs In Workspaces, custom workspace picker, less clutter, no confusing Add action for already placed artifacts.

Non-goals:

- No real AI model execution.
- No canvas rebuild.
- No artifact deep editors.
- No agents, ManageBac, admin analytics, or complex model routing.

Manual test:

- Can I understand where I am?
- Can I switch workspaces naturally?
- Does `/workspace` feel like a working environment?
- Do Cards, Timeline, and Library visibly switch over the same data?
- Do cards have hierarchy and type identity?
- Does the command bar/activity tray feel integrated?
- Does the inspector feel useful?
- Does `/artifacts` feel cleaner and less confusing?
- Does the UI feel less generic?

## Wave 3 - Artifact Blueprint Experiences

Goal: make artifacts feel like distinct school objects, not generic cards.

Focus:

- Artifact detail/open surfaces.
- Document blueprint basic reader/editor surface.
- Flashcard deck overview/study preview.
- Quiz overview/take/review basics.
- Planner task view/edit basics.
- Thread reference card/detail view.
- Blueprint-specific artifact creation forms/defaults.
- Artifact cards open into useful detail rather than dead placeholders.
- Artifact library becomes a real object library with inspect/open/edit affordances.

Non-goals:

- No full spaced repetition engine.
- No full quiz grading engine unless trivial.
- No real AI generation yet.

Manual test:

- Can I create each first-five artifact type?
- Does each type feel visually/functionally distinct?
- Can I open and inspect or edit it?
- Does `/artifacts` feel like a library of real objects?

## Wave 4 - AI Run / Operation Engine

Goal: make the command bar do real controlled AI work through the new `AIRun`/`Operation`/`ResultCard` protocol.

Focus:

- Fixed model call through OpenRouter.
- Workspace command bar creates `AIRun`.
- Model returns a structured operation plan.
- Validate operations before execution.
- Create/update artifacts through operations.
- Result cards stream/update with real events.
- No fake thinking traces.
- Compact progress events.
- Tool breaks only for real backend operations.
- Confirmation gates for risky actions.
- Object explosion protection.

Non-goals:

- No complex router.
- No multi-agent orchestration.
- No canvas.
- No ManageBac.
- No agents.

Manual test:

- Can I ask the workspace command bar to create a simple artifact?
- Does it produce a compact result card?
- Does it avoid fake trace UI?
- Does it ask confirmation before risky or bulk operations?
- Does the generated object appear in the correct place?

## Wave 5 - Threads and Chat Convergence

Goal: unify `/chat` and workspace AI primitives without destroying normal chat UX.

Focus:

- New `Thread`/`Message` integration.
- Every chat/workspace command creates `AIRun`.
- Workspace runs may or may not create threads.
- Threads can be pinned/referenced in workspaces.
- Right run/thread hub becomes real.
- `/chat` can create artifacts that go to Artifact Library/Inbox by default.
- Chat artifact cards have Open / Add to workspace.
- Continue thread from result card/right hub.
- Hidden result cards remain accessible.

Non-goals:

- No agents.
- No full router.
- No canvas.

Manual test:

- Can I create an artifact from chat without it auto-cluttering a workspace?
- Can I add it to a workspace manually?
- Can I continue a thread from workspace?
- Can workspace show selected thread references without showing every thread?

## Wave 6 - Workspace Intelligence and Context

Goal: make the system feel aware of selected artifacts and workspace context.

Focus:

- Selected artifact context.
- Multi-select context.
- Workspace summary/context builder.
- Search across artifacts/workspaces.
- Basic related-artifact suggestions.
- Create from selection.
- Better inspector intelligence.
- Lightweight source/provenance display.
- Possible simple RAG/file awareness if the foundation is ready.

Non-goals:

- No autonomous workspace creation unless confirmed.
- No ManageBac.
- No agents as the central product.

Manual test:

- Can I select artifacts and ask for something based on them?
- Does the AI know the current workspace context?
- Does it avoid creating clutter?
- Can I find related objects easily?

## Wave 7 - Study Object Quality

Goal: make school-specific artifact types genuinely good.

Focus:

- Better flashcard quality and editing.
- Quiz taking/marking basics.
- Document/essay feedback workflow.
- Planner task usefulness.
- Educational skills/guides attached to blueprints.
- Source reliability/research brief if ready.
- Mode/style differences between chat and workspace.

Non-goals:

- No heavy admin/teacher dashboard.
- No ManageBac unless explicitly chosen.

Manual test:

- Are flashcards actually usable?
- Are quizzes distinct and testable?
- Does document feedback feel educational?
- Does this feel useful for school work?

## Wave 8 - Spatial / Focus / Canvas Power Layer

Goal: bring back the original Spectra power-user ideas only after the object model and UI are strong.

Focus:

- Focus spaces from selected artifacts/threads.
- Canvas as a secondary view.
- Semantic zoom.
- Spatial layout.
- Lasso/multi-select.
- Possible diagram/whiteboard blueprint.
- Smooth transitions between cards, focus, and canvas.

Non-goals:

- Do not begin until basic workspace/artifact/AI/thread flows feel good.

Manual test:

- Can I build a temporary focus workspace from selected objects?
- Does canvas add power rather than gimmick?
- Can I move between overview and depth smoothly?

## Roadmap Rules

- The roadmap is a living guide. It must be updated when implementation or feedback changes product logic.
- Feedback can move between waves. Record the reason when moving it.
- Waves should stay testable. Split large waves and merge tiny waves.
- Do not start agents, ManageBac, admin analytics, complex routing, canvas, or custom blueprint builder before the core workspace/artifact/AI/thread foundation is genuinely good.
- Do not re-import old WorkspaceV2, old workspace components, old `ArtifactAiSurface`, old workspace-data route, or old orchestrator/routing foundations into new Spectra code.

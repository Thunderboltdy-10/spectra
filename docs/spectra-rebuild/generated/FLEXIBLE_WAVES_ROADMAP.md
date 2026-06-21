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

## Wave 2B - UI Source-of-Truth Foundation / Corrected Wave 2

Goal: implement the approved visual source of truth for `/workspace` and `/artifacts` before moving to the next functional wave. This is the corrected Wave 2 UI foundation, not Wave 3.

The six screenshots in `docs/spectra-rebuild/ui-source-of-truth/` are now the visual contract:

- workspace cards overview
- workspace timeline with selected run inspector
- artifacts grouped/list library
- workspace selected artifact cards state
- workspace canvas soft clusters
- artifacts board columns

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
- Canvas should be implemented only as the approved soft-cluster relation display. Advanced canvas behavior remains later.
- Redesigned inspector/context panel replacing the weak focus pane.
- Selected artifact inspector state with title, type, summary, placement, quick actions, and run/thread metadata where available.
- No selection inspector state with workspace summary, recent runs/result cards, and useful quick actions.
- Selected run/activity inspector state.
- Command bar as the central control surface.
- Result cards/activity tray compact, attached to command bar width, real-data driven, scrollable, and non-fake.
- Card hierarchy with selected, pinned/important, normal, and type-accented states.
- Better typography, icon treatment, spacing, hover/focus motion, and visual warmth.
- Reduced redundant search/filter controls.
- Artifact library polish: clear Inbox vs In Workspaces, grouped/list mode, board mode, custom workspace picker, less clutter, no confusing Add action for already placed artifacts.
- Seeded demo data for Biology, Maths EE, Spectra, Economics, English, including documents, decks, quizzes, tasks, thread references, runs, result cards, unplaced artifacts, placed artifacts, pinned/active items, timeline events, inspector examples, and canvas relation examples.
- Basic object/artifact relation display for seeded Canvas and Inspector examples.
- Runtime safety for incomplete data: missing placements, links, relations, runs, artifacts, and hidden workspace items must not crash selected states.
- Creation flows are foundational: workspace create/archive and artifact create/add/remove/move must stay wired and synced between `/workspace` and `/artifacts`.
- Popover/menu completeness: dropdowns close on outside click, three-dot menus either open real menus or are removed, and deferred actions are visibly disabled.
- Obvious performance fixes: avoid unnecessary full overview reloads on workspace switching where a workspace-only fetch is enough; deeper backend/query/cache work is tracked as a separate performance wave.

Non-goals:

- No real AI model execution.
- No AI-assisted relation suggestions.
- No advanced canvas/focus/semantic zoom.
- No artifact deep editors.
- No agents, ManageBac, admin analytics, or complex model routing.

Stop condition before Wave 3:

- Do not proceed to Wave 3 if Cards, Timeline, Library, Canvas, grouped/list artifacts, board artifacts, creation flows, and selected-state safety do not hold up under manual testing against the source-of-truth screenshots.
- Wave 3 may replace safe placeholders with real artifact detail/editing, but Wave 2B must not leave clickable dead buttons or runtime errors.

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
- Do the six approved screenshots have a represented working view?

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

## Wave 3B - Artifact Studio / Split-View Tabs

Goal: replace one-off artifact drawers with a shared Artifact Studio used from both `/workspace` and `/artifacts`.

Product model:

- Artifacts are shared objects.
- Workspaces are contextual working lenses over those objects.
- `/artifacts` is the global library/inventory.
- `/workspace` is the working room/context.
- Both surfaces use the same artifact opening/editing system without being merged.

Focus:

- Default artifact open behavior is a resizable right split panel, similar to a Notion side peek.
- The old right inspector disappears while the artifact split is open.
- Expand/open-as-tab creates or focuses a local artifact tab.
- Full tab mode gives the artifact the main working area.
- Tabs are local UI state, can be closed/switched, show active and saved/dirty state, and may restore from local storage.
- Document detail moves toward a real TipTap-backed rich editor.
- Flashcard deck detail supports section/card list plus front/back editing.
- Quiz detail supports real question objects, options, correct-answer selection, add/remove question, and add/remove option.
- Planner task is corrected to a task/calendar item, not a lesson-planning document.
- Artifact detail views include the Spectra quick-chat bar with an artifact/context chip.

Non-goals:

- No real AI generation or operation planning.
- No agents, ManageBac, complex routing, or advanced canvas editing.
- No full spaced repetition engine.
- No advanced quiz grading/responses.
- No full chat/thread convergence.

Manual test:

- Clicking artifacts from `/workspace` and `/artifacts` opens the same split Studio.
- Resizing the Studio leaves the source page usable.
- Expanding opens/focuses a tab and full tab mode takes over the main route area.
- Saved edits sync across `/workspace` and `/artifacts`.
- Planner artifacts feel like tasks/calendar items.
- Thread references remain visibly deferred to chat convergence.

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
- Shared run execution across `/workspace`, `/artifacts`, and Artifact Studio. `/chat` Thread/Message/AIRun convergence remains Wave 5 rather than wrapping the legacy orchestrator.
- Strict NDJSON progress events generated from real operational phases; progress never enters saved final content.
- Confirmation execution/revalidation in Wave 4 rather than the later general polish wave.

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
- Does focused context remain a hint rather than an assumed target when the prompt says otherwise?
- Do progress summaries stay in result cards and out of saved assistant/final text?

## Wave 4.5 - Pre-Wave 5 Polish and Performance

Completed on 2026-06-21. This pass consolidated workspace/object UI polish, redesigned Timeline, corrected creation/removal/deletion semantics, fixed timestamp and schema drift, and completed the responsiveness work below without changing the Wave 4 execution engine. See `WAVE_4_5_WORKSPACE_OBJECT_SURFACE.md` for the implementation record and manual acceptance checklist.

## Performance Wave - Spectra Responsiveness and Data Efficiency (absorbed into Wave 4.5)

Goal: make workspace switching, artifact filtering, creation/deletion, seed idempotency, and result refreshes feel instant enough for daily use.

This wave can happen before Wave 4 or alongside Wave 4 if Wave 2B client-side fixes are not enough.

Focus:

- Audit `/api/spectra` fetch patterns for over-fetching and repeated full overview reloads.
- Add or verify Convex indexes for workspace/artifact placement queries.
- Avoid repeated seeding and duplicate demo hydration during normal navigation.
- Cache stable workspace/artifact metadata on the client where appropriate.
- Profile create/archive/add/remove flows and eliminate avoidable refetch waterfalls.

Manual test:

- Switching between seeded workspaces should feel immediate.
- Creating/removing artifacts and workspaces should update the current view without long blank loading gaps.
- `/artifacts` filters should respond without a full visual reset.

## Wave 5 - Threads and Chat Convergence

Goal: unify `/chat` and workspace AI primitives without destroying normal chat UX.

Completed on 2026-06-21. See `WAVE_5_THREADS_CHAT_CONVERGENCE.md` for the implemented lifecycle, UI contract, verification, and deferred migration/memory work.

Focus:

- Convex-backed `spectraThreads`/`spectraMessages` integration with refresh recovery and clean message persistence.
- Every chat/workspace command creates `AIRun`.
- Workspace runs may or may not create threads.
- Threads can be pinned/referenced in workspaces.
- Right run/thread hub becomes real.
- `/chat` can create artifacts that go to Artifact Library/Inbox by default.
- Chat artifact cards have Open / Add to workspace.
- Continue thread from result card/right hub.
- Hidden result cards remain accessible.
- Shared conversation rendering across `/chat`, temporary run detail, and real thread-reference artifacts.
- Structured run context snapshots and artifact provenance provide hooks for later memory without implementing memory in this wave.

Non-goals:

- No agents.
- No full router.
- No canvas.
- No long-term memory, automatic memory extraction, sub-agents, autonomous orchestration, or historical legacy-chat migration UI.

Manual test:

- Can I create an artifact from chat without it auto-cluttering a workspace?
- Can I add it to a workspace manually?
- Can I continue a thread from workspace?
- Can workspace show selected thread references without showing every thread?

## Wave 5.5 - Conversation / Workspace UX Stabilization

Started on 2026-06-21 before Wave 6. This is a product-quality correction over the Wave 5 worktree, not a conceptual wave.

Focus:

- real public assistant text streaming with optimistic messages, smart scroll following, cancellation, retry/recovery, provider/model/usage metadata, and generated titles/summaries;
- polished `/chat` welcome, messages, traces, recent navigation, run hub, rename/pin actions, and a working attachment menu;
- one shared conversation/composer for `/chat` and real thread-reference artifacts;
- explicit global/workspace/artifact/thread composer targets and one main side panel at a time;
- compact artifact proposals/actions and Inbox-by-default chat creation;
- persisted Inbox/Pinned disclosure state, pinned work in every workspace view, list limiting, calmer actions/hover states, and loading improvements;
- artifact baseline-aware dirty state, save/discard close handling, and manual/AI/revert version provenance.

Boundaries remain unchanged: no memory, agents, complex routing, ManageBac, advanced canvas, or relation intelligence. See `WAVE_5_5_CONVERSATION_WORKSPACE_STABILIZATION.md`.

## Wave 6 - Workspace Intelligence and Context

Goal: make the system feel aware of selected artifacts and workspace context.

Focus:

- Selected artifact context.
- Multi-select context.
- Workspace summary/context builder.
- Search across artifacts/workspaces.
- Basic related-artifact suggestions.
- AI-assisted object/artifact relation suggestions and link creation.
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
- Durable object-link visual editing if Wave 6 relation primitives are ready.
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

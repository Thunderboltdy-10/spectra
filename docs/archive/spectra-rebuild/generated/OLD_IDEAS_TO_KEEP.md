# Old Ideas to Keep

Generated during Phase -1 analysis on 2026-06-17. These are extracted ideas only. They are not direct implementation instructions unless they align with `docs/spectra-rebuild/`.

## Product Ideas Worth Preserving

### One AI run as a coherent unit of work

Repeated old audits agreed that the product fails when chat messages, tool calls, thinking labels, artifact side effects, workspace mutations, and model decisions appear as unrelated fragments. Keep the mental model that a user command creates one coherent `AIRun` that owns:

- input prompt and selected context
- model used
- status lifecycle
- optional thread linkage
- operations proposed/executed
- result card
- final message or summary
- created/changed artifacts
- errors and retry state

This aligns directly with the new rebuild docs.

### Real events, not fake traces

The old audits repeatedly called out decorative "thinking" UI and generic phase labels. Keep the lesson:

- show compact status only when no precise event exists
- render real operation/status events when they exist
- hide implementation noise behind details
- do not dump chain-of-thought-like or fake trace text

This should become `AIRun` + `Operation` + `ResultCard`, not the old route-trace drawer.

### Clarification should resume the same run

The clarification audit identified a real product problem: asking clarifying questions as separate visible messages breaks continuity. Keep the idea that clarification is a human-in-the-loop pause/resume state for the same run.

Wave 0 does not need full clarification, but the schema should not block:

- `aiRuns.status = "waiting_for_clarification"` later
- operation/result card can show a compact prompt for user input
- answering continues the same run/thread, not a new disconnected chat

### Artifacts are persistent objects with provenance

Old docs correctly recognized that artifact creation/update should be structured and linked to the run that created it. Keep:

- artifact provenance
- source chat/thread/run/workspace references
- version history
- open/add-to-workspace actions
- artifact cards in chat/workspace/library

But replace "markdown note with AI sidebar" with blueprint-based artifacts.

### WorkspaceItem as projection/reference

The old projection audits are useful. The key lesson is that workspace placement must not own content. Keep:

- WorkspaceItem references an Artifact/Thread/etc.
- Removing a WorkspaceItem should not delete the Artifact.
- Workspace projection must be explicit, immediate, and testable.
- Created-in-chat artifacts should not be auto-placed unless confirmed.
- Created-in-workspace artifacts belong to the workspace by default.

### Version history and AI edit infrastructure

The current artifact backend has meaningful versioning ideas:

- `artifactVersions`
- `applyAiEdit`
- restore version
- pending diff / last AI edit metadata

Keep as design inspiration for the document blueprint and later artifact editing. Do not preserve current surface behavior where the artifact page is a document editor plus right AI side panel.

### Current app shell, theme, and sidebar feel

The rebuild should preserve the polished Spectra shell where it helps:

- left sidebar feel
- light/dark theme tokens
- settings drawer feel
- utility dock and toast styling
- typography/token approach in `globals.css`
- basic Clerk/local auth bootstrap

Keep this as visual continuity, not as an obligation to keep old architecture.

### Normal chat is valuable

The old system overreached, but the full chat page is still useful. Keep:

- `/chat` as a normal reliable chat surface
- chat history sidebar
- normal messages/composer
- markdown rendering
- stop/regenerate/copy basics
- compact status instead of noisy traces

Do not let `/chat` become the workspace command bar.

### Cards/panes before canvas

Old workspace docs contain strong semantic zoom and canvas ideas, but the new rebuild explicitly makes cards/panes the default and canvas secondary. Keep canvas ideas only as later inspiration:

- semantic zoom means changing information density, not scaling text
- minimap/territory/spatial memory can be revisited later
- lasso/working set/focus space can become power features
- trackpad-first navigation matters when canvas returns

Wave 0 should not rebuild canvas.

### Educational object types

Keep the strongest old educational object ideas, recast as built-in blueprints:

- document
- flashcard deck
- quiz
- planner task
- thread reference

Useful old specialty behavior:

- flashcard decks should be one artifact, not many cards
- quizzes should render as quizzes, not markdown
- planner items need due date/status/links
- thread cards should summarize and continue the conversation

### Resources and RAG state machines

Old audits correctly say files/resources must have honest state. Keep for later waves:

- uploaded/processing/processed/failed states
- retry/error visibility
- search/citation fidelity
- personal vs workspace context distinction

Wave 0 should not attempt to fix RAG, but should avoid hard-coding a design that makes it impossible.

### Operation log and undo direction

`workspaceMutations` and old operation ideas are worth preserving conceptually:

- mutations/operations should be logged
- destructive operations require confirmation
- undo data can be attached where feasible
- operations should validate input/output

Rename and generalize this into `Operation`, not workspace-only mutation history.

### Skills as small quality guides

Old skills work got too large, but the concept remains useful:

- product/design skills for UI behavior
- educational skills for flashcard/quiz/document quality
- blueprint-linked skills

Keep as a small registry later. Do not rebuild a giant skills system in Wave 0.

## Ideas to Keep Only as Deferred Inspiration

- semantic zoom
- canvas territories
- minimap
- edge hubs
- right-click menus
- command palette global navigation
- topic clustering
- ghost suggestions
- companion agents
- ManageBac-derived planner sync
- ambient workspace preparation
- visual/diagram/code artifact blueprints
- shared group sessions
- voice-first capture

These are valuable, but all are after the core object model works.

## Explicit Non-Keeps Despite Old Docs

Do not keep these old ideas for v1 rebuild:

- workspace as canvas-first
- agents as central product
- ManageBac as core v1 surface
- complex model router as active foundation
- old mode-first AI system
- auto-cluttering ghost items
- auto workspace creation from AI
- admin analytics as primary navigation
- 16 artifact types as v1 core
- generic workspace widgets as core primitives


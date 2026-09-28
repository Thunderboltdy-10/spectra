# Wave 3B Artifact Studio / Split-View Tabs Plan

Generated on 2026-06-19 during Wave 3B implementation.

## Position

Wave 3B corrects the artifact opening model introduced in Wave 3A. Artifacts remain shared objects. `/workspace` remains the contextual working room and `/artifacts` remains the global library/inventory, but both routes now use one shared Artifact Studio system for opening and editing artifacts.

This wave does not merge `/workspace` and `/artifacts`.

## Studio Model

- Clicking an artifact opens a right split panel by default.
- The split panel is a real working surface, not a small inspector drawer.
- The panel defaults to roughly half the screen and can be resized horizontally.
- The underlying workspace/library adapts to the remaining width.
- The old workspace right inspector is hidden while Artifact Studio is open.
- Selection checkmarks are no longer the primary opening model; clicks open the studio.

## Local Tabs

- The studio has an expand/open-as-tab action.
- Expanding creates or focuses a local UI tab for the artifact.
- Full tab mode gives the artifact the main working area for that route.
- Tabs are local UI state, not backend objects.
- Open tabs are persisted in `localStorage` on a best-effort basis.
- Tabs support active state, close, saved/dirty indicator, and switching.

## Blueprint Detail Direction

The artifact detail source-of-truth images in `docs/spectra-rebuild/artifact-detail-source-of-truth/` define the direction:

- Document: TipTap-backed rich writing surface, formatting toolbar, metadata/details rail, linked objects, and artifact quick-chat.
- Flashcard deck: section/card list, selected front/back editor, confidence/hint controls, and study controls marked as deferred where not implemented.
- Quiz: structured question list, question editor, answer option controls, correct answer selector, preview state, and deferred publish/responses.
- Planner task: task/calendar item with title, description, status, priority, due/start/end time, all-day toggle, subtasks, attachments, linked artifacts, reminders, and archive action.
- Thread reference: safe placeholder/detail view only; real thread rendering belongs with chat convergence.

## Wave Boundary

Built now:

- Shared `ArtifactStudio` component.
- Shared studio state hook for split, full-tab mode, local tabs, dirty indicators, and local persistence.
- Studio integration from both `/workspace` and `/artifacts`.
- Basic safe editing for first-five blueprint content.
- Artifact quick-chat bar inside detail views, visually scoped to the artifact.

Deferred:

- Real AI generation and artifact AI actions.
- Operation planning.
- Full chat/thread convergence.
- Full spaced repetition.
- Advanced quiz grading and responses.
- Advanced canvas editing.
- Complex routing, agents, and ManageBac.

## Manual Validation

- Open `/workspace`, enter Biology, click a document/deck/quiz/task card, and confirm it opens as a right split panel.
- Resize the split panel and confirm the workspace adapts.
- Expand the artifact to a tab, switch tabs, close tabs, and refresh to check local restoration.
- Open the same artifact from `/artifacts` and confirm edits are shared after save.
- Confirm the workspace inspector is not visible while the studio split is open.
- Confirm planner artifacts look like tasks/calendar items, not lesson documents.

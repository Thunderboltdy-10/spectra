# Flexible Backlog and Feedback

Generated on 2026-06-17 after Wave 1. This file collects Pablo's UI complaints, deferred feedback, and ideas that should not be forgotten.

## Rule

Feedback can move between waves if product logic changes. If something is wrong but not urgent, keep it here and assign it to the most appropriate future wave. If a wave becomes too large, split it. If a wave becomes too small, merge it. Keep milestones testable and substantial.

## Pablo's Current UI Complaints

### Wave 2B Source-of-Truth Correction

This correction supersedes any Wave 2 implementation that does not match the approved screenshots in `docs/spectra-rebuild/ui-source-of-truth/`.

| Feedback | Current Wave Assignment | Notes |
| --- | --- | --- |
| The six approved screenshots are now the visual source of truth, not loose inspiration. | Wave 2B | `/workspace` and `/artifacts` should recreate their structure, density, hierarchy, command dock, rail, inspector, and artifact views closely. |
| Wave 2B is corrected Wave 2 UI foundation, not Wave 3. | Wave 2B | Do not start artifact blueprint/detail work until this surface is stable. |
| Workspace must support Cards, Timeline, Library, and Canvas view navigation. | Wave 2B | Canvas is a calm relation display only in this wave. |
| Right inspector needs workspace/no-selection, selected artifact, and selected run/activity states. | Wave 2B | Selection should update inspector without modals. |
| Artifact library must support grouped/list and board-column modes. | Wave 2B | Grid can remain secondary if useful. |
| Placed artifact actions must not show confusing generic Add. | Wave 2B | Placed rows/cards should use Open, Move, and remove-placement style actions. |
| Seeded demo data must be rich enough to test immediately. | Wave 2B | Include five named workspaces, placed/unplaced artifacts, runs, timeline events, pinned/active examples, and canvas relation examples. |
| Object/artifact links introduced by the canvas screenshot should become a planned real primitive. | Wave 2B plan, Wave 6+ implementation | In Wave 2B, only seeded relation display is required. AI-assisted relation suggestions are deferred. |
| Clicking artifacts/runs must be safe even when placements, links, relations, or data are missing. | Wave 2B | Detail/editing can remain Wave 3, but Wave 2B must show safe inspector/placeholders instead of throwing. |
| Creation flows are core, not optional polish. | Wave 2B | Workspace create/archive and artifact create/add/remove/move must remain wired after the visual rebuild. Dead create buttons are not acceptable. |
| Popovers, dropdowns, and menus must close on outside click. | Wave 2B | Applies to New, command menus, artifact placement menus, workspace picker, and future overflow menus. |
| No fake menus or fake action affordances. | Wave 2B | Three-dot buttons must open useful menus or be removed. Unsupported actions should be visibly disabled with the deferred wave. |
| Workspace switching and create/delete feels too slow. | Wave 2B obvious fixes, Performance Wave deeper work | Avoid obvious over-fetching/repeated seeding now; create a later performance wave for backend/query/cache optimization. |

### Wave 2 Recovery Correction

This correction supersedes the rejected Wave 2 visual direction from commit `e280602`.

| Feedback | Current Wave Assignment | Notes |
| --- | --- | --- |
| `/workspace` needs a Workspace Home and must not automatically open Biology or the first workspace. | Recovery / Wave 2 | Workspace Home is the default state until the user intentionally opens a workspace. |
| Workspace navigation should use a left-middle vertical rail with Home plus workspace icons. | Recovery / Wave 2 | It must feel like core navigation, not a form control or dropdown. |
| There must always be an obvious way back to Workspace Home. | Recovery / Wave 2 | Home stays as the top rail item. |
| Avoid cards inside cards and excessive roundness. | Recovery / Wave 2 and ongoing | Prefer plain page structure, spacing, typography, dividers, and object cards only where needed. |
| Use progressive disclosure. | Recovery / Wave 2 and ongoing | Hide creation/filter controls behind New, plus menus, contextual panels, or compact controls. |
| Use `/chat` visual language as inspiration. | Recovery / Wave 2 and ongoing | Borrow hierarchy, intentional composition, accent strips, and clearer primary/secondary information without copying it exactly. |
| Command bar/result tray must be slim, grounded, and integrated. | Recovery / Wave 2 now, Wave 4 later | Do not put big labels inside the command field. Result cards default to compact one/two-line rows. |
| Do not expose creation/filter controls everywhere. | Recovery / Wave 2 and ongoing | Workspace artifact creation belongs behind plus/menu. Artifact creation belongs behind New. |
| Inspector should not dominate the page. | Recovery / Wave 2 and ongoing | Only show it when useful, such as when an object is selected. |
| Fix core flows before visual redesign. | Recovery / Wave 2 and ongoing | Workspace creation/switching and artifact create/place flows must remain working. |

### Original Wave 1 Feedback

| Feedback | Current Wave Assignment | Notes |
| --- | --- | --- |
| `/workspace` drops directly into Biology with no serious workspace navigation. | Wave 2 | Add workspace overview/top rail and switcher. |
| There is no clear way to move between workspaces. | Wave 2 | Make switching obvious and custom. |
| Workspace navigation uses an ugly/native/default dropdown. | Wave 2 | Replace with Spectra-styled switcher/listbox/popover. |
| Focus pane UI is very bad and looks like a generic form/card. | Wave 2 | Replace with contextual inspector. |
| Result cards above quick chat are in a weird separate container. | Wave 2 | Attach compact activity tray to command bar width. |
| Command bar does not feel like the core control surface. | Wave 2 now, Wave 4 later | Wave 2 handles UX; Wave 4 makes it execute real AI work. |
| Plus button alignment/styling is poor. | Wave 2 | Make it polished and aligned with the command surface. |
| Tip/help text near quick chat floats separately and is not connected to command bar. | Wave 2 | Integrate context/tip into the command surface. |
| Cards are too blocky and equally weighted. | Wave 2 | Add hierarchy, accent, selection, pinned treatment. |
| Nothing stands out. | Wave 2 | Make hierarchy visible without making everything loud. |
| Icons feel generic. | Wave 2 now, Wave 3 later | Wave 2 improves treatment; Wave 3 makes blueprint-specific object identity deeper. |
| Text hierarchy is weak; no text feels more important than other text. | Wave 2 | Redo headings, meta, chips, and card typography. |
| Too many search/filter controls compete for space. | Wave 2 | Reduce clutter in workspace/artifact surfaces. |
| Page does not feel like a working environment. | Wave 2 | Workspace layout must feel operational, not dashboard filler. |
| UI feels AI-generated rather than designed. | Wave 2 and ongoing | Apply frontend-design direction every wave. |
| It lacks motion, warmth, premium feel, and microinteractions. | Wave 2 and ongoing | Add restrained movement and tactile states. |
| Pablo likes landing page style where section separation is not harshly squared and has more custom rounded/organic shapes. | Wave 2 and ongoing | Bring this into app surfaces carefully, without gimmick. |
| Pablo expects a lot of effort on the feel, look, and layout of the whole project, especially workspace and artifacts. | Wave 2 and ongoing | UI quality is not optional. |
| Do not go crazy and make everything stand out or be different. | Wave 2 and ongoing | Use hierarchy and restraint. |

## Deferred Feedback and Ideas

| Item | Wave | Reason |
| --- | --- | --- |
| Artifact open/detail surfaces should feel type-specific. | Wave 3 | Needs blueprint renderer work after workspace UX foundation. |
| Document, flashcard deck, quiz, planner task, and thread reference should each have distinct experiences. | Wave 3 | Requires renderer/detail surfaces. |
| Artifact opening should use a shared Artifact Studio, not tiny route-specific drawers. | Wave 3B | `/workspace` and `/artifacts` keep different purposes but use the same split-panel/tab editing system. |
| Artifact Studio should open as a resizable right split panel by default. | Wave 3B | The source view adapts to remaining width; old workspace inspector disappears while Studio is open. |
| Artifact Studio should support local artifact tabs. | Wave 3B | Tabs are local UI state, not backend objects. Restore from local storage if straightforward. |
| Planner artifacts are task/calendar items, not lesson-planning documents. | Wave 3B | Include status, priority, due/start/end time, subtasks, attachments, links, reminders, and archive/trash action direction. |
| Thread reference detail should defer real conversation rendering. | Wave 5 | Real thread rendering belongs with chat convergence and should feel like normal `/chat`. |
| Deeper blueprint engines can continue after the Studio shell. | Wave 7 | Rich document behaviors, full study loops, quiz grading, and stronger task workflows should build on the shared Studio. |
| Command bar focus chip should become manually switchable. | Wave 4 / Wave 6 | Default to the active object context, such as open artifact or workspace, but let the user switch to no focus, workspace focus, or another artifact without moving the command bar. |
| Artifact creation should use blueprint-specific forms/defaults. | Wave 3 | Wave 2 can polish the creation strip, but full forms belong with blueprint UX. |
| Artifact open/detail/editing can be deferred, but must have safe Wave 2B placeholders. | Wave 3 | Clicking an artifact should never error. Wave 3 replaces placeholders with real type-specific detail/edit surfaces. |
| Command bar should perform real AI operations. | Wave 4 | Wave 2 designs the control surface; Wave 4 wires execution. |
| Result cards should stream/update from real AI events. | Wave 4 | Requires AIRun/Operation engine. |
| Risky/bulk AI actions require confirmation. | Wave 4 | Operation policy enforcement. |
| `/chat` artifacts should land in library/inbox by default. | Wave 5 | Chat convergence work. |
| Continue thread from workspace result card/right hub. | Wave 5 | Requires thread/message integration. |
| Hidden result cards remain accessible. | Wave 5 | Right hub needs real thread/run history. |
| Multi-select selected artifact context. | Wave 6 | Context builder and selection model. |
| Search across artifacts/workspaces. | Wave 6 | Broader context/search foundation. |
| Related artifact suggestions. | Wave 6 | Useful after artifact/context quality improves. |
| Durable object/artifact link primitive with provenance and relation types. | Wave 6 | Wave 2B only displays seeded relations in Canvas/Inspector. |
| AI-assisted relation suggestions. | Wave 6 | Do not build autonomous relation generation in Wave 2B. |
| Better flashcard learning loops and quiz grading. | Wave 7 | Study object quality wave. |
| Educational skills/guides attached to blueprints. | Wave 7 | AI quality and object behavior. |
| Advanced canvas, semantic zoom, focus spaces, lasso, spatial layout. | Wave 8 | Power layer only after object/UI foundation works. |
| Spectra performance wave: workspace switching, artifact filtering, creation latency, seed idempotency, over-fetching, and backend indexes. | Performance Wave before/alongside Wave 4 | Treat as a major product-quality wave if simple Wave 2B client optimizations are insufficient. |

## Do Not Forget

- School-first but admin-light remains the product identity.
- `/chat` remains a normal full chat page.
- `/workspace` is the core working environment.
- `/artifacts` is a real artifact library/inbox.
- Shared primitives must remain the foundation: `Workspace`, `Artifact`, `Blueprint`, `WorkspaceItem`, `Thread`, `Message`, `AIRun`, `Operation`, `ResultCard`.
- Do not rebuild agents, ManageBac, admin analytics, complex model routing, canvas, or custom blueprint builder yet.
- Use fixed model config until the rebuild is ready for routing complexity.
- Do not import old workspace/artifact/orchestrator systems into new Spectra code.
- Do not proceed with later waves if the core Wave 2B UI foundation regresses away from the approved screenshots.

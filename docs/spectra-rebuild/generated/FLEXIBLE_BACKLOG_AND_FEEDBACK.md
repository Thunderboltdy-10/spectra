# Flexible Backlog and Feedback

Generated on 2026-06-17 after Wave 1. This file collects Pablo's UI complaints, deferred feedback, and ideas that should not be forgotten.

## Rule

Feedback can move between waves if product logic changes. If something is wrong but not urgent, keep it here and assign it to the most appropriate future wave. If a wave becomes too large, split it. If a wave becomes too small, merge it. Keep milestones testable and substantial.

## Pablo's Current UI Complaints

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
| Artifact creation should use blueprint-specific forms/defaults. | Wave 3 | Wave 2 can polish the creation strip, but full forms belong with blueprint UX. |
| Command bar should perform real AI operations. | Wave 4 | Wave 2 designs the control surface; Wave 4 wires execution. |
| Result cards should stream/update from real AI events. | Wave 4 | Requires AIRun/Operation engine. |
| Risky/bulk AI actions require confirmation. | Wave 4 | Operation policy enforcement. |
| `/chat` artifacts should land in library/inbox by default. | Wave 5 | Chat convergence work. |
| Continue thread from workspace result card/right hub. | Wave 5 | Requires thread/message integration. |
| Hidden result cards remain accessible. | Wave 5 | Right hub needs real thread/run history. |
| Multi-select selected artifact context. | Wave 6 | Context builder and selection model. |
| Search across artifacts/workspaces. | Wave 6 | Broader context/search foundation. |
| Related artifact suggestions. | Wave 6 | Useful after artifact/context quality improves. |
| Better flashcard learning loops and quiz grading. | Wave 7 | Study object quality wave. |
| Educational skills/guides attached to blueprints. | Wave 7 | AI quality and object behavior. |
| Canvas, semantic zoom, focus spaces, lasso, spatial layout. | Wave 8 | Power layer only after object/UI foundation works. |

## Do Not Forget

- School-first but admin-light remains the product identity.
- `/chat` remains a normal full chat page.
- `/workspace` is the core working environment.
- `/artifacts` is a real artifact library/inbox.
- Shared primitives must remain the foundation: `Workspace`, `Artifact`, `Blueprint`, `WorkspaceItem`, `Thread`, `Message`, `AIRun`, `Operation`, `ResultCard`.
- Do not rebuild agents, ManageBac, admin analytics, complex model routing, canvas, or custom blueprint builder yet.
- Use fixed model config until the rebuild is ready for routing complexity.
- Do not import old workspace/artifact/orchestrator systems into new Spectra code.

# Wave 3 Artifact Blueprint Experiences Plan

Generated on 2026-06-18 before implementation.

## Position

Wave 3 builds on the committed Wave 2B source-of-truth UI foundation. It should not redesign `/workspace` or `/artifacts`; it should make the existing cards, rail, inspector, command dock, activity tray, view switching, and library surfaces open real blueprint-specific object experiences.

## Scope

- Add a safe artifact detail/open surface reachable from workspace cards and `/artifacts`.
- Render distinct blueprint experiences for document, flashcard deck, quiz, planner task, and thread reference artifacts.
- Replace generic artifact creation with blueprint-specific forms/default content.
- Support basic edits that are low-risk and local to the artifact:
  - title and summary for all artifacts
  - document body blocks
  - flashcard front/back/hint entries
  - quiz question/answer/options basics
  - planner task status, priority, description, and due date
  - thread reference summary and linked-id placeholder fields
- Preserve workspace placement semantics:
  - unplaced artifacts can be added to workspaces
  - placed artifacts can be opened, moved, or removed from a workspace without deleting the artifact
  - edits sync between `/workspace` and `/artifacts`

## Non-Goals

- No real AI model execution.
- No AI operation planning.
- No agents, ManageBac, admin analytics, or complex routing.
- No full spaced repetition or advanced quiz grading.
- No advanced canvas editing or AI relation suggestions.

## Validation

- Create each supported artifact type from `/artifacts` and from a workspace.
- Open each artifact type from workspace cards and the artifact library.
- Edit fields and confirm the changes survive reloads and appear on both surfaces.
- Remove a workspace placement and confirm the artifact remains in `/artifacts`.
- Confirm unsupported/deeper actions are labelled as later or disabled, not dead.

# Spectra Rebuild — Product Decisions

This file records the current product decisions. Treat this as source of truth unless Pablo explicitly changes it.

## Identity

Spectra is a school-first, admin-light AI workspace.

It is not merely a school chatbot. It is a structured working environment where students and teachers can chat, create artifacts, study, organize work, and use AI to operate on real objects.

## School-first, admin-light

The product should still feel designed for school use:

- learning modes
- subject/project workspaces
- teacher-compatible workflows later
- future agent support
- privacy and appropriate AI culture

But v1 rebuild should not focus on heavy admin control, analytics dashboards, school-wide governance, ManageBac, or agents.

The user-facing experience matters first.

## Surfaces

### `/chat`

A full normal chat page.

It should remain separate because it is useful, familiar, and lower friction.

It should use the same backend primitives as workspace, but present them as a normal conversation.

### `/workspace`

The main Spectra operating surface.

Default should be cards/panes, not canvas.

Canvas should be available as a powerful secondary view.

Core interactions:

- open workspace
- see artifacts/tasks/thread references as cards/panes
- use bottom command bar
- see AI result cards above command bar
- open right thread/run hub
- open artifact/editor panes
- switch to canvas later

### `/artifacts`

A real artifact library/inbox page.

It should show all artifacts, especially artifacts created from `/chat` but not yet placed in a workspace.

It should support search, filters, type grouping, recent items, and “Add to workspace” actions.

## Core entities

```txt
Workspace
Artifact
Blueprint
WorkspaceItem
Thread
Message
AIRun
ResultCard
Operation
FocusSpace
```

## Artifact name

Keep the word `artifact` throughout the rebuild for consistency. UI renaming can happen later.

## Canvas decision

Canvas is valuable but not default.

Use cards/panes as the default because it is more practical for school users. Canvas becomes the spatial/overview/power view.

## AI autonomy decision

AI should be powerful but not clutter-producing.

It may suggest structure, create explicitly requested artifacts, and operate on selected objects. It should not aggressively create new workspaces or dozens of cards.

## Agents

Skip agents for v1 rebuild.

Keep optional fields/hooks if easy, but no agent UI and no agent-first architecture.

## ManageBac

Skip ManageBac for v1 rebuild.

Planner tasks should exist as a first-class artifact/blueprint, but ManageBac integration is later.

## Admin

Hide or deactivate admin-heavy parts for now.

Keep minimal auth/user/org support if it helps school-first compatibility. Do not optimize admin dashboards.

## Model routing

Freeze complex routing.

Use one fixed strong model through OpenRouter during the rebuild. Old router work can be archived for later.

## UI priority

The UI must be genuinely excellent:

- current theme should be respected
- microinteractions matter
- workspace should feel alive but not cluttered
- AI progress should be compact and useful
- no ugly thinking/tool trace dumps
- every common object should share design language

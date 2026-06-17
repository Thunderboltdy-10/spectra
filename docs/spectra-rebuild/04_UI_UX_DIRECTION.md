# Spectra UI/UX Direction

## Goal

The UI must feel like a polished AI-native workspace, not a patched school chatbot.

Preserve the existing theme identity where good:

- dark/light theme support
- sidebar feel
- app shell feel
- polished rounded cards
- subtle shadows/borders
- settings/right panels
- keyboard-first interactions

But redesign workspace, artifacts, and AI status interactions.

## UI philosophy

```txt
Calm by default.
Powerful on demand.
No visual noise pretending to be intelligence.
```

## Main surfaces

### Chat

The normal chat page can be more boring than workspace, but it must be clean.

Replace disliked thinking/tool trace UI.

Bad:

```txt
large tool call dumps
fake trace visibility
ugly intermediate cards
verbose model plumbing
```

Good:

```txt
compact status pill/ribbon while thinking
expandable "Details" only if useful
clear final response
artifact cards embedded cleanly
created artifacts have Open / Add to workspace
```

### Workspace

Default view: cards/panes.

Suggested layout:

```txt
left app sidebar
main workspace header
view switcher: Cards | Canvas | Timeline | Library
central cards/panes area
right run/thread/artifact inspector hub
bottom command bar
result card stack above command bar
```

### Artifacts

`/artifacts` is a real library/inbox page.

It should show:

- all artifacts
- unplaced artifacts
- recently created
- type filters
- search
- workspace placement status
- Add to workspace
- Open/Edit

## Cards/panes default workspace

The default workspace should be useful before canvas exists.

Card types:

```txt
artifact card
thread card
planner task card
quiz card
flashcard deck card
document card
```

Cards should share design language but have distinct affordances.

Common anatomy:

```txt
icon/type chip
title
short summary
status metadata
linked workspace/thread/source
quick actions
```

## Canvas

Canvas is later/power mode.

It should be 2.5D semantic workspace, not true 3D.

When added:

- workspace territories
- semantic zoom
- artifact cards become previews/detail based on zoom
- lasso selection
- focus space creation
- pan/zoom smoothness
- no overcomplicated 3D navigation

## Result card stack

Location: above bottom command bar.

Behavior:

- cards stack vertically
- max height with scroll
- blur/fade when overflow
- cards persist until hidden
- latest/running cards visually prioritized
- cards use same theme language as artifacts

Microinteractions:

- smooth card enter/exit
- subtle progress shimmer/spinner
- hide animation
- status transitions from running → done
- click-to-open target
- hover actions revealed subtly

## Right Run/Thread Hub

Right panel should be a unified activity surface:

```txt
Running
Recent
Pinned threads
Hidden result cards
```

When a thread is open:

- show messages
- show operations performed
- show linked artifacts
- allow continue
- command bar context switches to this thread

## Command bar

Bottom command bar is not just chat.

It is a context-aware command surface.

Placeholder examples:

```txt
Global: "Ask Spectra or create something…"
Workspace: "Work with this workspace…"
Selection: "Act on 3 selected artifacts…"
Artifact: "Edit or ask about this artifact…"
Thread: "Continue this thread…"
```

It must visually show current target/context.

## Artifact design

Artifacts are blueprint-rendered.

Do not make everything a markdown note.

First five visual types:

### Document

Rich text/blocks, clean editor, Notion-like simplicity, but not copied.

### Thread reference

Conversation summary card with continue/open.

### Flashcard deck

Deck overview, card count, weak cards, study action, preview.

### Quiz

Question count, difficulty/source metadata, take quiz/review results.

### Planner task

Due date, status, linked artifacts, workspace.

## Visual consistency

All objects should share:

```txt
border radius
spacing scale
typography scale
chip style
icon style
hover behavior
focus ring
loading states
empty states
```

Blueprint renderers may differ, but they should feel part of the same system.

## Frontend-design skill

Before major UI work, the coding agent must activate/read the frontend-design skill and relevant `SKILL.md` files if available.

If unavailable, this file is the fallback UI source of truth.

## Important anti-slop rule

Do not create temporary ugly UI with the intention of fixing it later unless explicitly marked as a scaffold and deleted in the same wave.

Every milestone should look intentional, even if incomplete.

# Approach B: Magnetic Surface

## Positioning

This is the recommended direction.

It best matches the product you described after testing the earlier concepts:

- active work centered and dominant,
- infinite canvas preserved,
- hub utilities hidden until needed,
- strong right-panel workflow,
- less rigid than a bottom dock,
- less abstract than a relationship-first sky map.

## Core Metaphor

The viewport is a working surface.

The canvas is still infinite, but the current viewport feels like:

- the part of the surface you are actively using,
- not a tab,
- not a board inside a board,
- not a giant card,
- not a literal desk.

The edges behave magnetically.

- Utilities live there.
- Nearby workstreams can peek there.
- The UI can pull from those edges without permanently occupying them.

## High-Level Topology

```text
 ┌──────────────────────────────────────────────────────────────┐
 │   left edge utilities                           right panel  │
 │  <peek>                                                or    │
 │                                                          edge │
 │                                                              │
 │                    ACTIVE WORKSTREAM FIELD                   │
 │                                                              │
 │        threads lane       documents lane      widgets lane   │
 │                                                              │
 │           open composition, not stacked card columns         │
 │                                                              │
 │                        floating command                      │
 │                                                              │
 │  <peek> timer / shortcuts / deadlines         other edges    │
 └──────────────────────────────────────────────────────────────┘
```

## Why this shell wins

It solves the biggest contradictions in the current product:

- the canvas remains real,
- the active workstream can fill most of the screen,
- the hub does not need to be a giant visible strip,
- the chrome stays peripheral,
- moving between workstreams can happen through click, keyboard, or edge cues,
- panning remains free and never triggers forced camera behavior.

## Surface Layout

The active workspace should not be rendered as repetitive boxes.

Instead:

- threads appear as conversation strips or lifted snippets,
- documents appear as tall typographic sheets or excerpt blocks,
- planner items appear as milestone rows or timeline fragments,
- visual widgets appear as dedicated rendered modules,
- categories are implied by local rhythm, spacing, and headings.

### Example active workspace field

```text
 Biology HL
 ----------------------------------------------------------------
 THREADS
 enzymes discussion      genetics review      lab questions

 DOCUMENTS
 lab report excerpt
 revision summary

 WIDGETS
 progress arc      quiz generator      concept sketch
```

The separators should feel embedded in the surface, not boxed around each group.

## Distinct Visual Language

This shell should feel the most tactile and modular.

- firmer alignment,
- sharper geometry,
- stronger snap behavior,
- utilities that dock and attach instead of floating poetically,
- content blocks that can visually fuse into composite surfaces.

It should not look soft or dreamy. It should feel purposeful.

## Edge Utility Model

This shell uses the richest hidden-edge system.

### Ambient state

- center command surface visible,
- active timer visible if running,
- everything else mostly tucked away.

### Hover / bump state

- hover near an edge,
- a utility strip reveals itself slightly,
- click to expand fully,
- drag to reposition within valid edge zones.

### Edge Affordance Rule

There must always be a visible enough hint that something lives on the edge.

Examples:

- a sliver,
- a glowing notch,
- a pinned chip,
- a subtle motion cue on approach.

### Reveal-all state

- a shortcut or control exposes all utilities simultaneously,
- the user can pin, reorder, or inspect them.

## Workstream Switching

All three entry methods should work.

- click a workspace on canvas,
- click a pinned shortcut on an edge,
- use keyboard navigation or search jump.

### Critical rule

Panning near another workspace does not move the camera for the user.

It may:

- reveal a neighbor,
- increase its visibility,
- hint that it is nearby.

It may not:

- snap focus,
- force zoom,
- enter the workspace automatically.

## Enter / Exit Flow

```text
Overview
  -> click Biology
  -> camera fits Biology bounds
  -> center field opens
  -> edge utilities simplify
  -> Biology dominates viewport

Inside Biology
  -> pan freely
  -> see neighbor hints
  -> click thread
  -> panel opens
  -> command surface transfers to panel

Exit
  -> explicit back or escape
  -> panel closes first if open
  -> field relaxes back
  -> overview restored
```

## Right Panel Story

This shell gives the strongest panel choreography.

### Thread open

- thread snippet lifts,
- drifts toward right edge,
- panel catches it,
- command surface flies down and reappears in panel footer,
- timer remains visible if active.

### Document open

- document excerpt stretches slightly before handoff,
- panel opens wider,
- version history and AI edit flow stay in-panel.

### Whiteboard open

- whiteboard preview opens in the panel as a dedicated drawing surface,
- not on the global canvas.

## AI-Native Behavior

This shell is best for AI as a working assistant.

Examples:

- "Create a planner for next week."
- "Turn this revision summary into a quiz."
- "Improve the timetable widget."
- "Move the deadlines utility to the left edge."

AI should be able to mutate:

- content,
- widget type,
- layout,
- category placement,
- utility pinning,
- workspace colors within safe bounds.

Every action remains revertible.

## Failure Modes

- hidden edges can become undiscoverable if affordances are too subtle,
- too much customization can make the layout incoherent,
- magnetic reveals can become annoying if edge thresholds are too sensitive,
- the active field can still look like columns if the rendering language is not carefully designed.

## What Works

- best balance between focus and world-awareness,
- best fit for the existing right-panel model,
- best answer to your hidden-edge utility idea,
- strongest path to a premium but still practical interface,
- easiest to keep "AI-native" without turning everything into spectacle.

## What Does Not Work

- if the edge system is weak, this collapses into "canvas plus random floating bits",
- if the active field is rendered lazily, it becomes the same boring grouped cards with a different frame,
- if customization is too open, users create clutter and blame the product,
- if AI reorganizes too aggressively, the surface loses trust.

## Verdict

This should lead.

It is the only shell that fully respects all of the following at once:

- canvas-first navigation,
- dominant active workspace,
- mostly hidden utilities,
- strong defaults,
- right-panel continuity,
- AI-driven customization with low learning curve.

## What must be true in implementation

- edge reveals must be deliberate, not twitchy,
- the command surface must feel premium and singular,
- the active workspace must feel expansive,
- the right panel must feel like part of the same system,
- categories must remain readable without devolving into box soup.

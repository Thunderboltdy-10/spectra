# Wildcard D: Strata Canvas

## Why this exists

This is not one of the three primary preview shells.

It exists because if the team keeps struggling with macro-navigation in a 2D infinite plane, the answer may not be "better panning." It may be a different macro-axis.

## Core Metaphor

The workspace world has discrete depth layers.

- The current focus plane is active.
- Adjacent planes remain visible as context.
- Older or background material recedes without becoming another tab system.

This is not full 3D.

It should behave like a 2D web app using:

- scale,
- opacity,
- blur,
- shadow,
- strict active-plane rules.

## Structure

```text
 foreground plane
   active Biology workspace

 mid plane
   Math and Chemistry nearby

 far plane
   dormant or archived workstreams
```

The user still arranges widgets freely within the active plane.

## The Elevator Model

The cleanest way to make this usable is to treat depth like an elevator, not free-flight.

- one plane is active at a time,
- one plane can sit behind it,
- one transient overlay plane can sit above it.

### Plane roles

- `reference plane`
  older notes, supporting material, background work
- `active plane`
  current workspace
- `tool plane`
  command surface, right panel, transient controls

### Interaction

- normal scroll and pan work inside the active plane,
- an explicit modifier or UI control moves between depth planes,
- clicking a background plane can pull it forward into focus.

## Side View Diagram

```text
[Tool Plane]
  right panel
  command surface

========================
[Active Plane]
  current workspace
  crisp
  full interaction

------------------------
[Reference Plane]
  older notes / related workspace
  scaled down
  slightly blurred
  no direct editing until promoted
```

## On-Screen Mental Model

```text
┌──────────────────────────────────────────────┐
│  overlay tools                              │
│                                              │
│   ACTIVE PLANE                              │
│   full scale                                │
│   full opacity                              │
│                                              │
│      faint reference below                  │
│      smaller, softer, behind current work   │
└──────────────────────────────────────────────┘
```

## Plane Swap Diagram

```text
State A
  Active: Biology workspace
  Behind: old revision notes

Action
  user triggers depth change

State B
  Active: revision notes
  Behind: Biology workspace
```

## How it should feel

The motion should not be theatrical.

It should feel like:

- pulling a background layer into focus,
- pushing current work slightly back,
- never rotating the world,
- never distorting text.

## Why it could be valuable

- very strong focus by default,
- easier macro-organization,
- less need to endlessly pan around a giant map,
- completed or quiet work naturally recedes.

## What makes it interesting

This shell could unify two competing desires:

- "I want the canvas to remain spatial,"
- "I do not want to get lost in endless panning."

It gives macro-order through depth while preserving free arrangement inside the active plane.

## Why it is risky

- higher implementation complexity,
- different mental model,
- may feel too far from the current Spectra direction,
- could confuse users if depth cues are weak.

## What would make it fail

- fake 3D rotations,
- too many simultaneous active layers,
- unreadable blurred text,
- hidden depth controls,
- turning it into a novelty rather than a useful structure.

## Recommendation

Do not build this before the three primary shells.

Keep it as a pressure-release option if 2D overview navigation still feels wrong after the main redesign.

If it ever gets promoted from wildcard to real preview, it should still reuse:

- the same widget engine,
- the same right panel,
- the same AI provenance model,
- the same command surface.

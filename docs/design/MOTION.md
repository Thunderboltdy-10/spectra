# Motion

Spectra should feel alive: calm at rest, responsive to every touch, and lit up where work is happening. The hard part
is continuity. Effects must stay smooth for as long as they run, and every change of state must flow into the next.

The field and the prism, which carry most of Spectra's life, are defined in [LIFE.md](LIFE.md). This document covers
how interface elements themselves move.

## Principles

1. **Continuous.**
   - Spatial motion uses springs, not fixed tweens.
   - Any animation can be interrupted and continues from where it is.
   - Nothing snaps, flashes or restarts.
2. **Causal.**
   - Things come from where they were and go where they are going.
   - A card opening grows from the card. A thread joining the island streams to the island.
3. **Physical.** Things have weight and momentum:
   - a flick keeps going;
   - a drop settles;
   - a press compresses and rebounds.

   Neighbours react: tabs part for a dragged tab, and rows ease aside for a dropped row.
4. **Quiet at rest.** When nothing is happening, nothing moves except the prism's breath.
5. **Light means life.** Spectral light marks real activity only, and fades after it ends.
6. **Reduced motion is designed, not dropped.**
   - Every effect has a reduced variant: cross-fades instead of travel, and a static light instead of a sweep.

## Tokens

Tokens live in `src/features/spectra/motion/tokens.ts`.

| Tier | Use | Values |
| --- | --- | --- |
| Micro | Hover, press, toggles, focus | Press: 90 ms in, a spring out. Hover: 120 ms. |
| Spatial | Panels, menus, the island, layout changes | Springs: `snappy` for menus and popovers, `smooth` for panels and the Side, `gentle` for island morphs |
| Narrative | Choreography with several steps (a thread arriving, AI writing, a morph through particles) | Up to 900 ms, with steps overlapping |

Durations are deliberately not short. A morph that reads as a real transformation takes 450–700 ms. Only feedback to
a direct touch (press, hover) is instant.

**What animates.** Only `transform`, `opacity` and `filter`. Layout changes use FLIP or layout animations, never
animated layout properties.

**Tools.**

- `framer-motion` for layout and shared elements;
- the View Transitions API for route changes;
- CSS for micro states;
- the life engine (see [LIFE.md](LIFE.md)) for anything made of particles.

## Catalogue

### Controls

- **Press.** Every press compresses slightly, rebounds with a spring, and sends a ripple into the field.
- **Hover.** Hover raises tone, not size.
- **Focus.** Focus rings draw in.
- **Toggles.** They slide with a spring, and the knob overshoots slightly.
- **Menus.** They open from their trigger and close back into it.
- **Tooltips.** Every icon-only control has a tooltip with its name and shortcut, after about 500 ms (instantly once
  one tooltip is showing). Controls are designed so the tooltip is rarely needed.

### Drag and drop

- **Picking up.** The picked item lifts: its scale grows to 1.02, it gains elevation and tilts slightly with its
  velocity.
- **Moving.** Neighbours make room with springs, and the item leaves a faint wake in the field.
- **Dropping.** The item settles with a short overshoot, and the target ripples.
- **Cancelling.** A cancelled drag flies back along its path.

### Panels

- Opening, closing and collapsing slide from the panel's edge, while the content fades in after the frame.
- The rail's switch between full and icons is a morph: labels fade while the width springs.
- When the Side floats over the stage, it rises with elevation.

### Shared elements

- **Library card → artifact:** the thumbnail grows into the editor.
- **Side artifact ↔ fullscreen artifact.**
- **Threads view row → island tab:** particles stream into the tab.
- **Artifact card in a thread → the opened artifact.**

### Spectra writing (AI light)

**Writing into an artifact.**

- A soft spectral band sweeps across the region being written. The field glows in the paper around it (see
  [LIFE.md](LIFE.md)).
- Text resolves out of the light front, a few words at a time, from a slight blur. It never appears character by
  character.
- New slide elements, board nodes and cells condense out of particles.

**Spectra's presence in an artifact.** Spectra's cursor is a small prism caret, with a short trail of light.

**Afterwards.**

- The light fades about 1.2 s after the last write.
- A faint tint stays on changed regions until the user has seen them, then fades.

### Streaming text in a thread

- Words fade in from a slight blur to sharp, at a steady rate.
- A small buffer smooths uneven network chunks, so text never stutters or jumps.
- The scroll follows, unless the user has scrolled up.

### Captions

- The current caption has light running slowly along its left edge.
- When a step completes, the light settles into a done mark, and the title changes to past tense with a quick
  cross-fade.
- When the run ends, the trace folds into one line.

### Artifact status

See [EDITORS.md](EDITORS.md#the-status-control). State changes animate inside the glyph:

- a cloud fills as it saves;
- arrows turn while syncing;
- a shackle closes when the file is locked.

They never animate as a separate banner.

## Performance

Spectra is gaining a great deal of life, and it must not get slower. These budgets apply to every lane, from the first
commit.

**Heavy libraries.**

- There is no WebGL and no 3D library in the app.
- Heavy libraries (editors, charts, code runtimes) load only when the user first needs them.

**Ambient effects.**

- The field runs in a worker and sleeps at rest (see [LIFE.md](LIFE.md#budgets-and-tiers)).
- Main-thread animation work stays under about 2 ms per frame.
- Animation pauses when the tab is hidden or the element is offscreen.

**What to animate.**

- Animate `transform`, `opacity` and `filter` only.
- No animation loops driven by layout.
- Long lists are virtualised.

**Weak devices.**

- Every effect has a cheaper tier. The tier is chosen once, from device signals and early frame times.
- Reduced motion is its own designed tier, not a broken one.

**Targets on a mid-range laptop.**

- INP under 200 ms.
- No long tasks over 50 ms during interaction.
- Route JavaScript growth is justified in each lane's report.

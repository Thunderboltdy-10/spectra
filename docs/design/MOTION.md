# Motion and life

Spectra should feel alive: calm at rest, responsive to every touch, and lit up where work is happening. The hard part
is continuity. Effects must stay smooth for as long as they run, and every change of state must flow into the next.

## Principles

1. **Continuous.**
   - Spatial motion uses springs, not fixed tweens.
   - Any animation can be interrupted and reverses from where it is.
   - Nothing snaps, flashes or restarts.
2. **Causal.**
   - Things come from where they were and go where they are going.
   - A card opening grows from the card. A thread joining the island flies to the island.
3. **Quiet at rest.** When nothing is happening, nothing moves except the faint idle light of the prism.
4. **Light means life.** Spectral light marks real activity only, and fades after it ends.
5. **Reduced motion is designed, not dropped.**
   - Every effect has a reduced variant: cross-fades instead of travel, and a static light instead of a sweep.

## Tokens

Tokens live in `src/features/spectra/motion/tokens.ts`.

| Tier | Use | Values |
| --- | --- | --- |
| Micro | Hover, press, toggles, focus | Press 90 ms in and 160 ms out. Hover 120 ms. |
| Spatial | Panels, menus, the island, layout changes | Springs: `snappy` for menus and popovers, `smooth` for panels and the Side, `gentle` for island morphs |
| Narrative | Multi-step choreography (thread glide, AI writing, Bridge transfer) | 900 ms at most, with steps overlapping |

**What animates.** Only `transform`, `opacity` and `filter` are animated. Never animate layout properties directly:
use FLIP or layout animations instead.

**Tools.**

- `framer-motion` for layout and shared elements;
- the View Transitions API for route changes;
- CSS for micro states;
- one shared canvas layer for the dot field when it is active.

**Budget.**

- 60 fps.
- No more than about 2 ms of script per frame for ambient effects.
- INP under 200 ms.
- Ambient effects pause in hidden tabs.

## Catalogue

### Controls

- Every press compresses slightly and rebounds.
- Hover raises tone, not size.
- Focus rings draw in.
- Toggles slide with a spring.
- Menus open from their trigger.

### Panels

- Opening, closing and collapsing slide from the panel's edge while the content fades in after the frame.
- The rail's switch between full and icons is a morph: labels fade while the width springs.
- When the Side floats over the stage, it rises with elevation.

### Shared elements

- **Library card → artifact:** the thumbnail grows into the editor.
- **Side artifact ↔ fullscreen artifact.**
- **Threads view row → island tab:** a curved glide.
- **Artifact card in a thread → the opened artifact.**

### Island

- **Rest → hover:** the prism dissolves into dots that re-form as the +, while the pill grows outward from the centre
  and the tabs fade and slide out from behind the +.
- **Hover → composer:** the + rotates into the field's leading glyph and the field widens from the centre.
- **Send:** the field's text condenses into a new tab that slides left out of the +.
- **Working:** the prism's bands brighten one after another. This is a loop from the 3D renders.
- **Finished:** a full prism rotation, then the notification slides out of the prism. The rotation is the user's
  existing animation.
- **Needs you:** the prism unfolds into the question card, with its silhouette leading the shape. Answering folds the
  card back into the prism.
- **Tab → thread view:** the card drops from the tab and stays attached to it with a short connector. Moving between
  tabs slides the card instead of rebuilding it.
- **Dismiss:** a flick sends the tab right with inertia. It fades into the history edge and the others close the gap.
- **Arriving thread:** a ghost flies in, the pill swells to catch it, then settles.
- **Pointer:** the prism tilts slightly toward the pointer (a few degrees) and rebounds when pressed. Drag and settle
  are the user's existing animations.

### Spectra writing (AI light)

**Writing into an artifact.**

- A soft spectral band sweeps across the region being written.
- Text resolves out of the light front, not character by character.
- New slide elements, board nodes and cells condense from the dot field into place.

**Spectra's presence in an artifact.**

- Spectra's cursor is a small prism caret with a short spectral trail.

**Afterwards.**

- The light fades about 1.2 s after the last write.
- A faint tint stays on changed regions until the user looks at them, then fades.

### Streaming text in a thread

- Words fade in from a slight blur to sharp, at a steady rate.
- A small buffer smooths uneven network chunks, so text never stutters or jumps.
- The scroll follows, unless the user has scrolled up.

### Captions

- The current caption has light running slowly along its left edge.
- When a step completes, the light settles into a done mark and the title changes to past tense with a quick
  cross-fade.
- When the run ends, the trace collapses into one line.

### Outcomes as cues

- **Done:** the prism spins and a glint travels across it.
- **Problem:** the prism dims and its bands desaturate briefly. A single plain line appears only if the user needs to
  act.
- **Saved and synced:** this is not announced. Its absence of warning is the signal. A problem is shown where it
  applies, as a cue.

## The dot field

The dot field is the grain of Spectra's paper: the matter that work is made from. It must be polished, complete and
never a distraction.

**At rest.**

- It is visible only in open space (empty states, margins, the area around the island), at very low contrast.
- Behind dense work it disappears.
- **Near the pointer,** in empty areas only, dots lean slightly away from the pointer and drift back.
- **Empty states:** dots gather loosely into the glyph of what belongs there, for example the artifact type or a
  calendar.
- **Loading:** dots converge toward the prism, which then forms.

**With activity.**

- **Creation:** new elements condense out of dots (see AI light).
- **The island:** dots carry the morph between the prism and the + and flow into arriving tabs.
- **Bridge transfers:** dots flow along the path (below).
- **Sign-in and joining:** the field is the stage.

**Implementation.**

- At rest the field is a CSS background, so it costs nothing.
- Active moments mount one shared canvas or WebGL layer of instanced points that sits above paper and below content.
- It is DPR-aware and capped in point count, and pauses when hidden or idle.
- It builds on `src/features/spectra/field/` (`grain-renderer.ts`, `surface-field.tsx`) and replaces what doesn't meet
  this spec.

## Bridge and Lens

The link between Spectra and the desktop is drawn as a path of light between two glyphs: Spectra and the Office app or
folder. Its states replace text:

| State | Visual |
| --- | --- |
| Not connected | A dim, dotted path with scattered dots |
| Connecting | Dots gather toward the path and line up |
| Connected (idle) | A calm, thin line |
| Syncing | Dots flow along the line. The direction shows upload or download. |
| Waiting for Office (file open) | Dots queue at a small gate in front of the Office glyph, with a lock |
| Conflict | The path splits into two strands in different hues that meet at a fork. Clicking the fork resolves it. |
| Done | One pulse travels end to end and settles |

**Lens.** Lens (reading a file) is a lens shape sweeping across the file's thumbnail with a slight refraction. The
extracted parts light up as they are found.

## The prism mark

`SpectraMark` is the one component for the prism everywhere. Its states:

- `idle`;
- `thinking`: a slow internal light;
- `working`: the bands brighten in sequence;
- `done`: a full rotation and rebound;
- `needs-you`: a glint pulse in the needs-you hue;
- `problem`: dimmed and desaturated;
- `pressed`: rebound;
- `drag` and `settle`.

**The prism.**

- It is dark, opaque ink with real blue-violet depth, not glass.
- Its prism effect is light: spectral edges whose colours slide with the view angle, one soft refracted band and a
  clean key highlight.
- It has the asymmetric, chunky, softly bevelled shape of the code-built landing prism.
- It is built to [`docs/brand/PRISM-RUNTIME-PROMPT.md`](../brand/PRISM-RUNTIME-PROMPT.md) in
  `src/features/spectra/brand/prism/`.
- The Blender glass master is an experiment. Only its motion curves are reused.

**Which source at which size.**

- **48 px and below:** a hand-tuned SVG mark (three ink tones and one spectral edge). Press is a CSS transform.
- **49–160 px and the island:** shared WebP sprite atlases baked from the live shader and played with CSS. Drag tilt
  maps to turntable frames.
- **Large hero moments only:** `LivePrism`. It is one lazy WebGL canvas with a single-pass shader, renders on demand,
  and falls back to a poster.

`SpectraMark` never creates a WebGL context. The current `spectra-mark.tsx` drawing is replaced.

## Performance

Spectra is gaining a great deal of life, and it must not get slower. These budgets apply to every lane, from the first
commit.

**WebGL.**

- At most one WebGL context on a page, and only while it is doing something visible.
- Repeated elements (marks, icons, cursors, status cues) are SVG, CSS or shared images, never per-instance canvases.

**Heavy libraries.**

- `three` and `@react-three/*` load only on the routes that show a live 3D moment.
- Other heavy libraries (editors, charts, code runtimes) load when the user first needs them.

**Ambient effects.**

- Ambient effects (the dot field, the idle prism, AI light) cost nothing at rest: CSS or a stopped canvas.
- When running, they stay under about 2 ms of main-thread time per frame.
- They pause when the tab is hidden or the element is offscreen.

**What to animate.**

- Animate `transform`, `opacity` and `filter` only.
- No layout-driven animation loops.
- Long lists are virtualised.

**Weak devices.**

- Every effect has a cheaper tier, and the tier is chosen once from device signals and early frame times.
- Reduced motion is its own designed tier, not a broken one.

**Targets on a mid-range laptop.**

- INP under 200 ms.
- No long tasks over 50 ms during interaction.
- Route JS growth justified in each lane's report.

# Life: the field and the prism

Spectra's life comes from one material: **the field**, a lattice of fine dots behind and above the interface. The
prism is made of it. Effects are not decorations added to elements. They are the field reacting:

- rippling;
- glowing;
- flowing;
- gathering into a shape;
- condensing into something real.

Because everything is made of the same matter, one state can always flow into the next.

The field is mostly invisible:

- At rest, the paper is clean.
- The field shows itself only where something is happening, faintly, and brightest nearest the cause.
- It then settles back into the paper.

## The field

### Matter

- **Lattice nodes.** The paper's grain: about 1.2 px dots on a staggered (hex-packed) grid, 16 px apart. Every node
  has:
  - a home;
  - a displacement and a velocity;
  - an amount of light;
  - a hue.
- **Free particles.** Dots that have left the lattice to travel, flow or form shapes. They come from the lattice or
  from dissolving something (the prism, text, an element), and they return to the lattice or condense into something
  when they arrive.

### Physics

The lattice is a membrane.

- **Movement.**
  - Each node is pulled home by a spring and coupled to its six neighbours.
  - A disturbance therefore travels outward as a ripple, slows and fades, instead of a single dot twitching.
  - Damping is tuned so a strong pulse rings about twice and settles within about 1.5 s.
- **Light.**
  - Light is a second quantity on the lattice. It spreads to neighbours, decays over about 1.2 s, and carries a hue
    or the full spectrum.
- **What you see.** A node's visibility follows its energy:

  ```text
  alpha = min(maxAlpha, a·|velocity| + b·|displacement| + c·light) + reveal
  ```

  A still, unlit node has an alpha of zero.
- **Free particles.**
  - They follow a target with spring physics, plus a little curl noise so paths are organic, never straight lines.
  - They keep a minimum separation from each other, so formations don't clump.
- **Near the pointer.**
  - In open space only, the pointer gently pushes the nearest nodes away.
  - It reveals the grain within about 120 px, at about 6% alpha, fading out at the edge.
  - This is the "idle field": the grain that answers when the user moves, and is gone when they stop.

### Layers

- **Back layer.**
  - It sits below the content and above the app's paper background.
  - Opaque surfaces (panels, cards, editor pages and canvases) cover it naturally, so ripples show in open paper and
    around things, never through them.
- **Front layer.**
  - It sits above the content and holds only free particles: streams, dissolves, condensations and drag wakes.
  - It is very sparse, and nothing lingers over content for more than about 600 ms.
- Both layers are fixed to the viewport and live in one engine.

### What the field does

| Moment | The field |
| --- | --- |
| Press any button | A small ripple starts at the press point and runs out into the surrounding paper. The button itself compresses and springs back. |
| Drag (tabs, rows, cards, files, slide elements, board nodes) | The dragged thing leaves a faint wake of particles. Nodes part as it passes over open paper. The drop target receives a ripple when it lands. |
| Drag a file from the desktop | Nodes lean toward the drop zone and its edge gathers light |
| Something new appears (an artifact, an element, an event, a row) | It condenses out of particles drawn from the nearby field |
| Something is deleted | It dissolves into particles that drift back into the lattice |
| Loading | The field gathers into the outline of what is coming: dots forming rows, a page, a grid. It condenses into the real content when ready, so dot formations replace skeletons. A short load (under 300 ms) shows nothing. |
| Empty state | The field gathers loosely into the glyph of what belongs there, then stays faint until the pointer comes near |
| Spectra writing | Spectral light rises in the paper around the region being written and flows along with the writing front. A few particles drift off the caret. |
| Spectra working (island) | Faint spectral particles shed from the turning prism's edges and drift into the field |
| Needs you | Warm orange light gathers around the island and leans toward the user |
| Done | One clear ripple from the island across the bottom of the screen |
| A thread joins the island | Its row sheds particles that stream along a curve into the new tab |
| Send a message | The text condenses into particles that stream into the new tab |
| Problem | The light at the source turns red and stills. Nothing shakes. |
| Someone else edits | Faint light in their hue near their cursor, only in open paper |

### In editors

The field never competes with the work.

- **Over content.** Text, slides, sheets and boards are opaque, so the back layer stays out of them. Over content, the
  front layer is limited to:
  - condensation and dissolve of elements the user or Spectra creates or deletes, lasting at most about 600 ms;
  - drag wakes;
  - a few caret particles while Spectra writes.
- **Inside content,** Spectra's writing is shown by AI light in CSS (see [MOTION.md](MOTION.md)), not by dots.
- **In the margins,** around the page or canvas, the field can be livelier.

### Budgets and tiers

**Where it runs.**

- The engine runs in a Web Worker on OffscreenCanvas, so its frame work never touches the main thread.
- The main thread only posts small event messages, at most once per animation frame, and stays under 0.3 ms per frame.

**Sleeping.**

- When total energy falls below a threshold, the worker stops its frame loop. At rest the field costs nothing.
- It also pauses when the tab is hidden.

**Frame cost.**

- Simulation and drawing stay under about 4 ms per frame in the worker.
- Only nodes with energy are touched (a sparse active set).
- At most about 1,500 free particles on the full tier.

**Tiers.** The tier is chosen once, from device signals and the first frames:

| Tier | Behaviour |
| --- | --- |
| Full | Everything above |
| Light | A 22 px lattice, 30 Hz simulation, at most 400 free particles, no curl noise |
| Still | For reduced motion, or no OffscreenCanvas: no moving dots. Events become brief static glows and cross-fades. |

### Engine API

The engine lives in `src/features/spectra/life/`. Components never draw the field themselves. They call the engine:

```ts
life.pulse(point, { strength?, hue? })            // ripple: presses, drops, done
life.wake(point, velocity)                        // drag trail, call per frame while dragging
life.glow(rect, { hue | "spectrum", intensity })  // returns a handle; stop() fades it
life.gather(shape, rect)                          // loading and empty-state formations; returns a handle
life.stream(fromRect, toRect, { count, hue })     // particles travel along a curve
life.dissolve(source, rect)                       // source: a canvas, an element's bitmap or text; returns particles
life.condense(particles, target, rect)            // particles assemble into a target bitmap or path, then hand over to the DOM
```

**What uses it.**

- Kit primitives (Button, IconButton, Row, Tab, Panel, drag handles) call the engine themselves, so pages get life
  without writing any.
- Pages call it only for their own moments (a calendar block landing, a slide element condensing).

## The prism

The prism is Spectra: the mark, the AI's presence and the island's resting form. It is drawn in code by the same
engine family. There is no 3D library, no WebGL and no image assets at runtime.

### Form

The reference is the user's own code-made model (2026-10-03): a thin, clean, dark glass solid with crisp edges.

- **Shape.**
  - A triangular prism: an equilateral triangle, apex up, with slightly softened corners.
  - It is thin: the depth is about a quarter of a side. It is never chunky.
  - A narrow bevel runs round both caps. The bevels are the prism's defined edges.
  - At rest it is turned a little (yaw about −26°, pitch about 11°), so one side face and the upper face show. That is
    also the static mark.
  - Its silhouette must read instantly at 16 px. Marks (16–32 px) use a wider bevel so the edge still reads.
- **Material.**
  - A deep indigo body, slightly dark and translucent: the page shows through the caps, and the far edges show
    faintly through the body.
  - A cap facing you is at its most see-through; turning edge-on makes it denser, like tinted glass.
  - Each cap carries one soft band of reflected light. The band moves with the cap's angle, so turning the prism
    sweeps it across the glass.
  - The spectrum lives on the edges only:
    - the bevels carry it, strongest where the key light catches them, and white at the peak;
    - a fine spectral line runs where each cap meets its bevel, like the fringe a real edge throws;
    - the hues slide along the edges as the solid turns.
  - **No light passes through it.** There is no beam, no internal band, no fan, no glow around it and no shadow
    under it.
  - It must sit comfortably on paper beside text, never as a black blot or a glossy orb.
- **Rendering.**
  - `src/features/spectra/life/prism.ts` builds the mesh once, then rotates and projects it each frame.
  - Faces are shaded analytically into a display list: a gradient per cap, a gradient along each bevel and side
    strip, then lines.
  - The display list paints on a 2D canvas, live, or as a static SVG via `prismSvg` (favicon, tray, app icons).
  - It is convex, so there is no sorting: back faces first, then front faces, then lines.
  - It is crisp at every device pixel ratio.

### Sizes

| Size | Where | How |
| --- | --- | --- |
| 16–32 px | Rail brand, favicon, tray and app icons | The static mark: `prismSvg` or one canvas draw. In the rail it is live on hover. |
| 28–40 px | The island and the agent switch | Live, drawn only while its body is moving |
| 64–200 px | Empty states, sign-in, onboarding | Live, the full detail |

**Where it appears.**

- The prism appears in the rail (the brand), the island, and the moments that are about Spectra itself.
- It is not repeated in page headers, cards or buttons.
- The progress of a run is shown by the island and the trace, not by extra prisms.

### Behaviour

The prism has a body (`PrismBody`):

- a quaternion orientation;
- an angular velocity;
- a scale;
- springs that pull it toward a target pose.

Everything it does is a target change or an impulse, never a canned keyframe, so every motion blends into the next.

The prism has six rotational symmetries. When a spin slows, a detent pulls it to the nearest symmetric copy of its
target pose, predicted a moment ahead. A spin of any size therefore settles on whichever copy it reaches and never
unwinds. At rest the body is settled and asks for no frames at all.

| Input or state | Body |
| --- | --- |
| Rest | Still. There is no idle animation. |
| Pointer near | It leans toward the pointer, up to about 18° across and 13° vertically. |
| Hover | It spins round once about its vertical axis, turning away from the side the pointer came from, and grows to 1.06. |
| Press | It squashes to about 0.88 and tips back. On release it rebounds with overshoot, and a click without a drag adds a half turn. The field ripples from it. |
| Drag | The pointer turns it freely in 3D. On release it keeps its momentum, spins down with a little air drag, then catches in the detent. |
| Thinking (no tool yet) | It turns steadily, about once every 7 s, on a slightly tilted axis. The edge spectrum drifts slowly round. |
| Working | It turns about once every 2.6 s with a slow wobble. The edges carry the full spectrum, and the hues flow round them. |
| Needs you | It turns to face the user and stops spinning. It breathes in scale and nods every 2.6 s. Its edges warm to orange. |
| Done | Two quick turns, and a flash along every edge. Then it settles with overshoot, and its edges keep the full spectrum until the thread is seen. |
| Problem | A short shake about its axis. Its edges drain to grey, and it tips back slightly. |

Reduced motion sets the body to `still`: no spins, springs or leans, only colour changes.

### Morphs

The prism never cuts to something else.

1. It dissolves: its rendered pixels are sampled into particles that carry their own colours.
2. The particles travel to the next shape:
   - the + of the pill;
   - the outline of the question card;
   - an agent's glyph;
   - the notice text.
3. They condense, and the real element fades in under them.

Reversing a morph re-forms the prism from the same particles. A morph takes about 450–700 ms and can be interrupted
at any point.

### Reduced motion

The prism stays still. States are shown by its light (working, needs you, done, problem). Morphs become cross-fades.

## Applying it

- **Faint by default.** If an effect would be noticed from across the room, it is too strong. The strongest moments
  are done, needs you and arriving.
- **Causal.** Every effect starts at its cause and travels from there: the press point, the dragged thing, the
  writing front, the island.
- **Never decorative.** No ambient particles, no drifting background and no idle animation.
- **Measure it.** Every lane that adds a moment keeps within the budgets above and says so in its report.

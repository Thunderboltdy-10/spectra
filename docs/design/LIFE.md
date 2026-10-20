# Life: the field and the prism

Spectra's life comes from one material, **the field**: a lattice of fine dots behind and above the interface.

The field carries what happens between things: a press, a send, a move, news from the prism. What is
**coming** or **being worked on** is never dots: it is the skeleton, grey bars at the content's real places with
a band of light crossing them every 1.6 s (**ghost**, and in CSS **the band**, `spectra-field.css`). What appears
is there at once, whole and usable, and the band crosses it once as it lands. Nothing waits on the field.

The field is mostly invisible:

- At rest, the paper is clean.
- Wherever something moves through it, it surfaces around that thing, as a regular grid of faint dots. You see the
  medium being travelled through.
- It then sinks back into the paper.

## The field

### Matter

- **Lattice nodes.** The paper's grain: dots of about 1.2 px on a staggered (hex-packed) grid, 16 px apart. Every
  node has:
  - a home;
  - a displacement and a velocity;
  - light (a colour and an amount);
  - presence (how far the field has surfaced there);
  - `taken` (its dot has lifted out to travel, and it refills over a moment).
- **Formations.** A figure (strokes plus a fill) laid with dots every 3.6 px.
  - Each dot lifts out of a lattice node (or out of the shape before it).
  - It travels to its place with spring physics and a little curl noise.
  - As it arrives it reaches toward its neighbours, so the dots grow into the line itself.
  - The fill comes in only once the outline has closed.
  - The real element then takes over, and the formation fades.
- **Signals.** Light carried through the lattice along a gentle curve. The nodes draw together around its head and
  are pushed along with it, so the dots carry the light rather than watch it pass. The head is a bright knot.
- **Loose particles.** Only for reactions: a few dots that radiate from the prism and sink back into the field as
  light.

### Physics

The lattice is a membrane.

- **Movement.**
  - Each node is pulled home by a spring and coupled to its six neighbours.
  - A disturbance therefore travels outward as a ripple, slows and fades.
  - A strong pulse rings about twice and settles within about 1.5 s.
- **Light.** It spreads to neighbours, decays over about a second, and carries a colour or the full spectrum.
- **Presence.**
  - Formations in motion, signal heads and absorbing targets raise the field's presence around them, and it recedes
    over about a second.
  - Where it is present, the grid shows in ink at about 13% (17% in dark), and each dot glimmers on its own beat.
- **What you see.** A node's alpha is:

  ```text
  alpha = min(0.95, motion + 1.3·light + reveal + presence·rest) · (1 − taken)
  ```

  A lit node is also larger, up to about 3 px.
- **Formation dots.**
  - In flight, a dot is a dot: always DOT (1.9 px) wide, and it keeps at least 42% alpha, leaning toward the ink, even
    when the line it will become is faint.
  - Once it has joined a neighbour, it takes the line's width. Wide lines (content bars) thicken dot by dot.
- **Near the pointer.** The pointer parts the grain in open paper and reveals it within about 120 px, at about 6%.

### Layers

- **Back layer.**
  - It sits below the content. Opaque surfaces cover it, so the medium shows in open paper and around things.
- **Front layer.**
  - It sits above the content and holds formations, raised light from passing signals, and loose particles.
  - Nothing lingers over content: a formation hands over to its element as soon as it is whole.

### Choreography: what each animation is for

Every animation means one thing, and appears in one kind of place. If a moment isn't in this table, it has no
animation.

| Verb | What it means | Where it appears |
| --- | --- | --- |
| **pulse** | "This happened here." | Presses, drops, a thing settling into place, done |
| **wake** | "Something is moving through the paper." | Drags, fast pointer moves over open paper |
| **glow** | "Spectra is working on this." The skeleton's band crosses the region (`data-life-working`, `useLifeGlow`, `markWorking`); a small working mark (`WorkingMark`, two banded bars) stands for it in a row or a tab. Never dots. | Around a region while Spectra writes or edits it, a sync, a pairing |
| **send** | "Something went from here to there." Only light moves. | Adding A to B, moving a row to a list, a file to a folder |
| **arrive** | "This now exists." It is there at once, and the band crosses it once (`markArrival`, `useLifeEntrance`). | Anything new: a card, a row, a notice, a panel, what Spectra made |
| **unform** | "This no longer exists." Its lines part into dots that sink. | Deleting anything |
| **morph** | "This *is* that, in another shape." A ghost's lines flow into the content's. The island changes shape as one object instead: its paper stretches from one shape into the next (`island/shape-morph.ts`). | A ghost handing over to its content; the island's dock ↔ composer, a tab ↔ its thread card |
| **travel** | "This goes there and becomes that." It breaks, pours into the field, crosses it as light, and forms (or is taken in) at the far end. A target close by is poured into directly. | Anything that changes place: a message into the prism, Spectra's question out of it, an answer back, an artifact Spectra makes |
| **ghost** | "This is coming." A skeleton of the real content (frame, title and text lines at their real places) with a band of light sliding along it. | Loads of more than 300 ms. One placeholder is one ghost: a list's rows are its bars, with no frame unless it shows one. When the content arrives, the ghost's lines flow into the content's frame and lines (a morph), and then the content is real. |
| **breathe** | "The prism took something in" or "the prism changed state." It parts into dots, swells a little and reassembles. | The prism only: receiving, asking, starting work |
| **radiate** | "The prism has news." A few dots in the status colour fly from its edges and sink as light. | The prism: done (green), problem (red), a question for you (yellow), work that starts without a message from here (spectrum). Elsewhere only the frame of something judged right (green): an answer, a passed test |
| **absorb** | "This took that in." The field around it draws in. | The end of a send or travel into something |

**The choreographies that combine them:**

| Moment | Choreography |
| --- | --- |
| Hover the island | The rail's tabs rise from behind the dock one after the other; Ctrl J stretches the dock's paper into the composer with a little overshoot, the old contents fading as the new ones come in over it. |
| Leave the island | The same stretch back to the dock. |
| Open a thread from its tab | The thread card grows out of its tab, and folds back into it when closed. |
| Send a message | The words become dots and **travel** (pour) into the prism as the composer folds back round them. The prism **breathes** and starts working (status dot: spectrum). |
| Spectra asks | The question is there at once and **arrives**; the prism radiates yellow. Status dot: yellow. |
| Answer | The question **travels** back into the prism, which **breathes** and turns. Status dot: working. |
| Spectra creates an artifact | While it writes, its card carries the working mark and, while still empty, a skeleton of the lines to come; then it **arrives**. The prism **radiates** green, and its status dot shows done until seen. A live answer shows skeleton lines under the words written so far. |
| Done or problem | The prism **radiates** in the status colour and its status dot stays until seen. |
| A question, or work that starts on its own | When a question arrives the prism turns and **radiates** yellow; when an agent or a schedule starts work (not a message sent from here, which already travelled in), it turns and **radiates** the spectrum. `statusLight` decides. |
| Load | A **ghost** of the real content forms from the field and shimmers until the content arrives, then hands over. |
| Delete | The thing **unforms** from where you acted. |
| Join any list | `<LifeKey id>` inside an item (`of="tr"` in a table cell), a `Row` with a `lifeKey`, or `useLifeJoin`: an item that joins a list because of a press, or while Spectra works, **arrives**, and removed it **parts**. What a list opened with, more than two at once, or anything inside something still forming is simply there; when the list itself goes (a tab, a collapsed group) nothing parts. |
| Go to a page (the rail, a card, a creation) | The page's header **arrives** (`PageHeader` lands a launch, keyed by its title or `lifeKey`; rail destinations and pinned works are launchers). The page already open stays still. |
| Hand over (an empty state gives way to content) | The stand-in **flows into** what takes its place: its dots morph into the new content's lines (`useLifeHandover`, `<LifeHandover />` in `EmptyState`). With nothing there it parts; content that is forming itself brings its own light. |
| Add A to B | A **send** from A into B, which **absorbs** it and pulses. |
| Move (another column, day or folder) | The thing **travels**: its old shape breaks into the field, crosses it and forms where it is now. A move in place, or many at once (a re-sort), simply lands. Keyed departures (`useLifeDeparture(..., key)`) and arrivals under the same key in one commit make the move. |
| Create by hand (new work, duplicate, agent, event, comment) | While the request is on its way, a small **ghost** gathers where the user acted (`beginCreation()`). When it exists, what it becomes **morphs out of them**: the surface that opens (`land()` hands the seed to `useLifeLanding`), or with `{ into: "item" }` the event or comment that arrives (its "human" arrival claims the seed); if it fails, they part (`cancel()`); if nothing opens within the launch window, they go back to the field. |
| Tick something off | The paper **pulses** green where it was done: a task's done control, a step, a checklist item in a work (`data-life-done`). Undoing it is quiet. |
| Verdict (an answer checked, a card graded, a test run) | The paper **pulses** where the reader acted, green for right, red for wrong, blue for an open answer that is reviewed; a right answer's frame sends a few green dots off it (`useLifeVerdict`, `<LifeVerdict />`, `verdictAt`). Only a verdict that arrives on screen counts: coming back to an answered question is still. A revealed answer **arrives** (`<LifeForm />`), as do the end of a study queue and a quiz's result; reopened, they are simply there. |

### In editors

The field never competes with the work.

- **Over content.** Text, slides, sheets and boards are opaque, so the back layer stays out of them. Over content,
  only these appear, each handing over within about 600 ms:
  - form;
  - unform;
  - morph;
  - travel arrivals.
- **Inside content,** Spectra's writing is shown by AI light in CSS (see [MOTION.md](MOTION.md)), not by dots.
- **In the margins,** around the page or canvas, the field can be livelier.

### Budgets and tiers

**Where it runs.**

- The engine runs in a Web Worker on OffscreenCanvas.
- The main thread posts small command messages, at most one per frame, and stays under 0.3 ms per frame.

**Sleeping.**

- When no node carries energy, light, presence or a taken dot, and nothing is forming or travelling, the worker
  stops its frame loop. At rest the field costs nothing.
- It also pauses when the tab is hidden.

**Frame cost.**

- Simulation and drawing stay under about 4 ms per frame in the worker.
- Only the active window of the lattice is touched.
- Formations draw as one path per colour per stroke.

**Tiers.** The tier is chosen once, from device signals and the first frames. A device with 4 cores or 4 GB or less
starts light. Otherwise the engine times its first 90 active frames, and if the median passes 6 ms it moves to the
light tier the next time it falls asleep (never in the middle of a moment) and stays light for the visit. The writing
front finds the end of a reply from the end, so a long reply costs no more than a short one.

| Tier | Behaviour |
| --- | --- |
| Full | Everything above |
| Light | A 22 px lattice and at most 300 loose particles |
| Still | For reduced motion, or no OffscreenCanvas: no moving dots. Events become brief static glows and cross-fades. |

### Engine API

The engine lives in `src/features/spectra/life/`. Components never draw the field themselves. They describe what
changes as figures and call `life`.

Figures are plain data:

- `outlineFigure`, `rowsFigure`, `circleFigure`, `combine` and `prismFigure` (in `figure.ts`);
- `figureOf(element, { bars })` (in `figure-dom.ts`), which reads an element's outline, surface and text lines so a
  formation is exactly the element it hands over to.

```ts
// The field
life.pulse(x, y, strength?, colour?)                   // a ripple
life.wake(x, y, vx, vy)                                // drag trail, per frame while dragging
life.glow(rect, colour)                                // a handle; stop() fades it

// Matter
life.form(figure, { from?, colour?, hold? })           // Formed: .formed, .gone, .release(), .sink()
life.unform(figure | formed, { from? })                // Promise: gone
life.morph(from, to, { hold? })                        // Formed
life.travel(from, to | { absorb: rect }, { colour })   // from: a figure, a formation or a point
                                                       // Travelled: .arrived, .formed, .gone
life.ghost(figure)                                     // Formed, held and shimmering until release()
life.send(from, to, { colour, absorb? })               // Promise: arrived

// The prism's reactions
life.breathe(prismFigure, amount?)                     // Formed
life.radiate(prismFigure, { colour, count, reach })
life.absorb(rect, { colour })
```

**Mounting.** One `LifeField` is mounted for the whole app in `Providers`, on every page except the landing page,
which has its own field. The back layer sits at z-index −1, directly over the body's paper; the front layer sits just under toasts, over the island and modals. Pages are transparent
(`.spectra-wave-y` and the stage have no background of their own), so the medium shows in open paper, and every
surface with a background covers it.

**Hooks** (`use-life.ts`), for components:

- `useLifeGlow(ref, active, colour?)`: glow around an element while Spectra works on it; it follows the element
  as it resizes and scrolls. Cards glow while `creating` or `updating`.
- `useLifeEntrance(ref, { from?, bars? })`: the element forms out of the field where it appears, then takes over.
- `unformElement(element, { from? })`: call just before something is removed.
- `travelElement(from, to | { absorb })`: from an element or a point, to an element or into one.
- `useLifeSurface({ wait? })`: a callback ref for floating surfaces. Dialogs, sheets, popovers and menus form from
  what opened them (the last press, or the focused control for Enter or Space) and part where they were when they
  close. With `wait`, a dialog stays invisible until its dots have formed it; menus are usable at once while their
  rows gather.
- `useLifeArrival(ref, key, kind)`: something new forms the first time its key appears after the page has settled.
  `"ai"` light leaves the prism, crosses the field and forms the element; `"human"` forms from the user's last
  action. Whatever was there when the page opened is simply content, and a key forms only once per visit. Artifact
  cards arrive while Spectra is creating them, or for 30 seconds after they were made (`cardArrival`).
- `useLifeDeparture(ref, enabled?)`: something removed parts where it was. It is measured while still on the page and
  unforms on the next frame, only if it really left: not on a page change, not on a remount, and not when more than
  four things leave at once (a filter or a folder change is a new view, not removals). Cards and `Row` use it.
- `useWritingFront(ref, active)`: while Spectra's reply streams into a thread, a faint spectrum light in the field
  follows the writing front (the end of the last written word). The tail itself carries Spectra's caret, a small
  prism of the spectrum that breathes until the reply is complete.
- Causes: the last press, the last drop, the control acted on from the keyboard, or where Spectra's spark is working a
  control (`markCause`), within one second. The composer's
  files and @ references form from that cause and part when removed; on send they go with the words, not apart.
- `useLifeLanding(ref, key)`: shared elements (MOTION.md). Pressing a card (`[data-spectra-card]`) or any
  `[data-life-launch]` element remembers its figure; the next surface that lands within 2.5 s (a work or a thread in
  the Side, a work opened full) morphs from it: the card's dots flow into the new frame, then the surface is real.
  Without a recent launch the surface makes its own entrance.
- Sends ("add A to B"): any drag in the page that ends in a drop the page takes (`preventDefault`) carries light
  from what was dragged into the closest `[data-life-receive]` (a folder, a list, a tab), which takes it in and
  pulses; without one, the light lands where it was dropped. For moves that are not drags (a "Move to" menu,
  Spectra filing something), call `sendInto(target, from?)`. `from` defaults to the last cause; `null` only pulses
  the target.

**Ghosts.** Every `Skeleton` is marked `data-life-ghost` (its lines `data-life-ghost-bar`). While the field is on
(`html[data-life="on"]`), `LifeField` holds a ghost of each one in the field, at most 16 at a time, and the CSS pulse
stops. When the content replaces it, the ghost is released and the dots hand over to the real lines.

**Spectra's spark.** When Spectra drives the interface (the follow choreography), its cursor is a small turning spark
of the spectrum, not an arrow. Each control it uses glows, and its light crosses the field from the last control, or
from the prism, to the next one.

**The favicon** is `prismSvg` of the resting prism with its status dot. It reads the `prism.status` query that the
island publishes. Until the island publishes one, the favicon shows working while a run is live, and yellow while
a run waits on the user.

**What uses it.**

- Kit primitives (Button, IconButton, Row, Tab, Panel, drag handles) call the engine themselves, so pages get life
  without writing any.
- Pages call it only for their own moments, from the choreography table above.

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
| 16–32 px | Rail brand, favicon, tray and app icons | The static mark: `prismSvg` or one canvas draw. In the rail it is the live body (`PrismLoader interactive`): it leans toward the pointer, turns on hover and squashes on press. |
| 11–28 px in the page | Sign-in, chat avatars, Spectra in presence chips, a running trace | `SpectraMark` is the static mark (both themes in its markup; `mono` in the surrounding colour). `PrismLoader` is the live body on a small canvas: it turns while working, warms while waiting, settles when done, and draws only while it moves and is on screen. There is no other prism drawing. |
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

### Status dot

The prism's moments are short, so its state stays visible as a small dot by its top right corner. The dot sits
apart from the solid, not on a vertex.

| Status | Dot |
| --- | --- |
| Working | Cycles slowly through the spectrum |
| Needs you, warning | Yellow; needs you breathes |
| Done | Green, until the thread is seen |
| Problem | Red |
| Info | Blue, until seen |
| Offline | Grey |

- **Appearing.** It slides out from the nearest vertex on a spring, overshooting a little. It shrinks back into the
  vertex when cleared.
- **Clearing.** Done, needs you and info clear when the user sees the thread (`markSeen`). Working clears when the
  work ends.
- **In icons.** The dot is part of the display list, so the favicon and tray icons (`prismSvg`) show it too.

### Morphs

The prism never cuts to something else. It is a figure like any other (`prismFigure`):

- its silhouette;
- the spectral rails of its near face, with their colours;
- its status dot;
- its body as the fill.

So it morphs like anything else:

1. Its lines part into dots in place.
2. The silhouette's dots flow into the next shape's outline (the composer, a question card). Its rails and dot,
   which the next shape doesn't need, sink into the field.
3. The dots fuse into the new outline, the surface fills in, and the real element takes over.

Reversing a morph forms the prism from the same dots, and the live prism takes over from its own figure.

- A morph takes about 450–600 ms and can be interrupted at any point.
- While something travels into or out of the prism, the prism **breathes**: it parts, swells and reassembles.

### Reduced motion

The prism stays still. States are shown by its light and its status dot. Morphs and travels become cross-fades.

## Applying it

- **Faint by default.** If an effect would be noticed from across the room, it is too strong. The strongest moments
  are done, needs you and arriving.
- **Causal.** Every effect starts at its cause and travels from there: the press point, the dragged thing, the
  writing front, the island.
- **Never decorative.** No ambient particles, no drifting background and no idle animation.
- **Measure it.** Every lane that adds a moment keeps within the budgets above and says so in its report.

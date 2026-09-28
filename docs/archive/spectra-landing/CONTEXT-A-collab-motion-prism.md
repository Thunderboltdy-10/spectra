# CONTEXT A — Collaboration / Motion / Prism

## 1. Collaboration, presence, cursor choreography

### 1.1 Interaction protocol
`src/features/spectra/collaboration/interaction-model.ts` — pure types + helpers, no DOM/React.

| Export | Purpose | Signature |
|---|---|---|
| `SemanticTarget` | The addressing unit. Never pixels. | `{artifactId, path, primitive, regionId?, part?, scope?, label?}` |
| `ControlPrimitive` / `CONTROL_PRIMITIVES` | 14 control kinds | `"text"\|"richtext"\|"code"\|"dropdown"\|"toggle"\|"button"\|"slider"\|"gridCell"\|"timelineEvent"\|"canvasObject"\|"listItem"\|"viewSwitch"\|"surface"` |
| `InteractionAct` | 27-case union of every meaningful state | `{kind:"hover",at?}\|{kind:"caret",point}\|{kind:"select",span}\|{kind:"dragMove",at?}\|…` |
| `InteractionState` | The awareness payload | `{v:2, actor, act, lifecycle, target, dropTarget?, menu?, speculation?, note?, heldRegionIds?, at}` |
| `ActorIdentity` | Who acts; AI is owner-attributed | `{clientId, kind:"human"\|"ai", name, accountId?, ownerAccountId?, ownerName?, runId?, operationId?}` |
| `InteractionLifecycle` | `idle\|waiting\|queued\|blocked\|paused\|active\|failed\|cancelled\|completed\|settled` | + `TERMINAL_LIFECYCLES` |
| `CursorMode` / `cursorModeForAct` | Glyph to paint | `(act) => "pointer"\|"caret"\|"selection"\|"grab"\|"resize"\|"menu"\|"press"\|"hidden"` |
| `presenceColor` | Stable actor colour | `(actor) => string` |
| `PRESENCE_PALETTE` | 8 hexes | `["#7c3aed","#159b76","#2e8fd4","#d89a28","#ef684f","#8b5cf6","#0f766e","#c2410c"]` |
| `actorLabel` | `"{owner}'s AI"` for AI | `(actor) => string` |
| `describeAct` / `describeState` / `describeLifecycle` | Shared narration | `(act, target) => string` |
| `canonicalPath` / `pathSegments` / `joinPath` / `pathWithin` / `pathsIntersect` / `targetKey` / `sameTarget` | RFC-6901 pointer algebra; strips `/content` prefix | |
| `readInteractionState` / `normalizeInteractionState` | Defensive parse + structural guard | |
| `actUsesCaret` / `actIsDrag` / `actIsResize` / `actIsMenu` / `actIsMutation` / `stateIsVisible` / `primitiveHoldsText` / `idleState` | Act classification | |

### 1.2 Geometry resolution — `collaboration/interaction-geometry.ts` (`"use client"`)

| Export | Signature |
|---|---|
| `SURFACE_ATTRIBUTE` `TARGET_ATTRIBUTE` `PART_ATTRIBUTE` `LINE_ATTRIBUTE` | `data-spectra-surface` / `-target` / `-part` / `-line` |
| `resolveSurfaceFrame(element, originElement?) => SurfaceFrame` | `{element, rect, origin, scale}` — measures scroll container + overlay origin + ancestor scale |
| `measureScale(el) => number` | catches CSS `scale`, `zoom`, pinch-zoom |
| `toSurfaceBox(frame, rect) => SurfaceBox` | viewport rect → overlay-origin CSS px |
| `resolveTargetElement(root, target)` | `{element, precision:"exact"\|"container", part?} \| null` |
| `caretRectFor(element, point)` | true caret, incl. input/textarea via canvas metrics |
| `selectionRectsFor(element, span) => DOMRect[]` | per-line-box rects |
| **`resolvePlacement(frame, {target, point?, span?, fraction?})`** | **single entry point for all chrome** → `InteractionPlacement` |
| `InteractionPlacement` | `{box, point:{left,top}, caret?, selection?[], part?, precision, offSurface?}` |
| `offSurfaceEdge(frame, box)` | `"top"\|"bottom"\|"left"\|"right"` |
| `hitTest(root, clientX, clientY)` | `{path, part?, element, fraction} \| null` |
| `textPointAtClient(element, x, y)` | nearest char offset |
| `revealTarget(root, target) => boolean` | scrollIntoView without stealing focus |

Selector cascade (`candidateSelectors`, ~:114), descending trust:
`[data-spectra-target="<path>"]` → `[data-ai-path]` → `[data-block-id]` → `[data-address]` → `[data-region-id]`/`[data-spectra-region]`. Ancestor fallback shortens path one segment at a time, reports `precision:"container"`, and carets are suppressed at that precision (guard at ~:721).

### 1.3 DOM contract
| File :: export | Purpose |
|---|---|
| `collaboration/target-attributes.ts` :: `targetAttrs(path, part?, primitive?)` | Spread onto the element that IS the control |
| :: `partAttrs(part)`, `collectionPath(collection, index, ...rest)`, `BOX_HANDLE_PARTS` | 8 handles `handle:nw…handle:w` |
| `collaboration/control-descriptors.ts` :: `buildTarget({typeKey, artifactId, path, part?, regionId?, label?})` | assigns `primitive` + human `label` from per-artifact `ControlRule[]` |
| :: `matchControl`, `primitivesForType`, `controlRulesForType`, `CONTROL_DESCRIPTORS` | descriptor table |
| `collaboration/held-controls.ts` :: `HELD_ATTRIBUTE`(`data-spectra-held`), `HELD_BY_ATTRIBUTE`, `heldControlsFrom`, `heldExplanation`, `useHeldControlGuard`, `HELD_DECLINED_EVENT` | ownership locks |

**There is no in-memory target registry. The registry IS the DOM.**

### 1.4 Choreography pipeline
```
AI operation envelope
  └─ planChoreography(request)            collaboration/choreography.ts
  └─ AiPerformer.start(envelope)          collaboration/ai-performer.ts   → publish(InteractionState)
  └─ PresentationLane.push(state)         collaboration/presentation-lane.ts
  └─ CursorTravel.moveTo(x,y,now,cross)   collaboration/cursor-motion.ts
  └─ resolvePlacement(frame, req)         interaction-geometry.ts  (re-measured EVERY rAF)
  └─ <InteractionLayer>                   components/presence/interaction-layer.tsx
```

`choreography.ts`:
- `planChoreography(request) => ChoreographyPlan | null` (null = no-op)
- `ChoreographyRequest {target, before?, after?, menuOptions?, dropTarget?, size?, handle?, intent?:"create"|"remove"|"reorder"|"group"|"switchView", reorder?, members?, budgetMs?}`
- `ChoreographyFrame {act, hold: ms, value?, note?, menu?, dropTarget?, lifecycle?}`
- `scheduleConcurrently(plans)` — non-overlapping targets parallel, same target serialises
- `APPROACH_MS = 180`, `SETTLE_MS = 260`. Every plan opens with a `hover` approach frame.

`cursor-motion.ts`:
- `CursorTravel(reducedMotion)` — `.moveTo(x,y,now,crossesScope?)` `.snapTo` `.sample(now): TravelSample` `.fadeOpacity` `.position` `.travelling` `.kind`
- `TravelKind = "stay"|"hop"|"journey"|"fade"`
- `travelDuration(px) = clamp(70 + px*0.42, 120, 460)`; `travelKindFor(px, crossesScope)`: <2px stay, ≤96px hop, else journey
- `easeOutExpo(t) = 1 - 2^(-10t)`
- `CometTrail(maxPoints=5, lifetimeMs=260)` — `.push(x,y,now,active)` `.sample(now)`

`presentation-lane.ts`:
- `classifyTravel(from, to) => FrameTravel {kind, crossesScope, semanticDistance}` — cross-scope always `fade`
- `semanticPathDistance(from, to)` — A1 grid distance for sheets, index steps for ordered collections
- `PresentationLane(actorKey)` — `.push(state)` `.current()` `.clear()`
- `orderPathsByRoute`, `planJoinLateArrival`, `useJoinLateArrival`

### 1.5 Scroll / resize / zoom
**Handled by per-frame re-measurement, not listeners.** Zero `scroll`/`resize`/`ResizeObserver` in `collaboration/`, `components/presence/`, `anchors/`. `InteractionLayer` runs an unconditional rAF loop (interaction-layer.tsx:231-395) calling `resolveSurfaceFrame` + `resolvePlacement` fresh every frame.
- `frameSignature(state)` (:155) is the semantic identity — position change without signature change = surface moved, not actor travelled. Scrolling does not fake a journey.
- `quiet?: boolean` prop suppresses travel while local user scrolls (`snapTo`). **Never wired by any caller today.**
- Overlay is a **sticky zero-height node** pinned to the scroll viewport; `element` spans scrolling content. Hence `SurfaceFrame` carries both `rect` and `origin`.

### 1.6 Anchors (separate subsystem)
`anchors/semantic-anchor.ts` :: `SemanticAnchor` (`WorkAnchor & {relativePosition?: Uint8Array}`), `WorkAnchorAdapter {exists, describe, reveal, resolveGeometry, createFromSelection, migrate}`, `createWorkAnchorAdapter(type, handlers?)`, `AnchorGeometry`, `regionsFor`, `serialize/deserializeSemanticAnchor`.
`anchors/registry.ts` :: `WORK_ANCHOR_ADAPTERS`, `getWorkAnchorAdapter(type)`.
`collaboration/presence-anchor.ts` :: `resolvePresenceAnchorFromPoint`, `resolvePresenceAnchorElement`, `clientRectForCharOffset`, `positionForPresenceAnchor`, `clientRectsForSelectionRange`, `selectionIsActive`.
Anchors are for durable comments/references. Live cursors do NOT go through them.

### 1.7 Presence identity
- **Colour**: `presenceColor(actor)` hashes a seed into `PRESENCE_PALETTE`. Human seed = `accountId || name || clientId`. AI seed = `ownerAccountId || ownerName || accountId || clientId`. **So "Pablo" and "Pablo's AI" resolve to the SAME palette colour.**
- **AI-owned-by-human is first-class**: `kind:"ai"` + `ownerAccountId` + `ownerName`; `actorLabel` → `"{ownerName}'s AI"`, fallback published name, then `"Spectra AI"`. Rendered with `data-ai="true"` + `SparkGlyph`.
- **8 cursor modes**: pointer, caret, selection, grab, resize, menu, press, hidden. `grab` = hand path; `resize` = diagonal arrows; press tips the arrow + ripple; caret/selection draw no glyph, just the caret bar.
- **Chrome CSS classes** (globals.css from ~15840): `.spectra-presence-layer`, `-actor`, `-trail`, `-selection`, `-frame` (`data-variant=blocked|resize|drag|structural|press`), `-provisional`, `-handles`/`-handle`, `-press`, `-drop`, `-ink`, `-caret` (`data-typing` → blink), `-menu`, `-cursor`, `-flag`, `-edge`, `.spectra-completion-ring`.
- **Degradation**: `useSimplifiedPresence()` (coarse pointer or <720px), `dense` (>6 actors) mute trails/tilt but keep identity/carets/selections. `usePrefersReducedMotion()` → `snapTo`. Stale >20s or terminal lifecycle → 480ms depart. Unresolvable target → renders `null`.

### 1.8 Local publishing + AI performance
- `use-interaction-presence.ts` :: `useInteractionPresence({artifactId, typeKey, actor, surfaceRef, onPublish, heldRegionIds?, resolveRegionId?, enabled?}) => {publish, publishIdle, targetFor}`. `PUBLISH_INTERVAL_MS=45`, `HOVER_IDLE_MS=6000`, 800ms focus heartbeat lease renewal.
- `ai-performer.ts` :: `AiPerformer(actor, publish)` — `.start(envelope)` `.commit` `.confirmDurable(path)` `.fail` `.cancel` `.block` `.pause` `.resume` `.materialize` `.getSnapshot()` `.subscribe()` `.dispose()`. One body per actor: a second concurrent op QUEUES.
- `interaction-choreography.ts` :: `AiStreamBeat`, `buildArtifactLivePreviewBeats`
- `follow.ts` / `follow-ai.ts` :: `follow`, `useFollow`, `planCatchUp`, `useFollowAi`, `noteAiLocation`
- `text-transition.ts` :: `planTextTransition(before, after, {code?, budgetMs?})`, `pointForOffset`, `describeTextDelta`, `changedLineRange`
- `region-controller.ts` :: `ArtifactRegionController`, `RegionClaimResult`
- **`components/presence/interaction-layer.tsx` :: `InteractionLayer({states: readonly InteractionState[], localClientId?, quiet?})`** — the ONLY renderer; consumed solely by `components/artifact-studio.tsx`.

---

## 2. Motion primitives

Runtime is **framer-motion ^12.38.0**. No GSAP. No `motion/react` package. R3F for 3D.

| File :: export | Values |
|---|---|
| `motion/tokens.ts` :: `MOTION_DURATIONS` | seconds: `instant .08, fast .12, base .22, slow .36, deliberate .48` |
| :: `MOTION_EASINGS` | `standard [.22,1,.36,1]`, `outExpo [.16,1,.3,1]`, `inOut [.65,0,.35,1]` |
| `motion/grammar.ts` :: `MotionPrimitive` | `reveal\|morph\|focus\|ownership\|completion\|recovery\|presence` |
| :: `grammarFor(primitive, level)` | → `PrimitiveConfig {type, duration, ease, stiffness?, damping?, distance}`; `none`→0.001s/0px; `reduced`→×0.4, distance ≤1px, springs stripped |
| :: `transitionFor(primitive, level)` | `morph` = spring 300/32; `presence` = .35s outExpo 4px; `focus` = .9s |
| `motion/motion-level.ts` :: `useSpectraMotion()` | `useSyncExternalStore` over `data-spectra-motion` + `prefers-reduced-motion` → `{level, reduced, disabled}` |
| :: `resolveEffectiveMotion(preference, osReduced)` | OS can only DECREASE motion |
| `motion/motion-primitives.tsx` :: `Reveal` | `({children, className?, primitive?="reveal", delay?=0, style?})` |
| :: `CrossfadeText` | `({value, className?, primitive?})` |
| :: `MorphShell` | `({layoutId, children, className?})` |
| :: `FocusPulse` | `({children, pulseKey, className?})` |
| `motion/index.ts` | barrel |

CSS mirror `globals.css:4403-4408`: `--motion-fast:120ms --motion-base:220ms --motion-slow:360ms --ease-standard --ease-out-expo --ease-in-out` — numerically identical to tokens.ts.

---

## 3. Landing + prism

### 3.1 Files
| Path | Lines | Role |
|---|---|---|
| `SpectraLikedPrism.tsx` (root) | 589 | **Reference only — NOT the good one.** Imports a root-relative path; not wired in. |
| `src/app/landing/prism3d/Prism.tsx` | 608 | **THE production prism.** Strict superset of the root file. |
| `src/app/landing/prism3d/PrismCanvas.tsx` | 239 | Canvas + SceneDriver + CameraRig + FloorPool + Environment |
| `src/app/landing/prism3d/PrismFx.tsx` | 192 | contact sparkles, output beam, flash |
| `src/app/landing/prism3d/anchors.ts` | 28 | 6 contact anchors, 6 wavelength colours, 1 output anchor |
| `src/app/landing/scene/heroState.ts` | 116 | **module-level mutable singleton** + `phases()` + `damp/smoothstep/clamp01` + `T` |
| `src/app/landing/prism/prism-stage.tsx` | 150 | progressive enhancement, WebGL detect, quality detect, `dynamic(ssr:false)` |
| `src/app/landing/prism/prism-scene.ts` | 154 | pure deterministic scroll→optics state machine |
| `src/app/landing/prism/prism-fallback.tsx` | 154 | static SVG prism |
| `src/app/landing/sections/narrative.tsx` | 383 | mounts sticky stage; owns `useScroll` |
| `src/app/landing/landing-client.tsx` | 228 | composition root |

Superset deltas vs root file: raymarch steps 20→**24**; blending Additive→**Normal** (truthful on cream); `PrismFx` **mounted**; reduced-motion **composed static pose** `euler.set(0.06,0.32,0.04)`; **self-computed staggered ingestion** (:419-427); shared `./anchors`; volume `visible={quality!=="low"}`; exports `Prism, PrismQuality, buildShellGeometry`.

### 3.2 `Prism` API
```ts
export type PrismQuality = "high" | "medium" | "low";
export function Prism({ quality }: { quality: PrismQuality }): JSX.Element
```
That is the ENTIRE surface. Everything else flows through the `heroState` singleton. Quality → `samples` 6/3/1, `resolution` 384/256/128, volume visibility.

**Geometry** `buildShellGeometry()`: asymmetric triangle `(0.04,1.16) → (1.06,-0.63) → (-1.0,-0.72)` through `ExtrudeGeometry`, `depth 0.86`, `bevelThickness/Size 0.075`, `bevelSegments 5`, `curveSegments 6`, `center()` + `computeVertexNormals()`. Real thickness, real bevels.

**Three stacked meshes** on one shared geometry:
1. Shell + `MeshTransmissionMaterial` — `transmission 1, thickness .72, roughness .02, ior 1.58, chromaticAberration .62, anisotropicBlur .12, distortion .12, distortionScale .22, temporalDistortion .06, attenuationDistance 6.5, attenuationColor #d9d0ff, clearcoat 1, clearcoatRoughness .08, backside, backsideThickness .35`
2. Edge-response shell `scale 1.012`, `renderOrder 2` — fresnel shader with per-anchor ignition (`uEntry[6]`, `uEntryCol[6]`, `uEntryW[6]`, `uOut`), `depthWrite:false`
3. `BoxGeometry(1.9³)`, `side: BackSide` — **raymarched plasma volume**, 24 steps, sphere-intersect early discard, 3-octave FBM, per-wavelength `refractedPath()`, pooling/swirl/compression toward output. Camera transformed into prism-local space on CPU each frame (WebGL1-safe).

**Drag/rotation**: `quaternion = drag * drift`, then `rotateZ(-resist*0.09 + yield_*0.2)`.
- `drift`: `targetYaw = sin(t*.19)*.62 + sin(t*.067+1.3)*.42 + t*.055`, damped via `yawA`/`yawV`; pitch/roll add pointer parallax (`heroState.px/py`); floats `position.x/y` on separate sines.
- `drag`: arcball. `pointerdown` on shell mesh (R3F); `pointermove`/`pointerup` bound on **`window`** (:384-391) so drag survives leaving canvas. Axis `(dy,dx,0)` normalised, angle `len*0.0075`.
- Momentum `exp(-3.4*d)`, spin `exp(-4.2*d)`. Press moved <6px = click → `spinVel.set(1.9,4.4,1.2)`, `heroState.pulse = 1`.
- Cursor: `gl.domElement.style.cursor = "grab"/"grabbing"`.
- Scale breathes `1 + pulse*.03 + charge*.018 - resist*.014 + yield_*.022`.

**Narrative coupling**: `heroState.progress` → `phases(p)` → 7 overlapping weights (`dormant, ignition, routing, consolidate, alive, compression, release`) → shader uniforms every frame. `T = {contact:.08, ignite:.24, route:.44, alive:.64, output:.86}`. Prism writes back `heroState.quat` and `heroState.center`.

### 3.3 Mount
`narrative.tsx:189-208`:
```tsx
<div className="pointer-events-none sticky top-0 z-0 h-screen">
  <div className="pointer-events-auto absolute inset-0">
    <PrismStage scene={PRISM_SCENES.hero} sceneRef={sceneRef} className="absolute inset-0" />
```
Scroll driver (:160-173): framer `useScroll({target: rootRef, offset:["start start","end end"]})` + `useMotionValueEvent` writes `sceneRef.current` — a **ref**, so scroll never re-renders React.

`PrismStage({scene, sceneRef?, className?})`: builds a getter/setter `progressRef` proxy; detects WebGL (`webgl2 ?? webgl`); detects quality (`hardwareConcurrency`, `deviceMemory`, coarse pointer, min-dim <620); crossfades SVG→Canvas over 1000ms on `onFirstFrame`; `IntersectionObserver` (`rootMargin: 80px`) sets `paused`.

`PrismCanvas({progressRef, quality, reduced, paused?, onFirstFrame?})`:
```
dpr = high [1,2] | medium [1,1.5] | low [0.75,1]
gl = {antialias: quality!=="low", alpha: true, premultipliedAlpha: false,
      powerPreference: low?"low-power":"high-performance", preserveDrawingBuffer: false}
camera = {position:[0,0.05,7.4], fov:35, near:0.1, far:40}
frameloop = (reduced || paused) ? "demand" : "always"
onCreated: gl.setClearColor(0x000000, 0)
```
**Lighting**: no ambient/directional lights at all. A procedural `<Environment resolution={96} frames={1} background={false}>` of four `meshBasicMaterial` planes: top `#f6f3ff`, left `#c2b3f7`, right `#bfe6d6`, bottom `#efe7da`. `frames={1}` = baked once. Plus `FloorPool` — 128×128 radial-gradient `CanvasTexture` plane at `y:-1.52`, `scale 5.2`, lerps `#a795ff → #ffe9c8`.

**Repositioning today is camera-level only** — `CameraRig` (:132-162): `aside = smoothstep(0.28,0.48,heroState.progress)`; `camera.position.z → 7.4 - charge*0.35 + aside*1.15`; `camera.lookAt(-0.85 - aside*1.9, -0.04 + aside*0.14, 0)`. `SceneDriver` damps `heroState.progress` toward `progressRef.current` at λ 3.6, tracks pointer parallax at λ 5.

**Perf**: one Canvas, one geometry × 3 meshes, all per-frame work is ref/uniform mutation inside `useFrame` (files carry `/* eslint-disable react-hooks/immutability */`). Zero React re-renders per scroll frame. `frameloop:"demand"` freezes off-screen. Cost centres: `MeshTransmissionMaterial` (6 samples @ 384px RT re-renders scene per sample) and the 24-step raymarch.

### 3.4 What ONE persistent instance needs
1. **Hoist the mount** out of `LandingNarrative`'s sticky div into a `fixed inset-0 z-0 pointer-events-none` layer. R3F auto-resizes to container.
2. **Replace progress-only placement with a rect driver**: sections publish a DOM rect (`data-prism-slot` + rAF `getBoundingClientRect`), rig converts viewport rect → camera/group transform. Add `heroState.slot = {x,y,scale}` and damp toward it.
3. **Group vs camera transform**: `Prism` already writes `group.current.position.x/y` in idle drift. Cleanest: wrap `<Prism>` in an outer placement `<group>` and leave `Prism` untouched.
4. **`heroState` is a module singleton** — exactly one prism per page. Fine for one; hard-blocks two.
5. **Keep a pause gate**: with a full-page fixed canvas the `IntersectionObserver` always intersects, so `paused` stops working. Replace with a scroll-idle/scene gate or the GPU never rests.
6. **Progress source must widen** to page-level scroll + a mapping from page ranges to `T` thresholds.

---

## GAPS — needed by the brief, absent today

1. **No page-level persistent prism host.** Section-scoped only.
2. **No slot/rect-driven prism placement.** One hardcoded `aside` smoothstep. No `data-prism-slot`, no rect resolver, no `heroState.slot`.
3. **No story-state injection into the prism.** `heroState` exposes only progress/pointer/pulse/charge. Cannot drive individual `entryPower[i]` externally.
4. **The collaboration fabric cannot run on the landing page.** `InteractionLayer` is consumed only by `artifact-studio.tsx`, needs a `data-spectra-surface` scroll container + `data-spectra-target` controls. Nothing in `src/app/landing/**` has either.
5. **No scripted/deterministic actor timeline.** No seek/scrub, no scroll-progress→frame-index mapping.
6. **rAF re-resolution is brute force.** `resolvePlacement` → `querySelectorAll` + `getBoundingClientRect` + `createRange` every frame per actor. On a tall page with many actors this is layout-thrash. No caching, no IO gating, no mutation invalidation.
7. **`resolveGeometry` on anchors is a stub** — `registry.ts` constructs every adapter with no handlers, so it always returns `null`.
8. **Prism has no imperative API.** No ref handle, no `setPose`, no `focusAnchor`.
9. **Motion grammar and prism are disconnected.** No shared spring/easing token reaches R3F.
10. **No prism↔cursor spatial bridge.** Nothing maps `CONTACT_ANCHORS_LOCAL`/`OUTPUT_ANCHOR_LOCAL`/`heroState.center|quat` to a 2D surface point.
11. **`quiet` is never wired.** On a scroll-driven page travel will smear unless driven.
12. **Landing reveals bypass the grammar** — raw `IntersectionObserver` + `data-reveal`/`is-visible` CSS.
13. **Only `prism-scene.ts` is tested.**

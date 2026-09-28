# SPECTRA LANDING — IMPLEMENTATION AUDIT REPORT

**Date:** 2026-08-09
**Scope:** Full read-only review of the landing implementation against `SPECTRA_LANDING_ULTIMATE_IMPLEMENTATION_PROMPT.md` (the brief), plus live-runtime issues surfaced during browser testing.
**Method:** 11 parallel audit agents (CSS pipeline, build/typecheck/lint/tests, scene-by-scene conformance, scroll director/story engine, repo QA gates, copy matrix, runtime-error forensics, WebGL shader forensics, performance profiler, prism-family/favicon inventory, creative-deviation inventory). No files were modified by this audit.
**Interface note:** where the implementing agent had creative latitude (brief ch. 24/33), deviations are classified **A = acceptable creative improvement** or **B = loss of mandated coverage**. Being strict only against the core requirements is intentional.

---

## 1. EXECUTIVE SUMMARY

The landing is a real, structurally ambitious implementation of the brief's engine: one 1040-logical-px x ~11,000-px persistent canvas, a pure-function scroll director with `travel/stage/hybrid` modes, one true R3F prism carried through every scene via a priority-claimed slot system, the three canonical actors, and a final reveal on the same canvas. The two signature spectacles (Scene 3 ingestion/transformation, Scene 12 reveal mechanism) survive and are technically strong.

**However, the page currently has one CRITICAL shipping bug, a dead performance-pause path, and several mandated beats missing:**

1. **CRITICAL — runtime crash freezes the story clock for every visitor.** `use-story-typing.ts` grabs the hidden `<input type="file">` inside the hero's CommandBar (it precedes the textarea in DOM order) and calls the `value` setter → `InvalidStateError` → the throw propagates through `emitStoryFrame` (no try/catch) → the rAF loop never re-schedules → **everything freezes ~6% down the page** (src/app/landing/story/use-story-typing.ts:36/54/69, src/features/spectra/components/command-bar.tsx:504, src/app/landing/story/story-clock.ts:59-61, src/app/landing/story/story-canvas.tsx:64-71).
2. **CRITICAL — production build is red.** `next build` fails at type-check: 6 TS errors in landing code (calendar.tsx:181, references.tsx:124, authored.tsx:103-106). No production bundle can be emitted today.
3. **HIGH — the WebGL prism never pauses.** `prism-stage.tsx` has a `paused` path, but the staged-scene branch skips the IntersectionObserver, so the R3F `frameloop="always"` canvas renders at full cost (~180-215 MB GPU at dpr 2) even when the prism is off-viewport — the dominant cause of the reported lag.
4. **HIGH — the final reveal uses a CSS replica shell, and the single prism never docks into the Live Dock slot.** The brief's finale (ch. 7/27) is the one true prism seated in the real dock; instead the reveal's furniture is hand-built markup (reveal.tsx:150-321) and the prism settles beside the closing line (reveal.tsx:362-366).
5. **MEDIUM — repo QA gate `check:architecture` is red** (new `Event("input")` not in the frozen custom-events baseline, use-story-typing.ts:38), and the whole story/scene engine has zero test coverage.
6. **Product prism family incomplete:** the browser/app icons (`favicon.ico`, `favicon.png`, `icon-192.png`) are the outdated blue prism / Next default; the new violet mark only exists as `public/icon.svg`; `PrismLoader` (loading variant) is exported but never wired.

CSS was not an issue — the break was a stale `.next` build; after clearing it the CSS pipeline (PostCSS/Tailwind v4) compiles cleanly. Only low-priority hygiene remains (UTF-8 BOM in globals.css, self-referential `@theme inline` aliases).

---

## 2. QA GATE STATUS (as of audit date)

| Gate | Status | Details |
|---|---|---|
| `next build` (npm run build) | **FAIL** (exit 1) | Compiled 43s OK (incl. CSS pipeline), fails at type-check. 6 TS errors, all in landing: `scenes/calendar.tsx:181` (TS2322 `"available"` not assignable to `CapabilityState`), `scenes/references.tsx:124` (TS2739 missing `createdAt/updatedAt` for `SpectraArtifactEmbed`), `story/authored.tsx:103-106` (JSX children type errors, 4x). |
| `npx tsc --noEmit` | **FAIL** (exit 2) | Same 6 errors above. |
| `npx eslint src/app/landing src/features/spectra --max-warnings=0` | **FAIL** (exit 1) | 13 errors + 6 warnings. Landing: `prism/prism-layer.tsx:32`, `prism/prism-slot.ts:122` (react-hooks/refs), `scenes/workbench.tsx:223` (react/display-name). Spectra: `yjs-artifact-operation.ts:258`, `live-dock.tsx:572`, `spectra-rich-content.tsx:28`, `surface-field.tsx:191`, `use-streaming-reveal.ts:91` (react-hooks/refs), `artifacts-shell.tsx:868,1708`, `school-data-shell.tsx:327` (react-hooks/purity), `calendar-application.tsx:313`. |
| `vitest run` | **FAIL** (exit 1) | 648 pass / 2 fail — `native-yjs-models.test.ts:290,375` (legacy flashcard review state / mission objective parsing). No landing test failures, but also almost no landing tests. |
| `npm run check:architecture` | **FAIL** (exit 1) | `src/app/landing/story/use-story-typing.ts:38` dispatches `new Event("input", {bubbles:true})` — not in frozen customEvents baseline (baseline inventory at docs/spectra-definitive/generated/baseline-inventory.json). Needs `npm run inventory:spectra` regeneration or an exclusion. |
| `npm run check:copy` | PASS | |
| `npm run check:design-tokens` | PASS (23 warnings) | 23 hard-coded hex values inside className strings across 22 files (join/page.tsx, app-shell.tsx, global-settings-drawer.tsx, 20 under features/spectra). Token-debt, not a gate breaker. |
| `npm run test:realtime` | PASS | 11/11 collaboration worker tests. |
| `npm run build:realtime` | PASS | Wrangler dry-run 304.67 KiB. |
| Landing unit tests | PASS | 1 file (`prism-scene.test.ts`), 10/10 — state-machine tests only. |

---

## 3. RUNTIME BROWSER ISSUES

### 3.1 CRITICAL — File-input crash freezes the story clock (reported stack confirmed)

Browser error: `Uncaught InvalidStateError: Failed to set the 'value' property on 'HTMLInputElement': This input element accepts a filename...` at `src/app/landing/story/use-story-typing.ts:36:22` from `useStoryTyping.useEffect` (line 84), via `emitStoryFrame` (story-clock.ts:60) in `advanceStory` (story-clock.ts:200).

- **Root cause:** `useStoryTyping` finds the input with `host.querySelector("textarea, input")` (use-story-typing.ts:69) — returns the **first match in document order**. Inside the hero's real `CommandBar`, the hidden `<input type="file" multiple hidden>` (command-bar.tsx:504-514) precedes the real `<textarea>` (command-bar.tsx:644). The trigger beat is hero.tsx:99-110 (`Spectra` typing "Turn these notes into a revision document for Friday." into `hero/quickchat/input`).
- **Impact:** `emitStoryFrame` iterates frame listeners with no try/catch (story-clock.ts:59-61); the rAF loop only re-schedules after `advanceStory` returns (story-canvas.tsx:71). Result: the exception kills the entire frame pipeline — canvas camera, prism, all `Authored` text, all `Carried` objects, `commitStoryStep` — permanently, mid-hero, for every visitor.
- **Latent risk:** identical "re-queue at end" rAF pattern without try/catch in presence/interaction-layer.tsx:402-405; any future throwing measurement would freeze the overlay the same way.
- **Recommended fix (not applied):** selector `"textarea, input"` → `"textarea, input:not([type=file]):not([type=checkbox]):not([type=radio]):not([type=range])"` (use-story-typing.ts:69), a runtime type allow-list in `commit()` (line 36), and belt-and-braces: wrap each listener in `emitStoryFrame` in try/catch (or schedule the next rAF before calling `advanceStory`).

### 3.2 WebGL shader warnings — benign-but-noisy (forensics complete)

`THREE.WebGLProgram` warnings `X4122` (double precision sums, at compiled lines 207/220/221) and `X4008` (division by zero, ×3) were reproduced against the exact runtime state (ACES tone mapping, `<Environment resolution={96}>` → PMREM cube height 256).

- **X4122 family originates in three.js/drei transmission-material code, NOT in `Prism.tsx`'s own GLSL**: the literal `1 - 1/256 = 0.996094` fingerprint comes from `CUBEUV_TEXEL_HEIGHT` constant folding in `bilinearCubeUV`, plus ACES tone-map matrices. Cosmetic, compile-time only, printed once per program compile (not per frame).
- **X4008 is the true (measure-zero) hazard**: `cube_uv_reflection_fragment.glsl.js` face projections `uv = vec2(...) / abs(direction.x|y|z)` — divisor can be exactly 0.0 for axis-aligned envmap sampling directions → ±Inf/NaN env sample. In practice the bevelled shell/mesh makes this occur only at flat faces; no visible artifact verified. Optional guard: `uv = vec2(...) / max(abs(direction.x), 0.0001)` (6 variants).
- The repo's own shaders are clean: the only `1.0 - dot(...)` family (Prism.tsx:259, `pow(1.0 - max(dot(...), 0.0), 3.2)`) is safe; the only division with variable denominator is already guarded (Prism.tsx:189, `max(0.0001, beams + pool)`); `PrismCanvas.tsx:204,210` is guarded (`slot.w <= 0 || size.height === 0 → return`).
- **Verdict:** no shader work required; optionally add the six `max(abs(...), 0.0001)` guards for clean D3D11 consoles.

### 3.3 Clerk dev noise (not a bug)

`detectKeylessEnvDriftAction` POST / 200 logs are internal `@clerk/nextjs` keyless-mode drift detection in dev. No repo code involvement; ignore.

### 3.4 CSS "break" — resolved

Confirmed environmental: stale `.next` build artifacts. `next build` compiles the CSS pipeline cleanly (PostCSS config: `@tailwindcss/postcss`, globals.css 19,939 lines: `@import tailwindcss/katex/react-flow` top-of-file, one `@theme inline`, one `:root`, 96 keyframes, 45 media blocks, zero unbalanced braces, zero unterminated comments, zero stray `@layer`). No further action. Low-priority hygiene only:
- UTF-8 **BOM** at offset 0 of globals.css (lightningcss, Next's minifier, hard-fails on it — latent risk if the minifier chain ever consumes the raw file; re-save as UTF-8-no-BOM).
- Self-referential `@theme inline` aliases (`--text-micro: var(--text-micro)` etc., globals.css:27-59) resolved only by the redundant `:root` block (4272-4421) — fragile if `:root` is ever stripped.
- 529 `!important` declarations; two distant copies of chrome rules (e.g. `.spectra-wave-y .text-[8px]` at 288 vs 14567) — stale-look risk on future edits.
- 23 design-token hex-in-className warnings (see section 2).

---

## 4. PERFORMANCE (the reported lag) — hot spots & recommended fixes

Every landing-related frame currently runs **8-9 concurrent rAF/DOM loops + 1 R3F WebGL loop**, with **~67 `onStoryFrame` listeners fanned out every frame even at rest**, driving ~20 DOM writes and ~25-35 layout reads (`getBoundingClientRect`/`offsetWidth`) per frame across the story tree.

| # | Location | Cost / frame | Sev | Recommended optimisation | Quality risk |
|---|---|---|---|---|---|
| 1 | `prism3d/PrismCanvas.tsx:264` (`frameloop="always"`), dpr `[1,2]` (:259-275) | Full WebGL render; ~180-215 MB GPU at dpr 2 | Crit | Pause R3F when the prism slot is off-viewport (IntersectionObserver) | Low |
| 2 | `prism/prism-stage.tsx:158-166,170` (`paused = staged ? !active : !visible`) | Pause path **dead on landing** — staged branch skips IO | Crit | Let staged scenes use the IO path; `paused` never engages today | Low |
| 3 | `story/story-clock.ts:59-61` (emitStoryFrame fan-out) | ~67 listeners ticked every frame, no deadband | High | Skip/guard emission when step state unchanged; deadband at rest (+ try/catch per listener) | Medium — motion systems need a guarded tick |
| 4 | `story/story-canvas.tsx:62-75` (own rAF), :91-95 (unguarded channel writes) vs :97-100 (guarded `open` dataset) | 4 style writes + 1 layout read always | High | Dirty-check channel values like the `open` branch | None |
| 5 | `field/landing-field.tsx:131,145-154,163-174` | 8 unguarded custom-prop writes | Med | Guard each write against last value; recompute on scroll/resize only | None |
| 6 | `presence/interaction-layer.tsx:241-410` (two measure loops) | 25-35 rect/width reads; 0-4 setState/frame | Med | Cache rects; debounce on idle / distant scene (near.ts:30-36) | Low |
| 7 | `collaboration/interaction-geometry.ts:71,82-88,224,328,345-346,424,706,717` | Forces layout flushes across story tree | Med | Precompute geometry on scroll/resize/reveal, not per frame | Low |
| 8 | `prism/prism-layer.tsx:52-67` (zIndex rAF) | 1 extra rAF + writes | Small | Fold into the story rAF; compute once per step | None |
| 9 | `prism/prism-stage.tsx:64-87` (SlotFallback), `prism-slot.ts:63,76-108` (`offsetWidth` in claim loop) | 1-2 reads/frame | Small | Cache widths on resize | None |
| 10 | `landing-client.tsx:50-51` (Rail writes) | Writes every frame, even off-screen | Small | Dirty-check per step | None |
| 11 | `presence/interaction-layer.tsx:782-802` (DropTargetOutline rAF) | Duplicate measurement loop | Small | Derive from main measure pass | None |
| 12 | Whole canvas tree permanently mounted (13 scenes), dot field = CSS lattice (globals.css:19555-19600), 49 `Authored` × 2 spans | ~5-7k DOM elements baseline | — | Keep (intentional architecture); only attack via 3-7 | N/A |

**Verified non-bugs:** no framer-motion on the landing; 0-4 setState/frame (presence only) — the canvas tree does NOT re-render per frame; `Authored` text writes are `!==`-guarded; story steps re-render ≤24/scene by design; LiveDock polling no-ops in story mode.

**Top-10 ranked fixes (all quality-preserving):**
1. **(Large)** Pause R3F when prism slot off-viewport (fixes #1+#2 — the single largest GPU win; identical render on re-entry).
2. **(Large)** Deadband `emitStoryFrame` at rest (#3) — removes most of the ~20 DOM writes + ~25-35 layout reads/frame.
3. **(Medium)** Dirty-check channel-box writes (story-canvas.tsx:91-95).
4. **(Medium)** Fold auxiliary rAF loops into the single story rAF (#8, #11 → 8-9 loops down to 1+1).
5. **(Medium)** Cache geometry; stop forcing layout per frame (#7).
6. **(Medium)** Idle-out presence: debounce measure + `setVisuals`/`setBox` (#6).
7. **(Medium)** Guard `landing-field` custom-prop writes (#5).
8. **(Small)** Cache SlotFallback width (#9).
9. **(Small)** Cache `offsetWidth` in slot claims (#9b).
10. **(Small)** Guard Rail writes (#10).

---

## 5. PRODUCT PRISM FAMILY — favicon/icon gap (user-reported)

The brief (ch. 7 "Product-wide prism") requires a lightweight derived family: static mark for favicon/header/tiny icons, animated sprite for loading, shader-lite loop for the Live Dock slot, consistent silhouette.

| Asset / surface | Current state | Should be |
|---|---|---|
| `src/app/favicon.ico` | Unchanged since create-next-app — default "N" wedge | New violet prism mark (or delete; let Next `app/icon.svg` win) |
| `public/favicon.png` (64px) | **Old blue-on-black prism** (since pre-redesign commit) | Regenerate from the new mark |
| `public/icon-192.png` (192px) | **Old blue prism** (apple touch) | Regenerate at 180/192 |
| `public/icon.svg` | **Already the new violet mark** (matches `spectra-mark.tsx` geometry/palette) | Keep |
| `src/app/layout.tsx:31-37` icon metadata | Points at 3 stale rasters + icon.svg | Point at regenerated set; apple ideally 180 |
| In-app brand (sidebar, chat empty state, landing wake/rail/reveal, sign-in) | Already the new `SpectraLogo`/`SpectraMark` everywhere | Keep |
| `src/components/spectra-prism-optic.tsx` | SVG 2D prism with CSS light-band dispersion; `PrismLoader` exported | **`PrismLoader` is never imported anywhere — the loading variant is dead code.** Wire it into loading states (loading-states.tsx) or delete |
| Live Dock prism slot | `PrismRunMark` 14px with `data-prism-slot="live-dock"` (live-dock.tsx:137) — works, ready for the landing's anchor-over | Keep (this is exactly the shader-lite loop the spec wants) |
| `src/components/layout/app-shell.tsx:734-751` | Dead disabled sidebar `<aside>` containing a second logo | Delete |
| Mark derivation | `spectra-mark.tsx` copies the silhouette/palette by hand | Optional: export silhouette/`ENTRY_COLORS` from prism3d and derive |

**Bottom line:** the app UI already renders the correct new mark everywhere; only the static icon surfaces (favicon.ico, favicon.png, icon-192.png) plus the unwired `PrismLoader` are outdated.

---

## 6. SCENE-BY-SCENE CONFORMANCE (spec ch. 15-27)

Legend: ✓ implemented · ≈ partial/substituted · ✗ missing. Progress numbers from the implementation's own timeline (timeline.ts) vs spec windows.

| Scene | File | Spec % | Impl % | Mode | Verdict summary |
|---|---|---|---|---|---|
| 0 wake | `scenes/wake.tsx` | 0-3 | 0-1.8 | travel ✓ | Field develops, Pablo places the mark, alignment guide, Spectra types wordmark, 7-item header in one group. **Complete.** |
| 1 hero | `scenes/hero.tsx` | 3-13 | 1.8-9.7 | travel (hybrid settle missing) | Marker, 3-line headline (violet `connected.`), support, grouped buttons, real Quick Chat typed via real CommandBar (currently crashes — §3.1), weighted prism drag-in, visitor drag window. Copy reworded in places (creative A). |
| 2 prepare | `scenes/prepare.tsx` | 13-18 | 9.7-14.2 | stage ✓ | Ownership takeover, stable pose, centre-left reposition + ~10-14% shrink, PAI output region. Stage D atmosphere implicit (field only). |
| 3 transform | `scenes/transform.tsx` | 18-29 | 14.1-24.3 | stage ✓ | **Signature scene survives.** A-F ingestion ≈ condensed (no particles, honest shader state); G internal processing condensed from 6 sub-steps to 3-wave weights (transform.tsx:288-305); I materialisation ≈ (edge → card → typed title | sources | deadline). Copy ✓. |
| 4 living | `scenes/living.tsx` | 29-38 | 23.5-32.5 | hybrid ✓ | Document expand, prism shrink (ownership, but no visible drag beat), editorial copy ✓, Spectra enters document, dual local field regions, citation attach. Support line is typed by Spectra where spec said Pablo's AI (minor). |
| 5 contention | `scenes/contention.tsx` | 38-46 | 31.9-38.4 | stage only (no travel lead) | **≈ substituted** — doc-paragraph contention → sheet-cell race with real held-control guard and queue chips. Valid product demo, but AI-vs-AI, and `RUN_STEPS.waitingForPablo` / `updatingExplanation` (work.ts:265-266) are dead code; Live Dock never appears here. Classified **B** (see §8). |
| 6 dock | `scenes/dock.tsx` | 46-54 | 36.4-45.4 | hybrid ✓ | Real LiveDock driven off `deriveLiveDockTab`; statuses (working / needs-input / completed) preserved via run state; hover, expanding question, answer, completion colouring ✓. Tab titles re-cast (A); spec's steer "Make the final section shorter." missing; hover lands on the needs-input tab rather than the working tab. |
| 7 workbench | `scenes/workbench.tsx` | 54-65 | 43.3-53.7 | stage (no travel lead) | **≈ substituted** — spec 5-tab rail (Revision document / Quiz / Presentation / Sheet / Code) with Edit→Preview and Code Split → real 3-pane Document/Plan/Sheet split tree. Quiz/Presentation/Code appear NOWHERE on the page (feature-coverage loss). Classified **B**. |
| 8 references | `scenes/references.tsx` | 65-72 | 53.7-60.9 | hybrid ✓ | Real ArtifactEmbed collapsed→expanded + a **locked "Request access" state** (genuinely strong trust moment, A). But research rhythm (search/read/verify/attach, "10 results"), B4:F18 range selection, comments + semantic anchor jump, context picker — all absent. Classified **B** for coverage. |
| 9 calendar | `scenes/calendar.tsx` | 72-79 | 60.9-68.2 | stage (no travel lead) | Scheduling drag ✓, deadline locked `From school` ✓, `Move a block and the plan moves with it.` (A). Missing: unscheduled/task lane (Biology revision / French oral / EE research), ManageBac region, 45→75 min resize, Plan details panel, dock "Study plan scheduled". Classified **B** for the lane+resize beats. |
| 10 foundry | `scenes/foundry.tsx` | 79-88 | 68.2-76.5 | hybrid ✓ | **≈ substituted** — quiz-coach interview with real `coveredFacets` sufficiency + Compile button; adaptive field creation survives. Missing: education marking mission copy, adaptive fields (Evidence and examples / Expected output / Access), capability modules, Use mode, "Improving from 3 verified examples". Classified **B**. |
| 11 scale | `scenes/scale.tsx` | 88-94 | 76.5-82.3 | travel ✓ | Broader camera ✓ (zoom 0.72). Closing line reworded to `Not a set of features. / One place to work.` + counted tally (A — arguably better). Cleanup triad (Stage C) absent; canvas narrowing happens only in the reveal director, not by actors. |
| 12 reveal | `scenes/reveal.tsx` + `story/timeline.ts` | 94-100 | 82.3-100 | stage + internal travel ✓ | **Mechanism is exemplary**: same canvas contracts to a channel, camera-return proof pass revisits the hero, real actors cross into the thread, `The landing page is ready.` typed (reveal.tsx:108-118), dock settles to completion, all reversible. **Costs:** shell furniture is decorative CSS markup (replica — violates the one-authoritative-UI rule), prism never docks into the dock slot, final CTAs are `Get started`/`Sign in` instead of `Open Spectra`/`Explore the workspace` (A). Stage H prism-slot beat classified **B**. |

**Progress-encoding:** scene spans are computed from canvas heights; nothing hard-encodes the brief's windows. Total at ~10-14% shifted vs brief after Scene 6 (reveal spans 17.7% vs brief's 6). Cosmetic; no user-visible defect.

---

## 7. CREATIVE DEVIATION INVENTORY (A = keep, B = loss to recover)

### A — improvement trade-offs (worth keeping)

1. **Single-prism slot architecture** (prism-slot.ts): priority-ordered, per-frame measured claims — the one true 3D body genuinely crosses every scene; ingestion wavelengths driven by the same beats that drag the cards (transform.tsx:288-305). Strongest engineering on the page.
2. **Real-state honesty everywhere**: contention via the product's `useHeldControlGuard`; dock via `deriveLiveDockTab` on real `SpectraRun` fixtures; foundry sufficiency via `coveredFacets`; the cited sheet is a real workbook.
3. **Locked-reference refusal** ("Request access" embed, references.tsx:83-101) — a trust moment the brief didn't have.
4. **Copy upgrades**: "It interviews you until it understands." (foundry.tsx:50-58), "Move a block and the plan moves with it." (calendar.tsx:125), "A reference is a relationship." (references.tsx:47-57), "Not a set of features / One place to work." + counted tally (scale.tsx:38-55, 81-87), `Get started`/`Sign in` final CTAs with real routes (reveal.tsx:373-390).
5. **Reveal mechanism**: pure-function camera math (timeline.ts `proofPass`/`channelFor`) — reversible, no remount, no screenshots, mandatory final-typing beat present.
6. **Re-cast dock tabs** (dock.tsx:164-226): statuses and semantics preserved; titles improved.
7. **No forbidden additions anywhere**: no fake browsers, no screenshots, no particle systems, no feature grids, no duplicated rail, no fourth actor (verified by grep).

### B — losses that remain losses under creative authority

1. **Work-type breadth.** Quiz, Presentation, Code appear nowhere on the page; Scene 7 has no rail (3-pane Document/Plan/Sheet). Brief ch. 28 explicitly names `document, quiz, presentation, sheet, code` as coverage — this is cut, not restaged.
2. **Research/verify rhythm + range semantics + Comments.** The search→read→verify→attach arc, B4:F18 selection, comment + semantic-jump, and context picker are absent; Comments (a named capability, ch. 28) is demonstrated by zero scenes. The `B4:F18` reference label never appears (sheet data is A1:D6).
3. **Foundry long-term capability.** Skills modules, Use mode, and "Improving from 3 verified examples" replaced by a Compile button. `Improving from 3 verified examples` is completely absent from the codebase.
4. **Human contention as the trust beat.** Mandate was Spectra waiting for **Pablo** ("Waiting for Pablo to finish", no error state); impl shows an AI-vs-AI queue. `RUN_STEPS.waitingForPablo` is defined (work.ts:265) and never rendered — dead code.
5. **Calendar unscheduled lane / ManageBac identity / resize.** The pending-task lane, 45→75-min resize beat, and school-provider naming are gone; only a generic locked deadline carries school context.
6. **Reveal shell is a replica, and the prism never docks.** Two structural items: (a) `RevealShell` sidebar/rail/dock/thread is hand-built CSS markup (globals.css:19138+, reveal.tsx:150-321) instead of the real shared components — future Live Dock edits will NOT propagate to the landing, violating brief ch. 2; (b) the single true prism settles beside the closing line (reveal.tsx:362-366) — the mandated "same 3D prism lands inside the real Live Dock's prism slot" (ch. 7/27/34) never happens. The dock's `data-prism-slot="live-dock"` (live-dock.tsx:137) exists and is ready for exactly this.

### Also worth noting (classified A, small)

- Hero headline split over 3 typed lines vs brief's 2; support clause reworded (hero.tsx:35-66).
- Hero right-half negative space after the prism departs is uncomposed darkness for the rest of the 11,000px page (brief ch. 7 asks for intentional vacancy) — remains open.
- Scene 4 support line typed by Spectra rather than Pablo's AI (living.tsx:126-135).

---

## 8. COPY MATRIX — key mandated strings

| Spec string | Status | Implementation |
|---|---|---|
| Header: How it works / Capabilities / Specialists / For schools / Pricing / Sign in / Get started | ✓ exact | wake.tsx:43-49, 98-99 |
| SPECTRA WORKSPACE marker | ✓ (case via CSS) | hero.tsx:31 → `TYPE.micro` uppercase |
| Every piece of work, / **connected.** (violet) | ✓ (3 lines) | hero.tsx:39-55; `--brand-primary` #7b5cf5 |
| Turn these notes into a revision document for Friday. | ✓ (but crashes typing — §3.1) | hero.tsx:107; dock.tsx:178; reveal.tsx:288 |
| Ecosystems revision notes / Ecosystems revision / Due Friday | ✓ | transform.tsx / work.ts:19-26 |
| One request becomes work you can keep. | ✓ | transform.tsx:145 |
| Not another answer. / Work that stays alive. | ✓ | living.tsx:69,77 |
| Waiting for Pablo to finish / Updating the explanation | ✗ dead code | work.ts:265-266, never rendered |
| Checking the finished document / Scheduling three study blocks | ✓ (dock scene) | work.ts:264,267 → dock.tsx:172,215 |
| Live Dock tabs: Revision notes / Source check / Study plan | ≈ re-cast | dock.tsx:164-226 (Ecosystems revision notes / Which source... / Three study blocks) |
| Make the final section shorter. (steer) | ✗ absent | — |
| The right form, without changing places. | ✗ → "Everything open at once." | workbench.tsx:63-71 |
| References that remain real. / Cite the source, expand the live view... | ✗ → "A reference is a relationship." | references.tsx:47-57, 108-111 |
| Ecosystem data — Sheet · B4:F18 | ✗ never used | sheet range is A1:D6 (work.ts:78-114) |
| The plan moves with the work. | ≈ reworded ("Move a block...") | calendar.tsx:123-127 |
| Build expertise, not another persona. | ✗ → "It interviews you until it understands." | foundry.tsx:50-58 |
| IB Biology marking mission / "Precise, demanding and constructive..." | ✗ → quiz-coach mission | foundry.tsx:184-253 |
| Evidence and examples / Expected output / Access | ✗ → other sections | foundry.tsx:184-253 |
| Improving from 3 verified examples | ✗ absent | — |
| Ask once. Keep the work, the sources and the people connected. | ✗ → "Not a set of features. One place to work." | scale.tsx:38-55 |
| Spectra landing / Finishing the page | ✓ | reveal.tsx:139, 314 |
| The landing page is ready. | ✓ (typed in thread) | reveal.tsx:115 |
| Open Spectra / Explore the workspace | ✗ → Get started (/sign-up) + Sign in (/sign-in) | reveal.tsx:373-390 |

**Typography/quality checks:** Manrope + IBM Plex Mono via next/font; hero 94px (brief 88-104 ✓), section 64px (58-72 ✓), support 42px (38-48 ✓), body 19px (18-20 ✓), micro 11px (11-12 ✓). No gradient-text headings anywhere (only solid violet accents); the only `background-clip:text` classes are product-internal stream shimmers. No `#` placeholder links anywhere.

---

## 9. ARCHITECTURE CONFORMANCE — STRONG PARTS (verified)

- **One authoritative UI per surface, story state injection** — genuinely honored across CommandBar, LiveDock (`deriveLiveDockTab`, `live-dock.tsx:161-184,300`), SheetsStudio, PlanStudio, ArtifactCard/Embed, ThreadCard. No `LiveDockLanding` forking; the landing drives the real components through deterministic fixtures.
- **Choreography survives scroll/resize** — actors resolve `getBoundingClientRect` per frame against live layout; no cached viewport coordinates; semantic target IDs (`TARGET_ATTRIBUTE`/`PART_ATTRIBUTE`); re-resolution during routing.
- **Scroll director** — one owner of scroll→progress (story-clock.ts:175 `advanceStory`), pure `cameraFor(scrollY,H)` (timeline.ts:274), three modes, generous stage mapping, full reversibility incl. the proof pass — no one-way commits.
- **Story ownership is scoped** — hero CommandBar typing is readOnly during the story beat; prism owned only during its drag windows; `data-spectra-held` guard in contention; no global `pointer-events: none` anywhere.
- **No duplicated rails, no landing-only nav**, no fake browser frames, no feature-grid section.
- **Three actors only**; owned-AI colour derived from owner (actors.ts:13-45); no invented cursor physics.

---

## 10. TEST & TOOLING GAPS

1. The entire story engine (story-clock, timeline, beats, actors, work, scene-kit, authored, use-story-typing), all 13 scenes, prism-slot/prism-layer, landing-field, surface-field, and spectra-prism-optic have **zero tests**. Only `prism-scene.test.ts` (10/10 pass). The driving failure mode (§3.1) is precisely the kind of thing a single integration test (`timeline.ts` beat → typed target is a text-capable element) would have caught — spec ch. 31's "Verify" discipline is currently unenforced.
2. `validation-report.json` is stale and covers only `/workspace` + `/chat` (4 assertions, all pass) — it never exercises the landing, prism, calendar, or choreography.
3. `check:architecture` red on `new Event("input")` (use-story-typing.ts:38) — see §2.
4. Design-token debt: 23 hard-coded hex in className usages.
5. Working-tree state: old landing sections deleted and staged, new `story/`, `scenes/`, `field/` untracked (`git status` shows `??`). The review ran against a scattered tree.

---

## 11. PRIORITISED ACTION PLAN (recommendations only — no changes made)

### P0 — ship blockers
1. Fix the typing target selection → `textarea, input:not([type=file])...` (use-story-typing.ts:54/69) + protect `emitStoryFrame` with per-listener try/catch (story-clock.ts:59-61) — restores every visitor's story flow. Add a regression test.
2. Fix the 6 TS errors: calendar.tsx:181, references.tsx:124, authored.tsx:103-106 → `npm run build` green.

### P1 — high-value
3. Wire the prism pause path for staged scenes + pause R3F off-viewport (PrismCanvas.tsx:264, prism-stage.tsx:158-166) — the bulk of the lag.
4. Deadband `emitStoryFrame` at rest (story-clock.ts:59-61).
5. Prism → Live Dock docking in the finale: mount the real LiveDock (or its slot) in the reveal shell and claim it with `prism-slot` (live-dock.tsx:137 `data-prism-slot="live-dock"` exists; reveal.tsx:310-318 is decorative) — the missing signature beat.
6. Replace the reveal shell replica with real shared components (`RevealShell`, reveal.tsx:150-321) to restore the one-authoritative-UI rule for the finale.

### P2 — coverage & polish
7. Regenerate `check:architecture` baseline (`npm run inventory:spectra`) or seed the event name.
8. Decide the B-list coverage items (work types, research rhythm + comments, foundry long-term stages, calendar lane/resize, human contention with the dock step) — confirm which are intentional cuts vs lost scope.
9. Product prism family: regenerate favicon.ico / favicon.png / icon-192.png from the new mark; wire or cut `PrismLoader`; delete the dead sidebar in app-shell.tsx:734-751; optionally derive `spectra-mark` geometry from prism3d exports.
10. Performance cleanups #3-#11 from §4 (all zero/low quality risk).
11. Optional GLSL guards for the X4008 class (`max(abs(d.y), 0.0001)` family) for clean consoles.
12. globals.css hygiene: strip BOM, de-duplicate chrome rules, reduce `!important`.

---

## 12. FINAL VERDICT

The engine is real and mostly faithful — the persistent canvas, director, one-prism slot system, actor discipline, and reveal mechanics are above bar, and the creative deviations that exist are largely good ones (A-list). The page is however **not shippable in its current state**: the file-input crash freezes the narrative for every visitor and the build is red. Fix P0-1 + P0-2, then the two P1 structural items (prism pause, prism-to-dock finale), and the remaining work is coverage restoration (B-list) plus polish (P2) — all with file:line anchors above.
# M7 — PRISM & LANDING

> **SUPERSEDED 2026-08-19 by `docs/spectra-nova/missions/N11-identity-field-prism-motion-landing.md`** (W2 and W4). The prism-family intent survives; the landing narrative is deliberately rebuilt around the Nova product. Do not run this brief.

**Agent:** Designer · **Prerequisites:** M6 verified

## Objective

Give Spectra its prism identity family product-wide, and finish the landing page to its brief: field visible, prism present from the hero, shimmer calibrated, performance smooth, and a final reveal that is the *real* Spectra shell. `SPECTRA_LANDING_ULTIMATE_IMPLEMENTATION_PROMPT.md` remains the binding vision; STATE.md §2.F lists the located defects.

## Workstream 1 — Product prism family (CANON D18)

1. From the landing prism's silhouette/material language, derive: **static mark** (favicon + tiny icons — replace the stale blue favicon), **spinning loader** (lightweight vector/canvas/pre-rendered, no R3F) for loading states, and the **Live Dock slot** treatment for active runs. Consistent angle, proportions, surface cues across sizes.
2. Replace the current in-app prism marks (`spectra-prism-optic.tsx`, ad-hoc logo variants) with the family — one source of truth; delete `SpectraLikedPrism.tsx` and other leftovers.
3. Place it where identity is genuinely communicated (sidebar mark, dock run slot, loading, empty/branded states, AI presence where appropriate). Do not sprinkle it mechanically.

## Workstream 2 — Landing sensory layer (root causes in STATE §2.F)

1. **F1 — Field visibility:** retune with the M6 renderer — full-bleed presence at 2–5% rest, emotional-arc moods per scene (brief §11), pointer response (~150px falloff, few-px displacement), prism bending/occlusion. Kill the corner-bias-only look; kill the double-dimmed CSS fallback.
2. **F2 — Prism from the hero:** fix slot claiming (`prism-slot.ts:86–130`) to consider viewport/scene relevance so off-screen claims never win; unhide the hero prism (rework the `Carried data-present` gating in `hero.tsx:203–215`) — the prism enters in Scene 1 per the brief and remains trackable through the story; raise early optics from near-zero so the glass reads as present-but-dormant.
3. **F4 — Shimmer calibration:** `.spectra-authored-edge::after` and `.landing-question-waiting` become a subtle streaming tail (thin, low-alpha, actor-tinted), not purple bars. Recalibrate all authored-text effects.
4. **F5/F6 — Chrome & hero:** one navigation (kill the duplicate Rail/Sign-in rows); wake/hero composed so the settled state is a real hero (headline, copy, Quick Chat, prism, living field) — never a white void; remove dev pills.
5. **F3 — The real reveal:** rebuild Scene 12 on the actual product shell components (post-M4 unified shell, real LiveDock, real thread/conversation surface, real workbench chrome) driven by story state — delete the `.landing-shell-*` CSS mock. The prism docks into the real Live Dock prism slot (family item from Workstream 1 takes over outside the landing). The revealed workspace must look like the product screenshots, artifact + thread side by side, per the brief's Stage A–K.
6. **F7/C7 — Performance:** R3F frameloop demand-driven/paused when prism inactive or off-screen; story clock stops fan-out when settled; remove per-frame `getBoundingClientRect` from slot measurement (cache + invalidate); verify scenes lazy-activate. Target: smooth scroll on the dev machine end-to-end; no long tasks during travel.

## Workstream 3 — Story quality pass

Walk the full story as a first-time visitor at slow and fast scroll (forward and backward): every scene entrance/exit clean, actors behave per concurrency discipline, copy typos gone, intermediate frames beautiful (capture them). Fix what fails the brief's §30 avoid/prefer lists.

## Acceptance criteria

1. Flow P passes: prism family in dock/loader/icon/favicon; landing prism present and trackable from Scene 1 to dock-landing.
2. Landing field visibly alive at rest in every scene (screenshot per scene, `.shots/missions/M7/`), pointer-responsive, mood-arced.
3. Reveal is the real shell (side-by-side comparison screenshot against the live app included in evidence).
4. Smooth-scroll performance trace saved; no `frameloop="always"` while idle; Golden Flows 0 + 12 unaffected in the app.
5. One prism implementation family, no orphaned prism code (grep proves it); STATE §2.F all VERIFIED.

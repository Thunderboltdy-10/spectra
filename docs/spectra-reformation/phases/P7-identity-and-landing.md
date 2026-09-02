# P7 — Identity & Landing

**Goal:** the sensory identity ships (N11's intent, absorbed): one field system, one prism family, a motion grammar that reflects real activity, and the landing page with its reveal — original without becoming an award-site chore (PRODUCT §7).

**Prerequisites:** P6 accepted (identity polishes a coherent product; it cannot substitute for one). **Architecture:** ARCHITECTURE-PLATFORM §3 (tokens/motion), PRODUCT §7; design-intent archaeology: `docs/spectra-landing/SPECTRA_LANDING_ULTIMATE_IMPLEMENTATION_PROMPT.md` + CONTEXT-A/B/C (re-narrated for the current product). **Findings absorbed:** HQ STATE F1–F7 (field/landing breakage), N11 brief intent, AI-12's follow/reveal polish remainder.

**Difficulty (PROCESS §4):** UI1/UI2 = Grok 4.6 High with the UI specialist. V1 = GPT 5.6 Sol high. UI1 and UI2 are the third and fourth reserved UI-specialist sub-phases.

## P7.UI1 — Field + motion grammar (MT) — **IMPORTANT / LAUNCH-CRITICAL / UI SPECIALIST 3 OF 4**

**Model: Grok 4.6 High with the frontend UI specialist skill stack.** One field system (the duplicate `surface-field`/`grain-field`/`landing-field` implementations converge — subtraction law); signals driven by real events (AI activity, sync transitions, collaborator presence) not decoration; idle cost approximately zero rAF. Motion grammar uses the existing motion tokens for route-crossing Follow AI, org-tree motion, sync transitions and command feedback — quiet by default, reduced-motion complete.

### Read and map before coding

1. Inventory every field/prism/noise implementation, animation loop, raw duration/easing and reduced-motion branch. Record consumers and choose the single surviving engine.
2. Trace real event sources: collaboration awareness, AI lifecycle, sync presenter and route transition. Define a small typed visual-signal input; visuals must never infer truth from CSS classes or duplicate product state.
3. Capture the current shell at idle, AI streaming, peer presence, sync transition, Follow AI route crossing, both themes and reduced motion.

### Implement and subtract

- Converge all product/landing field rendering on one engine and token family. Delete duplicate renderers and styles in the same commit.
- Event intensity is bounded, debounced and meaningful. Idle uses no continuous animation loop; hidden tabs stop; low-power and reduced-motion modes become static but still communicative.
- Route and object motion preserves spatial continuity and focus. It must never delay editing, intercept input, cause layout shift, or mask an error/refusal.
- Create the final Spectra icon/prism family from the same geometry, including favicon/app/sidebar/small-state variants with legibility at small sizes.

### Check

Unit tests for signal mapping and lifecycle cleanup; performance traces for idle and active states; intermediate-frame screenshot sequences; hidden-tab test; both themes; reduced motion; keyboard focus during transitions; no duplicate field engines or raw motion escapes after search. Exit with a before/after matrix and measured frame/idle costs.

## P7.UI2 — Landing and real-shell reveal (MT) — **IMPORTANT / LAUNCH-CRITICAL / UI SPECIALIST 4 OF 4**

**Model: Grok 4.6 High with the frontend UI specialist skill stack.** The preserved concept: visible collaborators build a Spectra surface and the sequence ends in a **real shell reveal**. The CSS mock shell dies. The story is the launch product: school work in one place, existing Office files preserved, humans and AI working together, local files optional through Bridge, and truthful control.

### Information architecture

1. In ten seconds a first-time school user must know what Spectra is, who it is for, and the primary benefit. Use plain language; do not lead with Bridge, Convex, agents, lenses, or protocol terminology.
2. The page must remain a landing page: clear hero, concise proof, product capability sequence, trust/file-fidelity section, collaboration/AI section, final CTA and required legal/auth routes. No award-site scavenger hunt.
3. Use real product components/data shapes for the reveal, isolated behind a safe read-only demo boundary. Never ship a second fake shell or forked design system.

### Build method

- Audit the preserved landing references and current production shell, then write a one-page narrative/scene list before layout work.
- Implement progressively: semantic static page first, then responsive layout, then UI1 field/motion, then the real-shell reveal. The page remains complete if animation or JavaScript is unavailable.
- Test signed-out sign-in, request access, invitation join, signed-in continue, back navigation and error recovery. CTAs must retain intended return URLs without leaking tokens.
- Optimize real assets, fonts and hydration. No autoplay media dependency, unbounded canvas, or main-thread animation loop.

### Evidence and budgets

Screenshots at supported desktop widths, both themes, 200% zoom and reduced motion; intermediate reveal frames; cold-load performance on throttled modest hardware; layout-shift and idle-loop trace; 30-second comprehension card with a person unfamiliar with implementation; built-app auth journey. Exit only when the real shell appears, the story is clear without motion, and every CTA works.

## P7.V1 — Visual/motion verification (MT)

**Model: GPT 5.6 Sol high, fresh session.** Tier-D discipline: intermediate frames captured during motion, realistic content density, both color schemes, reduced motion, keyboard/focus, low-end throttling, no idle loops, no layout shift, no duplicate visual engine. Run the 30-second stranger comprehension card and require an accurate plain-language answer about Spectra and its value. Verify all landing/auth routes on the production build. Repair holdable classes and rerun the whole affected matrix; do not grade taste from a single hero screenshot.

## Exit gate

Field/motion budgets met; reveal works from a cold load; landing meaning survives without motion; V1 PASS closes P7 without an owner-acceptance request.

### P7.UI1 implementation log — 2026-09-02

- Design read: preserve-and-complete Spectra's warm-paper violet system; variance/density stay matched, with motion +1 only for AI, sync, presence and selection.
- SYSTEMIC field class: `surface-field` is the one event-fed renderer; duplicate grain/landing engines and ribbon assets were migrated and deleted.
- The landing, shell, auth and panel surfaces now share bounded typed field signals, static reduced/low-power fallbacks and visibility cleanup.
- One projected-glass prism geometry now drives the landing mark, app/sidebar marks, loaders, favicon and app icon; loaders communicate waiting/working/completion without decorative churn.
- SYSTEMIC animation class: the R3F prism uses demand rendering plus the story clock; measured after coast at 0 rAF callbacks/1.5 s, versus 303 callbacks/1.2 s while actively scrolling.
- SYSTEMIC navigation class: artifact close and in-editor work-to-work navigation read synchronous browser route truth, so a stale framework query snapshot cannot reopen the prior work.
- Open work is now visibly distinct from picker/context selection in both Library rows and board cards; folder collapse and close/save single-flight were repaired at their shared seams.
- DS-4 closed in implementation with brand violet `#6a4de8` (5.47:1 against white); independent P7.V1 still owns visual acceptance.
- Evidence: `.shots/reformation/P7.UI1/before/00-current-entry-1440.png` through `03-landing-prism-reference.png`; `.shots/reformation/P7.UI1/after/04-field-prism-top-1440.png`, `05-field-prism-hero-1440.png`.
- Checks: Vitest 9 files/94 tests; TypeScript; scoped ESLint 0 warnings; architecture, copy, design-token and secret gates all pass.
- Status: IMPLEMENTED, not verified.

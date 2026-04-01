# Decision Matrix

This file is intentionally blunt.

The goal is not to defend every idea. The goal is to remove weak assumptions before implementation starts.

## Short Answer

- Approach B should lead.
- Approach A should inform overview and relationship language.
- Approach C should inform polish, onboarding, and focus choreography.
- Approach D is interesting but should not absorb implementation time now.

## The Real Question

The three shells are not competing on visual novelty. They are competing on one thing:

Which shell makes Spectra feel immediately useful while preserving the canvas as a real advantage over normal chat-plus-doc tools?

## Approach A: Semantic Constellations

### What works

- strongest macro overview,
- strongest spatial memory at the world level,
- strongest fit for AI-discovered relationships,
- most distinctive identity.

### What fails

- too poetic for core daily use,
- lowest "open this thread and get to work" efficiency,
- easiest to overcomplicate,
- highest risk of prioritizing metaphor over workflow.

### Harsh verdict

This is the best inspiration shell and the weakest default shell.

If made primary, it will probably impress people first and frustrate them later.

## Approach B: Magnetic Surface

### What works

- best operational clarity,
- strongest compatibility with the current architecture,
- best use of hidden utilities without forcing a permanent dock,
- strongest preservation of the infinite canvas while still allowing focus,
- best fit for the right-panel and AI handoff behavior.

### What fails

- less immediately iconic than Approach A,
- can look generic if the rendering language is lazy,
- depends heavily on edge affordances being tuned well,
- can turn into messy floating UI if not tightly disciplined.

### Harsh verdict

This is the most honest answer to the product.

It does not rely on a metaphor carrying the experience. It relies on behavior, clarity, and good composition. That makes it the safest ambitious option.

## Approach C: Focal Lenses

### What works

- easiest to understand,
- easiest to make beautiful,
- easiest to onboard with,
- strongest for guided focus and teacher-facing presentation work.

### What fails

- chips away at the raw canvas advantage,
- can become a polished cage,
- too easy to drift toward a fancy mode-based app instead of a malleable workspace,
- risks trading freedom for aesthetic control.

### Harsh verdict

This is the best refinement shell and the wrong default shell if canvas freedom is sacred.

It should heavily influence transitions and focus mechanics, but not dictate the whole worldview.

## Wildcard D: Strata Canvas

### What works

- solves macro-navigation in a genuinely different way,
- has real conceptual freshness,
- naturally supports focus.

### What fails

- too much implementation and concept risk right now,
- not aligned enough with the current product state,
- likely to distract the team before the main system is stable.

### Harsh verdict

Good thought experiment. Bad immediate priority.

## Final Decision

The production-first path should be:

1. Build the shared engine from `FOUNDATIONS.md`.
2. Implement Approach B as the primary shell.
3. Borrow from Approach A:
   relationship cues, overview identity, AI connection language.
4. Borrow from Approach C:
   focus choreography, lens-like dimming, premium composition.

## Design Standard for the Build

If the first interactive prototype of Approach B still feels like:

- grouped cards on a canvas,
- a bottom bar with too much chrome,
- a search input that looks like toolbar furniture,
- hidden edges that nobody notices,
- AI edits that feel unsafe,

then the redesign has failed, even if the architecture is technically correct.

# P3 — The Capability Protocol

**Goal:** the operation IR exists and everything derives from it (CANON R6). After P3, adding a capability means writing one definition + one editor handler + (if native) one lens delta — and the workbar, AI tools, strict-native gating, choreography metadata, and prompt documentation update themselves. Ghost capabilities fail the build.

**Prerequisites:** P2.I1–I3 accepted (the IR maps to lens deltas; they must be real). **Architecture:** ARCHITECTURE-CAPABILITIES (all). **Findings absorbed:** Part XII (CMD-1..6), PREF-1..3, the C2 asymmetry, DOC-10-class ghosts (now impossible).

**Difficulty (PROCESS §4):** I1 = Hard / GPT 5.6 Sol xhigh. I2, I3, I4, V1 = Medium-thinking / Grok 4.6 High.

## P3.I1 — IR core + Office formatting family (H)

The `CapabilityDefinition` schema and derivation pipeline (registry projection, AI tool schema generation, gating composition, ghost build gate) proven on the worst-mismatch family first: Office text/cell formatting (~15 commands ↔ `format_blocks` ↔ `format-runs` today). Deliverables: definitions module per type family; generated `CommandBinding`s rendering pixel-identically through the existing workbar (no visual change — this unit is plumbing); generated `propose_operation` schemas (consumed for real in P4, validated now); the ghost gate in the owning unit; `capability-audit.ts` retargeted at the IR.

## P3.I2 — Full IR migration (MT)

Remaining Office commands; application scope (navigation, settings, library/tree ops with authority `riskClass`); non-Office types (quiz, flashcards, code, whiteboard, planner, agent — inline studio bindings registered without behavior regression). Stable ids never change (D34). Presentation maps (tab/icon/control/shortcut) are the only hand-written remainder per type.

Not Luna: authority classes and non-Office studios are edge cases inside the IR, not a mechanical remainder walk.

## P3.I3 — Gate wiring + input-path unification (MT)

`gateOperation` becomes the mandatory chokepoint in `applyAiArtifactMutation` (CMD-2 closed; C2 symmetric — AI receives the same refusal sentences humans see). One dispatch chokepoint per studio: keyboard, context menu, chrome buttons all resolve definitions (closes PPT-5 keyboard bypasses, CMD-1 split-view double-fire, sheets' dual Mod+F, RichTextFormatBar raw chains, unregistered dispatcher ids). Overflow ranking inverted so honest-disabled controls stay visible (CMD-3).

## P3.I4 — Preferences/customization unification (MT)

One merge algorithm (`resolvePreferences`) everywhere — the shallow dispatcher patch, the one-level server `mergeValues` (the settings-corruption family), and ad-hoc client applies die (PREF-1). Zombie command-id pruning on IR migration; StrictMode double-write fixed; fire-and-forget writes get failure surfaces (PREF-2); empty-subscription default-clobbering guarded (PREF-3). Rename/density either get their UI or leave the schema (wire-or-delete).

## P3.V1 — Protocol conformance verification (MT)

Generated parity tests (every definition reachable in UI; every AI-exposed definition schema-valid; every native definition's delta real — imported, not string-matched); a journey card verifying cross-surface consistency (learn a control in one place, it's identical everywhere — D41); a regression card per non-Office studio confirming no behavior change; split-view shortcut card (one fire, one artifact).

**Model: Grok 4.6 High.** Not property/chaos Hard.

## Exit gate

Ghost gate + conformance suites in their owning units; the "add one capability" walk-through (a real new small capability added as the acceptance demo, touching only definition + handler + delta) recorded as evidence; V1 PASS; Pablo pass.

## P3.I1 implementation log — 2026-08-27

- Status: **IMPLEMENTED**; acceptance remains P3.V1/Pablo-owned.
- Root cause: Office formatting capability truth lived in UI bindings, aggregate manifest verbs, and lens schemas independently.
- Added the typed `CapabilityDefinition` core and 37 Document/Sheets/Presentation formatting definitions.
- Workbar bindings now derive params, availability, native reach/refusal, authority, choreography, and legacy manifest specialization from the IR; authored presentation stayed unchanged.
- Generated typed per-type `propose_operation` Zod/JSON schemas for P4 consumption.
- Build preflight now imports real lens schemas and fails missing, unclaimed, or fictional formatting deltas and missing native refusals.
- `capability-audit.ts` now grades granular IR ids while retaining unmigrated manifest verbs for P3.I2.
- Focused Vitest: 10 files / 159 tests; capability gate, secret scan, diff check, and scoped ESLint (0 errors) passed.
- Signed-in Playwright smoke: mounted Presentation Shape formatting controls held with 0 console errors; known overflow warnings remain P5.I1.
- `tsc` and architecture checks contain only recorded repository blockers; no P3.I1-owned failure.
- Later owners unchanged: P3.I2 remaining migration, P3.I3 dispatch/gate paths, P3.I4 preferences, P5.I1 overflow loop, P6.I3 logger wiring.

## P3.I2 implementation log — 2026-08-27

- Status: **IMPLEMENTED**; acceptance remains P3.V1/Pablo-owned.
- Root cause: remaining Office, application, and studio commands still authored availability/native/manifest truth beside the IR.
- Catalog now covers remaining Office ops, application `riskClass`, and quiz/flashcard/code/whiteboard/planner/agent workbars; stable ids unchanged (D34).
- Projection overwrites IR-owned fields at assembly; extra original manifest verbs stay so inspections bundled on a control are not dropped.
- Honesty: `presentation.slide.add` claims `add-slide` and is enabled in strict-native; hyperlink/footnote-class refusals fire even when the region reads NATIVE (DOC-10).
- Recalc, named-range manager, and reading-order panel stay view-side (no native write claim, no false undo).
- Ghost gate claims every imported lens delta kind. `gateOperation` NATIVE-no-delta still belongs to P3.I3.
- Focused Vitest: 7 files / 136 tests; `check:capabilities`; secret scan 2108 files; `git diff --check`; scoped ESLint 0 errors.
- Live Playwright not run (`localhost:3000` did not answer). No visual redesign.
- Later owners unchanged: P3.I3 gate/keyboard/overflow, P3.I4 preferences, P5.I1 overflow loop, P6.I3 logger wiring.

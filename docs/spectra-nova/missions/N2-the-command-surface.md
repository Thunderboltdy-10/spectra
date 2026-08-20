# N2 — THE COMMAND SURFACE

**Charters:** Product Engineer (primary) + AI Systems Engineer (registry contract only)
**Prerequisites:** N1 accepted in `STATE.md`
**Architecture:** ARCHITECTURE-COMMANDS (all); ARCHITECTURE-STORAGE §11.3 (settings migration); ARCHITECTURE-FIDELITY §2 (availability inputs — stub them, N4 fills them); ARCHITECTURE-AI §2, §7
**Evidence:** `.shots/missions/N2/` · Tier P for the surface, Tier R for the settings migration

## Objective

Build the one command registry and turn `ArtifactWorkbar` into its renderer: category tabs, contextual tabs, per-command compact/medium densities, an expanded mode, and real user customization — all persisted with the **account**, not the browser. When N2 closes there is exactly one semantic path per operation (C1), the AI capability layer of N8 has a language to speak, and N7 can add serious editor depth without inventing a single new toolbar.

## Why now

Every later surface hangs off this. N7 depth is impossible without a place to put commands that is not another bar. N8 choreography must resolve the control position the *user currently has*, which requires the registry plus synced preferences. And settings must leave `localStorage` before anything real (sync policies, toolbar layout, AI authority mode) depends on account-level truth.

## Workstreams (ordered)

### W1 — Settings become account truth (Tier R)

1. New Convex `accountPreferences` with the existing scope semantics: `account`, `workspace`, `work_type`, `device` overlay — mirror the merge order of `resolvePreferences` exactly (`src/features/spectra/settings/preference-store.ts`, `settings/schema/preferences.ts`). Do not invent a second merge algorithm.
2. Server-side Zod validation on every write (charter rule; NV-4 must not repeat in new code). Unknown or legacy keys are dropped with a logged migration note, never persisted blind.
3. One-time client migration of `spectra:preferences:v2` into account scope with merge; genuinely device-specific values stay device-scoped. `localStorage` is demoted to an offline cache and fast first paint; the account is authority.
4. `settings.changed` bus event preserved; add subscription-driven propagation so a change made on device A appears on device B without a reload.
5. The four wired settings sections keep working throughout. This is a storage migration, not a settings redesign — redesign belongs to N10.

### W2 — The registry (Tier P, with unit tests on availability)

1. Create `src/features/spectra/commands/` implementing the `Command` record of ARCHITECTURE-COMMANDS §2 verbatim: namespaced stable ids, params schema, single `execute`, `availability(ctx)`, `presentation` densities, `defaultPlacement`, `contextualTab`, `shortcut`, `risk`, `undo`, `choreography` hints.
2. Migrate every per-studio `WorkbarActionSpec` in the nine creatable studios into registered commands. Manifest `operations` name lists (`artifacts/registry.ts`) become command-id references — one vocabulary, not two.
3. **Enforce C1.** Audit every control in every studio; each one either routes through a command `execute` or is deleted. Put the coverage count in the mission log (commands registered / controls migrated / controls deleted).
4. **Enforce C2.** `availability` consumes exactly the context the AI will later receive: capabilities (`workCan`), compatibility profile, fidelity map (stubbed as all-NATIVE until N4), selection, permissions. One function, two consumers.
5. Close M4-E10 here: fold the `blueprints/*` remnants and the `artifact-card.tsx` `blueprintMeta` divergence into the manifest/registry pair and delete the leftovers. One type vocabulary, one label source — this kills the five-names-for-one-type problem HQ logged as seam S4.
6. Derive keyboard shortcuts and context menus from the registry instead of local handlers. `spectraBus` product commands (`work.open`, `settings.*`) stay as they are for now — N8 migrates them; do not break the bus.

### W3 — Tabs, densities, expansion, contextual tabs (Tier P)

1. `ArtifactWorkbar` becomes the registry renderer. The category tab row lives **inside** the single workbar identity — not a new chrome layer, not a second navbar, not a stack (D34). Collapsed height stays in the current family.
2. Tab taxonomies per ARCHITECTURE-COMMANDS §3: Document `General · Insert · Format · Layout · References`; Sheets `General · Insert · Format · Data · Formula · Review`; Presentation `General · Insert · Design · Arrange · Animate · Present`; Quiz, Flashcards, Plan, Code, Whiteboard and Agent get `General` plus tabs only where real depth already exists. Do not inflate simple types.
3. Compact and medium presentations per command and control kind (`[Aa ▾]` versus `[ Inter ▾ ]`). Where a kind has only one honest form, declare one — do not fabricate a second.
4. Expanded mode: the workbar grows vertically into labeled groups, ribbon-functional and Spectra-visual. Per-user, per-type, persisted. Default stays collapsed.
5. Contextual tabs wired to real selection models in at least Document (Equation, Table, Image), Sheets (Chart, Formula), Presentation (Shape, plus a Transition tab that is honest about being preserved-only until N5), Whiteboard (Shape) and Code (Code output). They appear on context and dismiss when context leaves.
6. Width-pressure shedding keeps working, now reading priority from placement plus density preferences rather than hardcoded lists.

### W4 — Customization (Tier P)

1. User operations: pin and remove in General, move between valid tabs, reorder commands, reorder tabs, rename visible labels (id untouched), set density per command, expanded on or off, reset-type-to-default.
2. Affordance: one calm customization mode on the workbar itself (drag to move, context menu for options) plus a settings section offering the same operations. No separate configuration app.
3. Layout is a preference section inside the W1 store, so it syncs across devices and is reachable by N8 as an ordinary settings action.
4. Live propagation: a layout change re-renders every open editor workbar **in place** (D40) — no remount, no lost editor state, no scroll reset. Verify with an artifact open in a split while the layout changes from settings.
5. Named layout presets only if trivially cheap after the above. Not required.

### W5 — Convergence sweep (Tier P)

1. Resolve NV-3: converge the two rich-text implementations (`ArtifactRichTextEditor` versus the document toolbar path) into one, with formatting commands from the registry. Delete the loser.
2. Any second bar-like row discovered in a studio during migration is deleted, not registered.
3. Apply the sweep rule to anything adjacent you break or notice.

## Invariants to uphold

C1 (one execute per operation), C2 (availability parity), D33–D35, D40 (live in-place updates), **D41 (one control, one component — the registry is the enforcement mechanism: a command rendered on two surfaces is one component with one label, never two look-alikes), D42/D44 (bounded reads and viewport framing for every menu, palette and picker you build)**. Typing path untouched (D20). No parallel settings store, no parallel registry, no second workbar.

## Out of scope

Command palette / kbar (trivially derivable later) · AI execution of commands (N8) · editor feature depth (N7) · fidelity-driven availability beyond the stub (N4) · settings redesign (N10) · presets beyond cheap.

## Acceptance gates

1. Registry coverage: every workbar control in all nine studios resolves to a command id, with the count in the log and grep evidence that no studio mutates state outside a command `execute`.
2. Settings migration: dry-run and cutover evidence; a preference set in one browser profile appears in a second profile of the same account without reload; a malformed write is rejected by validation (test).
3. Tabs, densities and expansion demonstrated in Document, Sheets and Presentation: collapsed, expanded, compact, medium, plus a narrow-width shedding shot.
4. Contextual tabs: screenshots of each wired context appearing and dismissing.
5. Customization: pin, move, reorder, rename, density and reset all evidenced, persisted across reload, and propagated live into an open split editor (before/after shots of the same mounted editor, no remount).
6. M4-E10 closed: one type vocabulary; `blueprints/*` remnants and duplicate label sources deleted (grep evidence).
7. P0, P1, P2, P8 and P11 pass fresh; keyboard shortcuts still work and now come from the registry.
8. STATE updated (NV-3 resolved, M4-E8 and M4-E10 closed); mission log ≤40 lines; close-out checks green.

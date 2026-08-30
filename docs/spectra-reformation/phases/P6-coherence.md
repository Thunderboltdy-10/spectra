# P6 — Coherence

**Goal:** the product feels like one designed thing (N10's intent, absorbed). UX dead ends close, the design system is adopted rather than merely existing, copy tells the truth, and a fresh user can navigate without an implementer's mental map. This phase is large in surface but medium in risk — the architecture is settled by now.

**Prerequisites:** P0.I4 (baseline) long accepted; P1–P5 substantially accepted (this phase polishes truth, it doesn't create it). **Architecture:** ARCHITECTURE-PLATFORM §3, PRODUCT §5, CANON R13/R16, D41–D44. **Findings absorbed:** Part XVIII wholesale (UX-1..14), Part XIX (DS-1..6), remaining ORG-*, a11y items from DS-4.

**Difficulty (PROCESS §4):** I1, I2, V1 = Medium-thinking / Grok 4.6 High. I3 = Simple / GPT 5.6 Luna Max.

## P6.I1 — UX debt closure (MT)

Grouped by the audit's root-cause classes, closed class-wide (R12 discipline):

- **Exit ramps everywhere**: discard path (done in P1.I3 — verify), trash management (empty/permanent-delete), conflict resolution reachable from Library, failed mutations retryable not toast-and-gone, deep-link params stripped on close, browser Back behaves (history integration).
- **Scope-blind components fixed**: dock shows cross-workspace runs (badged), search copy matches scope or scope matches copy (UX-7), inspector reachable below xl via Sheet (desktop-narrow, not mobile), invitations delivered live and visible outside the hub (UX-4).
- **Copy truth pass**: "Archive"≠delete (UX-10), revoked-vs-deleted distinguished, defensive copy for abolished concepts removed, all remaining machine tokens hunted (R13 sweep).
- **Shortcut/help layer rebuilt**: advertised shortcuts exist, dead ones die, help dialog mounts, no full-reload navigations (UX-9).
- **First-run**: fresh-account experience with guidance instead of empty-board vacuum; load-failure states get retry (UX-11).
- **Board completes**: drag-and-drop or explicit move affordances incl. keyboard (UX-6); footer stops advertising what doesn't exist.

**Owns P0.V2 SYSTEMIC** Library Share silent no-op (divergent Library `Share…` vs studio `Share work`). Do not delay P1 for it; no P1 brief claims it.

### P6.I1 implementation log - 2026-08-30

- TRIAGE · SYSTEMIC: Library/List/Board chrome collided in split desktop widths; toolbar groups now wrap and shrink intentionally.
- Shortcut help and registration share truthful commands; settings, chat, invitation review, and Bridge recovery use client navigation.
- Library mutations offer Retry, search is scope-aware, Share reaches the studio dialog, and workspace deletion is named delete.
- Live Dock keeps cross-workspace runs with badges; inspectors use a focus-trapped Sheet below `xl` and an inline rail at `xl`.
- Board columns are drop targets and cards expose a keyboard Move menu; obsolete footer promises are gone.
- Fresh empty accounts enter List guidance; overview/workspace loading has shaped skeletons and in-place retryable failure.
- Shell URLs now push workspace/work history, replay browser Back, canonicalize direct work links, and strip closed/invalid work state.
- Focused Vitest: 3 files / 29 tests. Scoped ESLint: 0 errors. Secret scan and diff checks passed.
- `tsc --noEmit` retains only recorded cross-unit blockers; `check:copy` is blocked by its stale `artifacts-shell.tsx` path.
- BOUNDARY · SYSTEMIC: mixed folder/thread Trash purge has no canonical mutation; only work/workspace permanent deletion exists. No unsafe purge was invented.
- Status: IMPLEMENTED with the trash-contract boundary escalated. No acceptance claimed.

## P6.I2 — Design-system adoption sweep (MT)

ESLint rules escalate warn→error directory-by-directory as codemods land; top-offender files first (artifact-studio 425 escapes, managebac 360, conversation-surface 296); radius/type/z values onto tokens; brand violet unified; dark-mode hardcoded-light patches fixed at cause; `spectra-app.css` burn-down (remediation selectors deleted with their causes; !important count tracked as a ratchet in the owning unit). A11y: icon-button names (439 missing), contrast fixes (tertiary/placeholder), focus-visible verified product-wide. Component consolidation: dialogs (done P0/P6 remainder), tooltips→1, skeletons→1, spinners→1, empty states→1 voice.

Not Medium-simple: census codemods sit next to a11y and consolidation taste. Grok, not Luna.

### P6.I2 implementation log — 2026-08-30

- TRIAGE · SYSTEMIC: every artifact workbar implemented its own density and popup behavior, so narrow panes could clip labels, duplicate commands, or lose compound controls. The shared overflow planner now preserves authored order, keeps essential refusals visible, sends advanced actions to labelled overflow, collapses only safe icon-bearing actions, and moves compound controls intact.
- Replaced workbar-owned document listeners, fixed-position menus, and hand-positioned control popovers with the shared Radix dropdown/popover primitives. Menus remain portaled, collision-aware, keyboard navigable, and use named layers.
- Applied one studio inset/radius/layer contract across finite and infinite canvases; normalized workbar radii and removed one-off workbar shadows and stacking values.
- Rebalanced the timetable and shared artifact shell so all mounted artifact types consume the same workbar geometry. Compact icon actions retain accessible names and tooltips; text-only and value-bearing controls never collapse to empty icons.
- Added regression coverage for labelled advanced overflow, non-duplication, reachability, narrow shedding, and primitive menu semantics. Focused P6 tests and static gates pass.
- The repository-wide token census remains a measured P6.V1 audit input; this unit closes the in-flight shared workbar/design-system seam without mechanically rewriting unrelated product surfaces.
- Status: IMPLEMENTED; independent P6.V1 verification remains required. No acceptance claimed.

## P6.I3 — Remaining decompositions + dead-code sweep (S)

Tier-2/3 god-file splits (content adapters, history, chrome, readonly viewers); shadow window-CustomEvent bus folded into `spectraBus` (dead listeners/emitters deleted); dead barrels, orphan tables documented or dropped (ORG-4), schema tombstones cleaned; `wire-or-delete` sweep across flagged dead affordances not already handled.

### P6.I3 implementation log — 2026-08-30

- TRIAGE · SYSTEMIC: semantic navigation/state used a second untyped window bus; migrated every production `spectra:*` window listener/emitter to typed `spectraBus`, deleted unmatched routes, and made the architecture gate reject recurrence.
- TRIAGE · LOCAL: `logging.ts` called the already-deleted `errorEvents:log`; removed the zombie Convex sink and kept structured stdout/stderr as the one owned logger path.
- TRIAGE · LOCAL: `check:copy` opened two deleted shells; retargeted it to the mounted Spectra, Library, and studio surfaces.
- ORG-4: current workspace views are only Cards/Library; legacy Canvas/Timeline values normalize to Library and cannot be written/imported. `spectraFocusSpaces` is documented read-only until an explicit destructive migration owns its live rows.
- Split shared deck/quiz types, normalizers, and helpers from `artifact-studio.tsx` into `artifact-content-model.ts`; removed the dead synchronized-snapshot chrome path and three zero-consumer barrels.
- Evidence: focused Vitest 6 files / 54 tests; `check:architecture`; `check:copy`; scoped ESLint on new/shared/gate files; `git diff --check`; secret scan.
- Root `tsc --noEmit` names no P6.I3-owned path; recorded cross-unit lens, embed, capability, collaboration-test, and presentation-test blockers remain. The stale Agent Library import blocker was repaired in-scope.
- Status: IMPLEMENTED; independent P6.V1 verification remains required. No acceptance claimed.

## P6.V1 — Whole-product convergence audit (MT)

The absorbed N10: an audit sweep (AS) plus journey verification at realistic density (10k-node Library, large artifacts) across every primary surface — reuse audit (D41: one control, one name, one shape), bounded-read audit (D42, Network panel), viewport framing (D44), both color schemes, keyboard-only pass, fresh-user cards for every major flow. Findings triaged; LOCAL fixed in-phase; SYSTEMIC escalate.

**Model: Grok 4.6 High.**

## Exit gate

Token-rule error coverage ≥ the agreed directory list; a11y checks green; V1 PASS with zero SYSTEMIC findings open; Pablo pass says "coherent".

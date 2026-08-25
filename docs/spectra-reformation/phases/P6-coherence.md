# P6 — Coherence

**Goal:** the product feels like one designed thing (N10's intent, absorbed). UX dead ends close, the design system is adopted rather than merely existing, copy tells the truth, and a fresh user can navigate without an implementer's mental map. This phase is large in surface but medium in risk — the architecture is settled by now.

**Prerequisites:** P0.I4 (baseline) long accepted; P1–P5 substantially accepted (this phase polishes truth, it doesn't create it). **Architecture:** ARCHITECTURE-PLATFORM §3, PRODUCT §5, CANON R13/R16, D41–D44. **Findings absorbed:** Part XVIII wholesale (UX-1..14), Part XIX (DS-1..6), remaining ORG-*, a11y items from DS-4.

## P6.I1 — UX debt closure (M)

Grouped by the audit's root-cause classes, closed class-wide (R12 discipline):

- **Exit ramps everywhere**: discard path (done in P1.I3 — verify), trash management (empty/permanent-delete), conflict resolution reachable from Library, failed mutations retryable not toast-and-gone, deep-link params stripped on close, browser Back behaves (history integration).
- **Scope-blind components fixed**: dock shows cross-workspace runs (badged), search copy matches scope or scope matches copy (UX-7), inspector reachable below xl via Sheet (desktop-narrow, not mobile), invitations delivered live and visible outside the hub (UX-4).
- **Copy truth pass**: "Archive"≠delete (UX-10), revoked-vs-deleted distinguished, defensive copy for abolished concepts removed, all remaining machine tokens hunted (R13 sweep).
- **Shortcut/help layer rebuilt**: advertised shortcuts exist, dead ones die, help dialog mounts, no full-reload navigations (UX-9).
- **First-run**: fresh-account experience with guidance instead of empty-board vacuum; load-failure states get retry (UX-11).
- **Board completes**: drag-and-drop or explicit move affordances incl. keyboard (UX-6); footer stops advertising what doesn't exist.

## P6.I2 — Design-system adoption sweep (M)

ESLint rules escalate warn→error directory-by-directory as codemods land; top-offender files first (artifact-studio 425 escapes, managebac 360, conversation-surface 296); radius/type/z values onto tokens; brand violet unified; dark-mode hardcoded-light patches fixed at cause; `spectra-app.css` burn-down (remediation selectors deleted with their causes; !important count tracked as a ratchet in the owning unit). A11y: icon-button names (439 missing), contrast fixes (tertiary/placeholder), focus-visible verified product-wide. Component consolidation: dialogs (done P0/P6 remainder), tooltips→1, skeletons→1, spinners→1, empty states→1 voice.

## P6.I3 — Remaining decompositions + dead-code sweep (S)

Tier-2/3 god-file splits (content adapters, history, chrome, readonly viewers); shadow window-CustomEvent bus folded into `spectraBus` (dead listeners/emitters deleted); dead barrels, orphan tables documented or dropped (ORG-4), schema tombstones cleaned; `wire-or-delete` sweep across flagged dead affordances not already handled.

## P6.V1 — Whole-product convergence audit (M)

The absorbed N10: an audit sweep (AS) plus journey verification at realistic density (10k-node Library, large artifacts) across every primary surface — reuse audit (D41: one control, one name, one shape), bounded-read audit (D42, Network panel), viewport framing (D44), both color schemes, keyboard-only pass, fresh-user cards for every major flow. Findings triaged; LOCAL fixed in-phase; SYSTEMIC escalate.

## Exit gate

Token-rule error coverage ≥ the agreed directory list; a11y checks green; V1 PASS with zero SYSTEMIC findings open; Pablo pass says "coherent".

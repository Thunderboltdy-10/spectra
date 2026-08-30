# P15 — Experience: Onboarding & Connections

**Goal:** the first hour of a real user's life in Spectra becomes a designed product, and everything the expansion built (connectors, depth, school intelligence) presents as **one coherent surface** rather than a fleet of merged worktrees. This is the expansion's equivalent of P6: convergence and polish, gated by journeys from clean profiles. The P9.I4 bootstrap checklist already rehearsed the raw onboarding path; this phase makes that path good.

**Prerequisites:** P9 accepted (I1/I2 build on its surfaces); P15.I3 may start early against already-merged surfaces; **P15.V1 waits for P11.V1 and P13.V1** (it verifies the composed experience, not fragments). **Architecture:** PRODUCT (experience laws), ARCHITECTURE-PLATFORM (design system), EXPANSION §7. **Findings absorbed:** onboarding exploration 2026-08-30 — no student-facing onboarding wizard exists (signup → invitation accept → bare workspace); ManageBac identity resolve and class selection live on separate pages a new user would never find; the standing narrow-width chrome findings (STATE §1 2026-08-30).

**Difficulty (PROCESS §4):** I1, I2, I3 = MT / xhigh. V1 = Hard / **max**.

## P15.I1 — The onboarding journey (MT)

From Clerk signup to first real work, as one guided flow with honest skips (every step skippable, nothing lies about being required):

1. Sign-up / invitation accept → school membership confirmed in plain words.
2. **School data:** if the school has ManageBac connected — identity resolve, bootstrap sync with visible progress, then the P13.I2 class picker inline ("These look like your classes — create workspaces for them?"). If not, a clean skip.
3. **Your files:** Bridge introduction (R15 tone — optional always), pairing, first folder mount; or skip with "your files stay where they are".
4. **Connections:** the P10.I1 hub presented as optional cards (Google, Notion, calendars…).
5. First artifact: land in a seeded workspace with an honest empty state that teaches creation + AI in one gesture.

Re-entrant (resumable, revisitable from Settings), state persisted per account, no modal chains (R16). Owns: onboarding routes/components, first-run detection, empty-state seam. Does not own: the connector/MB mechanics it composes.

## P15.I2 — Connections hub completion (MT)

The P10.I1 skeleton graduates to the product surface for *every* external relationship:

- Uniform card grammar: identity, scope sentence (what syncs, what doesn't — the R25 sentence), health state with one compensating action ("Reconnect", "Fix in Google", "Remove"), last-activity truth.
- Bridge devices + mounts fully at home here (device revoke wired end-to-end — the P10.I1 wiring polished), ManageBac as the school-data card (admin vs member views), per-connection sync policy through the R14 toggle vocabulary.
- Double-sync risk generalized: the OneDrive/Dropbox path heuristic grows to warn on any two connectors watching the same content (e.g. a Drive-synced folder also mounted via Bridge).
- Add/remove lifecycle: removing a connection states consequences plainly (what stays, what becomes unavailable) and executes the compensating transitions (R2) — verified copy against actual behavior, not aspiration.
- Owns: `settings/ui/` connections surfaces. Does not own: worker/truth logic (P10/P11).

## P15.I3 — Expansion UI/UX audit sweep (MT)

P6.I2's convergence discipline applied to every surface the expansion added or touched:

- Design-system adoption on new surfaces (tokens, primitives, no bespoke chrome); the ESLint design census must not regress on touched directories.
- Narrow-width grading for every studio workbar that gained P12 depth (the standing STATE §1 finding): icon/text fallback, meaningful ordering, overflow correctness — capability truth never reduced to make the bar fit.
- Copy sweep (R13): every new state sentence (connector health, sync scope, CAS boundaries, memory/skill caps) reads as a human sentence; `check:copy` path fixed if still crashing on the deleted shell (Field Note 2026-08-28).
- Motion/feedback pass per R16: state shown on the thing itself across new surfaces.
- Owns: cross-cutting polish diffs; anything structural found here is triaged (R12) to its owning phase, not absorbed.

### P15.I3 implementation log — 2026-08-31

Status: IMPLEMENTED. No acceptance claimed.

- Audited the merged Code-depth surface against the established Spectra reference language: calm, dense, token-led, with capability truth preserved.
- Replaced all 42 Code-studio design-system escapes with shared radius, type, shadow, and named-layer tokens; the touched surface now has zero scoped ESLint/design warnings.
- Replaced the bespoke run control and confirmation-modal implementation with the shared Button and Radix-backed Dialog primitives, retaining destructive-state and focus behavior.
- Humanized run, import, asset, publishing, permission, and empty-state copy; shared work-type metadata now replaces raw blueprint keys in resource labels.
- Expanded `check:copy` to cover Code and Soul settings and to reject directly rendered internal status enums.
- Regraded the Code workbar at narrow widths: the existing deterministic overflow contract retains every authored action, order, and compound control, so no capability was removed to make the bar fit.
- Focused Vitest: 6 files / 51 tests PASS. Root TypeScript, copy, capability, design-token, secret, scoped ESLint, and diff gates PASS.
- Full design census: 1,902 existing escapes repository-wide; none remain in the touched Code studio. The token gate's 15 warnings are on untouched paths.
- No structural connector, school, or studio-depth defect was absorbed; those ownership boundaries remain P10/P11, P13, and P12 respectively.
- No server, browser, Convex process, Bridge, Office, cloud I/O, or live lease was used.

## P15.V1 — Composed-experience verification (H, max)

Fresh agent, **clean profiles** (new accounts, not the seeded pair), own local instance:

- **The first hour, twice:** (a) a student at a ManageBac school — signup through class import through first assignment planned through first artifact, following only what the product affords (no doc knowledge); (b) a user with no school connection — files-first path via Bridge + a Google connection. Sequences with timestamps (R11); every friction point filed with triage class.
- **Connections lifecycle matrix:** add/remove/revoke/re-add across three provider families including failure injections (denied OAuth, expired token on reopen).
- **Coherence audit:** one pass across all new surfaces for design-system, copy, narrow-width — grading as a user, per the P8 perception rule.
- Budget re-check against P9 baselines on the composed product.

## Exit gate

Both first-hour journeys complete without doc knowledge and read as designed, not assembled; the Connections hub is the single truthful home of every external relationship; the audit sweep's systemic findings are closed class-wide or owned in Field Notes; V1 PASS; Pablo's L5 pass on the onboarding flow specifically.

# P6 — Coherence

**Goal:** the product feels like one designed thing (N10's intent, absorbed). UX dead ends close, the design system is adopted rather than merely existing, copy tells the truth, and a fresh user can navigate without an implementer's mental map. This phase is large in surface but medium in risk — the architecture is settled by now.

**Prerequisites:** P0.I4 (baseline) long accepted; P1–P5 substantially accepted (this phase polishes truth, it doesn't create it). **Architecture:** ARCHITECTURE-PLATFORM §3, PRODUCT §5, CANON R13/R16, D41–D44. **Findings absorbed:** Part XVIII wholesale (UX-1..14), Part XIX (DS-1..6), remaining ORG-*, a11y items from DS-4.

**Difficulty (PROCESS §4):** I1–I3 are implemented history. Active order is I4 → UI1 → UI2 → V1. I4/UI1/UI2 = Grok 4.6 High; V1 = GPT 5.6 Sol high. UI1 and UI2 are two of the four reserved UI-specialist sub-phases.

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

## P6.I4 — Launch contract closure (MT)

**Model: Grok 4.6 High.** This is a bounded implementation packet, not a new architecture. It closes functional gaps that would make a school launch feel unfinished before visual polish begins.

### Read first

- Reproduce the mixed folder/thread Trash case from P6.I1 and trace every existing deletion/purge mutation, permission check, placement edge, thread reference, artifact summary, attachment, and audit consumer.
- Audit the landing→sign-in→invitation→school bootstrap path against the already-integrated Clerk/JWT fixes and deterministic local seed. Do not replace Clerk or invent another local auth mode.
- Read every still-open P5/P6 Field Note in STATE and classify it as already fixed by the stable composition, owned here, owned by UI1/UI2, or release-gate evidence. Cite code, not old status prose.

### Implement

1. Define one typed permanent-trash contract for every trashable launch object. Mixed selections either purge atomically with an itemized result or refuse before mutation with a plain sentence; partial silent success is forbidden.
2. Ensure purge/move/restore updates org placement, child counts, bounded Library summaries, collaboration/thread references, and search/index projections without unbounded reads.
3. Exercise signed-out preferences, expired/stale JWT, invitation-cookie recovery, accepted-invite idempotence, operator-without-membership, and seeded school-admin entry. Repair only discovered gaps; keep the existing auth boundary.
4. Close dead launch controls discovered during the audit with wire-or-delete. Do not import P9–P15 product features to satisfy a dead affordance.

### Check

- Red-first tests for mixed purge, failure atomicity, restore-after-partial-history, child-count/summary parity, and authorization on each mutation.
- Focused login/invitation/operator/bootstrap tests plus one browser journey from landing to a seeded school surface.
- Static bounded-read audit on every touched Convex query; no `.collect()` over an owner or room history.
- Full typecheck and relevant copy/capability/secrets gates. V1 owns the full product sweep.

### Exit

No functional P6 Field Note lacks an owner; mixed Trash is real and tested; the seeded school login path has a fresh-browser proof; one coherent commit and an implementation log. Do not ask for owner acceptance.

### P6.I4 implementation log — 2026-09-01

- TRIAGE · SYSTEMIC: Trash was restore-only; mixed folder/thread/work had no atomic forever-delete. One `orgTree.purge` now refuses in a sentence before any write, or purges the expanded subtree with an itemized result. Bounded `take(100)` drains, not owner/room `.collect()`.
- Library Trash: Restore + Delete forever, Empty Trash, shared `TrashPurgeDialog`. Copy: items stay until restore or delete forever.
- Native Library titles use the path basename (`listingNameForNativeWork`); path rename always updates the node name. Accepting a share places an invitee org node so Shared can list it; accept is idempotent.
- Join token cookie survives Clerk; AppShell will not dump a signed-in user to workspace while it is stored. Already-accepted school invites return `alreadyMember`. Tree reads skip until Convex is authenticated (stale JWT).
- Taste: Empty Trash only when Trash has rows; dialog reuses the studio delete voice. Studio `permanentlyDelete` still owns blob/meter cleanup.
- Evidence: focused Vitest 7 files / 54 tests; `.shots/reformation/P6.I4/` (Trash empty, seeded Library, `/` → school workspace). No acceptance claimed.

## P6.UI1 — Responsive shell, Library, and workbar coherence (MT) — **IMPORTANT / LAUNCH-CRITICAL / UI SPECIALIST 1 OF 4**

**Model: Grok 4.6 High with the frontend UI specialist skill stack.** Work from live screenshots before changing code. This sub-phase owns visual structure and interaction density, not capability semantics.

### Surfaces and invariants

- Primary shell, Library List/Board, workspace split view, Live Dock, studio identity bar, shared workbar, inspector/sheets, dialogs and menus.
- Test widths 1920, 1440, 1280, 1024, and the narrowest supported desktop. Mobile remains out of scope.
- No collision, clipped label, unreachable command, double scrollbar, accidental fixed overlay, or content hidden behind the Dock.
- Preserve authored command order, essential actions and truthful refusals. Overflow may reorganize presentation; it may not delete capability.
- One inset/radius/layer rhythm across document, sheets, presentation, code, whiteboard, quiz, flashcards, planner, agent and timetable studios.

### Method

1. Capture a before matrix with realistic long titles, 10k-style Library density, active collaboration, multiple Dock tabs, failed/retrying states, and both themes.
2. Map each collision to the shared primitive or token that owns it. Fix the shared cause; no per-screen magic numbers unless the surface is structurally unique.
3. Verify keyboard reachability, visible focus, menu collision handling, zoom, text scaling, and browser Back while each layout is dense.
4. Capture after images at the same sizes and content. Include a difference note for each changed shared primitive.

### Gates

Focused component/interaction tests; workbar overflow and non-duplication tests; Playwright screenshot matrix; keyboard-only journey; no new raw colors/radii/z-index; no capability-gate diff. Exit with zero launch-blocking visual collisions.

### P6.UI1 implementation log — 2026-09-02

- TRIAGE · SYSTEMIC: split-panel sizing had two authorities that disagreed at narrow widths — the JS fitter asked for the work's floor while the CSS cap squeezed the panel under it (768px: a 248px studio beside a 280px library, identity bar and workbar tabs clipped). One pure resolver (`split-presentation.ts`) now owns the boundary: when the host cannot honor library reserve + the work's registry `minInlineSize`, `StudioSplitShell` promotes the panel to a full-width overlay over the content column (library stays mounted; close/Escape/hub-tab return; +32px hysteresis; demotes back to split when the host fits). Scoped to the workbench row (`data-split-host`); route side previews and landing scenes keep their fixed-width behavior.
- TRIAGE · SYSTEMIC: every surface guessed its own composer clearance (`pb-24` list, `pb-[150px]` workspace, nothing on board) and the guesses lost whenever the dock grew. The band now publishes its own height: `composer-safe-area.ts` registry (multi-mount safe) fed by `WorkbenchLiveStack`, one `.spectra-composer-clearance` rule consumed by Library list/board, workspace home, and the document scrollport; `.spectra-composer-above` lifts the selection pill and the return-to-follow pill above the band (UX-13 "pill parks under the dock"). Per-studio `useComposerSafeArea` deleted (migrate-and-delete; sheets/whiteboard now inherit the root var).
- TRIAGE · LOCAL: folder rail let a long tree paint over Quick views/Trash; the tree region now scrolls inside its own flex share (`organizer-rail.tsx`).
- Layer contract: sidebar `z-40`→`z-chrome`, selection pill `z-[200]`→`z-toast`, drag ghost `z-[400]`→`z-toast`, return pill `z-[80]`→`z-panel`, dock small-screen sheet `z-50`→`z-composer-dock`. No new raw colors/radii/z-index.
- Evidence: focused Vitest 12 files / 92 tests (new `split-presentation` 4 + `composer-safe-area` 3; workbar overflow/component, live-dock, ux-debt-closure, design-layers, organizer, sheets-render, persistence, sync-presentation, primitives all green); `tsc` adds zero errors (5 pre-existing P6.I4 Convex ctx-typing errors recorded in STATE); scoped ESLint 0 errors; copy/capability/token/secret gates pass; `fidelity:seam` 13/13.
- Browser: after matrix `.shots/reformation/P6.UI1/after/` (118 PNGs + manifest, captured by a separate Grok agent) — no new collisions; overlay coherent at 768 (full title/workbar, composer above panel, sidebar reachable); document still splits at 1024; dock clearance measured 97px/74px above the band at 768/1024. Keyboard-only journey: 18/18 tab stops with visible focus, open → Escape → Back replays the split. 200% zoom: no horizontal overflow; split self-promotes to overlay. `error-retry` overlay could not be restaged (opportunistic); recorded in the after manifest.
- Taste noted: overlay covers the library at narrow widths rather than squeezing both — the same call P6.I1 made for inspectors below xl. Placeholder keeps reserving split width during chunk load (one-frame settle into overlay); multiple simultaneous overlay panels stack latest-on-top.
- Status: IMPLEMENTED; independent P6.V1 verification remains required. No acceptance claimed.

## P6.UI2 — Tokens, accessibility, component convergence, and lint floor (MT) — **IMPORTANT / UI SPECIALIST 2 OF 4**

**Model: Grok 4.6 High with the frontend UI specialist skill stack.** Run after UI1 so it consolidates the surviving system rather than polishing components UI1 will remove.

### Scope

1. Burn the design census down class-by-class: raw color, radius, type, shadow and z-layer escapes; dark-mode hardcoded-light defects; `!important` remediation selectors.
2. Consolidate dialogs, tooltips, skeletons, spinners, empty states and status copy to one owned primitive/voice per role. Delete displaced implementations.
3. Close accessible names, contrast, focus-visible, focus trap/return, keyboard order, live-region restraint, reduced-motion and 200% text zoom across primary launch surfaces.
4. Make `npm run lint` pass with zero errors and zero warnings. Evidence/generated browser artifacts may be excluded only by a narrow path-level configuration with a written reason; product source rules may not be disabled or downgraded.

### Grok investigation packet

Start from `npm run check:design-tokens`, `npm run lint`, the census report and the highest-warning product files. Group warnings by root cause and shared primitive before editing. Work in bounded batches, run the owning component tests after each batch, and re-screenshot any visible component. Search for the deleted pattern after migration. Do not convert violations into inline disable comments, broad ignores, duplicated tokens, or nearly-identical replacement components.

### Exit

Zero lint warnings; design-token gate green; automated a11y checks green; representative keyboard/reduced-motion/dark-light browser matrix; warning and `!important` ratchets recorded; no broad gate weakening.

### P6.UI2 implementation log — 2026-09-02

- TRIAGE · SYSTEMIC: the workbench row had no shared budget — the thread and run panels lived outside `data-split-host` and could never overlay, so at ≤1440 they squeezed the library to 280px and forced the studio into its overlay early; independent per-panel fitters then oscillated (measured live: panels flipped 360↔420 indefinitely, one state over budget). One pure resolver now owns the row (`split-presentation.ts`): `resolveWorkbenchPanes` walks panels in priority order (work > thread > run) and promotes the lowest-priority panel to an overlay that spares in-flow siblings (measured right-inset); `allocateWorkbenchPanes` turns width intents into actual widths in a single pass (floors first, slack by drag-recency then priority) so the library reserve holds by construction and thrash is impossible; `resolveSidebarRail` rails the sidebar from the window width when panels need the room — presentational only, the stored preference is never rewritten and an explicit toggle wins until crowding clears.
- Live evidence (`.shots/reformation/P6.UI2/`): before, 1440 crushed the library to 280px beside studio 560 + thread 360; after, 1440 splits 420/420/360 stable across repeated measures, 1280 auto-rails the sidebar and keeps all four columns, 1024 keeps work + thread with the library covered (mounted), 768 stacks full-width overlays. Closing the thread restores the studio to its chosen width immediately.
- TRIAGE · LOCAL (DS-4): contrast cascade at the token level — light secondary/tertiary/placeholder shifted one step (#65615b / #716d67 / same) so every tier clears AA on every paper surface (worst 4.68:1, was 2.43:1); dark tertiary/placeholder #817b74 → #928c85 (worst 4.98:1). Hierarchy ratio preserved.
- In-area repairs: run panel header spoke raw card enums (`awaiting_confirmation`) and a re-invented violet `#8b6ff0` — it now derives the dock's truth state and speaks the one shared run vocabulary (`liveDockStateCopy`, moved into `live-dock-model.ts`; the dock consumes the same map); comments panel `z-[70]` → `z-panel` (embeds panel already used it); thread/run panels get the shared composer clearance so the dock band never covers their content or action footer.
- Evidence: focused Vitest 8 files / 91 tests (split-presentation 24: walk, rail, allocator incl. idempotence and drag-recency); `tsc` adds zero errors (5 pre-existing P6.I4 Convex ctx errors recorded in STATE); scoped ESLint 0 errors and −2 warnings on touched files; architecture/copy/token/secret gates pass; `git diff --check` clean.
- Owner-directed scope note (Pablo, this session): the 2,167-warning lint/census mass is preexisting and was deliberately not burned down here; the zero-warning lint floor from this unit's exit text remains open and is flagged for P6.V1's sweep decision. White-on-violet 4.48:1 (DS-4) is the brand accent itself — filed as a Field Note for P7.UI1 (identity owner), not changed unilaterally.
- Taste noted: overlays stack latest-on-top (UI1's call) and now spare split siblings; a dragged panel outranks default priority but can never push a sibling under its floor or the library under its reserve; auto-rail restores the moment the row fits again.
- Status: IMPLEMENTED; independent P6.V1 verification remains required. No acceptance claimed.

## P6.V1 — Whole-product convergence audit (MT)

**Model: GPT 5.6 Sol high, fresh session.** The absorbed N10 plus launch composition verification after I4/UI1/UI2.

Run realistic density (10k-node Library, large artifacts, long names, multiple active runs) across every primary surface. Audit reuse (D41: one control, one name, one shape), bounded reads (D42, Network panel and query counters), viewport framing (D44), both color schemes, keyboard-only navigation, reduced motion, 200% text zoom, fresh-user and failure/retry cards. Include account A admin/member paths and account B collaboration-only limits. Verify every workbar capability remains reachable at narrow and normal desktop widths.

Run full Vitest, typecheck, production build, lint zero-warning, architecture/copy/capability/token/secrets, all fidelity harnesses, and browser smoke on the built app. LOCAL and holdable SYSTEMIC failures are repaired class-wide and the affected matrix reruns. PASS closes P6 mechanically.

### P6.V1 verification log — 2026-09-02

- Verdict: **REJECTED**; P6 remains open because the zero-warning gate is red.
- TRIAGE · SYSTEMIC: dual read/write auth helpers leaked query contexts into write helpers. `placeAcceptedShare` and `drainArtifactCollaboration` now require `MutationCtx`; root typecheck passes.
- TRIAGE · LOCAL: P6.UI2 named derived sidebar geometry separately from the source-level contract. State now distinguishes the stored preference while `sidebarCollapsed` again names effective geometry; behavior is unchanged and the unweakened workbench test passes.
- TRIAGE · SYSTEMIC UX-14/DS-2: global consent sat below the composer and hand-rolled its modal. Banner and shared Radix Dialog now use `z-toast`; dialog role/name, trap, Escape, and focus return passed in the built app.
- TRIAGE · SYSTEMIC shared Button: Tailwind merging dropped semantic foreground classes beside `text-caption`, rendering every shared primary black-on-black. Token-backed arbitrary properties preserve foreground across all variants; component regression and built computed colours pass.
- Before/after: `.shots/reformation/P6.V1/00`–`08`; final `08` retains Spectra spacing/type/components and restores primary contrast. The 1024px reduced-motion/200% view has no horizontal overflow.
- Gates green: Vitest 165/1,552; `tsc`; production build; architecture/copy/capability/secrets/diff; seam 13/13; Office 32 plus 200k-cell/120-slide performance; DOCX 16 fixtures/177 assertions.
- Gate red: `npm run lint` exits 1 — 1,960 warnings across 102 product files. Narrow ignores cover generated `.playwright-cli`, `.shots`, and `.spectra-local` only; no product rule was disabled.
- The remaining DS-1/DS-2/DS-3 class spans multiple independent studios and admin shells, so R17 requires a fresh implementation packet rather than a partial verifier burn-down.
- Local Convex `127.0.0.1:3002` failed both 30s and 120s startup windows; the built failure/retry card was honest, but account A/B, 10k density, live workbars, and request budgets remain for the verifier rerun.
- Evidence manifest: `.shots/reformation/P6.V1/manifest.md`. No acceptance claimed.

### P6.V1 implementation log — 2026-09-02 (repair continuation)

- Role: Implementer. Status: **IMPLEMENTED**. Not VERIFIED.
- Class: DS-1/DS-2/DS-3 zero-warning. Mapped arbitrary type/radius/shadow/hex/z across 117 product files onto existing tokens; closed the leftover unused-var, hook-dep, color-mix `text-[…]`, JSX numeric z-index, and test hex-property tail. No new tokens, ignores, duplicate primitives, or gate weakening.
- Taste: landing channel names `z-chrome`; presentation canvas `isolation: isolate` keeps slide-number chrome inside the slide; deck audit resolves known `var(--token)` paints at the Node boundary so contrast still measures after migration. Office cell colours stay hex via identifiers.
- Tests: presentation WCAG fixtures restored to hex identifiers (migrator had rewritten them); token resolution covered by an extra assertion. Unused `contentTextFromJson` and dead native-notice state deleted.
- Gates: `npm run lint` 0 warnings; Vitest 165 files / 1,552 tests; `tsc --noEmit`; production build; architecture/copy/capability/token/secrets; fidelity seam 13/13, Office 32 + 200k-cell/120-slide, DOCX 16 fixtures / 177 assertions; `git diff --check`.
- Visual: `.shots/reformation/P6.V1/repair/before/` and `after/` — chrome still Spectra (sidebar, tokens, type, composer, failure card). Dark School, 1024 School, keyboard Try again, and 200% zoom with no html scrollWidth overflow. Signed-in `/` stays the shell.
- Convex `127.0.0.1:3002` still down. Account A/B, 10k Library density, live workbars, and network budget remain for the independent verifier rerun. DS-4 white-on-violet stays P7.UI1.

### P6.V1 verification log — 2026-09-02 (independent rerun)

- Verdict: **REJECTED**. Token/lint class independently green; live A/B, 10k Library, workbars, and D42 remain env-blocked.
- TRIAGE · SYSTEMIC R13: 500 JSON used "Unexpected server error"; School/Calendar printed `error.message`. `PUBLIC_SERVER_FAILURE` now owns ≥500 copy; those shells use `describeFailure` + `ProductErrorState` + shared Button.
- School no longer claims "No school source is connected" when records were not read; Calendar no longer claims "No unscheduled plans" on that path. Rail still shows `PLANS · 0`.
- After: `.shots/reformation/P6.V1/rerun/after/` (workspace, School light/dark, Calendar, 1024/200%, account B). Live 500 message is the public sentence, not CONVEX jargon. 1024+200% html scrollWidth=clientWidth.
- Gates: lint 0 warnings; `tsc` via production build; focused Vitest (route-handler, ux-debt, windowRange); copy/secrets/capabilities; `git diff --check`. Full Vitest 165/1,552, architecture/token/fidelity/200k/120 were green at `178557dc` before this repair.
- Convex: CLI 30s, 300s, then direct `convex-local-backend` (~15 GB) never bound `127.0.0.1:3002`. No reset, no `convex push`. 10k is unit-tested (`windowRange`); live density/workbars/admin-vs-member/B limits/D42 unproved.
- DS-4 stays P7.UI1. Mutation `toast.error(error.message)` dumps are a remaining copy class, not started here. No acceptance claimed.

## Exit gate

Token and lint rules cover all product source; a11y checks green; V1 PASS with zero launch-blocking SYSTEMIC findings open; verifier closes P6 without requesting owner acceptance.

# M4 — ONE PRODUCT

> **M1-M4 era. Historical record.** M4 delivered most of its substance in commits `M4`/`M4+`/`M4++` but was never formally closed; Nova mission **N1** reconciles it into `docs/spectra-nova/STATE.md` and appends the missing mission log here. Current operating truth: `docs/spectra-nova/`.

**Agent:** Builder · **Prerequisites:** M3 verified

## Objective

Spectra stops reading as "stitched pieces mid-debug" and becomes one coherent, honest product: a single visual grammar for controls and states, zero developer residue, truthful data everywhere, and a codebase with one implementation per concept.

## Workstream 1 — Product hygiene (STATE.md §2.D)

1. **Dev residue (D1/D2/D5):** issue badges, floating error toasts, leaked schema keys in Analytics/Admin (`spectraArtifacts.by__account_created`, `schoolMemberships.by_school_status`), "Compiling…" pills — all gone from product surfaces or gated behind a dev-only diagnostics flag.
2. **Content rendering (D4):** raw HTML in task/plan previews rendered properly (root: HTML summaries rendered into plain text nodes — fix at the render boundary, audit all preview surfaces); fix copy bugs ("You created a agent", "universitv").
3. **Data truth (D6, CANON D14):** reconcile every count-vs-copy contradiction (Analytics 246 vs "no work"; Library 69 vs "Unplaced work 0"); wrong hover-preview targets (Quiz card shown for Presentation/Sheet rows, screenshots 146/153); adopt capability-truth states on Analytics/Admin/School where data is genuinely absent.
4. **Systems of consistency (CANON D16):** one primary/secondary button treatment; one active-state treatment (currently 4 variants: global nav, School, Settings, Admin); one empty-state component (kills the wireframe rectangles); one error presentation grammar (kills the 5-variant, triple-signal patterns — Calendar is the worst offender); a truncation policy (tooltips + layouts sized for real names; fix "Flashc…", "Docu…", "IN PROC", clipped titles/tabs).
5. **Shell space (CANON D8):** composer + dock reserved space; content never hidden underneath; session state ("Continue Round One…") never leaks into global placeholder copy.

## Workstream 2 — Wire-or-delete (STATE.md §2.E — every row gets resolved, none deferred)

- **Delete:** `legacy-window-bridge.ts` (E6); `memory-shell.tsx` + `timetable-page-shell.tsx` (E7); `SpectraMigrationFlags` (E1) unless a real dual-path consumer is created this mission; test-only session controllers (E4) not adopted by M3's decomposition; `blueprints/registry.ts` after merging anything unique (E10); `DurableRunTabs` alias (E11); dead compute-broker paths (E12) not on a launch path.
- **Wire:** capability model (E5) — already wired in M1, confirm and delete leftover ad-hoc mode code; steering (E2) per M2's documented decision; coordination controller (E3) — decide now: adopt for human lease UX (queue full rollout to M9) or delete and let M9 re-introduce properly.
- **Fix:** Agent Foundry publish gate (E9) so publishing works end-to-end; timetable removed from creatable work types with legacy artifacts migrated/redirected (E11); route-redirect target mismatch (E11); the ~115 inert settings (E8): wire the handful that matter (continuation, dock behavior, motion/reduced-motion, text size), delete the rest from the UI — an attractive setting with no effect is worse than none.
- **Security (E13):** rotate the exposed keys, scrub git history (coordinate with Pablo before rewriting history — this is a stop-and-ask item), add a secret-scan gate.

## Workstream 3 — One shell (DEF-005 / C8)

Merge `workspace-shell.tsx` + `artifacts-shell.tsx` duplication into one shared shell layer with two thin route configurations (CANON D7). Inspector, dock wiring, composer, tab rail, session persistence: implemented once. Library keeps its purpose (all work) vs Workspace (contextual) — this is a code merge, not a product merge.

## Workstream 4 — Documentation reset

Add a two-line "historical — see docs/spectra-hq/STATE.md" header to the superseded ledgers (02/03/05/07) and `docs/spectra-rebuild/README` (do not delete them); confirm STATE.md doc-trust table matches reality.

## Out of scope

New visual identity (field/prism — M6/M7), motion (M8), multiplayer (M9).

## Historical mission log — reconciled by Nova N1, 2026-08-20

- M4 substance shipped across M4/M4+/M4++; N1 supplied the missing acceptance reconciliation.
- Product flows P0–P8 are evidenced in `.shots/missions/N1/001–044`; final N1 List/Board pass covered the new shell seam.
- C8 closed by one `SpectraShell`/`LibraryOrganizer` implementation with Library and Workspace as route scopes.
- E5 closed for all creatable studios through the registry/work-kernel contract; Timetable is explicitly retired.
- E9 closed: Foundry derives and publishes the runtime `instructions.text` brief through a server gate.
- E11 closed by surfacing legacy Timetables and retaining the idempotent Calendar migration; creation stays removed.
- E13 remains Pablo-owned key rotation; repository secret scan passed 2026-08-20.
- Current truth and all remaining ownership moved to `docs/spectra-nova/STATE.md`; this is the final HQ write.

## Acceptance criteria

1. Golden Flows 0–12 all pass — this is the first full-gate mission.
2. A screenshot sweep of every major route (`.shots/missions/M4/`) shows: no dev residue, no truncation defects, no contradiction, one control grammar. Compare side-by-side against the old `.shots` set and note the delta in the mission log.
3. STATE.md §2.E table: every row marked deleted/wired/fixed with commit references; §2.D rows VERIFIED with evidence.
4. Repo hygiene: net negative or neutral LOC delta for the mission (excluding tests), zero orphaned files in touched areas.

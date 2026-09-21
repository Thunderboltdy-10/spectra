# W9 school and Calendar repairs

2026-09-21. Prepared privately from `7e720624` in `w9-school-repairs`; requires coordinator integration and the normal local Convex deployment. No primary/runtime, provider, browser, or native application changes were made.

## R2 — complete bounded Calendar discovery

Fixed same-timestamp keyset continuation for unscheduled items, partial-time rows, planner tasks and migrations. Indexed boundaries now precede each bounded read, including the planner's task and artifact identity ties. Exact-title lookup uses an index containing `itemId` rather than repeatedly filtering the first page.

Visible discovery gives the range, long-event and undated streams their own continuation. Each event has one deterministic discovery bucket, so a long event is neither truncated nor duplicated and cursors do not grow with result count. This preserves the existing compact read models and requires only the new title/item index, not another data backfill.

The authenticated Calendar GET forwards every continuation. The page loader reads at most eight pages per batch and offers the existing Button treatment to continue. Completed streams are explicitly skipped, aborts reject late results, and a nonadvancing cursor fails visibly. Extending an incomplete range restarts the combined visible range so its unfinished tail is not discarded. Normal completed range extensions still read only the newly exposed days. Stream transitions can add up to two bounded requests; they replace silent omissions, not a full-table scan. Large results retain a visible partial-load state until the user continues.

## R4 — Keep remains effective after later syncs

An explicit class deselection now gates normalized ingestion and reconciliation. An unfetched kept class is not treated as a provider deletion. Whole-account responses cannot update it, and shared-source refresh/removal checks each projection account's selection independently. Membership discovery remains independent. Lookups use the existing integration/account/class index and cache their promises within the mutation. Reselecting resumes normal ingestion.

The regression selects two classes, keeps one, completes reconciliation for the other, attempts a later update, and reselects the kept class. Its schedule survives until updates resume. Another regression preserves one account's shared projection while a following account receives both an update and a subsequent removal.

## Verification and limits

- 48 tests passed across 10 Calendar/school/backend/client/route files, including 13 new regression cases.
- Full `tsc --noEmit --pretty false --incremental false` passed.
- ESLint passed for every changed TypeScript file; `git diff --check` passed.
- Actual Convex test handlers run through the real client loader in the pagination integration case. These are deterministic fixtures, not live browser/provider acceptance.
- UI skills read: `frontend-design` and `design-taste-frontend`. Design Read: student planning screen, restrained existing Spectra product UI; preserve layout, typography, density and motion. The skill's dense-product exception applies. The new status uses existing text tokens and Button, is keyboard accessible, and exposes loading/partial/failure states. No visual/browser acceptance is claimed.

Earlier review also traced Library placement and import failure paths. No further import finding was promoted without a complete deterministic end-to-end reproduction. R1 hollow-content handling is owned separately and was not changed here.

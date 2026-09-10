# W5-AUTH — Clerk factor-route state recovery

## Result

Fixed the Spectra sign-in loop caused by provider-tree remounting on Clerk factor navigation. Healthy provider and auth children now retain state across pathname changes, while a previously failed global boundary recovers when navigation changes its reset signal. The fix is integrated into `main`.

## Scope and current architecture

| Area | Current path | Role |
| --- | --- | --- |
| Provider shell | `src/components/providers.tsx` | Owns `LiveDataProvider`, theme, cache, consent, notifications, and the global boundary wrapper. |
| Error recovery | `src/components/global-error-boundary.tsx` | Catches render failures and exposes retry/reload fallback UI. |
| Auth entry points | `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx` | Render custom Spectra framing around Clerk's catchall components. |
| Signed-in return | `src/components/signed-in-continue.tsx` | Preserves invitation return and reloads into the signed-in destination. |
| Request boundary | `src/proxy.ts` | Leaves auth routes public and rejects unauthenticated private APIs with 401. |

## Root cause

Finding W5-AUTH-F01 — launch blocker, high confidence: `PathScopedErrorBoundary` rendered `<GlobalErrorBoundary key={pathname}>`. React therefore discarded and rebuilt the entire boundary subtree on every route change. Because `LiveDataProvider`, `ThemeProvider`, Clerk's auth form, and recovery helpers were descendants of that keyed boundary, moving from the sign-in page into Clerk's `/factor-one` or `/factor-two` routes could lose the in-progress form state and return to a new email form. This was a remounting defect, not an authentication decision or a missing Clerk factor.

## Small fix completed

Implementation commit `90d1248fba5855caea16d7cec0855945ff4f36ba` was cherry-picked into `main` as `00c6bdc4a98de9fc50bfad7373c8095ad0231311`.

Before: pathname was a React `key` on `GlobalErrorBoundary`, remounting all healthy descendants.

After: pathname is passed as `resetKey`; `GlobalErrorBoundary.componentDidUpdate` clears only a recorded failure when that reset signal changes. A healthy child tree is not keyed and therefore keeps its identity/state. The boundary still recovers on navigation after an error, and a newly rendered route can still fail normally and show the fallback.

Files in the implementation commit:

- `src/components/providers.tsx`
- `src/components/global-error-boundary.tsx`
- `src/components/__tests__/global-error-boundary.test.tsx`

## Evidence and coverage

### Focused regression

Source/test evidence on the isolated worktree and again after cherry-pick on `main`:

- `src/components/__tests__/global-error-boundary.test.tsx`: 3 tests passed.
- The regression asserts that the provider uses `resetKey`, not a pathname React key.
- A controlled child input retained `typed before navigation` when the reset key changed from `/sign-in` to `/sign-up`.
- A child-render failure at `/factor-one` recovered to a healthy child when the reset key changed to `/factor-two`.

Adjacent tests in the worktree: 4 files, 20 tests passed, including invitation URL construction, auth-server behavior, and operator authorization. Scoped ESLint passed in both the worktree and `main`.

The repository-wide TypeScript command was attempted but Node exhausted its heap before diagnostics (`FATAL ERROR: Ineffective mark-compacts near heap limit`). This remains an environment limitation, not a reported source error.

### Live primary-runtime evidence

The existing local stack was not restarted. Browser session `launch-auth-fix` exercised the runtime after commit `00c6bdc4`:

- `/sign-in?redirect_url=%2Fworkspace` rendered the custom sign-in page with the Clerk email/password controls and no console errors.
- Direct `/sign-in/factor-one` and `/sign-in/factor-two` requests mounted the auth catchall and normalized to the base sign-in surface without the global “Something went wrong” fallback. This confirms nested route handling and normal recovery presentation, but does not prove an in-progress authenticated Clerk session.
- `/sign-up?redirect_url=%2Fworkspace` rendered the custom sign-up page.
- `/sign-in?redirect_url=%2Fjoin?token=...` showed the invitation-specific exact-email copy, and its local sign-up link preserved the `/join?token=...` destination. The probe token was a non-secret sentinel and no account data was recorded.
- `/api/spectra/calendar` returned HTTP 401 with `AUTH_NOT_SIGNED_IN`, confirming the middleware still rejects an unauthenticated private API.
- The reserved `test@example.com` sign-in probe was rejected by Clerk as an unknown account (HTTP 422) and stayed on the email form. No password was submitted, no real login was claimed, and no email was sent to another person.

Browser snapshots were kept private and moved out of the checkout; none are committed.

## Healthy state and neighboring behavior

Healthy child components now retain state across navigation because the provider subtree is no longer keyed by pathname. The reset signal is still available to clear a stale global fallback after navigation. `SignedInContinue`, invitation-session helpers, and `src/proxy.ts` were inspected and were not changed. No auth bypass, fake identity, provider-user substitution, or Clerk/vendor upgrade was introduced.

## Unproved step and next check

The remaining exact user check requires a valid invited or existing Clerk development account: enter that account's email, complete its real password/verification factor, and confirm the form stays on the intended factor route, reaches `/workspace` for ordinary sign-in, or returns to `/join?token=...` for an invitation. The successful authenticated redirect and invitation acceptance were not claimed because no valid credential was available and no credential was invented.

## Handoff

- Worktree: `<local-workspace>`
- Scoped implementation commit: `90d1248fba5855caea16d7cec0855945ff4f36ba`
- Primary integration commit: `00c6bdc4a98de9fc50bfad7373c8095ad0231311`
- Report path: `docs/spectra-launch-audit/reports/W5-AUTH.md`
- Report commit: created separately after this evidence was recorded.
- Unrelated pre-existing/concurrent Wave 5 audit edits in `main` were preserved and not staged.

# P2 — Experience audit (student day one, busy teacher)

Branch `p2/experience`, from `main` 0bb65e90. This audit read code and ran jsdom/testing-library tests only. It used no browser, dev server or Convex.

## Commits

| Hash | Subject |
| --- | --- |
| ac9fb228 | fix(join): end the missing-invitation dead end and stop futile invitation retries |
| 2633fd2d | fix(spectra): say "check your connection" instead of "Failed to fetch" when offline |
| 070d2741 | fix(spectra): stop printing Convex request frames in live-reference and Library errors |
| 071ad6be | fix(spectra): end AI runs in plain words instead of recovery jargon |
| 608858eb | chore(spectra): delete the unreferenced ObjectLibrary; type run-copy fixtures |
| a9f9d71b | fix(spectra): say "work" instead of "artifact" across user-facing copy |
| e856c47a | fix(spectra): make clarification choices recoverable and explain typed answers |
| 0cb459a1 | fix(a11y): give the shared-workspace icons a text alternative |
| 876a07dc | fix(a11y): stop loading spinners under reduced motion |
| 7927e76c | fix(spectra): reword offline failures in Calendar and school admin clients |
| ab4123f2 | fix(a11y): trap focus in admin and ManageBac dialogs; repair spaced Tailwind colours |

## Findings ledger

### Fixed

| # | Sev | Journey | Finding | Where (after fix) | Test |
| --- | --- | --- | --- | --- | --- |
| F1 | High | Join | `/join` without a token showed only a disabled Join button. There was no explanation and no way forward. | `src/app/join/page.tsx` | `src/app/join/__tests__/join-page.test.tsx` |
| F2 | High | Join | The admin client dropped the error `code`, so final invitation failures (expired, email mismatch, single school) were offered as retries forever. | `src/features/spectra/administration/api.ts` `responseJson`; `src/lib/invitation-session.ts` | `src/lib/__tests__/invitation-session.test.ts` |
| F3 | High | Offline | Every data/api call showed the browser's "Failed to fetch". A 502 showed "Spectra request failed (502)". | `src/features/spectra/data/request.ts`; `data/api.ts` `readJson` | `__tests__/data-api-connection-copy.test.ts` |
| F4 | High | Offline | Calendar (overview and actions) and the administration client bypassed that wrapper. The Calendar overview also parsed HTML gateway pages as JSON. | `calendar/data/overview-client.ts`; `calendar/ui/calendar-application.tsx` `calendarPost`; `administration/api.ts` | same file |
| F5 | High | Library / embeds | Toasts printed raw Convex frames (`[CONVEX M(...)] [Request ID: …] Server Error`). | `artifact-embeds-panel.tsx`, `artifact-embed-host.tsx`, `whiteboard-studio.tsx`, `document-studio.tsx`; `organization/tree-client.ts` `treeFailureMessage` | `__tests__/embed-failure-copy.test.tsx`; `tree-failure-message.test.ts` |
| F6 | Med | AI run | Terminal states used jargon: "recovery passes", schema paths (`operations.0.input`), "misread the request intent", "semantic region", raw blueprint keys in progress lines. "Cancelled" and "Failed" did not match the Stop control. | `runs/live-dock/live-dock-model.ts`; `operations/plan-diagnostics.ts`; `app/api/spectra/run/loop/act.ts` `operationEffectProgress` | `__tests__/run-outcome-copy.test.ts` |
| F7 | Med | All (D15) | 44 user-facing "artifact" strings remained: finder placeholder and section header, share toasts, archive/delete toasts, Code studio publish/run/preview, command hints, approval reasons, school admin, public metadata. | 22 files, see a9f9d71b | `check:copy` extended; 44 hits before, 0 after |
| F8 | Med | Clarify | Skip and batch-submit failures were swallowed. The disabled Continue button gave no reason. Nothing said a typed answer works. | `components/conversation-choice.tsx` (moved from conversation-surface) | `__tests__/conversation-choice.test.tsx` |
| F9 | Med | A11y | Hand-rolled `AdminDialog` and the ManageBac disconnect `alertdialog` had no focus move, trap, Escape or focus restore. | `components/ui/use-modal-focus.ts`; `administration/shared.tsx`; `pages/managebac-integration-shell.tsx` | `components/ui/__tests__/modal-focus.test.tsx` |
| F10 | Med | Visual / colour | 31 Tailwind arbitrary values contained spaces (`bg-[color-mix(in oklab, …)]`), so no CSS was generated. The `/join` error box, the ManageBac error banner and several status chips lost their tint. | join, managebac, school-admin, agent-library, superadmin | modal-focus.test.tsx (src-wide scan) |
| F11 | Low | A11y | `ProductErrorState` was not announced. Admin `LoadingPanel` had no status role. | `components/product-state.tsx`; `administration/shared.tsx` | conversation-choice.test.tsx |
| F12 | Low | A11y | The shared-workspace icons had no text alternative (sidebar and workspace header). | `components/layout/app-shell.tsx`; `pages/spectra-shell.tsx` | `__tests__/shared-indicator-a11y.test.ts` |
| F13 | Low | A11y | 78 `animate-spin` loaders ignored OS reduced motion. Spectra's own "Reduced motion" setting did not stop them either. | `src/styles/spectra-app.css` (next to the `data-spectra-motion` block) | `__tests__/motion-integrity.test.ts` |
| F14 | Low | Copy | The ManageBac disconnect dialog said "identity mappings" and "removed-source provenance". | managebac shell `DisconnectDialog` | — (copy) |
| F15 | Chore | — | `components/object-library.tsx` had no importers and still used retired vocabulary. | deleted | tsc |

### Reported, not fixed (outside this lane or needs a product decision)

| # | Sev | Owner | Finding | Where |
| --- | --- | --- | --- | --- |
| R1 | High | write-paths | `run.outcome` `native_pending` / `native_verified` is declared and read but never written. A success message therefore cannot say "saved, syncing to Word" versus "verified in Word" (D26). UI expectation: the terminal line names one of saved / queued for native sync / verified native / failed with retry. | `convex/spectraRuns.ts:1271,1405`; `src/app/api/spectra/run/loop/receipt-report.ts:89` |
| R2 | Med | catalog / security-privacy | Known lead. `project()` sets `isShared` only for rows the actor does not own. An owner's workspace with active invitations shows no shared icon in the catalog-backed sidebar. The legacy `spectraWorkspaces` query set `isShared = ownership==="shared" \|\| activeInvitations>0`. UI expectation: the owner sees the shared icon (now labelled "Shared") on workspaces they have shared. The artifact inspector "Sharing: Private" row (`spectra-shell.tsx` ~830) has the same dependency. `catalogGraph.ts` was not edited. | `convex/catalogGraph.ts:184`; consumers `app-shell.tsx:927`, `spectra-shell.tsx:546,830` |
| R3 | High | write-paths | `ArtifactConflictResolution` shows raw JSON snapshots, a raw `regionId` and a JSON merge editor to students (D13). | `src/features/spectra/components/conversation-surface.tsx:306,317,422` |
| R4 | Med | ops / security | The Stop and Undo toasts print `await response.text()`, which may be JSON or HTML. The run route calls `requireActor()` unwrapped, so a signed-out Stop returns 500 and the user reads "This run can no longer be stopped safely." (D11). | `src/features/spectra/ai/use-spectra-run.ts:793,1285,1501,1689`; `src/app/api/spectra/run/runtime.ts:3636` |
| R5 | Med | write-paths | Tool registry titles surface in approval and prohibition text ("Read artifact guidance", "Add artifact comment"). | `src/features/spectra/tools/registry/application-tools.ts:91,304` |
| R6 | Low | write-paths | Collaboration labels say "artifact". | `collaboration/ai-ui-events.ts:181`; `collaboration/artifact-yjs-model.ts:661` |
| R7 | Low | ops-performance | There are no route-level `error.tsx` boundaries. Placement is theirs; the copy should use `describeFailure` wording. | `src/app/**` |
| R8 | Low | experience (follow-up) | The live preview shows the build route's error text verbatim. This is intended for compile errors, but an offline fetch there still reads "Failed to fetch". | `components/live-code-runtime.tsx:159,188,231` |
| R9 | Low | experience (follow-up) | 14 other hand-rolled `role="dialog"` surfaces (studios, kbar, calendar, guided tour) were not audited for focus trap and restore. `useModalFocus` is available. | e.g. `calendar-application.tsx`, `universal-kbar.tsx`, `artifact-comments-panel.tsx` |
| R10 | Info | — | Streamed assistant text has no live region. The Live Dock strip (`aria-live="polite"`, `live-dock.tsx:867`) announces run state. This is judged correct; token-by-token announcement would be noise. | — |

### Rejected / verified fine

- Local draft deletion is confirmed ("Delete this draft from this device? This can't be undone.").
- `humanizeIntegrationError` is used for ManageBac actions.
- Calendar overview errors go through `describeFailure`.
- The Live Dock `stopTab` is `void`ed, but `runEngine.stop` handles and reports its own failures.

## Incident: cross-worktree stash

`git stash` is shared across worktrees. My `git stash pop` took the write-paths stash `bf975aa8`, and another agent popped my stash `a540fcac`. I returned `bf975aa8` to the stash list with `git stash store` under a message naming p2/write-paths, and restored my edits from the dangling `a540fcac`. The write-paths worktree may still hold my embed/tree edits (identical to commit 070d2741). The write-paths agent should discard them if present. I did not use stash again.

## Tests and gates

- Focused vitest per fix. Each new test was checked to fail against the pre-fix source (via `git diff`/`checkout`/`apply`, not stash).
- Full run: `timeout 3000 npx vitest run --maxWorkers=3`, 421 files passed and 1 skipped; 3894 tests passed and 1 skipped.
- `tsc --noEmit` is clean. `eslint --max-warnings=0` is clean on every touched file.
- `check:architecture`, `check:copy` (extended), `check:design-tokens`, `check:capabilities` and `check:secrets` all pass.
- Contract change: `wave4-operation-engine.test.ts` now asserts "2 new work items" instead of "2 visible artifacts". The confirmation requirement is unchanged. Three plan-diagnostics/sheets assertions were updated for the new plain-language copy (071ad6be).

## Needs live verification (browser agent)

1. `/join` with no token: the heading "Open your invitation link" and the "How to get an invitation" link work.
2. `/join?token=<expired>`: a plain message, no Retry button, no raw code, and the invitation cookie is cleared.
3. `/join?token=<valid>` while signed out: the Sign in link returns to `/join?token=…`.
4. The `/join` and ManageBac error boxes now show a coral tinted background and border (F10).
5. DevTools offline, then add a comment, open the Calendar, add a personal event, and open school admin People. Each toast reads "Spectra could not reach the server. Check your connection, then try again."
6. Remove access to an embedded source, then open the Embeds panel: the toast has no `[CONVEX`/`Request ID` text.
7. Stop a run: the Live Dock reads "Stopped". Force a terminal failure: it reads "Could not finish" with a next step.
8. Clarification: the hint "Or type your own answer in the message box." is visible, and a typed answer continues the same run. With batch questions, Continue explains how many remain. Skip while offline shows a toast and re-enables the controls.
9. Screen reader: Tab through the admin "Remove member" dialog and the ManageBac "Disconnect" dialog. Focus starts inside, Tab wraps, Escape closes, and focus returns to the trigger.
10. OS reduced motion on: loaders on `/join`, Library, and the admin LoadingPanel are static. The same with Settings, then Reduced motion.
11. Shared indicator: a screen reader announces "Shared" on the sidebar workspace. Owner view: share one of your own workspaces, then check the sidebar icon (expected to be missing until R2 is fixed).
12. Finder (Ctrl+K or context picker): the placeholder reads "Find work, …" and the section header reads "Work".

## Shared files touched (outside the pure experience surface)

- `src/features/spectra/data/api.ts` (fetch wrapper; `requestSpectra` moved to `data/request.ts`)
- `src/features/spectra/administration/api.ts`
- `src/app/api/spectra/run/loop/act.ts` (progress copy only)
- `src/features/spectra/operations/plan-diagnostics.ts` and `operations/policy.ts` (copy only)
- `src/styles/spectra-app.css` (one reduced-motion rule)
- `scripts/check-user-facing-copy.mjs`
- `src/components/layout/app-shell.tsx`
- New: `src/components/ui/use-modal-focus.ts`

Nothing was changed in `convex/**` or in the logic under `src/features/spectra/collaboration/**`.

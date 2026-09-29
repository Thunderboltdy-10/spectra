# P3 — Surfaces 2 (Phase 3)

Branch `p3/surfaces-2`, from `main` a7861f4f. This pass continues workspace-flows on
the surfaces it did not reach, seen by a student, teacher, school admin and
superadmin in their first week:

- Home and the chat list
- The workspace hub chrome
- `/admin`, `/school` and `/school-data`
- The ManageBac UI
- Notifications
- The inherited residuals R2–R9

Per the coordinator, the priorities were home, workspace hub, admin/school, the
ManageBac modals and R2/R3/R7. Lower-value items are recorded below, not fixed.

Gates at the end of the branch:

| Gate | Result |
|---|---|
| `tsc --noEmit` (app and `convex/tsconfig.json`) | clean |
| `eslint --max-warnings=0` on every changed file | clean |
| `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets` | pass |
| Full `vitest run` | 4213 passed, 1 skipped, 1 failed: `run-route.test.ts` "answers Stop from a caller who is signed out…" (2.8 s, under load). That file is untouched here and re-ran green alone (59/59). |

## Findings ledger

### Fixed

Each fix has a test that failed before it and passes after it.

| # | Sev | Finding | Root fix | Test |
|---|-----|---------|----------|------|
| S1 | High | **A chat lost the name its owner typed.** A rename went through `cleanTitle`, which strips stop words and keeps 4 words. The next generated-metadata window then retitled the chat anyway, through the header or the Library. | `ownerTitle` (`convex/spectraThreads.ts:213`) keeps the typed words. It trims them, caps them at 88 characters and refuses an empty name. `titleSetByOwner` (`schema.ts:4071`) is set by `update` and by `orgTreeShared.ts:1273` (Library rename). `applyGeneratedMetadata` never retitles such a chat (:1674). | `convex/spectraThreads-owner-actions.test.ts` (4) |
| S2 | High | **A chat moved to the Library Trash stayed in every chat list**, and could still be resumed. | `list` drops chats whose primary tree node is trashed (`spectraThreads.ts:958`). Restoring the chat brings it back. | Same file: trash/restore case |
| S3 | Medium | **A chat could not be deleted from its header.** Rename and pin failures were silent, and Enter did not save a rename. | `chat-shell.tsx:362` saveTitle, pin and `trashThread` (:404). Each failure has its own toast. "Delete chat" (:860) moves the chat to Trash, with Undo. | `chat-shell-load.test.tsx`: "ChatShell chat actions" (4) |
| S4 | High | **Pinning a sixth chat made it vanish from the sidebar.** Pinned was capped at 5 and Recents excludes pinned chats. `/chat` also listed only 10 of the 40 loaded chats, and first run and a search with no match showed a blank list. | `layout/sidebar-threads.ts`: Pinned is uncapped, `/chat` lists every loaded chat and the search covers all of them. The empty and no-match states have copy, and the open chat is `aria-current` (`app-shell.tsx:164`). | `sidebar-threads.test.ts` (3) |
| S5 | Medium (R7) | **Every admin action that failed was also an unhandled rejection** (`mutate` rethrew after its toast). An invite showed two toasts. The people search fetched members and invitations on every keystroke and showed a spinner each time. | `school-admin-shell.tsx:621`: `mutate` never rejects and returns `{result}` or `null`. Dialogs close only on success, and the redundant `.then(onRefresh)` double fetches are gone. `invite` (:886) shows one toast. The search waits 250 ms (:838) and only refetches members, and the table stays visible. A blocked clipboard is reported. | `school-admin-people.test.tsx` (4) |
| S6 | Medium (R2) | **Restoring a trashed Bridge work left its Recycle Bin request live**, so approving it later deleted the file of a restored work. Trashing an already-trashed work queued another delete. | `convex/orgTree.ts:784` only enqueues when the node entered Trash. `withdrawFileDeletion` (:811) marks the delete requests that are still waiting (`approval-required`/`pending`) as `ignored`, with the reason. | `orgTree-bridge-names.test.ts`: "Trash and restore" (2) |
| S7 | Medium (R9) | **The ManageBac Disconnect confirmation sat on the `dropdown` layer**, under panels and popovers. Settings and Manifest were hand-rolled, with no focus return, and their accessible names did not match their headings. | `managebac-integration-shell.tsx`: Disconnect is `ConfirmDialog` (:2024; destructive, pending, focus on Keep connected). Settings (:1768) and Manifest (:1935) use the shared `Dialog`, and Escape is blocked while busy. | `managebac-dialogs.test.tsx` (4) |
| S8 | Medium (R3) | **Personal events could be removed but not moved or resized.** | `isReschedulable` (`convex/calendar.ts:988`, `calendar-application.tsx:346`): a personal event that is not source-locked drags, resizes and gets +/−30 min. It goes through the same revision-checked `moveWorkBlock`/`resizeWorkBlock`. Official events stay fixed. | `convex/calendar.test.ts` (2); `calendar-application.component.test.tsx` (1) |
| S9 | Medium | **Every action on `/school` and `/school-data` swapped the page for a spinner**, which lost the scroll position and remounted the class shelf editor. A failed sync read "School could not load". | `school-data-shell.tsx:514` shows the spinner only on first load. `actionFailure` (:311) shows "Sync did not finish" or "Import did not finish", with Dismiss, and keeps the records visible. | `school-data-shell.component.test.tsx` (2) |
| S10 | Low (R8) | **The memory export and the workspace manifest export revoked the blob URL synchronously**, which can cancel the download in Safari. | Both use `downloadDocumentBlob`: `settings-application.tsx:252`, `spectra-shell.tsx:4049`. | `settings-export.component.test.tsx` |
| S11 | Low (R5) | **Reminder times were forced to en-US format.** | `shell-notifications.ts:26`: the reader's own locale, medium date and short time. | `shell-notifications.test.tsx` |
| S12 | Low (R6) | **Review did not reopen a collapsed invitations panel** when the URL was already `?collection=invitations`. | `reviewShareInvitations` (`shell-notifications.ts:94`) emits `invitations.review`. `useShareInvitations` (extracted from spectra-shell) opens the panel and refreshes. | Same file (2) |
| S13 | Low (R4) | **The kbar's success message was never seen**, because the bar closes in the same tick. | `universal-kbar.tsx:325`: toggle and mutate commands also show a toast with their result. | `universal-kbar.component.test.tsx` |

### Reported, not fixed

| # | Sev | Where | Finding and why it is not fixed here |
|---|-----|-------|------------------------------|
| X1 | Medium | `spectra-shell.tsx:4106` `permanentlyDeleteWorkspace` | After deleting a workspace, its hub tab stays, `selectedWorkspaceId` is not cleared, and the URL stays `/workspace/<deleted>`. A reload then shows "no longer available". The fix is to close the tab (`closeHubTab`) and replace the URL. It was not fixed because this rare flow needs a spectra-shell render harness to test. |
| X2 | Medium (Bridge) | `convex/orgTree.ts:811` | If the device has already *claimed* or *verified* a delete, restoring the work cannot bring the file back from the Recycle Bin. That needs a Bridge "restore from Recycle Bin" request, which is out of lane (`bridge/**`). Also, trashing a *folder* only trashes its nodes: it queues no disk delete for the Bridge works inside it, while trashing the work alone does. The inconsistency is left for the Bridge lane. |
| X3 | Low | `school-admin-shell.tsx:1222,1427,2161,2462` | Groups, Communication, Feedback and Audit still call `setLoading(true)` on every refresh, so the list flashes after each action. Their load-failure fallbacks read "Groups failed.", "Communication failed." and similar. This is the same pattern as S5 and S9, left for time. |
| X4 | Low | `superadmin-shell.tsx:874` | The SchoolsSurface search refetches on every keystroke (no debounce), the same defect as S5. |
| X5 | Low | `bridge/resource-surface.tsx:182` (bridge lane), `plan-studio.tsx:378`, `timetable-studio.tsx:213` (studios) | Downloads revoke synchronously or after 0 ms, the same defect as S10. These files are outside my lane. |
| X6 | Low | `convex/spectraThreads.ts:1320` `search` | AI thread retrieval still returns chats in the Library Trash. Filtering there changes what the model can read, so the decision is left to the AI lane. |
| X7 | Low | `app-shell.tsx:393,422` | `markAllNotificationsRead` / `markNotificationRead` are called as `void …()`. A failure is an unhandled rejection with no toast. |
| X8 | Low | `calendar-application.tsx` resize gesture | A pointer resize adds elapsed ms per pixel. A block that crosses the DST transition on a DST day could end an hour off. Drops are fine (see rejected). |
| X9 | Low | `spectra-shell.tsx:4049` | The workspace export filename strips non-ASCII characters ("Biología" → `biolog-a`, "数学" → `workspace`). |

### Error-code-dependent sites (for the convex-errors reconcile)

- `school-admin-shell.tsx:639`: admin `mutate` shows `humanizePublicFailure(error.message)`.
- `chat-shell.tsx:374,394,424`: rename, pin and trash use `describeFailure` with fixed fallbacks.
- `school-data-shell.tsx`: actions use `describeFailure` fallbacks. No new parsing was added.
- `calendar-application.tsx:392` `isGestureConflict` now also guards personal-event moves.
- `convex/calendar.ts:988`: move and resize of a non-reschedulable item still throw `CALENDAR_WORK_BLOCK_NOT_FOUND`.

### Reviewed and rejected

- **R3's DST drop.** The grid is a wall-clock grid: blocks are placed by `minutesOnDay` in the reader's zone. `resolveDrop` (`calendar-application.tsx:798`) sets wall-clock hours on the day, so the two agree on DST days. A drop inside the spring-forward gap (02:00–02:59 does not exist) lands at 03:xx, which is the correct instant.
- **Moving the People invitations fetch to its own polling.** One fetch per refresh is enough.

### Not reached

- `/agents/[id]`, `/analytics` and `/superadmin` beyond X4.
- The school admin tabs Usage, Integrations, Governance and Profile (only read for S5 and X3).

## Shared files touched

- `src/components/layout/app-shell.tsx`: notifications builder, Review and sidebar sections.
- `src/features/spectra/events/contracts.ts`: `invitations.review`.
- `src/features/spectra/pages/spectra-shell.tsx`: `useShareInvitations` hook and export download.
- `convex/schema.ts`: optional `spectraThreads.titleSetByOwner`.
- `convex/orgTreeShared.ts`: a Library rename of a thread sets `titleSetByOwner`.
- `convex/orgTree.ts`: trash and restore Bridge requests.
- `convex/calendar.ts`: `isReschedulable`.
- `convex/spectraThreads.ts`.
- `src/features/spectra/__tests__/invitation-strip.test.ts`: its source scans now read the modules the code moved to.

There are no changes to `components/ui/**` and no dependency changes. No Convex module gained an import from
`./_generated/server`: the edited modules keep their existing imports, so they reconcile with main's `./functions`
rule at merge.

## Needs live verification

Run these on a production-like deployment with Clerk, Convex, ManageBac and a paired Bridge.

1. **Chat name.** Rename a chat to "The French Revolution for my essay" and send 3 more messages.
   - Expected: the name is unchanged in the header, sidebar and Library.
   - Try an empty name. Expected: Save is disabled.
2. **Delete a chat.** Use the header's Delete chat.
   - Expected: you land on a new chat, and "Chat moved to Trash." with Undo.
   - Choose Undo. Expected: the chat reopens and is in the sidebar again.
   - Trash a chat from the Library. Expected: it leaves the sidebar and `/chat`.
3. **Sidebar.**
   - Pin 6 chats. Expected: all 6 are under Pinned.
   - On `/chat` with more than 10 chats, expect them all to be listed.
   - A new account shows "Your chats will appear here…". A search with no match shows "No recent chats match …".
4. **Notifications.** With the browser set to es-ES, look at a planner reminder. Expected: "29 sept 2026, 14:30", not "9/29/2026".
   - On `/library?collection=invitations`, collapse the panel, then press Review on a share notification. Expected: the panel reopens.
5. **Admin People.**
   - Invite with mail configured. Expected: exactly one toast, "Invitation sent to …".
   - Without mail. Expected: only the warning, and the secure-link dialog.
   - Change a role and force a failure (make the last admin a student). Expected: one error toast and no console "Uncaught (in promise)".
   - Type "ana" fast in search. Expected: one request after 250 ms and no spinner flash.
6. **Admin dialogs.**
   - Create a group or send an announcement that the server refuses. Expected: the dialog stays open with its fields.
7. **Bridge restore (R2).** Under a mirror-to-disk policy, trash a mirrored `Essay.docx`. Do not approve the Recycle Bin prompt. Restore the work.
   - Expected: the prompt disappears, and the file stays on disk after the device syncs.
   - Trash it again from a second, stale tab. Expected: one prompt.
8. **ManageBac.** As an admin on `/managebac`, open the rail and choose Disconnect ManageBac.
   - Expected: a centred confirmation above every panel, with focus on Keep connected.
   - Escape during the disconnect does nothing.
   - Settings and Manifest: Escape closes them, and focus returns to the opener.
9. **Calendar.** Drag a personal event to another hour and day, then use +30 min.
   - Expected: the event moves or grows and survives a reload.
   - An official ManageBac event is not draggable.
   - On 29 Mar 2026 (Europe/Madrid), drop at 02:30. Expected: the event lands at 03:30.
10. **School page.** On `/school`, scroll down and press Sync now.
    - Expected: the page stays where it was, with no spinner.
    - With ManageBac unreachable. Expected: "Sync did not finish" above the records, and Dismiss clears it.
11. **Exports in Safari.** Settings › Privacy › Export, and workspace › More › Export workspace. Expected: both files download.
12. **kbar.** Choose "Turn on conversation continuation".
    - Expected: the bar closes and a toast confirms the change.
    - Run a mutate command whose host also toasts (for example Update memory). Check that there is no double toast.

# P3 — Workspace flows (Phase 3)

Branch `p3/workspace-flows`, from `main` afe74633. It covers every surface outside
the editors, seen by a student or teacher in their first week: calendar and
planner blocks, the kbar, chat search, agents, the Library organizer, Bridge
names, `/join`, settings and account, and public share links. Main moved to
68275672 during the run. Per the coordinator, the branch was not rebased.

Gates at the end of the branch:

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint --max-warnings=0` on every changed file | clean |
| `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets` | pass |
| Full `vitest run` | 4118 passed, 1 skipped, 1 failed. The failure was the stale kbar source scan, fixed in b3ad01e1, and its file re-ran green (29/29). |

## Findings ledger

### Fixed

| # | Sev | Finding | Root fix | Test |
|---|-----|---------|----------|------|
| W1 | High | **Calendar grid on DST days.** The grid stepped days by adding 24 h. Around the October DST change, a date appeared twice, the next was skipped, and the range labels drifted. | New `calendar/domain/local-days.ts` (`addLocalDays`, `localDaysAround`, `endOfLocalDay`). Every range and step in `calendar-application.tsx` uses it (:91). | `calendar-application.component.test.tsx`: the DST heads appear once each. |
| W2 | High | **Calendar showed UTC times** to anyone without school data. The overview guessed the timezone from rows, falling back to UTC. The composer also defaulted to UTC times. | The timezone is always the browser's (`calendar-application.tsx:610`). The composer uses `toLocalDateTimeInput`. | UTC overview renders at 11:00 local; composer defaults to 11:00/12:00 local. |
| W3 | High | **No way to remove an event or a scheduled block.** | "Remove from Calendar" is offered for non-source-locked items, behind a `ConfirmDialog`. Removing a work block keeps the plan. | Remove "Dentist" through the alertdialog; an official record has no Remove button. |
| W4 | Medium | **Conflict recovery never fired.** The route strips the `CALENDAR_GESTURE_CONFLICT` code, so a stale drag showed a generic error with no reload. | `CalendarActionError` carries `error.code` (:374). `isGestureConflict` (:383) triggers the "Calendar changed" toast and a reload. | 409 → toast plus reload. |
| W5 | Medium | **Raw codes, or a false "check your connection" message.** Bare `CALENDAR_*` codes gave 500 plus connection copy. | Every Calendar error now carries a sentence (`convex/calendar.ts`, `calendar/domain/command.ts`). `route-handler.ts:60` maps worded `_NOT_FOUND` to 404 and `_UNAVAILABLE`/`_MISMATCH`/`_LOCKED`/`_CONFLICT` to 409, so the sentence is shown. Bare codes keep the generic 500. | `calendar-error-copy.test.ts`; `route-handler.test.ts` `it.each`. |
| W6 | Medium | **Composer accepted an end before its start** and was a hand-rolled modal (UI residual ~1820). | `CalendarComposer` (:1876) uses the shared `Dialog`. An inline alert blocks submit, and `min={start}` is set on the end field. | End before start → alert, submit disabled, no POST. |
| W7 | Medium | **A plan's scheduled block could not be opened.** `openItem` treated the block as linked work and navigated away. | `:924`: a block opens its details: Mark complete, +30 min, and "Open plan". | Linked-plan block test. |
| W8 | Medium | **The kbar offered commands that ask a person to type internal IDs** (sharing, sync policy, ManageBac, bridge.setup, library.delete/organize, bare open-thread/work). | `kbar.ts:210`. A command whose `item` parameter is not seeded is not listed. Search results still seed their IDs. | `kbar.test.ts` "never asks a person to type an internal ID". |
| W9 | Medium | **The kbar stole focus from the field a command asked for.** The residual hand-rolled modal (~405) and native select (~441) went with it. | `universal-kbar.tsx` uses the shared `Dialog` and `SelectField`. Focus runs only in list mode (:176). Escape steps back through `onEscapeKeyDown` (:395). | `universal-kbar.component.test.tsx`: cursor in the Memory field; Escape returns to the list. |
| W10 | Low | **Agent library modals were hand-rolled** (UI residual ~1044/~1128). | "Add to a workspace" and the public preview use the shared `Dialog` at the composer-dock layer (`agent-library-shell.tsx:1031`, :1094). Orphan CSS was removed. | tsc, eslint, tokens. No render test: the shell mounts the catalog and Convex hooks. |
| W11 | Medium | **Chat search dropped focus to `<body>` after choosing a result** and reopened with a stale query. It was hand-rolled (`context-controls` residual ~833). | Shared `Dialog` (`context-controls.tsx:791`). The field is focused in `onOpenAutoFocus`, so the return target is the button. The query is reset on open. | `global-search.component.test.tsx` (2). |
| W12 | Medium | **Delete in the Trash re-trashed.** The server no-oped, the UI said "Moved to Trash." and its Undo restored the items. The Undo also swallowed restore failures. | `library-organizer.tsx:823`: Delete in Trash opens the "Delete forever" confirmation. The Undo runs through `run` (message plus Retry) (:673). | New organizer render harness `library-organizer.component.test.tsx` (3). |
| W13 | **High** (Bridge) | **Renaming or moving a Bridge-mirrored work dropped its file extension on disk.** "Biology/Essay.docx" → "Biology/Essay draft", from the raw untrimmed input. A Library move sent the same rename. | `convex/orgTree.ts:71` `mirroredReplicaPath`: same folder and extension, the validated node name, no doubled extension, trailing dots dropped, nothing sent when unchanged. Used at :697 and :735. | `convex/orgTree-bridge-names.test.ts` (4). |
| W14 | High | **Nobody could sign out.** The shell's account button opens Clerk's profile, which only ends *other* sessions. This matters most on shared school computers. | Settings › Privacy and data › Account: "Manage account" and "Sign out" (`settings-application.tsx:273`). | `settings-account.component.test.tsx` (2). |
| W15 | High | **An invitee signed in with the wrong email was stuck.** "Sign in" sent a signed-in person to `/sign-in`, which bounced straight back to `/join`. | `/join` offers "Use a different account": it signs out, then returns through sign-in to the same invitation (`join/page.tsx:252`). The token cookie is re-persisted. | `join-page.test.tsx`: mismatch case; transient case. |
| W16 | High | **A shared public workspace showed only title cards.** The projection already carried the content, but nothing opened it. | `public-share-shell.tsx`: `ArtifactCard` (:131) is a button; `SharedWorkspace` (:491) opens the work in full, with "Back to …". | `public-share-workspace.component.test.tsx` (open/back). |
| W17 | Medium | **One failed 15-second background refresh replaced a public view** with "Shared view unavailable", and there was no retry. | A background failure that is not a 4xx keeps the last good view (:620). A first-load transient failure offers "Try again"; a 404 does not. | Same file (3 cases). |

### Reported, not fixed

| # | Sev | Where | Finding and why it is not fixed here |
|---|-----|-------|------------------------------|
| R1 | **High** (cross-cutting) | every `convex/*.ts`; `tree-client.ts:446` | No Convex module uses `ConvexError`. `tree-client.ts` itself notes that production Convex redacts plain `Error` messages to "Server Error". If so, every `CODE: sentence` contract degrades to generic copy in production: the calendar conflict reload (W4/W5), the invitation final-decision handling on `/join`, and Library copy. Needs live verification first. The fix is a codebase-wide move to `ConvexError`, which is far outside this lane. |
| R2 | Medium (Bridge) | `convex/orgTree.ts:780` trash / :788 restore | Trashing a mirrored work enqueues a Bridge "delete" (Recycle Bin). Restoring it enqueues nothing, so the file stays recycled while Spectra shows the work restored. Trashing an already-trashed node also re-enqueues a delete. This belongs to the Bridge lane. |
| R3 | Medium | Calendar | Personal events can be removed but not edited or moved. `resolveDrop` maps 24 h linearly on DST days, so a drop on a DST day can be off by an hour. |
| R4 | Low | `universal-kbar.tsx` | The success message is set just before the bar closes, so it is never seen. |
| R5 | Low | `app-shell.tsx:376,385` (shared layout) | Notification times are forced to `toLocaleString("en-US")`. |
| R6 | Low | `spectra-shell.tsx:1247` | After the invitations panel is collapsed on `/library?collection=invitations`, a notification's "Review" does not reopen it, because the param has not changed. |
| R7 | Low | `school-admin-shell.tsx:638` | `mutate` rethrows after its toast, so `void mutate(...).then(onRefresh)` makes unhandled rejections. Inviting also shows two success toasts. The people search refetches, with a loading flash, on every keystroke. |
| R8 | Low | `settings-application.tsx:255` | The memory export revokes its object URL synchronously after `click()`, which can cancel the download in Safari and older Firefox. The fix is `downloadDocumentBlob`. |
| R9 | Low (UI system) | `managebac-integration-shell.tsx:1789,1944,2031` | There are three more hand-rolled `useModalFocus` modals. They were not in the residual list. |
| R10 | — | `context-controls.tsx:371` | The context browser is an anchored, non-modal popover (`role=dialog` without `aria-modal`), not a modal. I left it as is; see the rejected list. |

### Reviewed and rejected

- Migrating `context-controls` ~369 to `Dialog`. It is a positioned popover beside the composer, and a modal Dialog would change its behaviour.
- Reminder due-time math (`convex/plannerReminders.ts`). It uses numeric `dueAt`, and no timezone defect was found.
- `/memory`, `/artifacts`, `/timetable` redirects. They resolve to live surfaces.
- Analytics load, error and retry states. They are complete.

### Not reached

- `/school-data`, `/managebac` UI, `/superadmin`, `/workspace/[id]` hub chrome, the chat thread list, and `/agents/[id]` beyond the modals.

## Shared files touched

- `src/lib/route-handler.ts` (+ test): worded status mapping.
- `src/features/spectra/components/context-controls.tsx`: GlobalSearch only.
- `src/features/spectra/components/universal-kbar.tsx`.
- `src/features/spectra/__tests__/live-dock.test.ts`.
- `src/styles/spectra-app.css`: orphan CSS removed.
- `convex/calendar.ts`: copy only.
- `convex/orgTree.ts`: Bridge target path.

There are no schema changes, no changes to `components/ui/**`, and no dependency changes.

## Needs live verification

Run these on a production-like deployment with Clerk, Convex and a paired Bridge.

1. **Convex error text (R1).** Trigger a known worded error, such as dragging a Calendar block in a stale tab.
   - Expected: the `CALENDAR_GESTURE_CONFLICT` code reaches the client, then "Calendar changed" and a reload.
   - If the client gets "Server Error" instead, R1 is confirmed.
2. **Calendar DST.** Set the OS to Europe/Madrid and view 20 Oct – 3 Nov.
   - Expected: each date appears once and 27 Oct is present.
   - Create an event with the default time. Expected: the next whole hour, local time.
3. **Calendar removal.** Remove a personal event, then a scheduled plan block.
   - Expected: a confirmation, then the item disappears. For the block, the plan stays in the Library and can be placed again.
   - Open an official ManageBac record. Expected: no Remove button.
4. **Plan block.** Click a scheduled block.
   - Expected: details with Mark complete, +30 min and "Open plan", which opens the plan.
5. **kbar.**
   - Press Mod+K and type "memory". Expected: "Update memory" is listed. (Mod+Shift+F focuses sidebar search; it does not open the command bar.)
   - Choose it. Expected: the cursor is in the field. Escape returns to the list; a second Escape closes the bar and focus returns.
   - Search "share". Expected: no command asks for an ID.
6. **Chat search.** Open search in /chat, type two letters and pick a workspace.
   - Expected: the dialog closes and focus is on the search icon.
   - Reopen it. Expected: an empty field.
7. **Agents.** Open a public agent's preview; open "Add to a workspace".
   - Expected: centred dialogs above the composer. Escape closes them. Install works.
8. **Library Trash.**
   - Trash a work, then Undo while offline. Expected: an error toast with Retry.
   - Open Trash, select the item and press Delete. Expected: "Delete … forever?", then it is gone.
9. **Bridge rename (W13).** On a mirrored `Essay.docx`, rename it in the Library to "Essay draft", then approve if asked.
   - Expected: the disk file becomes `Essay draft.docx` in the same folder.
   - Move the work to another Spectra folder. Expected: no disk change and no pending request.
10. **Sign out.** Settings › Privacy and data › Sign out.
    - Expected: you land on `/`. Visiting /workspace asks you to sign in.
11. **Wrong-account invite.** Open an invitation link while signed in with a different email.
    - Expected: "Join school" is disabled.
    - Choose "Use a different account". Expected: you are signed out, then sent to sign in. After signing in with the invited email you return to `/join?token=…`, and Join works.
12. **Public workspace.** Open a public workspace link in a private window.
    - Click a card. Expected: the work is shown in full. "Back to …" returns to the cards.
    - Turn the network off for 30 seconds. Expected: the content stays.
    - Revoke the link and refocus. Expected: "Shared view unavailable" with no retry.

# R-A5 — AI parity

Lane A5, branch `lane/parity`, worktree `<local-workspace>`, from main at 15095196. Goal: Spectra AI can do everything a user can do, and every action it cannot do has a written reason.

Nothing was run live: no dev server, no browser, no `next build`, no `convex dev` and no deploy. The coordinator lands the branch.

## Commits

| Commit | Change |
|---|---|
| 0db3764d | One approval table (`shared/ai-application-approval.ts`) for the tools, the worker and Convex. |
| 6e78547e | A4 leftover: `edit_artifact` opens a quiz for attempts (`publish`) or closes it (`unpublish`). |
| 5fa7918e | A4 leftover: `read_agent_releases` and `release_agent` (release privately, publish, promote, roll back, suspend). |
| 9aebb750 | A4 leftover: Share shows "Made by Spectra · Copy link" on a public link a run made, so a scheduled run's link can be copied later. |
| 80a0c079 | A4 leftover: a retried publish reuses its unchanged "Published" checkpoint. |
| bd60ba81 | `forget_memory`: Spectra erases one memory when asked, with approval. |
| 2ee39233 | HARNESS.md: the approval table, agent releases, quizzes, memory, link copy. |
| 0bb8d54c | `run_agent_checks`: Spectra runs an agent's checks, so it can publish an agent end to end. |
| e7ff9153 | HARNESS.md: `run_agent_checks`. |
| b393df0d | `read_share_invitations` and `respond_to_share`: accept or decline an invitation someone sent the user. ManageBac resource import is now a written gap. |
| c1291cd3 | HARNESS.md: invitations. |
| f1885036 | The comment test deletes only after approval (the behaviour 0db3764d introduced). |
| (this commit) | This report. |

## What changed

### One approval table

Before this lane, three places decided whether an AI command asked first:

- the tool;
- the worker that stages the step;
- Convex, which binds the user's answer to the step.

They disagreed in two ways.

- **No scope for "Allow".** `publish_code`, deleting a comment and removing a Bridge folder asked the user. The worker, though, staged them as not needing approval. Convex then had no scope to bind the answer to, and refused "Allow" with `AI_APPLICATION_APPROVAL_SCOPE_CHANGED`.
- **No category.** Set school sync mode and class workspaces also asked, but had no category, so "Always allow ManageBac" could not cover them.

`shared/ai-application-approval.ts` now decides, from the command and its arguments, whether a command asks and under which category. Every layer reads it:

- the tool's `category`;
- `convex-backend` `stageCommand`;
- `spectraHarness` `ensureApproved`;
- `spectraApplicationWrites` `execute`.

`tools.test.ts` fails if a tool's category differs from the table. It also fails if the table and the tool's effect disagree about asking (irreversible or settings ⇔ a category).

### A4 leftovers, all closed

- **Quiz open and close.** Quiz edits take `publish` and `unpublish`. Publishing checks every question after the call's other edits, as the studio does, and stamps `publishedAt`. The readback says whether the quiz is open.
- **Agent private and unshare.** `release_agent` runs the studio's own mutations through the application write path. The worker steps:
  - `release_private` makes an owner-only release, as a plain write.
  - `publish`, `promote`, `rollback` and `suspend` ask under `sharing`.

  `read_agent_releases` gives the release ids, and says whether the draft passed its checks. Unsharing an agent with a person stays `share` `revoke`. An open agent studio reloads its releases when Spectra changes them.
- **Copy link for a link a run made.** `publicLinks.aiOrigin` records the run and the step that made the link. `listPublicLinks` returns `madeBySpectra` only to the run's owner. Share shows "Made by Spectra · Copy link", which reveals the address through the existing `revealAiPublicLink`. The journal still never holds the secret.
- **No second "Published" checkpoint.** `changeGroups:createNamedCheckpoint` returns the parent checkpoint when a retried publish has the same name and the content is unchanged.

### New AI reach found by the audit

- **Forget a memory.** `forget_memory` maps to `write_memory` `{action: "forget"}`, then to `memory:forget`. It asks under `permanent_delete`. `memory.manage` keeps clear-all, dispute and memory settings as user-only.
- **Run an agent's checks.** `run_agent_checks` runs `agents/evaluate/checks.ts`, the same server function behind the studio's Run checks (the route is now a thin wrapper), under the run owner's identity. It returns:
  - the pass count;
  - the average score;
  - up to eight failing cases, with the graders' reasons as evidence.

  It is a plain write.
- **Answer share invitations.**
  - `read_share_invitations` lists pending invitations. Titles, names and notes are evidence.
  - `respond_to_share` maps to `respond_share_invitation`, then to `authority:acceptShareInvitation` or `declineShareInvitation`. It asks under `sharing`. The UI's notifications refresh afterwards.
  - Joining a school (`memberships:acceptInvitation`) is a separate user-only entry, `sharing.join_school`.
- **Catalog fix.** `agents:*` had wrongly covered follow and feedback. The agent studio's bench and compiler mutations are now listed by name, under the `agents.studio` gap, which lane L3 closed.

Every new command has:

- a `tools.test.ts` row (tool → app command and args);
- a `convex-backend-approval.test.ts` row (asks or not);
- an `application-action-contract.test.ts` case (mutation and UI event);
- a Convex test through `spectraApplicationWrites:execute`, which refuses an unapproved step that should ask;
- a `find_commands` ranking case.

Labels and questions never show ids.

## Convex files that need a deploy

- `convex/schema.ts`: `publicLinks.aiOrigin`, optional, so no migration.
- `convex/authority.ts`: `listPublicLinks` returns `madeBySpectra`.
- `convex/spectraApplicationWrites.ts`: the approval table, `release_agent`, `write_memory` forget, `respond_share_invitation`, and recording `aiOrigin`.
- `convex/spectraHarness.ts`: `ensureApproved` reads the approval table.
- `convex/changeGroups.ts`: the checkpoint dedupe.
- `shared/ai-application-approval.ts`: imported by the Convex files above.

The web app must ship with them. The worker stages steps with the same table that Convex checks, so if only one side ships, an approved step can be refused.

## Remaining gaps

No entry is a gap any more: nothing a user can do is out of Spectra's reach for engineering reasons alone, so the catalog's `gap` marker was removed.
- Lane L2 closed `managebac.import_resource`. The import moved to `managebac/resource-import.ts`, and a run reaches it through `managebac` {"action":"import_resource"} -> `import_managebac_resource`. See [R-L2-FINISH](R-L2-FINISH.md).
- Lane L3 closed `agents.studio`. It split into `agents.bench_run`, `agents.bench_read`, `agents.bench_save_test`, `agents.bench_remove_test`, `agents.compile` and `agents.approve_skills`, all reached by tools. See [R-L3-STUDIO-PARITY](R-L3-STUDIO-PARITY.md).

Every other entry with no AI path is user-only by policy. Each has its reason in the catalog table below. They fall into these groups:

- **The user's control over Spectra:** stop, answer or approve, review or undo, AI permissions, native writes.
- **The user's own judgment or identity:**
  - credentials and account deletion;
  - joining a school;
  - asking for access;
  - following or rating agents;
  - practising a quiz;
  - CAS reflections;
  - desktop file conflicts;
  - ManageBac mapping.
- **Browser-only actions:** the file picker for imports, the local compute cache, the reference picker.
- **Read state:** reminders and comment notifications.
- **Admin console:** school administration.
- **Deliberately never automated:** deleting permanently and purging all class workspaces at once.

## Live checks for the coordinator

1. **Approval scope.** Ask Spectra to publish a Code work, then press Allow. The live build publishes, and no `AI_APPLICATION_APPROVAL_SCOPE_CHANGED` appears. With "Always allow ManageBac" on, setting a school sync mode does not ask.
2. **Quiz open and close.** "Open my quiz for attempts" opens it: a student can start an attempt. "Close it" closes it.
3. **Agent release.** Ask to release an agent privately: it runs without asking. "Publish it to the class" asks. If the checks have not passed, Spectra runs `run_agent_checks` first. The studio's release list updates live.
4. **Copy link later.** Have a scheduled run make a public link. Later, Share shows "Made by Spectra · Copy link", and the copied address opens the work. Another user never sees the badge.
5. **Retried publish.** After retrying a publish, Version history shows one "Published" checkpoint.
6. **Forget a memory.** "Forget that I like short answers" asks, then the memory disappears from Settings → Memory.
7. **Answer an invitation.** Have another account invite you. "Accept the invitation Ana sent me" asks; after Allow, the work appears in the Library and the notification clears. Declining works the same way.

## Gates

All run in the worktree on the final code:

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `npx tsc --noEmit -p convex/tsconfig.json` | pass |
| `npx eslint . --max-warnings=0` | pass |
| `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets`, `check:skills` | pass |
| `check:deploy-env` | skipped by design (not a Vercel build) |
| `npx vitest run --maxWorkers=3` | 574 files, 4978 tests pass, 1 skipped |

The first full run had one failure: `convex/artifactComments.test.ts`. It still deleted a comment without approval, which 0db3764d correctly refuses. f1885036 updates the test. Earlier, a targeted run under load also failed `conversation-surface-history.test.tsx` once, at file level. It passes alone and in the full suite.

## Parity audit

The audit takes every UI write and asks whether Spectra can do it too. It covers:

- `postSpectra` actions in `src/app/api/spectra/route.ts`;
- the other API routes;
- calendar writes (`calendarPost`, in `calendar/route.ts`);
- Bridge and device calls;
- settings (`accountPreferences:writeLayer`);
- every public Convex mutation and action.

Each was checked against the registries: `ai-reach.ts` `COMMAND_CATALOG`, `tools/app.ts` and `work.ts` command tools, `application-commands.ts`, `effects.ts`, `spectraApplicationWrites` `mutationFor`, and the contract and tools tests.

`command-parity.test.ts` enforces the result. Every public Convex mutation and action must be covered by a catalog entry or by written plumbing, and every app command must have exactly one catalog owner.

The tables below are generated from the catalog. They list Convex writes only, not queries. Result: **0 uncovered writes**.

The catalog has 103 entries (counts updated by lane L3):

- 73 reach a tool;
- 30 are user-only, each with a reason;
- none is a gap;
- 98 server functions are written plumbing.

The route tables below hold 74 `postSpectra` write rows and 83 rows from other routes. Uncovered writes: 0.

### Catalog: every action, its AI path or the reason it has none

`tool` {fixed args} → app command. A tool with no app command runs in the harness itself (reads, navigation, `edit_artifact`).

| Action | UI | Server | AI path or reason |
| --- | --- | --- | --- |
| `navigation.open_library` Open Library | `app.page.library`, `app.page.workspace`, `app.navigate` |  | `open_in_spectra` {"destination":"library"} -> `navigate_spectra` |
| `navigation.open_workspace` Open a workspace |  |  | `open_in_spectra` {"destination":"workspace"} -> `navigate_spectra` |
| `navigation.open_work` Open a work item | `app.work.open`, `app.work.reveal-anchor` |  | `open_in_spectra` {"destination":"artifact"} -> `navigate_spectra` |
| `navigation.open_calendar` Open Calendar | `app.page.calendar`, `app.calendar.open` |  | `open_in_spectra` {"destination":"calendar"} -> `navigate_spectra` |
| `navigation.open_devices` Open Devices | `app.devices.open` |  | `open_in_spectra` {"destination":"devices"} -> `navigate_spectra` |
| `navigation.open_settings` Open Settings | `app.page.settings`, `app.settings.manage-account` |  | `open_in_spectra` {"destination":"settings"} -> `navigate_spectra` |
| `navigation.open_agents` Open Agents | `app.page.agents` |  | `open_in_spectra` {"destination":"agents"} -> `navigate_spectra` |
| `navigation.open_school` Open School | `app.page.school` |  | `open_in_spectra` {"destination":"school"} -> `navigate_spectra` |
| `navigation.open_analytics` Open Analytics | `app.page.analytics` |  | `open_in_spectra` {"destination":"analytics"} -> `navigate_spectra` |
| `conversation.find_thread` Find a past conversation | `app.thread.open`, `app.run.open-conversation` | `semantic:searchThreads` | `read_thread` |
| `conversation.send` Send a message | `app.page.chat`, `app.chat.new` | `spectraRuns:beginRun`, `spectraThreads:create`, `spectraThreads:appendMessage`, `spectraThreads:selectMessageChoice` | User only: The user's message is what starts Spectra; Spectra replies inside the conversation it was asked in. |
| `conversation.manage` Rename or tidy a conversation |  | `spectraThreads:update` | `manage_conversation` -> `manage_conversation` |
| `conversation.result_cards` Hide or keep result cards |  | `spectraRuns:hideTab`, `spectraRuns:selectTab`, `spectraRuns:hideResultCard`, `spectraRuns:keepResultCard` | User only: These arrange what the user is looking at under a reply while they read it. Spectra's work is the same either way; the work itself stays in the library. |
| `conversation.continuation` Continue the current conversation | `app.chat.continue`, `app.settings.toggle-continuation` |  | `change_settings` -> `change_spectra_settings` |
| `conversation.stop` Stop Spectra | `app.run.stop` | `spectraRuns:stopRun` | User only: Stop is the user's control over Spectra. Spectra ends its own turn by replying. |
| `conversation.stop_following` Stop following Spectra | `app.follow.stop` |  | User only: Follow is the user's view of Spectra's work, so only the user leaves it. |
| `conversation.answer` Answer Spectra or approve a change |  | `spectraHarness:answer`, `spectraRuns:claimConfirmation`, `spectraRuns:rejectConfirmation`, `spectraRuns:reviseConfirmation` | User only: An answer or an approval is the user's decision about Spectra's work. |
| `conversation.review_ai_edit` Review or undo Spectra's changes |  | `spectraArtifacts:dismissAiEdit`, `changeGroups:revertPlanForRun` | User only: Reviewing and reverting Spectra's work is the user's control over it. |
| `work.create` Create work |  | `spectraArtifacts:create` | `create_artifact` |
| `work.edit` Edit work |  |  | `edit_artifact` |
| `work.read` Read work |  |  | `read_artifact` |
| `work.search` Search everything |  | `semantic:search`, `semantic:related` | `search` |
| `work.insert_reference` Insert a live reference | `app.reference.insert` | `artifactEmbeds:create`, `spectraArtifactLinks:create`, `spectraArtifactLinks:remove` | `insert_reference` -> `insert_reference` |
| `work.pick_reference` Pick a reference target | `app.reference.begin-picking` |  | User only: Picking is a pointer gesture in the user's editor. Spectra inserts a reference by id with work.insert_reference. |
| `work.embeds` Read the embeds in a work |  |  | `read_embeds` |
| `work.manage_embed` Change or remove an embed |  | `artifactEmbeds:update`, `artifactEmbeds:remove`, `artifactEmbedPlacementActions:refresh` | `manage_embed` -> `manage_embed` |
| `work.save_version` Save a version |  | `changeGroups:createNamedCheckpoint` | `save_version` -> `save_version` |
| `work.history` Read version history |  |  | `read_versions` |
| `work.restore_version` Restore a version |  |  | `restore_version` -> `restore_version` |
| `work.request_access` Ask for access |  | `artifactAccessRequests:*` | User only: Asking for and granting access happens between people, under their own names. |
| `work.publish_runtime` Publish a code runtime |  | `spectraRuntimeBuilds:*` | `publish_code` -> `publish_code` |
| `library.organize` Organize the library | `app.library.organize` | `orgTree:createFolder`, `orgTree:rename`, `orgTree:move`, `orgTree:createReference`, `orgTree:placeWork`, `orgTree:removeFromWorkspace` | `organize_library` -> `organize_library` |
| `library.trash` Move to the Trash | `app.library.delete` | `orgTree:trash`, `spectraArtifacts:archive`, `spectraArtifactWrites:archive`, `spectraWorkspaces:archive` | `move_to_trash` -> `delete_library_items` |
| `library.restore` Restore from the Trash |  | `orgTree:restore` | `restore_from_trash` -> `restore_library_items` |
| `library.delete_forever` Delete permanently |  | `orgTree:purge`, `spectraArtifacts:permanentlyDelete`, `spectraWorkspaces:permanentlyDelete`, `spectraArtifactDeletion:*` | User only: Spectra never deletes permanently. It moves things to the Trash, and the user empties it. |
| `library.pin` Pin in the library |  | `orgTree:setPinned`, `orgTree:pinSources` | `organize_library` {"action":"pin"} -> `pin_library_item` |
| `library.workspaces` Create or rename a workspace |  | `spectraWorkspaces:create`, `spectraWorkspaces:update` | `organize_library` {"action":"create_workspace"} -> `organize_library` |
| `library.import` Import files | `app.library.import`, `app.workspace.import` | `artifactImports:*`, `spectraWorkspaces:importPortableManifest`, `spectraArtifacts:createImportedResource` | User only: Files come from the browser's file picker, which only the user can open. |
| `library.sync_policy` Change how items sync | `app.sync.policy.change` | `syncPolicy:*` | `change_sync_policy` -> `change_sync_policy` |
| `comments.add` Add a comment | `app.comments.add` | `artifactComments:create` | `add_comment` -> `add_comment` |
| `comments.read` Read comments |  |  | `read_comments` |
| `comments.open` Open comments | `app.comments.open` |  | User only: It only shows a panel in the user's editor. Spectra reads work with read_artifact. |
| `comments.manage` Edit, resolve or delete comments |  | `artifactComments:updateBody`, `artifactComments:setResolved`, `artifactComments:reanchor`, `artifactComments:remove` | `manage_comment` -> `manage_comment` |
| `comments.notifications` Comment notifications |  | `artifactComments:setNotificationPreference`, `artifactComments:markNotificationsRead` | User only: Notifications record what the user has seen and wants to see. |
| `settings.change` Change settings | `app.settings.change` | `accountPreferences:writeLayer` | `change_settings` -> `change_spectra_settings` |
| `settings.clear_cache` Clear the local compute cache | `app.settings.clear-compute-cache` |  | User only: The cache lives in the user's browser. Spectra works on the server and cannot reach it. |
| `permissions.ai` Change Spectra AI permissions | `app.security.authority-mode` |  | User only: It changes what Spectra AI may do. Only the user changes that, in Settings, so the AI can never grant itself more. |
| `permissions.credentials` Change sign-in and credentials | `app.security.credentials` | `secretBridge:write`, `secretBridge:revoke`, `secretBridge:eraseDeletedIdentity` | User only: Credentials are never handled by Spectra AI. |
| `permissions.delete_account` Delete the account | `app.security.delete-account` |  | User only: Deleting an account is never done by Spectra AI. |
| `calendar.add_event` Add a calendar event |  | `calendar:createPersonalItem` | `calendar` {"action":"add_event"} -> `create_calendar_personal_event` |
| `calendar.schedule_task` Schedule a task |  | `calendar:scheduleTask` | `calendar` {"action":"schedule_task"} -> `schedule_calendar_task` |
| `calendar.move_block` Move a work block |  | `calendar:moveWorkBlock` | `calendar` {"action":"move_block"} -> `move_calendar_block` |
| `calendar.resize_block` Resize a work block |  | `calendar:resizeWorkBlock` | `calendar` {"action":"resize_block"} -> `resize_calendar_block` |
| `calendar.complete_block` Complete a work block |  | `calendar:completeWorkBlock` | `calendar` {"action":"complete_block"} -> `complete_calendar_block` |
| `calendar.remove_event` Remove a calendar event |  | `calendar:removePersonalItem` | `calendar` {"action":"remove_event"} -> `remove_calendar_event` |
| `reminders.mark_read` Mark reminders read |  | `plannerReminders:markRead`, `timetableReminders:markRead` | User only: Marking a reminder read records that the user saw it. |
| `devices.status` Check devices |  |  | `devices` {"action":"status"} -> `read_devices` |
| `devices.pair` Connect this computer | `app.devices.pair` | `bridge:requestPairing` | `devices` {"action":"pair"} -> `pair_device` |
| `devices.add_folder` Add a folder | `app.devices.add-folder` |  | `devices` {"action":"add_folder"} -> `control_device` |
| `devices.retry_folder` Retry a folder |  |  | `devices` {"action":"retry_folder"} -> `control_device` |
| `devices.pause_folder` Pause or resume a folder |  |  | `devices` {"action":"pause_folder"} -> `control_device` |
| `devices.remove_folder` Remove a folder |  |  | `devices` {"action":"remove_folder"} -> `control_device` |
| `devices.pause` Pause or resume syncing | `app.devices.pause` |  | `devices` {"action":"pause_syncing"} -> `control_device` |
| `devices.show_logs` Show Bridge logs |  |  | `devices` {"action":"show_logs"} -> `control_device` |
| `devices.update` Update Spectra Bridge |  |  | `devices` {"action":"update"} -> `control_device` |
| `devices.remove` Remove a device |  | `bridge:revokeDevice` | `devices` {"action":"remove_device"} -> `remove_device` |
| `devices.native_writes` Change native writes |  |  | User only: It changes what Spectra AI may do. Only the user changes that, in Settings, so the AI can never grant itself more. |
| `devices.conflicts` Resolve a desktop file conflict |  | `replicas:resolveExternalConflict`, `replicas:applyProtectedPending`, `replicas:discardProtectedPending`, `replicas:forkProtectedPending` | User only: Choosing which version of a file on the user's computer survives is the user's decision. |
| `connections.providers` Connect an account | `app.providers.connect` | `managebac:configure`, `managebac:disconnect` | User only: Connecting a service goes through its own sign-in, which only the user completes. |
| `sharing.change` Share work | `app.sharing.change` | `authority:invite`, `authority:changeAcceptedLevel`, `authority:revoke` | `share` -> `change_sharing` |
| `sharing.invitations` See invitations waiting for you |  |  | `read_share_invitations` |
| `sharing.respond` Accept or decline a share |  | `authority:acceptShareInvitation`, `authority:declineShareInvitation` | `respond_to_share` -> `respond_share_invitation` |
| `sharing.join_school` Join a school |  | `memberships:acceptInvitation` | User only: Joining a school changes the account itself, its school and who administers it. Only the user accepts that, from the invitation. |
| `sharing.read` See who can open a work |  |  | `read_sharing` |
| `sharing.withdraw_invitation` Withdraw an invitation |  | `authority:revokePendingInvitation` | `share` {"action":"withdraw_invitation"} -> `change_sharing` |
| `sharing.exceptions` Set an access exception |  | `authority:setArtifactException`, `authority:clearArtifactException` | `share` {"action":"set_exception"} -> `change_sharing` |
| `sharing.public_link` Make or turn off a public link |  | `authority:createPublicLink`, `authority:revokePublicLink` | `share` {"action":"create_public_link"} -> `change_sharing` |
| `managebac.sync` Sync ManageBac | `app.managebac.sync` | `managebac:requestAiRefresh` | `managebac` {"action":"sync"} -> `trigger_managebac_sync` |
| `managebac.select_classes` Choose ManageBac classes | `app.managebac.select-classes` | `managebac:setSelectedClasses` | `managebac` {"action":"select_classes"} -> `select_managebac_classes` |
| `managebac.import_resource` Import a school resource | `app.managebac.import-resource` | `managebac:beginResourceImport` | `managebac` {"action":"import_resource"} -> `import_managebac_resource` (lane L2) |
| `managebac.mapping` Change ManageBac mapping | `app.managebac.mapping` | `managebac:upsertCalendarPeriodMap`, `managebac:removeCalendarPeriodMap`, `managebac:setOverlay`, `managebac:resolveConflict` | User only: Mapping changes use the dedicated school flow, where the user checks each record. |
| `managebac.class_workspaces` Class workspaces |  | `managebac:materializeClassWorkspaces`, `managebac:releaseClassWorkspaces` | `managebac` {"action":"create_class_workspaces"} -> `manage_class_workspaces` |
| `managebac.purge_class_workspaces` Remove auto-created class workspaces |  | `managebac:purgeAutoCreatedClassWorkspaces` | User only: It removes every auto-created class workspace at once, behind a phrase the user types on the ManageBac page. Spectra releases class workspaces one class at a time with the managebac tool. |
| `managebac.sync_preferences` School sync preferences |  | `school:setMode`, `school:setClassOverride` | `managebac` {"action":"set_sync_mode"} -> `set_school_sync_mode` |
| `managebac.sync_now` Sync school records now |  | `school:syncNow` | User only: The School page's Sync now button. Spectra refreshes the same records through Sync ManageBac. |
| `managebac.school_files` School files |  | `school:removeSchoolFile` | User only: Removing a kept school file is the student's choice on the School page. |
| `managebac.cas` CAS reflections and evidence |  | `school:saveCasReflection`, `school:deleteCasReflection`, `school:setCasOutcomes`, `school:beginCasEvidenceUpload`, `school:attachCasEvidence` | User only: CAS reflections must be the student's own words under IB rules. Spectra can help think one through in a document, but only the student saves it. |
| `memory.remember` Remember something | `app.memory.write` | `memory:remember`, `memory:correct` | `remember` -> `write_memory` |
| `memory.forget` Forget a memory |  | `memory:forget` | `forget_memory` -> `write_memory` |
| `memory.manage` Clear, dispute or configure memory |  | `memory:clearAll`, `memory:setDisputed`, `memory:updatePreferences` | User only: What Spectra may keep is the user's choice: clearing everything takes typed confirmation and memory settings are Spectra's own permissions. Spectra revises a wrong memory or forgets one instead of disputing it. |
| `agents.use` Hand a request to an agent |  |  | `use_agent` |
| `agents.releases` Read an agent's releases |  |  | `read_agent_releases` |
| `agents.release` Release an agent |  | `spectraArtifacts:publishAgent`, `spectraArtifacts:manageAgentRelease` | `release_agent` -> `release_agent` |
| `agents.checks` Run an agent's checks |  | `agents:beginEvalRun`, `agents:settleEvalRun`, `agents:admitModelWork`, `agents:recordModelWork` | `run_agent_checks` -> `run_agent_checks` |
| `agents.bench_run` Try an agent on the bench |  | `agents:recordBenchRun` | `run_agent_bench` -> `run_agent_bench` |
| `agents.bench_read` Read an agent's bench |  |  | `read_agent_bench` |
| `agents.bench_save_test` Keep a bench question as a test |  | `agents:saveBenchCase` | `save_agent_bench_case` -> `save_agent_bench_case` |
| `agents.bench_remove_test` Remove a bench test |  | `agents:removeBenchCase` | `remove_agent_bench_case` -> `remove_agent_bench_case` |
| `agents.compile` Compile an agent in the Foundry |  | `agents:beginCompilerJob`, `agents:updateCompilerJob`, `agents:cancelCompilerJob` | `compile_agent` -> `compile_agent` |
| `agents.approve_skills` Approve an agent's drafted skills |  |  | `approve_agent_skills` |
| `agents.manage` Follow or improve agents |  | `agents:follow`, `agents:submitFeedback`, `agents:proposeImprovement`, `agents:decideImprovement`, `spectraArtifacts:addPublicAgent` | User only: Following an agent, rating its answers and accepting an improvement are the user's own judgment of it. Spectra builds agents as work with create_artifact and edit_artifact. |
| `study.practice` Practise a quiz or deck |  | `quizPractice:*`, `flashcardStudy:*` | User only: These are the learner's own answers. Spectra answering them would fake the learner's progress. |
| `school.administration` School administration |  | `administration:*`, `schools:*`, `memberships:invite`, `metering:setLimitPolicy` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |

### postSpectra actions

| postSpectra action | Convex write | Catalog entry | AI path or reason |
| --- | --- | --- | --- |
| `hideRunTab` | `spectraRuns:hideTab` | `conversation.result_cards` | User only: These arrange what the user is looking at under a reply while they read it. Spectra's work is the same either way; the work itself stays in the library. |
| `updateMemoryPreferences` | `memory:updatePreferences` | `memory.manage` | User only: What Spectra may keep is the user's choice: clearing everything takes typed confirmation and memory settings are Spectra's own permissions. Spectra revises a wrong memory or forgets one instead of disputing it. |
| `rememberMemory` | `memory:remember` | `memory.remember` | `remember` -> `write_memory` |
| `correctMemory` | `memory:correct` | `memory.remember` | `remember` -> `write_memory` |
| `disputeMemory` | `memory:setDisputed` | `memory.manage` | User only: What Spectra may keep is the user's choice: clearing everything takes typed confirmation and memory settings are Spectra's own permissions. Spectra revises a wrong memory or forgets one instead of disputing it. |
| `forgetMemory` | `memory:forget` | `memory.forget` | `forget_memory` -> `write_memory` |
| `clearMemory` | `memory:clearAll` | `memory.manage` | User only: What Spectra may keep is the user's choice: clearing everything takes typed confirmation and memory settings are Spectra's own permissions. Spectra revises a wrong memory or forgets one instead of disputing it. |
| `selectRunTab` | `spectraRuns:selectTab` | `conversation.result_cards` | User only: These arrange what the user is looking at under a reply while they read it. Spectra's work is the same either way; the work itself stays in the library. |
| `selectMessageChoice` | `spectraThreads:selectMessageChoice` | `conversation.send` | User only: The user's message is what starts Spectra; Spectra replies inside the conversation it was asked in. |
| `createWorkspace` | `spectraWorkspaces:create` | `library.workspaces` | `organize_library` {"action":"create_workspace"} -> `organize_library` |
| `importWorkspaceManifest` | `spectraWorkspaces:importPortableManifest` | `library.import` | User only: Files come from the browser's file picker, which only the user can open. |
| `inviteShare` | `authority:invite` | `sharing.change` | `share` -> `change_sharing` |
| `acceptShareInvitation` | `authority:acceptShareInvitation` | `sharing.respond` | `respond_to_share` -> `respond_share_invitation` |
| `declineShareInvitation` | `authority:declineShareInvitation` | `sharing.respond` | `respond_to_share` -> `respond_share_invitation` |
| `changeShareLevel` | `authority:changeAcceptedLevel` | `sharing.change` | `share` -> `change_sharing` |
| `revokeShareAccess` | `authority:revoke` | `sharing.change` | `share` -> `change_sharing` |
| `revokePendingShareInvitation` | `authority:revokePendingInvitation` | `sharing.withdraw_invitation` | `share` {"action":"withdraw_invitation"} -> `change_sharing` |
| `createPublicLink` | `authority:createPublicLink` | `sharing.public_link` | `share` {"action":"create_public_link"} -> `change_sharing` |
| `revokePublicLink` | `authority:revokePublicLink` | `sharing.public_link` | `share` {"action":"create_public_link"} -> `change_sharing` |
| `setArtifactAccessException` | `authority:setArtifactException` | `sharing.exceptions` | `share` {"action":"set_exception"} -> `change_sharing` |
| `clearArtifactAccessException` | `authority:clearArtifactException` | `sharing.exceptions` | `share` {"action":"set_exception"} -> `change_sharing` |
| `createArtifactComment` | `artifactComments:create` | `comments.add` | `add_comment` -> `add_comment` |
| `updateArtifactComment` | `artifactComments:updateBody` | `comments.manage` | `manage_comment` -> `manage_comment` |
| `setArtifactCommentResolved` | `artifactComments:setResolved` | `comments.manage` | `manage_comment` -> `manage_comment` |
| `reanchorArtifactComment` | `artifactComments:reanchor` | `comments.manage` | `manage_comment` -> `manage_comment` |
| `removeArtifactComment` | `artifactComments:remove` | `comments.manage` | `manage_comment` -> `manage_comment` |
| `setArtifactCommentPreference` | `artifactComments:setNotificationPreference` | `comments.notifications` | User only: Notifications record what the user has seen and wants to see. |
| `markArtifactCommentNotificationsRead` | `artifactComments:markNotificationsRead` | `comments.notifications` | User only: Notifications record what the user has seen and wants to see. |
| `markPlannerReminderNotificationsRead` | `plannerReminders:markRead` | `reminders.mark_read` | User only: Marking a reminder read records that the user saw it. |
| `markTimetableReminderNotificationsRead` | `timetableReminders:markRead` | `reminders.mark_read` | User only: Marking a reminder read records that the user saw it. |
| `saveArtifactUserState` | `artifactUserStates:put` | plumbing | Plumbing: Per-user view state the editors save as they are used. |
| `requestArtifactAccess` | `artifactAccessRequests:request` | `work.request_access` | User only: Asking for and granting access happens between people, under their own names. |
| `cancelArtifactAccessRequest` | `artifactAccessRequests:cancel` | `work.request_access` | User only: Asking for and granting access happens between people, under their own names. |
| `resolveArtifactAccessRequest` | `artifactAccessRequests:resolve` | `work.request_access` | User only: Asking for and granting access happens between people, under their own names. |
| `resolveAiArtifactConflict` | `spectraOperations:resumeAfterRegionConflict` | plumbing | Plumbing: Spectra's own operation journal. |
| `updateWorkspace` | `spectraWorkspaces:update` | `library.workspaces` | `organize_library` {"action":"create_workspace"} -> `organize_library` |
| `archiveWorkspace` | `spectraWorkspaces:archive` | `library.trash` | `move_to_trash` -> `delete_library_items` |
| `deleteWorkspace` | `spectraWorkspaces:permanentlyDelete` | `library.delete_forever` | User only: Spectra never deletes permanently. It moves things to the Trash, and the user empties it. |
| `createArtifact` | `spectraArtifacts:create` | `work.create` | `create_artifact` |
| `publishAgent` | `spectraArtifacts:publishAgent` | `agents.release` | `release_agent` -> `release_agent` |
| `manageAgentRelease` | `spectraArtifacts:manageAgentRelease` | `agents.release` | `release_agent` -> `release_agent` |
| `followAgent` | `agents:follow` | `agents.manage` | User only: Following an agent, rating its answers and accepting an improvement are the user's own judgment of it. Spectra builds agents as work with create_artifact and edit_artifact. |
| `submitAgentFeedback` | `agents:submitFeedback` | `agents.manage` | User only: Following an agent, rating its answers and accepting an improvement are the user's own judgment of it. Spectra builds agents as work with create_artifact and edit_artifact. |
| `proposeAgentImprovement` | `agents:proposeImprovement` | `agents.manage` | User only: Following an agent, rating its answers and accepting an improvement are the user's own judgment of it. Spectra builds agents as work with create_artifact and edit_artifact. |
| `saveAgentBenchCase` | `agents:saveBenchCase` | `agents.bench_save_test` | `save_agent_bench_case` -> `save_agent_bench_case` |
| `removeAgentBenchCase` | `agents:removeBenchCase` | `agents.bench_remove_test` | `remove_agent_bench_case` -> `remove_agent_bench_case` |
| `decideAgentImprovement` | `agents:decideImprovement` | `agents.manage` | User only: Following an agent, rating its answers and accepting an improvement are the user's own judgment of it. Spectra builds agents as work with create_artifact and edit_artifact. |
| `addPublicAgent` | `spectraArtifacts:addPublicAgent` | `agents.manage` | User only: Following an agent, rating its answers and accepting an improvement are the user's own judgment of it. Spectra builds agents as work with create_artifact and edit_artifact. |
| `reviewFlashcard` | `flashcardStudy:review` | `study.practice` | User only: These are the learner's own answers. Spectra answering them would fake the learner's progress. |
| `setFlashcardNote` | `flashcardStudy:setNote` | `study.practice` | User only: These are the learner's own answers. Spectra answering them would fake the learner's progress. |
| `startQuizPractice` | `quizPractice:start` | `study.practice` | User only: These are the learner's own answers. Spectra answering them would fake the learner's progress. |
| `saveQuizPracticeResponse` | `quizPractice:saveResponse` | `study.practice` | User only: These are the learner's own answers. Spectra answering them would fake the learner's progress. |
| `submitQuizPractice` | `quizPractice:submit` | `study.practice` | User only: These are the learner's own answers. Spectra answering them would fake the learner's progress. |
| `createArtifactCheckpoint` | `changeGroups:createNamedCheckpoint` | `work.save_version` | `save_version` -> `save_version` |
| `createArtifactImportVersion` | `changeGroups:commitImport` | plumbing | Plumbing: Saves edit history for imports. |
| `reconcileArtifactImportVersions` | `changeGroups:reconcileImports` | plumbing | Plumbing: Saves edit history for imports. |
| `commitArtifactCurrentSession` | `changeGroups:commitCurrent` | plumbing | Plumbing: Saves edit history as the editors write. |
| `dismissAiEdit` | `spectraArtifacts:dismissAiEdit` | `conversation.review_ai_edit` | User only: Reviewing and reverting Spectra's work is the user's control over it. |
| `archiveArtifact` | `spectraArtifacts:archive` | `library.trash` | `move_to_trash` -> `delete_library_items` |
| `deleteArtifact` | `spectraArtifacts:permanentlyDelete` | `library.delete_forever` | User only: Spectra never deletes permanently. It moves things to the Trash, and the user empties it. |
| `ensurePersonalTimetable` | `spectraArtifacts:ensurePersonalTimetable` | plumbing | Plumbing: Creates the personal timetable on first use. |
| `addArtifactToWorkspace` | `orgTree:placeWork` | `library.organize` | `organize_library` -> `organize_library` |
| `moveArtifactToWorkspace` | `orgTree:placeWork` | `library.organize` | `organize_library` -> `organize_library` |
| `moveArtifactToGeneral` | `orgTree:placeWork` | `library.organize` | `organize_library` -> `organize_library` |
| `removeFromWorkspace` | `orgTree:removeFromWorkspace` | `library.organize` | `organize_library` -> `organize_library` |
| `setNodePinned` | `orgTree:setPinned` | `library.pin` | `organize_library` {"action":"pin"} -> `pin_library_item` |
| `createArtifactLink` | `spectraArtifactLinks:create` | `work.insert_reference` | `insert_reference` -> `insert_reference` |
| `removeArtifactLink` | `spectraArtifactLinks:remove` | `work.insert_reference` | `insert_reference` -> `insert_reference` |
| `hideResultCard` | `spectraRuns:hideResultCard` | `conversation.result_cards` | User only: These arrange what the user is looking at under a reply while they read it. Spectra's work is the same either way; the work itself stays in the library. |
| `keepResultCard` | `spectraRuns:keepResultCard` | `conversation.result_cards` | User only: These arrange what the user is looking at under a reply while they read it. Spectra's work is the same either way; the work itself stays in the library. |
| `createThread` | `spectraThreads:create` | `conversation.send` | User only: The user's message is what starts Spectra; Spectra replies inside the conversation it was asked in. |
| `updateThread` | `spectraThreads:update` | `conversation.manage` | `manage_conversation` -> `manage_conversation` |
| `keepRunAsThread` | `spectraThreads:createFromRun` | plumbing | Plumbing: Spectra's own run machinery. |
| `addThreadToWorkspace` | `spectraThreads:createFromRun` | plumbing | Plumbing: Spectra's own run machinery. |

### Other API routes (calendar, ManageBac, devices, agents, administration, public)

| Route | Convex write | Catalog entry | AI path or reason |
| --- | --- | --- | --- |
| `spectra/administration/route.ts` | `administration:schoolOverview` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:feedbackInbox` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:platformRequestInbox` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:auditLog` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:platformOverview` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:platformSecurityLog` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:lifecycleExportUrl` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `memberships:acceptInvitation` | `sharing.join_school` | User only: Joining a school changes the account itself, its school and who administers it. Only the user accepts that, from the invitation. |
| `spectra/administration/route.ts` | `memberships:invite` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:changeMember` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:revokeInvitation` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:createAnnouncement` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:updateScheduledAnnouncement` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:cancelAnnouncement` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:markAnnouncementRead` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:submitFeedback` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:respondFeedback` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:createSchoolRequest` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:respondSchoolRequest` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:updateSchoolProfile` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `metering:setLimitPolicy` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `schools:create` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `schools:cancelOnboarding` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `operatorSessions:start` | plumbing | Plumbing: Platform operator sessions. |
| `spectra/administration/route.ts` | `operatorSessions:end` | plumbing | Plumbing: Platform operator sessions. |
| `spectra/administration/route.ts` | `administration:createIncident` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:updateIncident` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:requestLifecycleJob` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:approveLifecycleJob` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/administration/route.ts` | `administration:cancelLifecycleJob` | `school.administration` | User only: School administration belongs to school admins in the admin console. Spectra AI acts for one person's own account. |
| `spectra/agents/bench/answer.ts` | `agents:recordBenchRun` | `agents.bench_run` | `run_agent_bench` -> `run_agent_bench` |
| `spectra/agents/foundry/compile.ts` | `agents:beginCompilerJob` | `agents.compile` | `compile_agent` -> `compile_agent` |
| `spectra/agents/foundry/compile.ts` | `agents:updateCompilerJob` | `agents.compile` | `compile_agent` -> `compile_agent` |
| `spectra/agents/foundry/compile.ts` | `agents:cancelCompilerJob` | `agents.compile` | `compile_agent` -> `compile_agent` |
| `spectra/assets/route.ts` | `artifactAssets:beginUpload` | plumbing | Plumbing: Upload protocol for work assets. |
| `spectra/assets/route.ts` | `artifactIntakeActions:verifyUploadedStorage` | plumbing | Plumbing: Upload verification. |
| `spectra/assets/route.ts` | `artifactAssets:revoke` | plumbing | Plumbing: Upload protocol for work assets. |
| `spectra/calendar/route.ts` | `calendar:ensureLegacyMigration` | plumbing | Plumbing: One-time data migration. |
| `spectra/calendar/route.ts` | `calendar:createPersonalItem` | `calendar.add_event` | `calendar` {"action":"add_event"} -> `create_calendar_personal_event` |
| `spectra/calendar/route.ts` | `calendar:scheduleTask` | `calendar.schedule_task` | `calendar` {"action":"schedule_task"} -> `schedule_calendar_task` |
| `spectra/calendar/route.ts` | `calendar:moveWorkBlock` | `calendar.move_block` | `calendar` {"action":"move_block"} -> `move_calendar_block` |
| `spectra/calendar/route.ts` | `calendar:resizeWorkBlock` | `calendar.resize_block` | `calendar` {"action":"resize_block"} -> `resize_calendar_block` |
| `spectra/calendar/route.ts` | `calendar:completeWorkBlock` | `calendar.complete_block` | `calendar` {"action":"complete_block"} -> `complete_calendar_block` |
| `spectra/calendar/route.ts` | `calendar:removePersonalItem` | `calendar.remove_event` | `calendar` {"action":"remove_event"} -> `remove_calendar_event` |
| `spectra/imports/route.ts` | `artifactAssets:beginUpload` | plumbing | Plumbing: Upload protocol for work assets. |
| `spectra/imports/route.ts` | `artifactIntakeActions:verifyUploadedStorage` | plumbing | Plumbing: Upload verification. |
| `spectra/imports/route.ts` | `artifactImports:begin` | `library.import` | User only: Files come from the browser's file picker, which only the user can open. |
| `spectra/imports/route.ts` | `changeGroups:commitImport` | plumbing | Plumbing: Saves edit history for imports. |
| `spectra/imports/route.ts` | `artifactImports:abortUpload` | `library.import` | User only: Files come from the browser's file picker, which only the user can open. |
| `spectra/imports/route.ts` | `artifactImports:prepareUpload` | `library.import` | User only: Files come from the browser's file picker, which only the user can open. |
| `spectra/imports/route.ts` | `artifactIntakeActions:verifyUploadedOriginal` | plumbing | Plumbing: Upload verification. |
| `spectra/lenses/docx/route.ts` | `replicas:recordExternalReconciliation` | plumbing | Plumbing: Spectra Bridge replica protocol. |
| `spectra/lenses/office/route.ts` | `replicas:recordExternalReconciliation` | plumbing | Plumbing: Spectra Bridge replica protocol. |
| `spectra/lenses/office/route.ts` | `replicas:resolveExternalConflict` | `devices.conflicts` | User only: Choosing which version of a file on the user's computer survives is the user's decision. |
| `spectra/managebac/route.ts` | `managebac:replaceCapabilityManifest` | plumbing | Plumbing: ManageBac sync protocol. |
| `spectra/managebac/route.ts` | `spectraArtifacts:permanentlyDelete` | `library.delete_forever` | User only: Spectra never deletes permanently. It moves things to the Trash, and the user empties it. |
| `spectra/managebac/route.ts` | `payloads:issueUpload` | plumbing | Plumbing: Upload protocol. |
| `spectra/managebac/route.ts` | `payloads:put` | plumbing | Plumbing: Upload protocol. |
| `spectra/managebac/route.ts` | `replicas:attachPortablePayload` | plumbing | Plumbing: Spectra Bridge replica protocol. |
| `spectra/managebac/route.ts` | `managebac:beginResourceImport` | `managebac.import_resource` | `managebac` {"action":"import_resource"} -> `import_managebac_resource` (lane L2; the import now lives in `managebac/resource-import.ts`) |
| `spectra/managebac/route.ts` | `spectraArtifacts:create` | `work.create` | `create_artifact` |
| `spectra/managebac/route.ts` | `spectraArtifacts:createImportedResource` | `library.import` | User only: Files come from the browser's file picker, which only the user can open. |
| `spectra/managebac/route.ts` | `managebac:attachResourceImportArtifact` | plumbing | Plumbing: Steps of a resource import the user started. |
| `spectra/managebac/route.ts` | `managebac:completeResourceImport` | plumbing | Plumbing: Steps of a resource import the user started. |
| `spectra/managebac/route.ts` | `managebac:failResourceImport` | plumbing | Plumbing: Steps of a resource import the user started. |
| `spectra/managebac/route.ts` | `school:syncNow` | `managebac.sync_now` | User only: The School page's Sync now button. Spectra refreshes the same records through Sync ManageBac. |
| `spectra/managebac/route.ts` | `managebac:beginSchoolFileFetch` | plumbing | Plumbing: Steps of a school file fetch the School sync started. |
| `spectra/managebac/route.ts` | `managebac:attachSchoolFile` | plumbing | Plumbing: Steps of a school file fetch the School sync started. |
| `spectra/managebac/route.ts` | `managebac:failSchoolFileFetch` | plumbing | Plumbing: Steps of a school file fetch the School sync started. |
| `spectra/managebac/route.ts` | `managebac:upsertCalendarPeriodMap` | `managebac.mapping` | User only: Mapping changes use the dedicated school flow, where the user checks each record. |
| `spectra/managebac/route.ts` | `managebac:removeCalendarPeriodMap` | `managebac.mapping` | User only: Mapping changes use the dedicated school flow, where the user checks each record. |
| `spectra/managebac/route.ts` | `managebac:configure` | `connections.providers` | User only: Connecting a service goes through its own sign-in, which only the user completes. |
| `spectra/managebac/route.ts` | `managebac:disconnect` | `connections.providers` | User only: Connecting a service goes through its own sign-in, which only the user completes. |
| `spectra/managebac/route.ts` | `managebac:setSelectedClasses` | `managebac.select_classes` | `managebac` {"action":"select_classes"} -> `select_managebac_classes` |
| `spectra/managebac/route.ts` | `managebac:materializeClassWorkspaces` | `managebac.class_workspaces` | `managebac` {"action":"create_class_workspaces"} -> `manage_class_workspaces` |
| `spectra/managebac/route.ts` | `managebac:releaseClassWorkspaces` | `managebac.class_workspaces` | `managebac` {"action":"create_class_workspaces"} -> `manage_class_workspaces` |
| `spectra/managebac/route.ts` | `managebac:resolveConflict` | `managebac.mapping` | User only: Mapping changes use the dedicated school flow, where the user checks each record. |
| `spectra/managebac/route.ts` | `managebac:purgeAutoCreatedClassWorkspaces` | `managebac.purge_class_workspaces` | User only: It removes every auto-created class workspace at once, behind a phrase the user types on the ManageBac page. Spectra releases class workspaces one class at a time with the managebac tool. |
| `spectra/managebac/route.ts` | `managebac:requestAiRefresh` | `managebac.sync` | `managebac` {"action":"sync"} -> `trigger_managebac_sync` |
| `spectra/native/route.ts` | `replicas:attachPortablePayload` | plumbing | Plumbing: Spectra Bridge replica protocol. |
| `spectra/resources/route.ts` | `spectraArtifacts:permanentlyDelete` | `library.delete_forever` | User only: Spectra never deletes permanently. It moves things to the Trash, and the user empties it. |
| `spectra/resources/route.ts` | `spectraArtifacts:createImportedResource` | `library.import` | User only: Files come from the browser's file picker, which only the user can open. |
| `spectra/resources/route.ts` | `replicas:attachPortablePayload` | plumbing | Plumbing: Spectra Bridge replica protocol. |

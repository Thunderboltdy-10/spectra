# S10 edge-health implementation handoff

> Imported proposal snapshot from Cursor. For the user-authorized S9 task on the shared primary checkout, follow the reviewed decisions in [`../S9-EDGE-IMPLEMENTATION.md`](../S9-EDGE-IMPLEMENTATION.md). The isolated-checkout/no-implementation instructions below applied to the original audit session. Recheck every cited claim against current source.

Checkpoint `eac1567be6feea64870bfb49258daa21909f9d75` (`eac1567b`).
Branch `cursor/s10-edge-health`.
Worktree `<local-workspace>`.

This file is the brief for a later implementing agent. It is source-traced at that commit. It is not live acceptance. Do not mark any row passed against the running app, native Office, Bridge, or production Convex.

The short index is `S10-EDGE-LEDGER.md`. The assignment map is `S10-EDGE-COVERAGE.md`.

## How to use this file

Implement one ticket at a time in an isolated checkout of `eac1567b` (or a later commit that still contains the cited lines). Do not edit the shared checkout at `<local-workspace>`. Do not merge to main from this pass.

For each ticket:

1. Read the cited symbols before editing. Line numbers drift; symbols do not.
2. Apply only the proposed change. Do not refactor neighbors.
3. Add the named regression. Do not weaken an existing assertion to make it pass.
4. If the ticket says **propose only**, write the patch as a comment or a separate proposal. Do not edit those files while S9-AI is live on main.

E01–E80 are recorded. Do not start a second deep-investigation wave from this session.

## Rules that apply to every ticket

- Success is a saved or mounted effect, not a handler that returned `undefined`.
- A list cap, a search error, or a missing row is not “the object does not exist.”
- A revoked grant, ended membership, or deleted artifact must fail the next read. A cached projection, cached role, or cached school is not authority.
- Human and AI paths for the same command must agree on whether a duplicate is reused and on whether the outcome is completed, pending, or needs-human.
- S9-AI owns `src/app/api/spectra/run/loop/**`, agent-loop content patches, and live application writes on main. Tickets that name those files are proposals.
- S10 DATA, LIBRARY, OPEN, BRIDGE, COLLAB, PERF, and PLATFORM own unfinished lanes. A ticket marked for one of those lanes is a proposal unless the change is a few lines and does not overwrite their branch.

## P1 tickets

### P1-01 Email change locks the account, and registerSelf can seize another account’s email

**User sees:** After Clerk verifies a new email, the person cannot get back in. The repair path can attach that email to the wrong Spectra account.

**Where:** `getAuthenticatedAccount` and `identity.registerSelf` in `convex/identity.ts`. Schema: `accounts.by_email` is not unique (`convex/schema.ts`). Webhook: `src/app/api/webhooks/clerk/route.ts` returns 200 with `deferredToAuthenticatedSession` and writes nothing, so Clerk will not retry.

**Failure:** Verified email on the token no longer matches the stored account, so auth fails before `registerSelf` remaps it. `registerSelf` checks uniqueness on insert only. An update or a race can store an email another account still holds.

**Fix:**

- On email mismatch, call the repair that remaps the existing account to the new verified email before returning a lockout, and only when that email is not already on a different account.
- On update as well as insert, refuse if another account row already has that email. Do not delete or overwrite the other row.
- Leave the webhook as a deferral, but do not treat its 200 as “identity was written.” The session path is the writer.

**Do not:** Add a unique index in a migration that fails on existing duplicates without a backfill plan. Do not let the webhook create accounts by itself.

**Test:** Two accounts; second `registerSelf` with the first account’s email throws. Email change on account A remaps A and does not attach A’s new email to B.

**Owner:** Identity. Safe to implement in this isolated branch.

### P1-02 Ending a membership leaves direct grants

**User sees:** A person who left school A and joined school B can still open works in A through an old direct grant.

**Where:** `changeMember` in `convex/administration.ts` patches membership and does not touch `accessGrants`. `evaluateLoadedResourceAccess` still accepts a live direct grant across schools.

**Fix:** When a membership becomes ended, revoked, or suspended, set `revokedAt` on that account’s live `accessGrants` for that `schoolId`, and bump policy version the same way `authority.revoke` does. Do this in the same mutation as the membership patch.

**Do not:** Delete grant rows. Do not revoke grants in other schools. Live collaboration rooms are a neighbor: `authority.revoke` already releases claims; reuse that helper if it is school-scoped.

**Test:** Grant on a work, end membership, assert the next access check is denied. A grant in another school is unchanged.

**Owner:** Identity / sharing. Related to P1-53 (30s actor cache) and P2 memory/grants.

### P1-03 Accepting an invite while already a member keeps the old role

**User sees:** An existing member accepts a new invite. The invite shows accepted. Their role stays the old one.

**Where:** `acceptInvitation` existing-member branch in `convex/memberships.ts`.

**Fix:** If the account already has an active membership in that school, either update the membership role to the invite role and then mark the invite accepted, or refuse the invite with a specific error and do not mark it accepted. Pick the update path: the invite is the newer authority the admin sent.

**Do not:** Create a second active membership. The schema does not enforce one active row (P2). The accept path must still leave a single active row.

**Test:** Member is `student`, invite says `teacher`, accept, membership role is `teacher`, invite is `accepted`.

### P1-04 Expired invites look like a connection failure

**User sees:** An expired or unavailable invite shows a generic connection error.

**Where:** `previewInvitation` throws a typed error. `normalizeErrorStatus` in `src/lib/route-handler.ts` turns unknown errors into HTTP 500. The join page treats 500 as “could not connect.”

**Fix:** Map the expired and unavailable invitation codes to 404 or 410 with a stable `error.code`. The join page should render “this invite is no longer available” for those codes.

**Test:** Expired preview returns the mapped status, not 500. The join page fixture asserts the unavailable copy, not the connection copy.

### P1-05 Palette commands report completed when the handler returns nothing

**User sees:** Document, stop, comment, and similar commands close as done when the mounted handler returned `undefined` or no-oped.

**Where:** `fromHandler` / `executeCommand` in `src/features/spectra/commands/application-dispatcher.ts` and `commands/registry.ts`. Document bus in `document-studio.tsx` synthesizes `{ status: "completed" }` when `execute` returns `undefined`. Studio comment handler in `artifact-studio.tsx` returns `void` and can return early when the artifact id does not match.

**Fix:** If every listener result is `undefined` or missing `status`, the outcome is `failed` (or `not-handled`), not `completed`. Do not close the dialog on that outcome. Apply the same rule on the document bus. A handler that intentionally did nothing must return `{ status: "failed" }` or `{ status: "completed", changed: false }` and the UI must not say the action happened. `app.run.stop` is the same bug: `spectra-shell.tsx`, `chat-shell.tsx`, and `global-route-workbench.tsx` return nothing when `runId` does not match `activeRunId`, and `fromHandler` still says “Stop requested.” `follow.stopRequested` already returns an explicit outcome; match that. There is no second command table under `src/features/spectra/actions/**`.

**Do not:** Change handlers that already return a real `SpectraCommandOutcome`.

**Test:** Bus listener returns `undefined` → outcome is not `completed`. Wrong-artifact comment handler → not “Comment added.”

### P1-06 Comment, continue, and stop freeze their target at rank time

**User sees:** The user opens the command bar on work A, then the visible work becomes B, and confirm still targets A.

**Where:** `commandEntry` in `src/features/spectra/commands/kbar.ts`. Document commands re-read context at execute. `app.comments.*`, continue, and stop do not.

**Fix:** For those entries, resolve `artifactId` (and run id, if any) at execute time from the current context, not from the object captured when the entry was ranked. If the target changed, say so and do not run against the stale id.

**Test:** Build the entry for artifact A, change context to B, execute, mutation receives B.

### P1-07 Bridge setup is prohibited in one registry and allowed in the other

**User sees:** One surface says Bridge setup is a human-only disabled action. The merged command list enables it for AI.

**Where:** Presentation rows in `src/features/spectra/commands/app-registry.ts`. Capability IR in `src/features/spectra/capabilities/application.ts`. Merge overwrites presentation with IR (`ai.exposed` → `aiAuthority: "allowed"`, `availability: "readable"`). Same split for `app.bridge.policy.change` and `app.bridge.pair` on the disabled/readable axis. Inverse bug: `app.managebac.import-resource` is `exposed: true` in IR and `aiAvailability: "prohibited"` on `spectraToolRegistry`.

**Fix:** Choose one authority and write it in both places.

- If setup is human-only: set IR `exposed: false` and availability `disabled`, and keep the tool prohibited. Update `bridge-trust.test.ts`, which currently expects `allowed`.
- If AI may hand the action to a human: set presentation to enabled + needs-human, and do not describe it as prohibited.

For ManageBac import, set IR `exposed: false` so the matrix matches the tool registry, unless product wants the tool to run. `evaluatePlanPolicy` in `operations/policy.ts` must reject `aiAvailability === "prohibited"` before the plan is approved (today it only checks confirmation).

**Owner:** Commands. The run loop that calls `markExecuted` after `needs-human` is S9-AI: propose that `setup_bridge` is not journal-`executed` until the human finishes. Do not edit `act.ts` on main.

### P1-08 Forever-delete drops children after 20 and can resurrect an empty workspace

**User sees:** Permanently deleting a workspace with more than 20 children leaves some children. An empty workspace can come back from Trash.

**Where:** `dissolveWorkspaceNode` in `convex/orgTreeShared.ts` (batch of 20). `permanentlyDelete` in `convex/spectraWorkspaces.ts`.

**Fix:** Loop pages until no children remain, then delete the workspace row. Do not insert or restore a workspace node when the delete job finishes with zero children. If a cursor remains, the job is not complete.

**Test:** Workspace with 21 children, forever-delete, zero nodes left, no resurrected workspace. Existing batch test must still pass for one page.

### P1-09 A reader rename patches the owner’s title

**User sees:** A person with a personal copy of a node renames it and the owner’s artifact title changes.

**Where:** `orgTree.rename` / `renameNode`.

**Fix:** If the caller does not own the artifact, patch only that caller’s org-node title. Patch `artifact.title` only for the owner (or a caller with modify on the artifact, if that is the product rule). Document which one you pick in the test name.

**Test:** Reader rename changes the reader node only. Owner rename still changes the artifact title.

### P1-10 ManageBac resync rewrites an unlocked calendar task even when the hash is unchanged

**User sees:** A task the user edited is overwritten on resync even though the source hash did not change.

**Where:** `ensureTimetableProjection`.

**Fix:** If the incoming hash equals the stored hash, do not write the task body. If the task is unlocked and the user has edited it, do not overwrite unless the hash changed and the product rule is “source wins.” Default: unchanged hash means no write.

**Test:** Same hash, unlocked task with a local title, resync, title unchanged.

### P1-11 keep_overlay still refreshes locked planner fields

**Where:** `resolveConflict` for planner/ManageBac.

**Fix:** `keep_overlay` must not write locked fields. Refresh only the unlocked fields the choice allows.

**Test:** Locked field stays at the pre-conflict value after `keep_overlay`.

### P1-12 Saving class selection overwrites a renamed class workspace title

**Where:** `ensureClassWorkspace`.

**Fix:** If the workspace title was changed by a person (not equal to the last projected class name), do not replace it on selection save. Store the projected name separately if the UI needs both.

**Test:** Rename workspace, save the same class selection, title unchanged.

### P1-13 A later academic period duplicates the projection

**Where:** `sourceIdentityKey` / `ensurePlannerProjection`.

**Fix:** Include the academic period in the identity key, or update the existing projection for that class instead of inserting a second one. Do not leave two live projections for the same class and period.

**Test:** Second period creates one new projection and does not duplicate the first period’s row.

### P1-14 Class follow treats a missing selection row as follow

**Where:** `classFollowPolicy`.

**Fix:** No matching selection row means not following. Return a distinct “unknown” or “not following” value. Callers must not schedule follow from that value.

**Test:** Empty selection, policy is not follow.

### P1-15 Failed class load then Save clears every class

**User sees:** Classes fail to load. Save sends an empty selection without a revision and deselects everything.

**Where:** `school-data-shell.tsx`, `class-shelf-editor.tsx`.

**Fix:** If the load failed or the revision is missing, disable Save and do not POST. An empty selection is allowed only after a successful load that truly returned no classes, and it must send the revision the server expects.

**Test:** Load error, Save is not called. Successful empty load still saves with a revision.

### P1-16 Onboarding Continue on a load error stores skipped

**Where:** `class-shelf-onboarding.tsx`.

**Fix:** A load error must not write `classShelvesStatus: skipped`. Keep the error on screen and leave status unset so Continue can retry.

**Test:** Throw on load, Continue, stored status is not `skipped`.

### P1-17 Import HTTP says imported before commit

**User sees:** The client treats the import as finished while the job is `awaiting_commit` or the commit was deferred.

**Where:** `src/app/api/spectra/imports/route.ts`. `completedAt` is also set at `awaiting_commit` in `convex/artifactImports.ts`.

**Fix:** Response status string matches the job: `awaiting_commit` or `deferred`, not `imported`, until the job row is `imported`. Do not set `completedAt` until that terminal status. Callers that branch on `imported` or on `versionId` must handle `commitDeferred`.

**Test:** Route fixture with `awaiting_commit` does not return `imported`. `completedAt` is absent until `imported`.

### P1-18 Bibliography replaces the deck with one slide

**User sees:** Building a bibliography leaves only the references slide.

**Where:** `buildBibliographySlide` assigns `draft.slides` from the bibliography plan. The in-place API is `applyBibliographySlides`.

**Fix:** Call `applyBibliographySlides` so the references slide is added or updated in the existing deck. Do not replace `draft.slides` with the plan’s slide list.

**Test:** Deck with three slides, build bibliography, four slides (or three plus an updated references slide), original slides still present.

### P1-19 Calendar columns use the browser’s local day

**Where:** `dayKey` in `calendar-application.tsx`.

**Fix:** Bucket events with the school timezone, not `Date` local methods on the browser. A school in a timezone ahead of the browser must not show the event on the previous day.

**Test:** Fixed UTC instant, school timezone `Pacific/Auckland`, column key is that zone’s date. Do not depend on the machine timezone; pass a clock.

### P1-20 Changing minutesBefore leaves the old reminder, then cancels it

**Where:** `plannerReminders.reconcileArtifact`.

**Fix:** When `minutesBefore` changes, update the existing delivery’s fire time in the same write. Do not leave the old fire scheduled and then cancel the delivery.

**Test:** Change 10 minutes to 30, one delivery row, fire time matches 30, status is not cancelled solely because of the edit.

### P1-21 A library deep link treats the 60-item list as “not here”

**User sees:** Opening `/library/{id}` for a work outside the first page says it is unavailable and never fetches that id.

**Where:** Deep-link effect in `spectra-shell.tsx`. `spectraArtifacts.list` is capped (take a multiple of the limit, then `slice(0, limit)` with no continue cursor).

**Fix:** If the id is absent from the loaded page, call `get` for that id. Only show unavailable when `get` says missing or access denied. Do not infer absence from a capped list.

**Test:** Id not in the first 60, `get` returns the artifact, the studio opens.

### P1-22 A failed library search looks like no matches

**Where:** `GlobalSearch` catch in `context-controls.tsx`.

**Fix:** The catch path renders an error (“Search failed”) and a retry. It must not use the empty-results component.

**Test:** Reject the search request, assert the error copy, assert the empty-matches copy is absent.

### P1-23 Document hydrate is marked applied before the editor exists, and saves reuse the creation content

**Where:** `document-studio.tsx`. `useStudioViewportReady(Boolean(editor))` fires before `editor.isInitialized`. `onUpdate` / `onChange` closes over the content object from editor creation.

**Fix:** Acknowledge viewport ready only when `editor.isInitialized` is true (and the view exists, if that flag is the project’s definition of ready). Read the latest content from a ref inside `onUpdate`, not from the closure captured at `useEditor` time. Do not mark hydrate applied until that ready gate has passed.

**Test:** Editor object exists, `isInitialized` false, ready is not acknowledged. A content change after creation is what gets saved.

### P1-24 Slash commands delete the query even when nothing is inserted

**Where:** `slash-command-extension.ts`, `runDocumentCommand`.

**Fix:** If the command inserts nothing, do not delete the typed slash query, and do not report completed. Delete the query only after the editor transaction inserts the node. This includes dialog-first verbs that do not insert yet: `insert.link`, `insert.image`, `insert.reference`, and `insert.citation`. Those open a draft, a file picker, or a rail. If the person cancels, the `/token` must still be in the document. The work bar calls the same handlers without deleting text; do not add a delete there. Slash is mounted only in `document-studio.tsx` at this commit. The unused `SLASH_COMMANDS` fallback in `slash-command-extension.ts` has the same delete-then-run order; fix it in the same change so a later editor does not inherit it.

**Test:** Command returns without a transaction, slash text remains, outcome is not completed.

### P1-25 Failed local collaboration restore still connects and can mark an empty room durable

**User sees:** IndexedDB restore fails. The client connects anyway. An empty or server snapshot is treated as synced, and the offline branch can be dropped.

**Where:** `use-artifact-collaboration.ts`. `persistence.initialize().catch(() => undefined)` then `connect()`, then `markRemoteDurable()` when unsynchronized count is 0.

**Fix:** If initialize fails, do not connect as a fresh empty doc and do not call `markRemoteDurable`. Surface a restore error and keep the local pending flag. Connecting is allowed only after a successful restore or an explicit “discard local copy” choice.

**Test:** `initialize` rejects, `connect` is not called, `markRemoteDurable` is not called.

**Owner:** Collaboration client. Do not rewrite the gateway in the same change.

### P1-26 A cached modify permission survives a failed refresh

**Where:** `hocuspocus-transport.ts` authorization watch and token callback. `level` stays `modify` unless the error string matches the narrow revoke list in `auth-session.ts`. `canEdit` trusts that level.

**Fix:** On refresh failure, do not keep `modify`. Either hold writes until refresh succeeds, or set level to `read` / unknown. Only an explicit offline-recovery flag may keep local edits, and those must not be sent until a successful authorize. `onAuthenticationFailed` must clear `level`.

**Test:** Prior level `modify`, refresh returns a non-revoke 403, `transact` is refused.

### P1-27 A revoked public link keeps showing the last projection

**Where:** `public-share-shell.tsx`. Server `publicProjection` returns null immediately. The client keeps `state === "ready"` until the 15s poll, focus, or visibility refetch returns 404.

**Fix:** When a background refresh starts after the tab was hidden or on an interval, keep showing content only until the response. On 404, clear `projection` before paint of the error. Optionally refresh on an interval shorter than 15s while a share is open; the important part is clearing on 404 without waiting for the next interval if the owner action is visible in the same session. Do not cache the POST (`no-store` is already set).

**Test:** Ready state, next POST returns 404, UI is the unavailable state and the old title is gone.

### P1-28 A revoked session can still append

**Where:** `scripts/collaboration-gateway.mjs` `persistAcceptedMessages` / `appendWithRetry`. `beforeHandleMessage` authorizes, then the debounced persist does not authorize again.

**Fix:** Call the same reauthorize immediately before `appendWithRetry`. If it fails, do not append, and do not emit `durable_ack`.

**Do not:** Remove the 15s auth cache for the hot path if product needs it; the persist boundary is the one that must be fresh.

**Test:** Authorize succeeds, revoke, persist runs, append is not called.

**Owner:** Collaboration gateway. Propose if that lane is paused and mid-edit; the change is local to the persist function.

### P1-29 Native bootstrap and durable payload admission skip the school check

**Where:** `collaborationGatewayStore.authorize`, `append`, and `checkpoint` compare `actor.schoolId` to the artifact school. `bootstrapNative` and `requireDurablePayloadAuthority` do not.

**Fix:** Add the same school comparison to `bootstrapNative` and `requireDurablePayloadAuthority`. A cross-school actor that fails `authorize` must fail these two as well.

**Do not:** Remove the school check from `authorize`. Intentional cross-school shares, if any, need a separate explicit grant path; do not invent one here.

**Test:** Actor school B, artifact school A, direct grant otherwise allowed, `bootstrapNative` and `put` throw the same denial as `authorize`.

### P1-30 Removing a slide leaves hyperlinks to the deleted part

**Where:** `pptx-lens.ts` `remove-slide`. `cleanupSlideHyperlinkRelationships` runs for some edits and not for remove.

**Fix:** After `removeSlide`, walk remaining slides and remove `hlinkClick` relationships whose target was the removed slide. If a link cannot be retargeted, drop it. Do not return `deck.save()` bytes that still point at the removed part.

**Test:** Two slides, slide 2 links to slide 1, delete slide 1, saved package has no relationship to the removed slide.

### P1-31 Adding a slide drops images, charts, and tables

**Where:** `addNativeSlide` in `pptx-lens.ts` only writes `object.type === "text"`. `pptxOperationsBetween` still sends full `objects`.

**Fix:** Either write images, charts, and tables in `addNativeSlide`, or fail the operation with a coded error when a non-text object is present. Do not save a text-only slide and report success.

**Test:** `add-slide` with one image, saved slide contains that picture relationship, or the call throws and bytes are unchanged.

### P1-32 A library move leaves the Bridge replica on the old path

**Where:** `convex/replicas.ts` stores `relativePath` at link time (often the title). No org-move handler updates it.

**Fix:** When an org move or rename changes the library path or title that was used as `relativePath`, patch `workReplicas.relativePath` and any pending `bridgeWriteRequests.relativePath` for that work, or enqueue a local rename. Do not leave the Bridge targeting the old path while the library shows the new one.

**Owner:** Bridge lane if they are already editing `replicas.ts`. Otherwise this isolated change is the patch plus a test.

**Test:** Move the work in the org tree, replica `relativePath` matches the new path.

### P1-33 The header says Saved while changes are still queued

**Where:** `selectSyncTruth` in `src/features/spectra/bridge/status.ts` ignores `queuedChangeCount` on the online path unless dirty or transport is busy. `resource-surface.tsx` calls `useSyncPresentation` without queue inputs.

**Fix:** If `queuedChangeCount > 0`, the state is pending/queued, not `saved` or `synced`, and the chip stays visible. Pass `queuedChangeCount` from every caller that has it, including the resource surface when a queue exists.

**Test:** Online, replicas current, `queuedChangeCount: 2`, label is not Saved or Synced.

### P1-34 An invitation cookie sends sign-in to /join instead of the public share

**Where:** `src/components/signed-in-continue.tsx`. Join cookie is checked before `redirect_url`.

**Fix:** If `redirect_url` is `/public` (or any non-join path the share flow set), go there. Use the join cookie only when there is no `redirect_url` or the redirect is already `/join`.

**Test:** Cookie set, `redirect_url=/public`, navigation is `/public`, not `/join`.

### P1-35 Palette folder create always inserts; AI reuses the same name

**Where:** Human: `library-organizer.tsx` `createFolder`. AI: `act.ts` `organize_library` searches and returns `reused: true`.

**Fix:** On the human path, search the same parent for the same name. If found, select that folder and say it already exists. Do not insert a second sibling. Keep the AI search. `act.ts` is S9-AI: do not edit it unless the human path is the one being aligned.

**Test:** Folder “Notes” exists, palette create “Notes”, one node, message is not “created.”

### P1-36 Settings toggle updates only the settings page

**User sees:** The settings switch moves. The command bar keeps the old preference for up to ~180s.

**Where:** `useSpectraPreferences` in `preference-store.ts` is per component. It emits `settings.changed` and nothing subscribes. AI `change_spectra_settings` writes Convex and does not push the patch into open hooks (S9-AI proposal: client should apply the patch from the run event).

**Fix:** One shared store (or a subscriber on `settings.changed`) so every mounted hook applies the same patch in the same turn. Do not wait for the idle refresh.

**Test:** Two hook instances, toggle on the first, the second returns the new value without a timer.

### P1-37 Opening a work from a library URL times out readiness

**Where:** `routeTarget` in `universal-kbar.tsx` maps `/library/{id}` to view `library`. The studio acknowledges view `artifact`. `viewport-readiness-mount.tsx` does not ack detail URLs. `thread_reference` never acks.

**Fix:** A URL that opens a work must request and acknowledge `view: "artifact"` with that work id. List `/library` stays `view: "library"`. `thread_reference` must ack when its empty or ready state is shown, including when there is nothing to edit.

**Test:** `openRoute('/library/work-1')` completes ready when the studio acks `{ view: "artifact", targetId: "work-1" }`. It must not time out.

### P1-38 Removing an embed deletes the server row, then the document reference can fail

**Where:** `removeEmbed` in `artifact-embeds-panel.tsx` calls server `remove` first, then `reference.remove`. Create rolls back the server row if insert fails. Remove does not.

**Fix:** Remove the editor reference first. If that throws, do not call server remove. If server remove must stay first, compensate by restoring the embed when `reference.remove` throws. The user must not see an error toast while the row is already gone and the host is still mounted.

**Test:** `reference.remove` throws, embed row still exists, toast is the failure, host still has the same embed id.

### P1-39 The live dock shows a run as working after the card is terminal

**Where:** `readTabRunSummary` in `convex/spectraRuns.ts` can return the embedded `tab.runSummary` from `beginRun`. `updateStatus` and `stopRun` patch the card and do not refresh that summary. `legacyTabRunFallback` defaults status to `completed` when the run doc is missing.

**Fix:** When the card or run row is terminal, the tab summary status must be that terminal status. Do not serve the begin-run snapshot over a newer card. Missing run doc must not default to `completed`; use `unknown` or omit the tab.

**Test:** Card `failed`, tab summary from `listTabs` is `failed`. Missing run does not yield `completed`.

### P1-40 A failed run is labeled “Completed with limits”

**Where:** `live-dock-model.ts`. `traceDegraded` or `phase === "partial"` maps to `completed_limited` even when run status is `failed`.

**Fix:** `failed` stays a failure label. `completed_limited` is only for status `completed` with a degraded trace. `failed` + retryable can stay “paused” only if that copy does not say completed.

**Test:** `{ status: "failed", traceDegraded: true }` does not use the completed-with-limits string.

### P1-41 A planner reminder still links to a work the person cannot open

**Where:** `loadPlannerReminderNotifications` in `convex/plannerReminders.ts` does not check access or artifact status. Timetable and comment loaders do. UI links to `/library/{artifactId}` in `app-shell.tsx`. Delivered rows are not cancelled when the artifact is deleted (only pending rows are).

**Fix:** Use the same access and active-artifact checks as the timetable loader. Omit rows the recipient cannot read. On artifact delete, cancel or drop delivered planner rows in the deletion job the same way comment notifications are removed.

**Test:** Delivered reminder, revoke read, `listMine` does not include it.

### P1-42 Linked Word export omits unsaved editor text

**Where:** `document-studio.tsx` docx branch POSTs `download-copy` by artifact id when `nativeBinding.format === "docx"`. Non-linked export uses `editor.getJSON()`.

**Fix:** If the editor is dirty or has local unsynchronized changes, export from the editor snapshot (or flush the save and then download). Do not download the server copy over unsaved text. If flush fails, show the error and do not start the download.

**Test:** Dirty editor with a new sentence, export bytes contain that sentence.

### P1-43 Sheet replace-all is a no-op that still succeeds

**Where:** `find-replace.ts` calls `replaceAll?.()` when params are true. Sheets adapter has `toggleReplace` and no `replaceAll`, so the call is a no-op and `executeCommand` returns true.

**Fix:** Implement `replaceAll` with `replaceInCells` for the found range, or do not register `navigate.replace` for a true replace-all on sheets. Zero matches must return a not-changed outcome, not completed. Document replace-all with zero matches has the same outcome rule (P1-05).

**Test:** Sheets command with `params: true` either replaces the cells or returns not-handled. It must not return success with zero writes.

### P1-44 Confirm can save a partial failure and then return a generic error

**Propose only (S9-AI).** `resumeOperationsAttempt` in `src/app/api/spectra/run/runtime.ts` can `updateStatus(failed)` with `preservedPartial` and then rethrow. The NDJSON wrapper emits `{ type: "error" }` without the card. The primary `runAttempt` catch includes the card.

**Fix:** On that catch, emit the error with the same card payload as `runAttempt`, including the partial summary already written. Do not rethrow into the generic wrapper after the row was updated.

**Test:** Second operation throws, stream error includes the card, row is `failed` with `preservedPartial`.

### P1-45 Region conflict on confirm ends the stream while the run stays running

**Propose only (S9-AI).** Same function returns on `AiArtifactRegionConflictError` without `updateStatus` and without a terminal NDJSON event. The primary path sets `awaiting_resolution` and emits `conflict_resolution_required`.

**Fix:** Use that same status update and event on the confirm/resume path.

**Test:** Conflict on resume, row is `awaiting_resolution`, stream includes the conflict event.

### P1-46 Attachment save fails after the run exists, and the 409 hides the run

**Propose only if `runtime.ts` is S9-AI-owned; otherwise implement.** `beginRun` commits, `persistRunAttachments` throws, response is 409 plain text with no `runId`.

**Fix:** Include `runId` and `executionId` in the 409 body. Do not leave the client unable to stop or open the run that was created.

**Test:** Attachment persist throws, status 409, body contains the run id, row exists.

### P1-47 ManageBac resource import is allowed in the capability matrix and prohibited at execution

**Where:** `capabilities/application.ts` `app.managebac.import-resource` `exposed: true`. Tool registry `import_managebac_resource` `aiAvailability: "prohibited"`.

**Fix:** Set IR `exposed: false` so merged `aiAuthority` is prohibited, matching execution. Also make `evaluatePlanPolicy` fail closed on prohibited tools (P1-07).

**Test:** Merged command `aiAuthority` is `prohibited`. A plan containing that command is not approved.

### P1-48 A closed studio stays in the context picker

**Where:** `context-source-boundary.tsx` calls `contextSourceRegistry.register` and does not return the unregister function from the effect.

**Fix:** `return () => unregister()` from the effect (the register call already returns it). Unmount and dependency change must remove the entry before the next paint’s picker read.

**Test:** Mount, unmount, `listEligible()` does not contain that work id.

### P1-49 Picking a reference closes before the insert finishes

**Where:** `viewport-context-picker.tsx` uses sync `spectraBus.command("reference.insert")`. The document handler is async (`artifactEmbeds.create` then TipTap). The dialog closes immediately. `command()` returns a listener count.

**Fix:** Use `commandAsync` / `commandAsyncResults` and close the dialog only after a successful outcome. On failure, leave the dialog open and show the error.

**Test:** Handler promise rejects, dialog still open, no success close.

### P1-50 Quiz practice says answers are synchronized while text is only local

**Where:** `quiz-studio.tsx`. The badge shows when `practiceSyncing` is empty. Short and long answers call `saveSpectraQuizPracticeResponse` on blur, not on each change.

**Fix:** Compare local `answers` to the last saved responses. If a focused field differs, the badge is “Not saved yet,” not synchronized. Keep the submit flush. Do not block timer submit; the flush loop should still run, and the badge must not claim success before it finishes.

**Test:** Type in a long response without blur, badge is not the synchronized string. After blur and a resolved save, it is.

### P1-51 Recent and Favorites still open a deleted or unavailable work

**Where:** `openNode` in `library-organizer.tsx`. Links check `target.available`. Work rows do not check `source.available`. Quick view does not filter unavailable sources. `available` is `status !== "deleted"` and ignores revoked grants (projection nodes are kept on purpose).

**Fix:** If `source.available === false`, do not call `onOpenWork`. Toast the same unavailable copy as the deep link. For revoked grants, either stop projecting those nodes into Recent/Favorites or set `available` from the access decision, not only from deleted status. Prefer filtering them out of the hunt lists.

**Test:** Deleted source, Enter on the row, `onOpenWork` not called.

### P1-52 requireActor can return the previous school for 30 seconds

**Where:** `src/lib/auth-server.ts`. `ACTOR_IDENTITY_TTL_MS` is 30s. `requireActor()` without `fresh` returns the cached `schoolId` even after `identity:me` would now be null. The proxy only checks Clerk `userId`.

**Fix:** On `identity:me === null`, clear that clerk id from the cache before throwing `AUTH_NO_SCHOOL`. Do not return a cached actor after a failed fresh read. School-scoped route handlers should pass `fresh: true` after membership mutations. Do not treat the proxy as a school gate; the actor helper is the gate.

**Test:** Cache filled, next `identity:me` returns null, `requireActor()` throws and a following call does not return the old school.

### P1-53 Cookie consent can look saved when storage failed, and settings cannot be reopened

**Where:** `writeConsentState` in `src/lib/consent.ts` swallows `setItem` errors. `persist` in `cookie-consent-manager.tsx` still `setConsent` and hides the banner. The configure control is inside the banner. Nothing dispatches `ai-school:open-cookie-settings`. The cookie policy page promises a persistent control.

**Fix:** If `writeConsentState` returns false, keep the banner and show a save error. Do not update React state to “saved.” After a successful save, leave a control (footer or the legal cookies page button) that opens the same dialog via that event.

**Test:** `setItem` throws, banner remains. After a successful reject, a settings button opens the dialog again.

### P1-54 Ending a membership leaves invites, class follows, pins, and notifications

**User sees:** An admin ends someone’s membership. A pending invite for that email can still be accepted. Old class-follow selections, pinned library nodes, and delivered notifications are still there if the person is invited back. There is no self-leave action, while `acceptInvitation` tells a person who already belongs to another school to leave first.

**Where:** The only production write that sets `schoolMemberships.status` to `ended` is `changeMember` in `convex/administration.ts` (about lines 723–728). It patches that row and writes an audit event. `convex/memberships.ts` exports `acceptInvitation`, `previewInvitation`, `listMine`, `searchSchoolMembers`, and `invite`. It has no `leave`. The hygiene that does exist is inside `invite`: before inserting a new invite it revokes pending `membershipInvitations` for the same school and email (about lines 314–326). Nothing like that runs on end.

**Failure:** After `ended`, these stay unchanged: pending `membershipInvitations` for that email and school; `managebacClassSelections` with `selected: true`; pinned `orgNodes` and `spectraThreads`; notification delivery rows (`schoolAnnouncementDeliveries`, `plannerReminderDeliveries`, `timetableReminderDeliveries`, `artifactCommentNotifications`). `listMine` then throws `AUTH_NO_SCHOOL`, so the person does not see them until a later membership. School purge deletes many of these tables. Member end does not. Direct grants are P1-02 and must be revoked in the same mutation.

**Fix:** In the same mutation as the membership patch, for that `accountId` and `schoolId`:

1. Revoke pending `membershipInvitations` whose normalized email matches the member, using the same patch `invite` already uses (`status: "revoked"`, `revokedAt`, `updatedAt`).
2. Revoke live direct `accessGrants` (P1-02).
3. Set class selections for that account and school to not selected, or delete them. Do not leave `selected: true` for a school the person has left.
4. Unpin org nodes and threads that belong to that school. Do not delete the person’s nodes in other schools.
5. Cancel or omit notification deliveries that target that account inside that school. Reuse the access filter from P1-41 so a restored membership does not resurrect a link to a work they can no longer open.

Do not add a self-leave mutation in this ticket unless product asks for it. If you add one, it must call this same cleanup. Until then, change the `MEMBERSHIP_SINGLE_SCHOOL` copy so it does not tell the person to leave when no leave action exists.

**Do not:** Run school purge for one member. Do not delete their account, their work in another school, or already imported library artifacts.

**Test:** End a member who has a pending invite, a selected class, a pin, and a delivered planner reminder. Invite status is `revoked`, selection is not selected, pin is not live, reminder is absent from `listMine` after they rejoin without those rows being recreated. A pin in another school is unchanged.

**Owner:** Identity. [Membership cleanup after leave](729d9acf-317e-4b11-868b-69f19c99481f).

### P1-55 After ManageBac disconnect, AI still treats the school data as connected

**User sees:** An admin disconnects ManageBac. The School page shows not connected. A later AI turn can still read the old rows and is told the integration is connected.

**Where:** `managebac.disconnect` in `convex/managebac.ts` sets the integration `status` to `revoked`, cancels active runs, and patches `externalRecords` to `sourceState: "removed"` while leaving `tombstone: false`. `recordsForPurpose` checks that an integration row exists, filters `!tombstone`, and returns `connected: true`. The run loop in `src/app/api/spectra/run/loop/plan.ts` calls `recordsForPurpose`. The School UI uses overview, which nulls a revoked integration. `beginResourceImport` already refuses new imports when revoked.

**Fix:** `recordsForPurpose` returns `connected: false` and an empty record list when the integration is missing or `status === "revoked"`. Do not return rows with `sourceState: "removed"`. Already imported library artifacts stay; that retention is intentional. `plan.ts` is on the AI path: if S9-AI is editing it, change only `recordsForPurpose` and let the planner read the new shape.

**Do not:** Tombstone every imported artifact on disconnect. Do not hide the School empty state.

**Test:** Disconnect, then `recordsForPurpose` is `connected: false` and `records` is empty. A non-revoked integration with live rows is unchanged.

**Owner:** ManageBac. [Non-ManageBac integrations](eabb3a72-2671-4a9f-8cda-c04fb2eddaea). The `integrations/` folder is a contract and badges only. There is no second provider.

### P1-56 A whiteboard style patch replaces the object, and verify still says it matched

**User sees:** An AI recolor or reshape reports Updated. Grouped objects ungroup. Borders, font size, lock, and embed ids disappear. A connector can vanish because normalize then drops an edge whose endpoints no longer exist.

**Where:** Human inspector in `whiteboard-studio.tsx` merges with `{ ...node.style, fill }` and then `normalizeWhiteboardContent`. AI apply is `applyResolvedContentPatch` in `src/features/spectra/ai/document-content-patch.ts`, which assigns the patched value in place. `authoredObjectFieldsMatch` in `content-patch-verify.ts` compares only the fields the model wrote. `verify.ts` `contentPatchChangeMatchesSaved` uses that subset match. `act.ts` does not add a second merge; fixing apply and verify is enough. Replacing the entire `/nodes` array is the already-filed sibling wipe (P2-09). This ticket is `/nodes/N` and `/nodes/N/style`.

**Failure:** The model sends `{ path: "/nodes/2", value: { id, type, content, style: { fill } } }` or `{ path: "/nodes/2/style", value: { fill } }`. Apply replaces the node or the style object. Fields the human had set (`parentId`, `stroke`, `fontSize`, `embedId`, `locked`) are gone. Verify sees that the authored fill equals the saved fill and marks the change matched.

**Fix:** On whiteboard apply, deep-merge `style` into the existing style object. Do not replace a node when the value is a partial object. Reject a whole-node value that omits keys the saved node has, unless the operation is an explicit delete. For `blueprintKey === "whiteboard"`, fail verify when the saved object had keys the authored value dropped. Group and ungroup stay human-only until a patch can write the group node and the children’s `parentId` in one change; a partial node write must not clear `parentId`.

**Do not:** Edit `act.ts` on main while S9-AI is live. Do not allow `/nodes` root replace as a workaround.

**Test:** Node with `style: { fill, stroke, fontSize }` and `parentId`. Patch `/nodes/N/style` to `{ fill: "#f00" }`. Stroke, font size, and `parentId` remain. Verify fails if the saved style lost `stroke`. There is a leaf `/style/fill` test in `whiteboard-content-patch.test.ts`. This case is not covered.

**Owner:** Propose only for the verify and apply files if S9-AI is editing them. [Whiteboard page patches](c6e39468-8bfb-4384-b948-0821bf2bc8f3).

### P1-57 One recolor prompt paints every color onto a single node

**User sees:** The person asks to recolor two objects. One object receives every color from the batch. The other does not change.

**Where:** `remapWhiteboardRecolorChanges` in `src/features/spectra/ai/whiteboard-content-patch.ts`, called from `plan.ts` when the blueprint is `whiteboard`.

**Failure:** The prompt matches the recolor regex and a title hint. `targetIndex` is fixed for the whole batch. Every `/nodes/*/style/*` color write is rewritten to `/nodes/${targetIndex}/style/...`, including paths that had already resolved to different indexes.

**Fix:** Remap only a change whose path did not already resolve to a node index. Never rewrite a path that already names a different index than `targetIndex`.

**Do not:** Change `plan.ts` on main if S9-AI owns that file. The remap function itself is the fix.

**Test:** Two changes, `/nodes/0/style/fill` and `/nodes/1/style/fill`, plus a title hint for node 0. After remap, node 1’s path is still `/nodes/1/style/fill`. No multi-node test exists today.

**Owner:** Propose only if `plan.ts` must change. The helper can be fixed and tested without the planner.

## P2 tickets

These are real, but they are either narrower, owned by another lane, or not fully proven. Implement only after the P1 in the same flow, or leave them as proposals when marked.

### P2-01 Citation edit drops sourceRef

`edit-word-citation` in `document-academic-operations.ts` keeps `sourceRef` only when `JSON.stringify(source)` is unchanged. The document UI rebuilds `source` on save, so a title edit strips the handle and `writeCitationMapping` deletes the XML. **Fix:** Copy `sourceRef` from the old citation unless the user cleared the source. **Test:** Edit pages only, `sourceRef` remains.

### P2-02 Footnote insert skips nativeBinding

Human footnote insert writes the editor node without `nativeBinding`, so a later note can reuse an orphan Word id. **Fix:** Insert through the same reducer path that records `nativeBinding.wordNotes`. **Test:** Insert footnote, binding contains the new id.

### P2-03 Open readiness, late hydration, URL close

Page shells never ack `requestViewportAction` for some artifact opens. A late `openArtifactById` can open the previous id. Clearing the URL calls `closeStudio` with no dirty check. **Fix:** Ack when the studio is ready; ignore responses whose navigation generation is stale; confirm dirty on URL close the same way as the close button.

### P2-04 Code export uses React state that lags Yjs

Inactive files in the code artifact export from React workbook state, not the Yjs doc. **Fix:** Read the Yjs snapshot for every file at export time.

### P2-05 Cached-only sheet numbers stay on screen after they are marked stale

Sheets set `cachedValueStale` and still display `value`. The lens does this on purpose until save, then strips `<v>` so reopen shows null. **Fix:** When `cachedValueStale` is true, show the stale treatment (or blank), not the old number as current. Do not change the native strip-on-save behavior.

### P2-06 Quiz allowResume false still consumes the attempt

The in-progress attempt is hidden and still counts toward the limit, so the learner can be stuck. **Fix:** Either show resume, or do not count a hidden in-progress attempt, or discard it when resume is disabled. Pick discard-on-start only if product wants a fresh attempt.

### P2-07 Flashcard review id is a new token per click

`review-${uniqueToken()}` in `flashcard-studio.tsx`. A retry after a lost response schedules a second review. **Fix:** Mint `clientReviewId` once per rating gesture and reuse it for retries. Honor `reused` from the server.

### P2-08 Quiz submit flush remints mutation ids

`quiz-studio.tsx` uses a new `crypto.randomUUID()` on flush. **Fix:** Persist the id used for the first save of that question and send the same id on flush and retry.

### P2-57 Document block delete and reorder are not patch operations

Human `moveBlock` and block delete in `document-studio.tsx` have no JSON-patch remove. AI can only replace or append `/blocks/-`. Replacing a whole block drops bold and named styles while text verify can still pass, because verify checks text containment. `applyResolvedContentPatch` also deletes `tiptap` when any change touches `/blocks`. `remapDocumentSectionRewriteChanges` drops a change when the section text is empty or the heading does not match. **Fix:** Add an explicit block remove. Merge block objects the way sheet cells merge, and keep formatting keys the model did not mention. Rehydrate or keep `tiptap` after a block touch. Do not treat text containment as proof the block is unchanged. **Test:** A bold block patched with the same plain text stays bold. A delete pointer removes one block and leaves its siblings. Section remap does not drop a change that still has text. **Owner:** Propose only, S9-AI. [Whiteboard page patches](c6e39468-8bfb-4384-b948-0821bf2bc8f3).

### P2-09 Document subset verify and whiteboard node replace (propose only, S9-AI)

`/blocks/N` subset verify can pass after fields drop. `/nodes` replace plus subset verify can drop siblings. **Fix:** Verify must fail when declared fields are missing. Do not edit those verifiers on main while S9-AI is live.

### P2-10 Stop does not cancel in-flight tools; durable poll advances before a bad payload parses (propose only, S9-AI)

**Fix:** Stop aborts the in-flight tool batch. Do not advance the durable cursor until the payload parses.

### P2-11 Collaboration revoke does not stop Convex side writes already in flight (propose only, S9-AI)

**Fix:** The write path re-checks policy version and stops after revoke. Pair with P1-28.

### P2-12 finalizeUpload requires candidateStorageId which beginUpload never sets

May be a dead path. **Fix:** Either set `candidateStorageId` in `beginUpload` or remove `finalizeUpload` if nothing calls it. Confirm call sites before deleting.

### P2-13 Library resource upload skips validateResourceUploadFile

**Fix:** Run the same validator the other upload entry uses before accepting the file.

### P2-14 Rehearsal apply writes a normal membership

**Fix:** Mark rehearsal memberships so restore can find the same id. Do not convert a rehearsal into a permanent member without an explicit confirm.

### P2-15 replace-paragraph can omit inlineContent

`docxOperationsBetween` emits a plain replace when text moved and rich semantics look unchanged, which can drop revisions, equations, and comment boundaries. **Fix:** Include `inlineContent` whenever the rich inline list differs, not only when plain text differs.

### P2-16 Native promotion keys only id plus text

`nativeLiveContentKey` ignores bold, equations, and tables, so those edits skip materialize. **Fix:** Include a hash of inline marks and non-text children in the key.

### P2-17 completeWrite can verify without a native receipt

**Owner:** Bridge lane. **Fix:** `verified` requires the native receipt binding, not only a matching revision hash. Do not take the Bridge queue if that lane is mid-change.

### P2-18 Deletion job complete while the artifact row remains

`processArtifactPage` returns `done` when retention blockers exist, and `process` marks the job complete. **Fix:** Job phase stays `retained` until the row is gone or the product explicitly has a retained-complete status that the UI does not treat as deleted.

### P2-19 One client id can hold two overlapping active region claims

`acquire` in `convex/regionClaims.ts` skips the conflict check for the same `clientId`. **Fix:** Overlapping domains conflict even for the same client. Same region id may still refresh.

### P2-20 Chart workbook update swallows errors

`updateEmbeddedWorkbook` empty catch, then `deck.save()`. **Fix:** Surface the error and do not save a chart whose workbook failed to update.

### P2-21 Native ack retries never refresh the claim lease

`retry_native_ack` reuses the original generation and token. **Owner:** Bridge. **Fix:** On lease rejection, refresh or stop retrying. Do not write the file again.

### P2-22 Trust presets apply without a paired device

`bridge-settings.tsx` applies account trust when signed in, not when Bridge is paired. **Fix:** Managed-copy and native-sync presets that require a folder stay disabled until a mount exists.

### P2-23 Durable read URL has no reader lease

`artifactContent.read` returns `getUrl`, then a later `release` deletes storage. **Fix:** Do not delete storage that was URL-issued until the grace window (`PAYLOAD_RELEASE_GRACE_MS`) has passed since the last read, or document that URLs are short-lived and expire them at the storage layer. Do not add a long-lived public URL.

### P2-24 Snapshot refcount drift

`releaseSnapshotObject` recounts from version indexes. A delete that skips it can purge early. **Fix:** Every version-row delete calls `releaseSnapshotObject`. Add a test that deletes a version without the helper and expects the maintainer not to purge if you cannot guarantee the call; better to make the helper mandatory at the delete site.

### P2-25 Preference writes are last-write-wins, and sign-out leaves memory

`writeLayer` merges with no revision. Sign-out clears `localStorage` and not React state. Migration can write the startup cache over a newer edit. **Fix:** Send a revision or updatedAt and reject stale writes. On `userId` change, reset hook state to defaults before the next account hydrates.

### P2-26 AI settings copy says updated while the page is stale

Propose only for the run message. The client half is P1-36. Do not say “now active” until the client patch is applied.

### P2-27 prebuild does not run product tests; unpaired Bridge is “ready”

**Owner:** Release. **Fix:** Do not treat `probeBridgeReadiness` unpaired as product-ready. Keep `prebuild` secret and capability gates; do not claim the harness whitelist is the product suite. No test-assertion weakening.

### P2-28 Use live source after the source is deleted

Pinned embed, version gone, source deleted: the button calls `update` to live, which still requires read on the deleted source. **Fix:** Hide the button when the source is deleted, or retarget the pin to a surviving snapshot without requiring live read.

### P2-29 Calendar pageComplete and result-card backfill can finish early

`pageComplete` is the current page, not the whole migration. Result-card backfill can set complete while a cursor remains. **Fix:** `complete` only when the cursor is null and `isDone` is true.

### P2-30 Memory list shows a claim the model will not use

`listMine` uses `canReadClaim` only. `contextForRunBase` also requires current evidence. **Fix:** Use the same evidence check in the privacy list, or label the row “not used in runs.” `private_global` staying after a school change is a product decision: if school facts must not survive, stop writing school content into `private_global`.

### P2-31 Missing run defaults the dock to completed

Covered by the fallback half of P1-39. Implement there.

### P2-32 Agent publish notice when the release list refetch fails

`agent-foundry.tsx` sets the notice even when `getSpectraAgentReleases` throws. **Fix:** Only announce the release after the list contains the new id, or merge the mutation result into local state.

### P2-33 Library reference “filed” when the link already exists

`createLinkNode` returns the existing node. The organizer says created. **Fix:** Return `created: false` and say the reference is already filed.

### P2-34 Token meters count failed runs and retries

`recordRunModelMeters` runs for completed, failed, and cancelled. A retry uses a new `executionId`, so meters add. **Fix:** If the product metric is “completed work,” sum only `completed`. Document retry stacking if the metric is “tokens spent.” Do not double-count the same `executionId`.

### P2-35 Analytics filter after a 2000-row cap

Deleted rows consume the cap before the filter. **Fix:** Filter in the index query, or keep scanning until 2000 kept rows or the index ends. Partial state must stay visible when the cap binds.

### P2-36 Workbench resolve hides a missing comment

`setResolved` throws `COMMENT_NOT_FOUND`. The workbench inspector has no catch. **Fix:** Toast the same error the studio panel toasts.

### P2-37 Scheduled callback `{ completed: true }` after a failed run

Propose only, S9-AI. **Fix:** `completed: true` only when the run row is terminal and the callback’s job finished. A failed preflight must not use the same flag as success. Return `runStatus` beside it.

### P2-38 Materialize returns 200 when the queue state is failed or already verified

Upload can finish, then `queueMaterialization` returns an old `failed` or `verified`, and materialize still returns 200. Reconcile rejects non-`pending`. **Fix:** Use the reconcile rule on materialize: non-pending after this request’s upload is an error unless the state is a new `pending` you just inserted. Do not report saved for `failed`.

### P2-39 Connector secret readable by any active member

`readEnvelopeForSchoolUse` checks membership, not admin. **Fix:** If the product rule is admin-only, require `school_admin` (or the operator manage session) on the use path. If any member may run the connector, document that and leave the code. Default proposal: require the same role as `readEnvelope` for `managebac-api-token`.

### P2-40 Omitted change-group commit looks like a full save

`commitChangeGroup` rebuilds omitted snapshots from the live artifact and returns `committed` with no flag. Human commits wait on projection; AI and restore do not. **Fix:** Include `rebuiltFromLive: true` on the result. Do not advance `currentVersionId` when the rebuilt before and after are equal unless the group is explicitly abandoned and the client is told. Do not weaken `hasPendingProjection`.

### P2-41 Superseded snapshot verify leaves the room compacting

Corrupt sets the room `active`. Superseded only patches the snapshot row. **Fix:** Set the room `active` on superseded as well, matching corrupt.

### P2-42 spectraBus.command does not wait

`global-route-workbench.tsx` awaits `command()`, which returns a listener count. **Fix:** Await `commandAsync` for open and thread-ready. Same class as P1-49.

### P2-43 School purge never deletes artifactUserStates

The table is listed in `PURGE_DEPENDENT_TABLES` but `rowBelongsToPurgedSchool` has no branch and returns false. **Fix:** Match on `schoolId` like the other school-scoped tables.

### P2-44 Duplicate quiz or deck aliases the original’s asset ids

`duplicateCurrentArtifact` copies `artifact.content` verbatim. Asset rows stay on the original. Deleting the copy does not free the original’s bytes. Deleting the original’s assets breaks the copy. **Fix:** Deep-copy asset rows onto the new artifact id, or strip asset ids and show them as missing. Do not share `spectraContentRef` (create already rejects that).

### P2-45 Worker tests inject an epoch the deployed room does not set

`room-core.test.ts` passes `{ permissionEpoch: 4 }`. `workers/collaboration/src/room.ts` constructs `RealtimeRoomCore` with no epoch, and the check then no-ops. Tests never import `worker.ts`. **Fix:** Construct the test room the way `room.ts` does, and set `permissionEpoch` on the durable object when the server bumps it. A stale token must fail that test.

### P2-46 Follow keeps moving after the leader is gone

Follow AI does not clear on run terminal. Human follow does not clear when the client id leaves presence. **Fix:** Disengage when the followed id is absent from presence, and disengage AI follow on run `final` / `stopped` / `error`. Clear AI location on that terminal. `resumeFollow` must no-op if the person is gone.

### P2-47 Cloudflare synchronized while local edits are queued

`CloudflareRealtimeProvider` can leave `state: "synchronized"` while `unsynchronizedChanges > 0`. Default provider is Hocuspocus. **Fix:** `state` is `synchronized` only when the pending queue is empty. Consumers must keep using `unsynchronizedChanges` as well (P1-33).

### P2-48 Quality pass after realization drops fields

Propose only, S9-AI. `prepareArtifactContentForQuality` can drop layout fields and still pass at score ≥ 80 with majors. **Fix:** Dropped required geometry is a blocker, or score the raw payload before realization.

### P2-49 Health HTTP 200 when the body says not ready

`/api/health` always returns 200. Probes are shallow (`/instance_name`, gateway status). **Fix:** Keep the JSON contract. Document that clients must read `status`. Do not treat HTTP 200 as ready in `probeWebReadiness` without reading the body. Optional: return 503 when aggregate status is `not_ready` if no caller depends on 200. Check local scripts before changing the status code.

### P2-51 A ManageBac capability run says completed while later classes are still syncing

`commitNormalizedPage` sets `externalSyncCapabilityRuns.status` to `completed` when that page has no `nextCursor`. The route then loops the next class or year-group binding. `completeSync` only repairs runs still `queued` or `running`, so the early `completed` row stays. The parent sync run stays `running` until the end, so this is the capability row, not the whole sync. **Fix:** Mark the capability run `completed` only after every route binding for that capability has been committed. A page with no cursor in the middle of the fan-out stays `running`. **Test:** Two class bindings, first binding’s last page, capability status is still `running` until the second binding commits. **Owner:** ManageBac. [Non-ManageBac integrations](eabb3a72-2671-4a9f-8cda-c04fb2eddaea).

### P2-52 lastSuccessAt is never written

`integrationCapabilities.lastSuccessAt` is read in `convex/managebac.ts` and never patched on a successful sync. `school-data-shell.tsx` `stateFor` treats a missing timestamp as partial coverage when records exist. **Fix:** Set `lastSuccessAt` when that capability’s run actually finishes (after P2-51, not on the first class). **Test:** Successful sync, `stateFor` is `available` when records exist and the timestamp is set.

### P2-53 Duplicate does not copy artifact links

`duplicateCurrentArtifact` and `spectraArtifacts.create` insert a new artifact and a tree node. They never read `spectraArtifactLinks`. The copy opens with no relations; the original keeps them. Move is not this bug: `moveNode` changes parent and order only, and link rows correctly keep the same artifact ids. Delete does remove link rows in `processLinksPage`, asynchronously; until that page runs, `hydrate` returns null and the studio draws nothing. There is no click-to-open on those rows. **Fix:** After the new artifact id exists, copy link rows that name the source, rewriting the copied side to the new id. Do not copy a link whose other side is the source itself into a self-loop unless the product wants that. Skip `spectraContentRef` (create already rejects it). **Test:** Original linked to work B, duplicate, the copy lists B and the original still lists B. **Owner:** Library. [Links after move](a55fa0c3-c91f-4bd7-a5e4-a13f95b3b49e).

### P2-54 Presentation export swaps a generic font and stays silent

Canvas text uses `presentationFontFamily`, which can keep `serif` or a CSS stack. Export and native sync call `normalizeNativeFontFamily` (`serif` becomes Times New Roman, `sans-serif` becomes Arial, missing becomes the theme then Arial). The success message mentions slides, embeds, and motion, not fonts. Word `docx-lens` throws `DocxLensError` on an unsafe name instead of swapping. **Fix:** If the exported typeface differs from the canvas family, say which family was written in the export message. Do not silently change the canvas. Do not make Word start swapping. **Test:** A run whose family is `serif` exports Times and the message names that substitution. [Office fonts and slash](ebb393f6-f009-4eb5-9966-74eaac579ee5).

### P2-55 Quiz and flashcard rows outlive the work, and the study timer is an orphan that lies about sessions

`spectraArtifactDeletion` never sweeps `flashcardStudyStates`, `flashcardStudyReviews`, or `quizPracticeAttempts`. School purge lists those tables. Forever-delete of a deck or quiz can leave the attempts. There is no achievement grant at this commit; `src/lib/achievement-rules.ts` has no callers. Do not build a badge on top of these rows until deletion sweeps them.

`src/components/study-timer.tsx` is not imported. It POSTs `/api/gamification/timer`, and that route does not exist. On restore, if a running work phase already ended, it increments `completedSessions` in `ai-school-study-timer-v2` and does not append `ai-school:timer-sessions` or call the server. A failed POST is swallowed and the toast and counter still advance. **Fix:** Do not mount this component until restore writes the same session row the live completion writes, and until a failed POST does not increment the counter. If you delete it as dead, delete the unused achievement rules with it only after confirming no dynamic import. **Test:** If the component stays, a persisted timer whose `phaseEndAt` is past does not increase `completedSessions` without an appended session row.

[Study timer achievements](7932e2ff-7704-44a4-b15c-14729194807a).

### P2-56 A missing schoolId is treated as owner access

`evaluateLoadedResourceAccess` comments say same-school ownership. The condition is `(!loaded.schoolId || loaded.schoolId === actor.schoolId) && owner`, so a resource with no school grants the owner modify with no grant scan. `requireArtifactCapability` itself loads `lifecycle` from the row, so it does not currently pass a stale lifecycle. A future caller of the preloaded API could. Cross-school read with a stale direct grant is P1-02, reached through this helper from 19 modules; do not file it again. **Fix:** Missing `schoolId` does not take the owner fast path. Require `loaded.schoolId === actor.schoolId` for that shortcut. `ensureThreadWorkspacePlacement` must refuse a workspace whose `schoolId` differs from the thread. **Test:** Owner, resource school missing, access is denied or requires an explicit grant. Thread in school A, workspace in school B, placement throws.

[Spectra shared helpers](387db2ee-e145-4479-a121-fef5ff691e7a).

### P2-50 No scoped test fails on these P1 paths

`src/features/spectra/__tests__` and `convex/*.test.ts` have neighbors, not regressions, for the P1 list. Each ticket above names the test to add. Add that test in the same change as the fix. Do not add a single meta-test that only reads this markdown file.

## Suggested implementation order

1. P1-05, P1-06, P1-24, P1-43, P1-49 (false completed). Same outcome rule, small files.
2. P1-15, P1-16, P1-21, P1-22, P1-50, P1-51, P1-53 (client honesty, low migration risk).
3. P1-02, P1-03, P1-04, P1-52, P1-54, P1-55 (membership, invites, and disconnect).
4. P1-08, P1-09, P1-18, P1-23, P1-30, P1-31, P1-38, P1-42 (data loss).
5. P1-25, P1-26, P1-28, P1-29, P1-33 (collaboration and sync). Coordinate with the collab and bridge lanes.
6. P1-44, P1-45, P1-46, P2-09, P2-10, P2-11 as proposals for S9-AI. Do not edit those files on main from this branch.

## What this file is not

It is not a claim that Spectra is ready to launch. It is not permission to weaken tests. It is not a request to start the Grok deep-implementation agents in this session. Another agent should take one ticket, implement it, and stop.

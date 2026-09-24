# S10 edge-health finding ledger

> Imported source-audit leads. Priority and proposed fixes are subject to the current-source review in [`../S9-EDGE-IMPLEMENTATION.md`](../S9-EDGE-IMPLEMENTATION.md); several fixes are intentionally rejected or reframed there. This ledger alone is not implementation authority or live evidence.

Checkpoint `eac1567b`, branch `cursor/s10-edge-health`. Leads only. Not live acceptance. Fixes are specified in `S10-EDGE-IMPLEMENTATION-HANDOFF.md` so another agent can implement them elsewhere. Do not start implementation agents from this session.

S9-AI overlap means inspect and propose, do not edit those files while that lane is live on main.

## P1 — user-visible wrong state, source-traced

| Lead | Class | Where | Failure |
| --- | --- | --- | --- |
| A verified Clerk email change locks the account out before `registerSelf` can repair it, and that repair can take an email another account still holds | proven-defect | `getAuthenticatedAccount`, `identity.registerSelf` | [Identity authority edges](5aebc64e-763f-4c2e-9454-66244ec2d7ce) |
| Ending a school membership leaves direct grants that still authorize after the person joins another school | proven-defect | `changeMember` does not revoke `accessGrants`; cross-school direct grants still pass `evaluateLoadedResourceAccess` | same |
| Accepting a new invite while already a member marks the invite accepted and keeps the old role | proven-defect | `acceptInvitation` existing-member branch | [Invites and membership](2d710d59-5c23-4c87-9633-98f6f6015dde) |
| Expired and unavailable invites are shown as a connection failure because those errors become HTTP 500 | proven-defect | `previewInvitation` through `normalizeErrorStatus` and the join page | same |
| Palette document and stop commands report completed when the handler returns nothing, and the dialog then closes | proven-defect | `executeCommand`, `fromHandler`, document studio bus | [K-bar command dispatch](d2f2451e-5c56-4ea7-a65a-350b6f3ad877) |
| Comment, continue, and stop freeze their target at rank time | proven-defect | `commandEntry` in `kbar.ts` | same |
| `app.bridge.setup` is prohibited in the presentation registry and readable in the capability registry | proven-defect | `app-registry.ts` vs `capabilities/application.ts` | same |
| Workspace forever-delete drops children after 20 and can resurrect an empty workspace from Trash | proven-defect | `orgTreeShared.dissolveWorkspaceNode`, `spectraWorkspaces.permanentlyDelete` | [Workspaces and org tree](3fd6ac3f-c5d2-411e-bae7-f84a009439c2) |
| A reader’s personal node rename patches the owner’s artifact title | proven-defect | `orgTree.rename` / `renameNode` | same |
| ManageBac resync rewrites an unlocked calendar task, including an unchanged hash | proven-defect | `ensureTimetableProjection` | [ManageBac sync edges](65364279-453d-4bb2-8a2a-e0b801181cb4) |
| Conflict choice `keep_overlay` still force-refreshes locked planner fields | proven-defect | `resolveConflict` | same |
| Saving class selection overwrites a renamed class workspace title | proven-defect | `ensureClassWorkspace` | same |
| A later academic period duplicates the projection | proven-defect | `sourceIdentityKey` / `ensurePlannerProjection` | same |
| Class follow treats “no matching selection row” as follow | proven-defect | `classFollowPolicy` | same |
| Failed class load then Save sends an empty selection without a revision and deselects every class | proven-defect | `school-data-shell.tsx`, `class-shelf-editor.tsx` | [School onboarding data](d0629f4a-f6fb-4aaf-bd79-d1034f551d84) |
| Onboarding Continue on a load error stores `classShelvesStatus: skipped` | proven-defect | `class-shelf-onboarding.tsx` | same |
| Import HTTP body says `imported` while the job is still `awaiting_commit` or the commit was deferred | strong-suspicion | `src/app/api/spectra/imports/route.ts` | [Import intake lifecycle](bdbc9fa0-4ad0-4dbb-9233-56491a27e242) |
| Bibliography command can replace the deck with only the references slide | proven-defect | `buildBibliographySlide` vs `applyBibliographySlides` | [Presentation editor commands](2dcf3836-b999-4e4a-ba4d-8fd91f5a1c0a) |
| Calendar columns use the browser’s local day, not the school timezone | proven-defect | `calendar-application.tsx` `dayKey` | [Calendar timezone paging](56475cff-68ab-45bc-8cb9-759f8c80ea65) |
| Changing planner `minutesBefore` leaves the old fire time, then the delivery is cancelled | proven-defect | `plannerReminders.reconcileArtifact` | [Tasks and reminders](3234e2e2-8110-4ed4-befe-1b31340ab2b7) |
| A library deep link treats the capped 60-item list as “not available” and never calls `get` | proven-defect | `spectra-shell.tsx` deep-link effect; `spectraArtifacts.list` | [Library catalog reads](2b2cd843-b42b-4f78-b3ca-6cca99bbae1b) |
| A failed library search is rendered as no matches | proven-defect | `GlobalSearch` catch in `context-controls.tsx` | same |
| Document hydrate is marked applied before the editor view exists, and text saves reuse the content object from editor creation | proven-defect | `document-studio.tsx` hydrate effect and `onUpdate` closure | [Document editor mount](1017d8b9-67f4-4a3b-a37d-01655de1bb76) |
| Slash commands delete the query and report completed when the action inserts nothing | proven-defect | `slash-command-extension.ts`, `runDocumentCommand` | same |
| A failed local collaboration restore still connects, and an empty room can be marked remotely durable | proven-defect | `use-artifact-collaboration.ts` initialize catch | [Collaboration client reconnect](c92ad338-f753-43e4-8e08-ee7235e03189) |
| A cached modify permission stays in force when session refresh fails without a revocation error | proven-defect | `hocuspocus-transport.ts` authorization watch | same |
| A revoked public link keeps showing the last projection until the 15s poll | proven-defect | `public-share-shell.tsx` | [Sharing and access requests](2f98189f-4b68-492f-89cd-bfb1f1ca94f8) |
| A revoked collaboration session can still append because the persist queue does not re-authorize | proven-defect | `collaboration-gateway.mjs` `persistAcceptedMessages` | [Collaboration gateway worker](8d5d84fb-543a-4367-b991-9548bd5c20ae) |
| Native room bootstrap and durable payload admission skip the school check that room authorize enforces | proven-defect | `bootstrapNative`, `requireDurablePayloadAuthority` | [Collaboration Convex rooms](75265244-c98e-4523-9bf4-5fd8972a5162) |
| Removing a slide leaves hyperlinks on the remaining slides pointing at the deleted part | proven-defect | `pptx-lens.ts` `remove-slide` | [PPTX package and media](eef4ea52-cdea-4682-9be7-f0fa46fc35d9) |
| Adding a slide from the projection writes only text boxes and drops images, charts, and tables | proven-defect | `pptx-lens.ts` `addNativeSlide` | same |
| A library move leaves the Bridge replica on the old relative path | proven-defect | `convex/replicas.ts` `relativePath` | [Bridge client and replicas](52068937-e997-4422-a427-e731fe15d801) |
| The work header can say Saved while local changes are still queued | proven-defect | `status.ts` `selectSyncTruth`, `resource-surface.tsx` | same |
| A leftover invitation cookie sends sign-in back to `/join` instead of the public share the person was opening | proven-defect | `signed-in-continue.tsx` | [Public and legal routes](5b226d4d-f75b-489f-ae2d-6c57ad61d1dd) |
| Creating a library folder from the palette always inserts a new node, while the AI path reuses an existing folder of the same name | proven-defect | `library-organizer.tsx` vs `act.ts` `organize_library` | [Human versus AI actions](304c7020-90f6-49d1-b3d1-680859e5ea6b) |
| Adding a comment reports completed when the mounted handler returns nothing, including a no-op on the wrong artifact | proven-defect | `fromHandler`, `artifact-studio.tsx` | same |
| A settings toggle updates only the settings page; the command bar keeps the previous preference until the idle refresh | proven-defect | `useSpectraPreferences` | [Settings and preferences](b7c1118b-6672-4e55-8ffc-7bfe477438b1) |
| Opening a work from a library URL asks for library readiness, while the studio acknowledges artifact readiness, so the open times out | proven-defect | `universal-kbar.tsx` `routeTarget`, `useStudioViewportReady` | [Open and viewport readiness](9b768546-9293-4492-85cf-fabad4fec727) |
| Removing an embed deletes the server row first, then the document reference removal can fail and leave the host mounted | proven-defect | `artifact-embeds-panel.tsx` `removeEmbed` | [Embed ownership](8746b7c0-4b8d-4ba6-8bcb-860cf4ef0f7f) |
| The live dock can keep showing a run as working after the result card is already failed, cancelled, or completed | proven-defect | `readTabRunSummary` in `spectraRuns.ts` | [Runs and threads](3151d444-d1cf-47cd-b00e-b4a1da217b93) |
| A failed run with a degraded trace is labeled “Completed with limits” in the dock | proven-defect | `live-dock-model.ts` | same |
| A delivered planner reminder still links to the work after read access is revoked or the work is deleted | proven-defect | `loadPlannerReminderNotifications` | [Notifications and audit](ec03a18a-de1b-4ac0-8a0d-a6232bbb57bd) |
| Exporting a linked Word file downloads the server copy and omits unsaved editor text | proven-defect | `document-studio.tsx` docx `download-copy` | [Find history export](58daec19-3ef2-41bd-b800-a0044786759e) |
| Sheet replace-all is registered but does nothing, and the command still reports success | proven-defect | `find-replace.ts`, `sheets-studio.tsx` | same |
| Confirming a run can persist a failed partial result and then return only a generic error with no card | proven-defect | `resumeOperationsAttempt` | [API run receipts](6d1aa214-0d31-4791-b7fb-eb9ed8404fdb) |
| A region conflict on confirm ends the HTTP stream while the run row stays running | proven-defect | `resumeOperationsAttempt` | same |
| A run can be created and then hidden behind a 409 when attachment save fails | proven-defect | `runtime.ts` `persistRunAttachments` | same |
| ManageBac resource import is marked AI-allowed in the capability matrix and prohibited in the tool registry | proven-defect | `capabilities/application.ts` vs `spectraToolRegistry` | [Operations and capabilities](4eceff6d-7415-4a8a-bdf0-98457ce37c14) |
| A closed studio stays in the context picker because the source registration is never removed | proven-defect | `context-source-boundary.tsx` | [Anchors events context](a312878f-8d12-4b6c-b4a4-4ba72e2366f2) |
| Picking a reference closes the dialog before the async insert finishes | proven-defect | `viewport-context-picker.tsx` `reference.insert` | same |
| Quiz practice shows “Current answers synchronized” while a focused text answer has not been saved | proven-defect | `quiz-studio.tsx` | [Shell saved versus durable](319b86cf-310d-4c31-9001-bb257e4f7545) |
| Recent and Favorites still open a work after it is deleted or no longer available | proven-defect | `library-organizer.tsx` `openNode` | [Artifact user state](2f3138cc-4161-4f2f-99ba-96741a40c014) |
| `requireActor` can return the previous school for up to 30 seconds after membership ends | proven-defect | `auth-server.ts` actor cache | [Proxy and auth server](b8d13f0c-6c16-43b2-8239-5e0b51492859) |
| Cookie consent can hide the banner when local storage did not save the choice | proven-defect | `writeConsentState`, `cookie-consent-manager.tsx` | [Consent and cookies](e465ea0a-a71f-46c4-bb60-5b5d8f8d6023) |
| After the first cookie choice, the settings control unmounts and nothing in the app reopens it | proven-defect | `cookie-consent-manager.tsx` | same |
| Ending a membership leaves pending invites, class follows, pins, and notification deliveries | proven-defect | `administration.changeMember`; no cleanup after the membership patch | [Membership cleanup after leave](729d9acf-317e-4b11-868b-69f19c99481f) |
| After ManageBac disconnect, AI still reads school rows as connected | proven-defect | `managebac.disconnect` vs `recordsForPurpose` | [Non-ManageBac integrations](eabb3a72-2671-4a9f-8cda-c04fb2eddaea) |
| A whiteboard style or whole-node patch replaces the object, and verify still passes | proven-defect | `applyResolvedContentPatch`, `authoredObjectFieldsMatch` | [Whiteboard page patches](c6e39468-8bfb-4384-b948-0821bf2bc8f3) |
| One recolor prompt remaps every color change onto a single title-matched node | proven-defect | `remapWhiteboardRecolorChanges` | same |

## P2 — held for a deep pass

| Lead | Owner note | Explorer |
| --- | --- | --- |
| Human footnote insert skips `nativeBinding`, so an orphan Word note id can be reused | Office | [Academic Word commands](180c5f39-3b56-4cc5-998a-5bca840373b8) |
| Citation edit drops `sourceRef` | Office | same |
| Artifact open readiness is never acknowledged; late hydration can reopen the previous artifact; URL close skips the dirty check | Open lane | [Pages and workbench](faccddd0-5741-4cb4-834d-909726c1affb) |
| Code run/export uses a React workbook that lags Yjs for inactive files | Collab | [Code artifact editor](1c5884b3-a7cc-4ba0-b1e1-a7232c2d0f79) |
| Cached-only sheet numbers stay on screen after they are marked stale | Sheets | [Sheets editor commands](c354d7ad-140d-4890-a515-3cb6a6c65d3f) |
| Quiz `allowResume: false` hides an in-progress attempt that still consumes the attempt limit | Quiz | [Quiz privacy practice](f1459ea6-6072-4990-82d3-4784170b191d) |
| Document `/blocks/N` subset verify can pass after fields are dropped | S9-AI overlap | [AI content patch verify](e5d7e817-4a3e-47a1-bb2c-8e01b6882d79) |
| Stop does not cancel in-flight parallel tools; durable poll advances the cursor before a bad payload parses | S9-AI overlap | [AI run loop control](ef644c06-8fd4-49fb-99ba-83013b8047ca) |
| Collaboration revoke does not stop Convex artifact side writes already in flight | S9-AI overlap | [AI authority application writes](99795b3b-f433-43bf-8c7f-c18558844c60) |
| `finalizeUpload` requires `candidateStorageId`, which `beginUpload` never sets | Assets; may be a dead path | [Attachments and assets](0500e6a0-43ad-4372-9ab4-b46517953dc5) |
| Library resource upload does not use `validateResourceUploadFile` | Import | [Import intake lifecycle](bdbc9fa0-4ad0-4dbb-9233-56491a27e242) |
| Local rehearsal apply writes a normal membership; restore does not keep the membership id | School | [School onboarding data](d0629f4a-f6fb-4aaf-bd79-d1034f551d84) |
| Flashcard review id is a new token per click, so a retry can schedule twice | Study | [Flashcard study sessions](0a8b19f6-cd65-43e3-9056-81c6c9feefc3) |
| Plain `replace-paragraph` can omit `inlineContent` when text moves and rich semantics look unchanged | Office | [Word lens projection fidelity](d814c89f-77a3-4904-bec7-9115a4888e70) |
| Live native promotion keys only block id plus text, so formatting and equations can skip materialize | Office | [Native reconciliation merge](13124c75-4ff2-4505-9135-c253c4a5a3b9) |
| Bridge `completeWrite` can mark verified from a matching revision without a native receipt | Bridge lane | [Bridge Convex queues](0cbc462b-5fb7-438b-971a-e228284f3028) |
| Whiteboard `/nodes` replace plus subset verify | S9-AI overlap | [Whiteboard editor state](a8573f90-f1a1-4a49-9a83-f4f9e1dcc514) |
| A deletion job can be marked complete while the artifact row is still retained | Data lane | [Retention and deletion](93164578-91c7-4206-85a8-1673a0ed91c5) |
| One collaboration client id can hold two overlapping active region claims | Collab | [Region claims and sync](df8e32a5-ae00-4e1e-95f7-4118b064bf96) |
| A chart workbook update that throws is swallowed and the slide is still saved | Office | [PPTX package and media](eef4ea52-cdea-4682-9be7-f0fa46fc35d9) |
| Native ack retries keep the original claim lease and never refresh it | Bridge lane | [Bridge Rust core](aef6b6cf-ddbf-48db-9e46-2ccac7e4d6ba) |
| Account trust presets apply without a paired Bridge device | Bridge lane | [Bridge client and replicas](52068937-e997-4422-a427-e731fe15d801) |
| A durable read URL can outlive the payload release because there is no reader lease | Data lane | [Durable payload ownership](08dec98c-3f11-4035-baac-1e6231775315) |
| Snapshot refcount can drift if a version row is removed without `releaseSnapshotObject` | Data lane | same |
| Bridge setup reports `pending` from the palette and `needs-human` from the AI path, with different action ids | S9-AI overlap | [Human versus AI actions](304c7020-90f6-49d1-b3d1-680859e5ea6b) |
| Preference writes are last-write-wins with no revision, so a slower save can replace a newer value | Settings | [Settings and preferences](b7c1118b-6672-4e55-8ffc-7bfe477438b1) |
| Sign-out clears stored preferences but leaves the previous account’s toggles in memory | Settings | same |
| An AI settings change tells the user the setting is active while the open page still shows the old toggle | S9-AI overlap | same |
| Web `prebuild` does not run the product tests, and an unpaired Bridge probe is reported ready | Release lane | [Release and test runner](d24646c8-ef95-49f8-aa4e-bced08037383) |
| “Use live source” on a pinned embed fails after the source is deleted and the pinned version is gone | Embeds | [Embed ownership](8746b7c0-4b8d-4ba6-8bcb-860cf4ef0f7f) |
| Import `completedAt` is set when the job is still `awaiting_commit` | Import | [Schema migrations and crons](5ee6c464-9736-4fda-90e1-9c64aa06bbe9) |
| Calendar migration `pageComplete` can be true while a later page is still pending | Calendar | same |
| A result-card backfill can mark the migration complete while its cursor is still set | Runs | same |
| The memory list still shows a claim after its source is gone, while run recall drops that claim | Memory | [Memory embeddings](09f89a65-42d7-437f-a6c0-4fc97ce3a04f) |
| Private global memory stays recallable after the account leaves the school that produced it | Memory | same |
| A missing run row falls back to status completed in the dock | Runs | [Runs and threads](3151d444-d1cf-47cd-b00e-b4a1da217b93) |
| Publishing an agent can show “Release published” when the release list refetch failed | Agents | [Agents publish](fe15c7c1-a48a-4324-8ccb-e76d410c980c) |
| There is no second offline draft store; a false Saved state comes from the collaboration cache and the sync chip | Offline | [Offline drafts](01beb238-ff55-46ce-b832-82316133ab6e) |
| Filing a library reference reports success when the link already exists and no new node is created | Library | [Sources and references](cbc1e424-d7c7-4681-ba66-548a7b84de57) |
| Model token meters are recorded when a run fails or is cancelled, and a retry with a new execution id counts again | Analytics | [Analytics correctness](cd2e2dc9-043a-4782-80a6-d43e47163bea) |
| Analytics counts filter after a 2000-row cap, so deleted rows can crowd out live work | Analytics | same |
| The workbench comment resolve hides a missing-thread error | Comments | [Comments lifecycle](a8194235-9501-49f6-bd83-158c456647d9) |
| A scheduled run callback can return `{ completed: true }` after the run row was marked failed | S9-AI overlap | [API run receipts](6d1aa214-0d31-4791-b7fb-eb9ed8404fdb) |
| Native lens materialize can return 200 after upload even when the queue state is failed or already verified | Office | [API content and native](661e3eef-3899-4456-84cd-754bc8eec926) |
| A school admin secret status call ignores an invalid operator session id | Admin | [Admin boundaries](2f462baa-7ebe-4cbb-80b0-cfba131f51ce) |
| Follow AI stays on after the run ends and can keep moving the viewport | Collab | [Presence and follow](ebf6972c-32c0-401b-8939-1195267b7835) |
| A human follow does not stop when the followed person leaves the room | Collab | same |
| The Cloudflare room can report synchronized while local edits are still unacknowledged | Collab | [Realtime tools quality](488201dd-2eee-4403-9820-b5dd257973e2) |
| A quality pass can succeed after presentation realization drops layout fields | S9-AI overlap | same |
| Plan policy does not read `aiAvailability`, so a prohibited command can be approved and fail only at execution | S9-AI overlap | [Operations and capabilities](4eceff6d-7415-4a8a-bdf0-98457ce37c14) |
| Quiz practice save mints a new idempotency id on submit flush, so a retry can write the answer twice | Quiz | [Data and compute features](0fa15732-af19-420d-89ec-5bdde134c983) |
| The Clerk webhook returns 200 without writing identity, so Clerk will not retry a failed `registerSelf` | Identity | [Webhooks and health](2c189d5f-4067-4fc9-bd63-b754e5e8cf2a) |
| Health always returns HTTP 200, including when the body says not ready | Release lane | same |
| A school connector secret can still be read by any active member after that person is no longer an admin | Secrets | [Secrets and bridge trust](dfcaaa5d-f94e-4751-b3cb-32326c7f3630) |
| An omitted change-group commit returns committed with no signal that the version was rebuilt from the live row | Collab | [Change group commits](1f2ba768-a177-4063-b81f-f532ddc48730) |
| A superseded snapshot verify can leave the room compacting | Collab | [Snapshot verify handoff](00b766e7-a1df-4a44-9d0f-176d02029133) |
| `await spectraBus.command` returns a listener count and does not wait for the handler | Shell | [Anchors events context](a312878f-8d12-4b6c-b4a4-4ba72e2366f2) |
| School purge lists `artifactUserStates` but never deletes those rows | Data lane | [Artifact user state](2f3138cc-4161-4f2f-99ba-96741a40c014) |
| None of the P1 rows have a regression in the scoped test trees that would fail on the traced path | Tests | [Test gap census](979a9f1d-7fbe-4187-a632-023ae635ace8) |
| A document reference insert from the editor can drop `placementOperationId` while the embed row is created | Embeds | [Rich content join](bbc4a118-e04b-4ac5-b59b-625980ec1a48) |
| A whiteboard embed keeps the snapshot in `node.content` after the live source metadata changes | Whiteboard | same |
| Duplicating a quiz or deck copies asset ids from the original, so deleting those assets breaks the copy | Studio | [Duplicate artifact outside tree](50ed620c-f789-479a-a4e9-b2ec3d74159a) |
| Collaboration worker tests inject a room epoch, so they stay green when the deployed room leaves the epoch unset | Collab | [Workers package contract](96aa952a-d3d9-49a2-84f6-3f71d73a3ac9) |
| A ManageBac capability run is marked completed while later class routes in the same fan-out are still committing | ManageBac | [Non-ManageBac integrations](eabb3a72-2671-4a9f-8cda-c04fb2eddaea) |
| `integrationCapabilities.lastSuccessAt` is never written, so a finished sync can still look partial | ManageBac | same |
| Duplicating a work does not copy `spectraArtifactLinks`; move leaves the same artifact ids on purpose | Library | [Links after move](a55fa0c3-c91f-4bd7-a5e4-a13f95b3b49e) |
| Presentation export substitutes a generic font and does not say so; Word throws instead | Office | [Office fonts and slash](ebb393f6-f009-4eb5-9966-74eaac579ee5) |
| Quiz and flashcard rows survive artifact deletion; the study timer counts a session without writing one, and nothing mounts that timer | Study | [Study timer achievements](7932e2ff-7704-44a4-b15c-14729194807a) |
| A resource with no `schoolId` is treated as owner access, and a thread can be placed in another school’s workspace | Authority | [Spectra shared helpers](387db2ee-e145-4479-a121-fef5ff691e7a) |
| There is no self-leave mutation, while accept still tells the person to leave their current school | Identity | [Membership cleanup after leave](729d9acf-317e-4b11-868b-69f19c99481f) |

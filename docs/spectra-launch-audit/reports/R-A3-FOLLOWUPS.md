# R-A3 — Follow-ups

Lane A3, branch `lane/followups`, worktree `<local-workspace>`. It holds the follow-ups from A2b (AI
reach), F2 (Devices) and D4 (Editors). Main is merged in at the end and the coordinator lands the branch.

Nothing was run live: no dev server, no browser, no installed Bridge, no live `eval:ai`, no Convex deploy. Convex
changes were tested with convex-test, and Bridge changes with `cargo test`.

## Commits

| Commit | Item | Step |
|---|---|---|
| 414d81d9 | 8 | one shared ManageBac refresh request (`aiRefreshRequest`) for the harness and Convex |
| 939f2ba7 | 1 | `read_school_data` reads past tasks, grades and CAS through `api.school` |
| e1817244 | 4 | `read_thread` pages on from a found passage (`spectraThreads:listMessagesFrom`) |
| 525f9a97 | 2 | the legacy AI module is removed |
| dd2ee9bb | 3 | the global search finds work through `useSemanticSearch` |
| 01e5d9bc | 5 | a watchdog inside the widget frame |
| a77f3c3c | 6, 11 | Agents, School and Analytics are follow destinations; `navigation.show` works on every page |
| 316b7eff | 7 | the catalog gaps get commands or a precise written reason |
| ec09c3e2 | 13 | a verified citation opens its source |
| e5a2661a | 9 | a paused folder holds its changes, folder by folder |
| bf170a28 | 10 | a work opens in its desktop app or shows in its folder |

## Items

1. **`read_school_data` reads through `api.school`. Done.**
   - It reads past tasks, grades with feedback and CAS through the School page's own queries: `school:tasks`, `task`,
     `cas` and `casExperience`.
   - These return only the student's own data and leave out any kind the student turned Off.
   - A `recordId` reads one task in full, or one CAS experience.
   - An empty answer says why: not connected, turned off, never synced (naming the sync purpose to ask for), or a sync
     problem.
   - Tests: `school-read.test.ts`.
2. **The legacy AI module is removed. Done.** See *Removed*.
   - The one live use was the server's application command path. Its boundary now lives with the harness in
     `src/app/api/spectra/run/harness/application-commands.ts`, with one Zod schema and one authority class for each
     command.
   - A test reads the tools' source and checks that the two lists match.
3. **`context-controls` uses `useSemanticSearch`. Done.**
   - Work is found by meaning and by words, and what is open counts as a ranking hint. Each result shows where in the
     work the match is.
   - Workspaces have no semantic kind, so they are still found by name.
4. **`read_thread` pages on from a found passage. Done.**
   - The new query `spectraThreads:listMessagesFrom` reads the messages older or newer than any message. It orders by
     time, then by insertion.
   - `before` and `after` take message ids, and every page names the ids to read on in both directions.
   - The old opaque-cursor path is gone.
5. **A widget watchdog. Done.**
   - A watchdog runs first inside the widget frame. Every `while`, `do-while` and three-part `for` loop checks with it.
   - After two seconds without yielding, the frame's scripts are stopped for good, its timers are cleared, a plain note
     shows and the app is told.
   - A heartbeat catches a frame that goes silent; the thread then removes it and shows the same note.
6. **Agents, School and Analytics are follow destinations. Done.**
   - All three are in `FOLLOW_ROUTES` and `NAVIGATION_DESTINATIONS`, and are reachable through `open_in_spectra`.
   - Agents takes a `targetId`.
   - The three navigation gaps in `ai-reach.ts` are now `tool("open_in_spectra", …)`.
7. **The other catalog gaps. Done.** `command-parity` is green.
   - **New commands**, each mapped to the same mutation the user's own control calls:

     | Command | Mutation |
     |---|---|
     | `restore_library_items` | `orgTree:restore` |
     | `pin_library_item` | `orgTree:setPinned` |
     | `organize_library` with `create_workspace` | `spectraWorkspaces:create` |
     | `manage_conversation` (rename, pin, archive) | `spectraThreads:update` |
     | `save_version` | `changeGroups:createNamedCheckpoint` |
     | `complete_calendar_block` | `calendar:completeWorkBlock` |
     | `remove_calendar_event` | `calendar:removePersonalItem` |
     | `set_school_sync_mode` | `school:setMode` or `school:setClassOverride` |
     | `manage_class_workspaces` (create, release) | `managebac:materializeClassWorkspaces` or `managebac:releaseClassWorkspaces` |

   - **The two ManageBac commands ask first.** They are in `CONFIRMED_COMMANDS` on the harness side and in
     `confirmedCommands` on the Convex side.
   - **New tools:** `restore_from_trash`, `save_version` and `manage_conversation`. The `calendar`, `organize_library`
     and `managebac` tools gained actions.
   - **User-only, with a reason:** result cards and tabs under a reply, and purging every auto-created class workspace.
   - **The twelve school and ManageBac mutations** from D4 are all accounted for:
     - `school:setMode` and `setClassOverride` are now tool reach;
     - `syncNow`, `removeSchoolFile`, the five CAS mutations and `managebac:attachSchoolFile` are server plumbing.
   - **Tests:** `application-action-contract.test.ts` and `tools.test.ts`, plus the new convex-test
     `convex/ai-application-reach.test.ts`.
8. **`trigger_managebac_sync` passes `kinds`. Done.**
   - The harness already sent kinds, but built the request separately from Convex.
   - Both now use `aiRefreshRequest` in `shared/school-sync.ts`, and a contract test checks its kinds and force.
9. **A paused folder holds its local changes, folder by folder. Done.**
   - **What already held:**
     - the outbound change queue (`drain_cloud_queue_holding` defers items for paused grants);
     - Spectra's writes, which wait with `folder-paused`;
     - global pause.
   - **What still reached the cloud, now fixed:**
     - The folder watcher's repair and reconciliation scans, and the `MOUNT_NOT_ACTIVE` re-registration, called
       `sync_grant`. That function registers files and uploads their bytes, and it ran even while the folder (or all
       syncing) was paused. It now returns `Paused` before reading anything. The watcher keeps journaling changes, and
       the folder is scanned when it resumes.
     - Storage-change payload requests (`claimPendingPayloadUpload`) uploaded the paused folder's files. They are now
       skipped, so the other folders go on, and Spectra asks for them again on a later pass.
     - Organization requests (move, rename, delete) changed the paused folder on disk. They now wait with
       `folder-paused`, as writes do.
   - **Convex side:** no new function was needed.
     - A waiting write or structure request goes back to `pending`.
     - Its backoff is capped at 60 s (`sync-retry-policy.json`), so the change applies within about a minute of
       resuming.
     - Writes keep extending `expiresAt`, so a long pause does not expire them.
     - The status line now says "Paused on this computer" instead of promising a retry. This is `replicaIsPaused`, plus
       a `folder-paused` sentence in `humanize.ts`.
   - **Native acknowledgements** still go out. They report writes that already happened, and holding them would only
     strand the cloud's claims.
   - **Tests:** the Rust test `a_paused_folder_is_never_scanned_to_spectra`, the existing
     `a_paused_folder_keeps_its_changes_queued_without_counting_attempts`, and `sync-presentation.test.ts`.
10. **Open in the desktop app, and show in folder. Done.**
    - **Routes.** Bridge's local control API has `/v1/file/open` and `/v1/file/reveal`, which take
      `{grantId, relativePath}`. Both sit behind the paired session, like every other control route.
    - **Path checks.** The path resolves through the folder's grant (`GrantRegistry::resolve`). It cannot leave the
      folder (no `..`, no absolute path, no link out) and must name a file that exists.
    - **Only documents open.** Open accepts only the Office formats Spectra keeps a desktop copy of. A program or script
      can be shown in its folder but is never launched from a web page.
    - **Platforms.** Explorer gets a plain path, not the `\\?\` form. On Windows it runs `explorer /select,`, on macOS
      `open -R`, and on Linux it opens the parent folder.
    - **Studio.** `can["open-in-office"]` is on when the work has a local copy in a folder selected on this computer and
      the work is an Office document. `can["show-in-folder"]` needs only the local copy. `handleStatusAction` calls
      `openBridgeFile` or `revealBridgeFile`, and a refusal shows Bridge's own sentence in a toast.
    - **Tests:** the Rust tests for the routes (`a_work_page_opens_its_file_or_shows_it_in_its_folder`, plus the
      session check) and for path containment (`a_work_page_reaches_only_documents_inside_a_selected_folder`,
      `explorer_gets_a_plain_windows_path`), and `bridge-file-actions.test.ts`.
11. **`navigation.show` works on every page without a reload. Done.**
    - One app-wide handler (`startFollowNavigation`) is mounted in `AppChoreographyMount` and uses the client router.
    - A page with in-page navigation registers it (`registerInPageNavigation`) and is asked first. The workbench shell
      uses this for its library and workspace hubs.
    - The `window.location.assign` fallback for connecting a device is gone.
    - Tests: `follow-navigation.test.ts` and `ai-ui-events.test.ts`.
12. **Cloud relay. A design note only.** See *Cloud relay* below. It touches the schema, Convex, Bridge's poll loop,
    the Devices page and the approval policy, so it is not small enough to build in this lane.
13. **The verified citation opens its source. Done.**
    - `SpectraRichContent` takes `sources`: a work opens in the Side (`work.open`, panel), and a web source opens in a
      new tab with `noopener,noreferrer`, for http(s) only.
    - A citation becomes a button only when it can open. A verified source with nowhere to open stays text.
    - Test: `rich-content-citation.component.test.tsx`.

## Removed

Item 2 deleted about 4,600 lines.
- **From `src/features/spectra/ai/`:**
  - `agent-loop`, `agent-context` and `read-snapshot`;
  - `tool-contract`, `attachment-evidence`, `source-evidence-content` and `content-patch-verify`.
- **Tools:** `tools/registry/*` (including the second copy of every input schema) and `tools/execution/*`.
- **Operations:** `operations/policy`, `operations/application-command`, the `operations` barrel, and the
  operation-input schema that only the old policy API used.
- **Tests that only exercised that code:**
  - `agent-loop`, `agent-context`, `action-protocol` and `application-tools`;
  - `attachment-evidence`, `content-patch-verify` and `sheets-content-patch`;
  - `s11-review-ai-context-continuation` and `s11-review-ai-loop-boundaries`.

Other removals:
- **Item 3:** the old title-and-text work search in the global search dialog, and its unused placement props.
- **Item 4:** the opaque-cursor path in `read_thread`.
- **Item 6:** `NOT_A_FOLLOW_DESTINATION`.
- **Item 11:** the shell's own `spectraBus.handle("navigation.show")` and the `window.location.assign` fallback.

## Gates

All gates were run in the worktree after the final merge of main.

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | pass |
| `npx eslint . --max-warnings=0` | pass |
| `npm run check:architecture` | pass |
| `npm run check:copy` | pass |
| `npm run check:design-tokens` | pass |
| `npx vitest run --maxWorkers=3` | pass: 545 files, 4741 tests (1 skipped); no flaky reruns needed |
| `cargo test --workspace` (in `bridge/`) | pass: bridge-app 46, bridge-core 74, chaos 21, granted_tree 1 |

## Needs a live check

- **Convex functions to deploy:**
  - `spectraThreads:listMessagesFrom` (new, item 4).
  - `spectraApplicationWrites:execute`, changed for item 7: new `mutationFor` cases and `confirmedCommands` entries.
    Until it is deployed, the new commands fail on the server with `AI_APPLICATION_WRITE_NOT_REGISTERED`.
  - Items 9 and 10 need no Convex change.
- **A new Bridge build** for items 9 and 10:
  - **Item 10 on an older Bridge.** Until the Bridge is updated, Open and Show in folder answer 404, and the toast
    shows the generic "could not complete the request".
  - **Pausing one folder**, then:
    - edit a file there, wait past the reconciliation interval, and check that nothing uploads;
    - resume, and check that the change uploads within about a minute;
    - check the same for a storage change and for a move made in Spectra.
  - **Open in Word and Show in folder** on Windows (Explorer selects the file) and on macOS.
- **Follow navigation.** Spectra showing Agents, School and Analytics from a non-workbench page should move without a
  reload.
- **Widget watchdog.** Run a real `show_widget` with a busy loop in the browser, and check that the note shows and the
  app stays responsive.
- **A live `eval:ai` pass** over the new tools: `restore_from_trash`, `save_version`, `manage_conversation`, the
  calendar complete and remove actions, the ManageBac sync mode and class workspaces (approval prompts), and the
  `read_thread` paging.

## Cloud relay (design note, item 12)

**Goal.** From the Devices page or from Spectra AI on one computer, control another computer's Bridge. The actions
are:
- pause or resume a folder;
- pause syncing;
- retry a folder;
- remove a folder;
- update Bridge.

Today the page says to use Spectra on that computer.

**Shape.** It reuses the claim pattern that writes and structure requests already use.
1. **Table.** A new `bridgeControlRequests` table has these fields:
   - `accountId` and `deviceId`;
   - `action` (an enum of the actions above) and `args` (`grantId` where it applies);
   - `state`: `pending`, `claimed`, `done`, `failed` or `expired`;
   - `claimToken`, `claimGeneration` and `attemptCount`;
   - `createdBy`: `user`, or `ai` with a `runId`;
   - `error`, `createdAt` and `expiresAt`, with a short TTL of about 10 minutes.
2. **Enqueue.** `bridge:requestControl` is a mutation from the page or the harness. It checks that the device belongs
   to the caller's account and is active, and that the grant is one of its mounts. An action that removes a folder
   needs the user's approval when Spectra AI asks. It is idempotent per (device, action, args) while pending.
3. **Claim.** In Bridge's poll loop, which runs before the paused-folder early return so that a remote resume works, a
   `bridgeControl:claim` takes the device credential, as `bridgeStructure:claim` does. It runs the same
   `LocalBridgeControl` method the local API calls, then completes with `done` or `failed` and a sentence.
4. **Report back.** The device's health report (`bridge:reportHealth`) already carries `paused` and its folder count.
   Per-folder paused state should join it, so the page shows the remote truth instead of the request's.

**Never relayed:**
- choosing a folder, which needs the native picker and a person at that computer;
- Open in Word, Show in folder and Show logs, which show something on a screen nobody is looking at;
- pairing.

Unpairing another computer is already done by revoking it in Spectra.

**Safety.**
- The relay adds no new Bridge network surface. Bridge still only polls Convex with its credential.
- Every relayed action is one Bridge already exposes locally.
- Requests expire, so a computer that comes back online after a day does not replay stale commands.

**Size.** It needs a schema table, three Convex functions with convex-test, a Rust poll step with tests, Devices page
wiring for "Other devices" rows, and an `ai-reach` entry. That is a lane of its own, not a follow-up.

## Left

- **Catalog gaps, with written reasons in `ai-reach.ts`:**
  - `work.embeds` needs a read of a work's embed ids.
  - `work.restore_version` needs a version-history read and a harness path to the server restore.
  - `work.publish_runtime` needs the build moved out of the publish route into a shared server function, with approval.
  - The editor publish rule: quizzes, code and agents each need a server publish path.
  - `comments.manage` needs a comments read.
  - `sharing.links_and_exceptions`: the journal receipt would keep a public link's secret, so it needs a hash-only
    receipt. Invitation and member ids are not readable yet.
- **Citation sources.** No app surface passes `sources` to `SpectraRichContent` yet, because a message carries no
  source list. Until one does, verified citations render as text with a "Verified source" title.
- **Toasts.** A Bridge too old for item 10 gives a generic error. Mapping a 404 to "Update Spectra Bridge" needs the
  status code passed out of `authorizedBridgeRequest`.
- **The cloud relay** (item 12), as above.

# R-L4 — Leftovers

Lane L4, branch `lane/leftovers`, worktree `<local-workspace>`, from main at 62bf9fc3. Goal: close
every genuinely open "Left:" note in the [REDESIGN-PLAN](../REDESIGN-PLAN.md) lane table, and any small, clearly
specified non-visual follow-up in the per-lane reports. Out of scope by assignment: live and visual checks, anything
that needs a paired Bridge (LV-046, LV-061), and Office viewer depth (Excel charts, pictures and conditional formats;
Word comments and tracked changes).

Nothing was run live: no dev server, no browser, no `next build`, no `convex dev` and no deploy. The coordinator lands
the branch.

## Commits

| Commit | Change |
|---|---|
| aeae7eb1 | `fix(calendar)`: block notes render as rich text with the shared renderer. |
| 3bf2684c | `feat(semantic)`: the companion's Related list and global search use the semantic layer. |
| 11dc2c79 | `fix(convex)`: `embeddingDimensions` listed in `convex/_generated/api.d.ts`. `920b4686` (on main) added the module without it, so `convex/module-graph.test.ts` failed on main. Types only; no function. |
| (this commit) | This report. |

## The assigned items

Most were already closed by later lanes. Each was checked in code before anything was changed.

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | Calendar block notes show raw `<p>` HTML | **Done now** (aeae7eb1) | A later commit had flattened the notes to plain words (`plainText` from `shared/semantic-chunks`), which hid the tags but lost bold, lists and links. See below. |
| 2 | `read_school_data` on the `api.school` queries | Already done | `939f2ba7` (A3 item 1): `src/app/api/spectra/run/harness/school-read.ts` reads `school:tasks`, `school:task`, `school:cas`, `school:casExperience` and `school:syncStatus` as the user; `convex-backend.ts` `readSchoolData` routes past tasks, grades, CAS and any `recordId` there. Tests: `school-read.test.ts`. Upcoming deadlines, class resources, timetable and classes stay on `managebac:recordsForPurpose`: `api.school` has no query for resources or the timetable, and its queries are student-only (`requireStudent`), while the purpose read also serves teachers. |
| 3 | The chat's verified-citation button does nothing | Already done | A3 item 13 (`SpectraRichContent` `sources`, `openCitationSource`: a work opens in the Side, a web page in a new tab) and `4746be7e` (runs keep what they read; saved replies carry `metadata.sources`). `conversation-surface.tsx` passes `sources` for saved replies (`messageSources(message)`) and live ones (`liveExchange.sources`). Test: `rich-content-citation.component.test.tsx`. |
| 4 | Formatting inside slide text boxes | Already done | Lane D4c (`08991fb7`): slide text boxes are the shared rich field (`slide-text-field.tsx`, used by `presentation-slide-canvas.tsx`), with PowerPoint export per paragraph; D4d (`4bcea2ab`) closed the three slide-text edge cases. Tests: `slide-text-field.component.test.tsx`, `presentation-io.test.ts`. |
| 5a | Catalog gaps in `ai-reach.ts` | Already done: **0** | The `gap` kind no longer exists in `AiReach` (only `tool` and `user`). A5 closed all but two; L2 closed `managebac.import_resource`, L3 closed `agents.studio` and deleted the marker. `command-parity.test.ts` fails on an action with no tool and no written reason. |
| 5b | The cloud relay | **Not done**: not specified, and a lane of its own | See [The cloud relay](#the-cloud-relay). |
| 6a | Copy link for scheduled runs | Already done | `9aebb750`: `publicLinks.aiOrigin`; Share shows "Made by Spectra · Copy link" to the run's owner, revealed through `revealAiPublicLink`. HARNESS.md, "Public link addresses". |
| 6b | Extra checkpoint on a retried partial publish | Already done | `80a0c079`: `changeGroups:createNamedCheckpoint` returns the parent checkpoint when it has the same name and the content is unchanged. The publish path names it `Published <title>` (`runtime-publish-server.ts`), so a retry after a failure past the checkpoint reuses it. |
| 6c | AI path to close a quiz | Already done | `6e78547e`: `edit_artifact` quiz edits take `publish` and `unpublish`. |
| 6d | AI path to unshare an agent | Already done | `5fa7918e`: `release_agent` (`release_private`, `publish`, `promote`, `rollback`, `suspend`) through the studio's mutations; `agent.private` maps to `release_agent` in `command-parity.test.ts`. Removing one person stays `share` `revoke`, which covers agents (`read_sharing` lists works, workspaces and agents). |
| 7a | Window shortcuts audited per nested studio type | Already done | D4d `ce3f298d`: the audit table in [R-D4d-OFFICE](R-D4d-OFFICE.md#shortcut-audit-across-editable_in_place); `eventBelongsToFocusedStudio` compares studio elements. |
| 7b | "Done" with the same work open in the Side | Already done | D4d `ce3f298d`: `work.requestClose` takes an `instance`, the inline editor passes its embed id, and `closeRequestReaches` sends a request only to the copy it names. |

### 1. Calendar notes (aeae7eb1)

- **Before.** `CalendarItemDetails` passed the notes through `plainText`, so `<p>Bring the <strong>lab book</strong></p>`
  read as words with no emphasis, and Markdown notes showed their `**`. The block subtitle stripped tags with a regex
  and refused any note containing `**`.
- **After.**
  - The Notes row draws the stored value with `SpectraStoredText` (editor HTML or Markdown, through
    `richContentFromStored`) on `spectra-prose`, the same renderer as replies, comments and flashcard faces. Nothing is
    injected as HTML.
  - A cleared editor value (`<p></p>`) shows no Notes row at all.
  - The block subtitle reads the notes' words through `plainTextFromStored`, so entities and Markdown read correctly.
  - The `shared/semantic-chunks` import is gone from the calendar.
- **Tests** (`calendar-application.component.test.tsx`): HTML notes keep `<strong>` and a list inside `.spectra-prose`;
  Markdown notes render bold without `**`; an empty editor value shows no Notes.

## Other follow-ups found in the lane reports

### Done now (3bf2684c)

- **The companion's Related list** (A2a, "Show `reasons` on Related"; HARNESS.md, "Semantic layer": "the companion's
  **Related** list: automatic links between artifacts (nearest neighbours above a threshold, plus explicit
  references)").
  - **Before.** `RelatedWork` in `work-companion.tsx` read `linkedArtifacts`, which reads demo metadata
    (`demoMeta(...).relations`). Real work never has it, so Related always said "Nothing linked yet".
  - **After.** It uses `useRelated(work._id, { limit: 12 })` (`api.semantic.related`):
    - explicit links come first, then work about the same things, each row saying why it is listed ("Linked from this
      work", "Links to this work", the link's own label, or "Similar"), with its type and last change;
    - only works are listed; conversations have their own tab;
    - a ghost while it loads (`LoadingRows`), **Try again** when it fails, and "Nothing related yet" when empty;
    - a quiet "Showing linked work only right now." when the answer is degraded (not for `index_partial`);
    - a work the page has loaded opens through the host's `onOpenWork`; any other opens in the Side by id
      (`work.open`, `panel`).
  - `linkedArtifacts` stays: the artifact studio's details still use it.
- **Global search's degraded note** (A2a, "Show a quiet note when `degraded` is set"). The command bar and the threads
  view already said so; `GlobalSearch` (`context-controls.tsx`) now says "Matching exact words only right now." too.
- **Tests:** `work-companion.component.test.tsx` (related rows with reasons, opening known and unknown work, ghost,
  retry, the degraded note, reason wording) and `global-search.component.test.tsx` (the degraded note).

### Checked and already closed

| Follow-up | Where it closed |
|---|---|
| `/devices` in the Side prefixes (F2) | `route-side-panel-host.tsx` `ROUTE_SIDE_PANEL_PREFIXES` |
| Hold a paused folder's uploads; Open in Office and Show in folder (F2) | A3 items 9 and 10 |
| An old Bridge says to update (A3) | `53153396` |
| `context-controls.tsx` on the old search path (A2b) | A3 item 3 |
| Legacy AI module, `read_thread` paging, widget watchdog, follow destinations (A2b) | A3 items 2, 4, 5, 6 and 11 |
| D3 follow-ups ("Open full", school files in viewers, offline vs other failures, Agents test, section tabs) | A4 |
| Bench Stop, older releases, model-written suggestions (L1) | L2 |
| Metering stopped bench answers and suggestions; a stopped answer's partial text (L2) | L3 `ca9de40f` |
| F1's per-purpose sync kinds (F1, A2b) | Merged with A2b |

### Left, and why

- **Open search results at their anchor** (A2a). `work.open` takes no region, and the editors have no shared "scroll to
  region" entry point. It needs a `regionId` on `work.open` and a handler in each studio: not small.
- **Two full copies of one work** (D4d). Inline copies are handled. A tab and the Side holding the same work at once
  could both answer a plain `work.requestClose`; in the workbench shell the studio is either a tab or the Side, so this
  was not reproduced in code and was left alone.
- **Bench suggestions** (L2): no retry for a reply that ignores the JSON shape, no re-check of a suggestion against
  later edits, and a repeated step is not deduplicated. These are recorded limits with no specified behaviour.
- **Cross-language recall and real-query fixtures** (A2a): quality work that needs traffic.
- **`scheduleExecution` merged into `beginRun`** (A1b): a latency candidate, not a defect.
- **Legacy clarification fields in `beginRun`** (A1b): left for the island's owner; the server already ignores them.

## The cloud relay

[DEVICES.md](../../product/DEVICES.md) does not specify it. The only design is A3's note
([R-A3-FOLLOWUPS](R-A3-FOLLOWUPS.md#cloud-relay-design-note-item-12)), which its author sized as a lane of its own. It
needs no new cloud service (Convex is the relay), but it does need a Convex deploy and a new Bridge build to work at
all. What it needs:

1. **Product spec first.** A "Controlling another computer" section in DEVICES.md: which actions relay (pause or
   resume a folder, pause syncing, retry a folder, remove a folder, update Bridge), which never do (choosing a folder,
   Open in Office, Show in folder, Show logs, pairing), how "Other devices" rows show a pending request and the remote
   truth, and the approval rule (removing a folder asks when Spectra AI requests it).
2. **Convex.** A `bridgeControlRequests` table (account, device, action, args, state
   `pending | claimed | done | failed | expired`, claim token and generation, attempts, `createdBy` user or AI run,
   error, about 10 minutes to expire); `bridge:requestControl` (owner and device checks, idempotent per device,
   action and args while pending); a device-credential `bridgeControl:claim` and complete, like
   `bridgeStructure:claim`; per-folder paused state in `bridge:reportHealth`. convex-test for each.
3. **Bridge (Rust).** A poll step that runs before the paused-folder early return (so a remote resume works), calls the
   same `LocalBridgeControl` method as the local API, and completes with a sentence; `cargo test` and `cargo clippy`.
4. **Web app.** "Other devices" rows gain the relayed actions with honest pending and expired states; an `ai-reach.ts`
   entry, a harness path through the application write path, and an approval-table row.

## Convex functions changed

None. No Convex function, schema or validator changed in this lane, so nothing needs a deploy. 11dc2c79 touches only
the generated type list (`embeddingDimensions` holds a constant, no function). The companion uses the existing
`semantic:related` action.

## Gates

Run in the worktree after the last code commit.

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `npx tsc --noEmit -p convex/tsconfig.json` | pass |
| `npx eslint . --max-warnings=0` | pass |
| `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets`, `check:skills` | pass |
| `npx vitest run --maxWorkers=2` | 594 files and 5177 tests passed, 1 skipped; the one failure, `convex/module-graph.test.ts` (on main since `920b4686`), was fixed in 11dc2c79 and passes alone (5/5). The known flakes did not fail. |

## Needs a visual check

1. **Calendar.** Open a plan's block whose notes have bold text and a list: the Notes row reads as formatted text at
   the details' size and colour, not as markup or flattened words.
2. **Related.** Open a work's companion, Related: linked work first with why, then similar work; a ghost while it
   loads. With embeddings off, the quiet note shows.

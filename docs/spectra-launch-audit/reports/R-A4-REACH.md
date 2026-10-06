# R-A4 — Reach and page follow-ups

Lane A4, branch `lane/reach`, worktree `<local-workspace>`. The lane has two parts:

- Part 1 gives Spectra AI the four things a user could do in the app and it could not: version history, embeds, sharing and publishing.
- Part 2 closes the D3 page follow-ups.

Nothing was run live: no dev server, no browser, no `next build`, no `convex dev` and no deploy. The coordinator lands the branch.

## Commits

| Commit | Part | Change |
|---|---|---|
| 2be733c1 | AI reach | `read_versions` and `restore_version` |
| a5801f0f | AI reach | `read_embeds` and `manage_embed` (resize, pin, follow live, recheck, remove) |
| 6aaf96c0 | AI reach | `read_sharing`; `share` gains withdraw invitation, set/clear exception, create/revoke public link |
| f56e4f05 | AI reach | `publish_code` (publish or unpublish a Code work's live build) |
| 733ce5dc | AI reach | HARNESS.md: the commands only `run_command` reaches, and public link addresses |
| 8dde63a0 | D3 | the split view's expand command says "Open full" |
| a61669cc | D3 | school PDFs and photos open in Spectra's own viewer |
| ea9a4db8 | D3 | `IsolatedErrorBoundary` says offline only when the device is offline |
| bd9aa0fb | D3 | an Agents page component test |
| ebf9bb92 | D3 | admin, platform and ManageBac sections use the kit's `PanelTabs`; `ProductSectionNav` deleted |
| (follow-up) | D3 | the ManageBac class collection test finds Overview as a `tab` |

## Part 1: what Spectra AI can now do

All new commands are run-only. They live in `tools/work.ts`, and the model reaches them through `find_commands` and `run_command`, so the offered tool list does not grow. Content read from people is evidence, never instructions, and the tool output says so: version names, embed titles, member names and compiler reports.

- **Versions.**
  - `read_versions` lists the saved versions.
  - `restore_version` goes through the same signed `artifactRestore` admission the history panel uses, keyed by the operation id so a retry replays its receipt.
  - The admission first saves "Your work before restore", so a restore is an ordinary `write` the user can undo. The `changeGroups:commitRestore` tombstone stays, as plumbing.
- **Embeds.**
  - `read_embeds` lists each embed with its id, source, region, size, version policy and state.
  - `manage_embed` runs the panel's own `artifactEmbeds:update` and `artifactEmbeds:remove` mutations and the refresh action. Removing takes the node out of the host first, as the editors do. Moving an embed stays a block move through `edit_artifact`.
- **Sharing.**
  - `read_sharing` lists invitations, members with exceptions and public link ids.
  - `share` adds withdraw invitation, set/clear exception, create public link and revoke public link, through the share dialog's own mutations.
- **Public links: the secret never enters the journal.**
  - The token is derived on the server: HMAC over (run, operation, resource) under a purpose key from `SPECTRA_SECRET_BRIDGE_KEY`.
  - Only its sha256 hash reaches Convex, through a new `execute` arg (`derived`) that the stored operation never holds. The receipt keeps the link id, policy version and level.
  - The model is told it never sees the address.
  - The user gets a `public_link_created` notice with **Copy link**. It calls `revealAiPublicLink`, which checks the run's owner, checks the link is still active and derives the token again. The notice shows once per operation.
- **Publishing.**
  - The build, asset packing, checkpoint and upload move out of the publish route into `runtime-publish-server.ts`, which the route and `publish_code` share.
  - The AI publishes the live Yjs source, so it never ships code the room has not saved.
  - Unchanged source reuses the current build, so a retried step is safe.
  - A failed build comes back as the compiler's report.
  - An open Code editor refreshes its publish state through `code.publishedChanged`.
- **Permissions.** Creating a public link and publishing are `irreversible` and ask under `external_send` ("Sending or publishing outside Spectra"), not under sharing. This is decided server-side in `spectraHarness.operationCategory`, so "Always allow" for sharing does not cover them.

## Part 2: D3 follow-ups

- **"Open full".** The rename covers the command, the header-actions comment and the status-control test.
- **School files in Spectra's viewer** (`school-file-viewer.tsx`).
  - Handed-in task files and CAS evidence that are PDFs or photos open in a kit `Dialog` over the task:
    - a ghost while the kept copy is fetched;
    - one plain line if a photo cannot show;
    - **Open in a new tab** as the way out;
    - **Copy into Library** beside it for tasks.
  - SVG stays out of the viewer because it can carry script.
  - Other types keep the new-tab path. Documents and slides open in Spectra through Copy into Library.
  - `docs/product/SCHOOL.md` now says exactly this. It used to promise viewers for "documents, slides", and no such viewer exists.
- **`IsolatedErrorBoundary`.**
  - It used to say "This device is offline" for every failure.
  - It now says offline only when `navigator.onLine` is false or a Spectra request never reached the server, and it recovers on `online`.
  - Any other failure gets "This part of Spectra stopped working." with **Try again**.
  - A fallback can be a function of `{offline, retry}`. The Library and Settings use this; the Library's hand-rolled retry button is now the kit `Button`.
- **Agents page test** (`agent-library-shell.component.test.tsx`). It renders the real page with only its data and studio seams mocked, and covers:
  - de-duplication across Discover and Installed;
  - install by reference;
  - uninstall;
  - the failure of published agents, which keeps your own agents and offers Try again;
  - search and the "No agents match" state;
  - the preview dialog.
- **Section tabs.**
  - `PanelTabs` gains an optional `primaryCount`. Tabs past it go into the kit's `OverflowMenu`, a portal, so the row never wraps, and the current tab always trades into the row.
  - Admin, superadmin and ManageBac pass glyph names and keep five tabs in the row.
  - `ProductSectionNav` and its source-string assertion are deleted. The admin People and ManageBac class collection tests now find a `tab`, not a `button`.

## Needs a Convex deploy

`convex/spectraApplicationWrites.ts` and `convex/spectraHarness.ts` changed. Until they deploy, the new commands fail closed (`execute` rejects the unknown command or arg):

- the `mutationFor` cases for `manage_embed` and the sharing actions;
- the `derived` arg on `execute`;
- the `operationCategory` change that puts public links and publishing under `external_send`.

## Live checks for the coordinator

1. Ask Spectra to restore an earlier version. Then undo it.
2. Ask it to resize, pin to a version, follow live, and remove an embed in a document and on a whiteboard.
3. Ask it for a public link:
   - the Copy link notice appears once;
   - the copied address opens in a private window;
   - the run history and the thread show no token;
   - revoking it from Share works.
4. Ask it to publish and unpublish a Code work. An open editor updates. Then press Always allow for publishing and confirm that sharing does not inherit it.
5. School:
   - open a handed-in PDF and a CAS photo: they open in the viewer;
   - open a `.docx`: it opens in a new tab.
6. Offline:
   - with the device offline, the Library and Settings say offline;
   - with a broken query online, they say it stopped working, and Try again recovers.
7. On admin, superadmin and ManageBac at narrow width, the tabs keep the current one visible and the More menu overlays.

## Remaining gaps and limits

- **Scheduled runs.** A public link made in a scheduled run gets no notice, because `emit` is a no-op there. The user can revoke and recreate the link from Share.
- **Publish retries.** A retried publish whose first attempt failed midway can leave an extra "Published …" checkpoint.
- **No harness path yet** for closing a quiz (`quiz.unpublish`) or making an agent private again (`agent.private`).
- **School viewers.** There is no in-place viewer for Office files. They open through Copy into Library or a new tab.
- **Branch is behind main.** `main` (at 7ff179ec) is ahead of the branch's merge base. The branch was not rebased, because landing is the coordinator's. `git merge-tree --write-tree main HEAD` reported no conflicts at that point.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `npx tsc --noEmit -p convex/tsconfig.json` | pass |
| `npm run lint` (`eslint . --max-warnings=0`) | pass, 0 warnings |
| `check:architecture`, `copy`, `design-tokens`, `capabilities`, `secrets`, `deploy-env`, `skills` | all pass (deploy-env skipped outside Vercel) |
| full `npx vitest run --maxWorkers=3` | pass: 558 files, 4844 tests (1 file and 1 test skipped) |

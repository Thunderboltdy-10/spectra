# R-D3 — Pages

Lane D3, branch `lane/pages`, worktree `<local-workspace>`. Every page except the landing page now sits on
the new shell, the kit and the life field. Main was last merged in at `dd195136`, which included af001032 (the AI cursor
light). The coordinator lands the branch.

Nothing was run live. There was no dev server, no browser, no `next build` and no Convex deploy. There are no backend
changes: nothing under `convex/**`, `bridge/**` or `src/app/api/**` changed.

## Commits

| Commit | Page | Step |
|---|---|---|
| 0d15e1cc | all | glyphs for every page icon, and an eslint ban on lucide outside workbars and studios |
| ab728a9f | kit | `PageHeader`/`PageBody`, a collapsible `SidePanel` with `PanelTabs`, and `EmptyState`/`ProblemState`/`LoadingRows`; the Side holds one panel |
| 86397660, 26d81d26, 4d81d874 | School, School data | one page on the per-student API, with Details beside it; `/school-data` lands on `/school` |
| 8dd6b714 | ManageBac | header line, kit buttons, a Details panel |
| fa7f8da0 | Calendar | Plans and details in a collapsible Side panel |
| 45570f74 | Library | folders are a breadcrumb plus a popover tree |
| eecfef6d | Workspace | the companion (Details, Comments, Activity, Related, Conversations) and the inner sheet |
| a19873e1 | Settings | header line; the section list folds into a popover when the Side opens |
| 06a2f8de | Chat | header line and kit controls |
| 4ec54b08 | Devices | header line; Details is a collapsible Side panel |
| 7730d69b | Agents | header line, kit states, token colours |
| 4f34e6a4 | Analytics | header line, a range control, token colours |
| 60efb69f | admin | header line; School context is a Side panel |
| b280bb51 | superadmin | header line; Platform context is a Side panel |
| b66cc74f | public share | kit states, type glyphs, plain words |
| e40ca536 | join | kit buttons |
| 41a8b438 | sign in/up, request access, legal, errors | one `PublicFrame` on the kit, plus a new `not-found` |
| e0a46f1d | Workspace, Library | the root and workspace headers are on the header line |
| 45f22cee | kit | `ProductPageHeader` and `AuxiliaryRail` removed |

## What each page got

- **Shared anatomy.** Every app page has:
  - one header line, with the title in the display serif and an `AdaptiveBar` on the right with a written collapse plan;
  - `PageBody` padding of about 88px at the bottom;
  - nothing fixed in the island zone;
  - at most three columns. A page's Side panel tucks into its tab while `useSideHeld()` is true.
- **Workspace.**
  - Fullscreen work gets the companion, a `SidePanel` with five tabs. Comments and Activity reuse `WorkbenchInspectorTabs` with a fixed `section`. Conversations lists the threads that hold the work.
  - Work in the Side reaches the companion as an inner sheet over the studio panel. It has Back, Open full, and Esc that restores focus. The sheet is also wired into `RouteSidePanelHost`.
  - The chat browser, a thread and a run share one slot, which removes the fourth column.
- **Library.** A breadcrumb with a popover tree replaces the folder column.
- **Calendar.** Plans and details live in a Side panel, and "Open plan" opens in the Side.
- **School.**
  - Overview, Tasks, CAS, Classes and Sync, with a Details panel.
  - Sync errors read as sentences.
  - A student can fix their own account match.
- **ManageBac.** Sync now, Refresh and Details.
- **Settings.**
  - The section list is a sticky column.
  - It becomes a popover when the Side is held or the window is under 900px.
  - Groups use container queries.
- **Chat.**
  - Search, New chat and Runs, plus Rename, Pin and Delete, all in the bar.
  - The runs aside has a labelled close button.
- **Devices.** Choosing a device reveals the Details panel.
- **Agents.**
  - New agent and Filter are in the bar.
  - Kit loading, problem and empty states.
  - Card tints are `color-mix` tokens.
- **Analytics.** A `Segmented` range for 7, 30 or 90 days, Refresh in the menu, token colours, and labels that are no longer in uppercase.
- **admin and superadmin.**
  - Header line with status and Refresh, plus the date range on the platform page.
  - The section nav is shared with ManageBac.
  - Context sits in a Side panel on Overview.
  - Loading uses kit rows.
  - A failed load reads "This didn't load" with Try again. Superadmin no longer prints raw errors.
- **Public share.**
  - Each work is named by its type, with the type's glyph and colour.
  - Kit loading, problem (Try again, or Go to Spectra) and empty states.
  - "View only".
- **join.** Kit primary and secondary buttons, and a link styled as a button.
- **Sign in/up, request access, legal and errors.**
  - `PublicFrame` and `LegalPage`, in `src/components/public-frame.tsx`, with token type.
  - The legal wording is unchanged.
  - Request access reads "Getting into Spectra".
  - `ErrorScreen` uses kit buttons and the `problem` glyph.
  - The new `src/app/not-found.tsx` offers the way to the workspace and home.
- **Memory and Timetable** are redirects and needed no work.

## Fixed along the way

- Request access's primary link used `--accent-primary`, which doesn't exist. It drew white text on no background.
- Next showed its bare 404 for any wrong address.
- The chats button on Workspace and Library had no tooltip.
- The platform page printed raw error text.
- Public share showed blueprint keys such as "FLASHCARD DECK".
- Hex colours were replaced with tokens in Analytics, Agents and superadmin.

## Removed

- `ProductPageHeader` and `AuxiliaryRail`.
- The Devices `details` command and its localStorage key. SidePanel remembers its own state now.
- The dead `.agent-library-create` CSS.
- The 56px icon tiles in the Workspace and Library headers.

## Gates (final run, after the main merge)

- `npx tsc --noEmit -p .`: pass.
- `npx tsc --noEmit -p convex/tsconfig.json`: pass.
- `npx eslint . --max-warnings=0`: pass.
- `npm run check:architecture`, `check:copy` and `check:design-tokens`: pass. The design-token gate gave no warnings.
- `npx vitest run --maxWorkers=3`: 553 files and 4776 tests passed, 1 skipped. None of the known flaky suites failed.
- New or updated tests:
  - `work-companion.component`
  - `superadmin-shell.component`
  - `public-pages` (in `src/app/__tests__`)
  - the admin header and context test in `school-admin-people`
  - the settings popover fold
  - the empty public space
  - the chat and settings tests, updated for the ResizeObserver stubs and the new names

## Needs a live check

- The companion sheet portals into the studio's `aside[aria-label="Work studio"]`. Check it in split mode, both on `/workspace` and on Side-hosting routes.
- The companion is hidden while a thread, run or chat browser holds the slot. Check the switch-over and the threads view.
- The Side panel tucks while the Side is held, at narrow widths, on admin, superadmin, Devices, Calendar and School.
- School's "Copy into Library".
- The Settings popover fold at about 900px.
- The Clerk widget inside the restyled sign-in/up card, in both themes.

## Follow-ups

- `artifact-studio.tsx` still says "Open as tab" and still uses `ChatBrowserButton`. These are studio internals and out of scope here. Rename the command to "Open full".
- Open school files in Spectra's viewers.
- `IsolatedErrorBoundary`'s default fallback says the device is offline for any failure. It should tell offline apart from other errors.
- Agents has no component test.
- `ProductSectionNav` remains as the section nav on admin, superadmin and ManageBac. It could become `PanelTabs` with an overflow.

## Decisions

- One Side slot. The chat browser, threads and runs replace each other rather than stacking.
- Workspace's settings, export and delete stay in a pinned overflow menu rather than becoming bar buttons. Delete should never surface as a bare button.
- Legal text was restyled only, never reworded.
- Merges with main had only import conflicts. Each kept this lane's markup and took main's API changes, such as `GlobalSearch` now passing an artifact id.

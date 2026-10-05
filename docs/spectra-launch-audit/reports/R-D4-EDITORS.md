# R-D4 — Editors

Lane D4, branch `lane/editors`, worktree `<local-workspace>`, from main `401bc4d3`. Binding spec:
`docs/design/EDITORS.md`, with `LIFE.md`, `MOTION.md`, `LANGUAGE.md`, `ICONS.md` and `SHELL.md`. Not merged into main;
the coordinator integrates.

## Result

- **Workbars.** Every editor collapses by a hand-written plan. Groups fold as units, undo and redo never move, and the
  person can reorder commands and groups.
- **Status control.** One control in every work header replaces the spinner, the sync sentence and the bare links. It
  reads the eight states of the EDITORS.md table.
- **Field moments.** Things in a work form from the field at their cause, unform where they were, travel from the
  prism when Spectra writes, and lift, leave a wake and settle when dragged.
- **Embeds.** The picker ranks related and recent work and searches by meaning. A click on the name opens the work,
  and a board preview keeps the board's layout.
- **Bugs fixed on the way.** Each has a test.

Nothing was run live: no dev server, no Convex, no browser, no `next build`. See *What needs a live check*.

## Commits

| Commit | Step |
|---|---|
| 67facf0b | workbar: collapse plans, groups that fold as units, a customise mode |
| e209327e | status: one status control in every work header |
| 3e9dfcad | life: things in a work form, unform and travel through the field |
| bfc8984b | fix(commands): infer a command's tab from whole words, not substrings |
| 6bce8333 | fix(embeds): picker ranking, open from the name, a board's layout |
| 0d03448f | test: the dispatcher and motion suites follow the removed `expanded` and the `scale` keyframes |

## What changed

### 1. Workbars (67facf0b)

- `src/components/ui/adaptive-groups.ts` (new kit file, nothing existing edited): `planGroupedLayout` on
  AdaptiveBar's measurements. A plan's steps hide labels, fold a whole group into one dropdown, or move a command or a
  group into More. Pinned commands never move.
- `components/workbar-plans.ts`: one plan per work type, tested at every width from the editor's minimum to 1360 px.
  Undo and redo come first and never collapse; symbols are always icon-only; worded commands keep their words.
- `components/workbar-arrange.ts`: the pure arrangement of a tab (history, groups, advanced) in the person's saved
  order, so the tests arrange a tab exactly as the bar does.
- `artifact-workbar.tsx`: measures real widths, renders folded groups as menus and More with group headings, marks
  contextual tabs, and has a customise mode (drag or arrow keys). The order is saved per user and per editor in
  `CommandLayout.groupOrder` / `commandOrder`. Disabled reasons are an `aria-describedby` hint plus a tooltip.
- Fixed: Settings > Workbar could not reset the timetable's bar.

### 2. Status control (e209327e)

- `components/artifact-status.ts`: a pure model over `presentSync` and the replicas. It covers saved, saving, offline,
  syncing, waiting for Office, read only, two versions and problem. Each state has:
  - its status glyph, hue and words;
  - the hover sentence ("Saved 2 min ago, and on this computer in Documents › Biology.");
  - the popover facts;
  - the actions the state allows and the surface can carry out.
- `components/artifact-status-control.tsx`:
  - the glyph crossfades in place and plays its own animation once on a change, and continuously while saving or
    syncing;
  - the words slide out of the glyph and back, and a live region announces them;
  - the sentence is the tooltip and the description, and a click opens details and actions;
  - field light: a done-hue pulse when a save lands, light held while the desktop file updates, and the problem hue
    on failure. There is no light when life is off.
- `components/artifact-header-actions.tsx`: the header on AdaptiveBar's plan engine. Status and presence are pinned.
  Comments, Chats and Open as tab step into the header's existing More when the title needs room, so there is never
  a second overflow button.
- Actions are wired in `artifact-studio.tsx`:
  - retry saves;
  - sign in;
  - reconnect opens Bridge settings;
  - history;
  - compare;
  - keep Spectra's or Office's version.

### 3. Field moments (3e9dfcad)

`components/editor-field-moments.ts` (`useEditorFieldMoments`) is mounted once on the studio surface. It watches
`FIELD_OBJECTS` (board nodes, slide objects, events, list items, plan cards, and tables, figures and code in
documents):

- **Forming.** Something new forms from the field at its cause: your pointer or caret, the nearest collaborator's or
  Spectra's cursor, or, when Spectra writes with no cursor here, light that travels from the prism through the field.
- **Text blocks** form as their lines, and only when someone else wrote them, so typing Enter is never an event.
- **Deletion** unforms where the thing was, from its last remembered place.
- **Spectra's regions.** A region Spectra is writing holds light around it until it is done.
- **Drags** leave a wake. What you pick up lifts (`[data-lifted]`) and settles (`[data-settling]`) with a pulse where
  it lands.
- **Budgets:**
  - no work while the field is off;
  - a 900 ms warm-up;
  - batches over 12 nodes (re-renders) are ignored;
  - at most four moments and three glows at once;
  - places are re-measured at most every 250 ms.

### 4. Command tab inference (bfc8984b)

- **The bug.** The patterns matched anywhere in "id label", so they read "review" in "Preview", "row" in "Arrow",
  "add" in "Padding" and "order" in "Border".
- **The fix.** They now match at the start of a word, with an optional un-/re- on the verbs that take one (ungroup,
  reorder, unfreeze, rerun).
- The quiz's "Preview as learner" sat on Review only by that accident; its binding now says `tab: "Review"`.

### 5. Embeds (6bce8333)

- **Picker.** `components/embed-candidates.ts` (`rankEmbedCandidates`):
  - with no query: related work (`useRelated`) first, then the most recently changed;
  - with a query: semantic hits (`useSemanticSearch`) first, then work containing every word, in any order.
  - Before, it used arrival order and one substring.
- **Opening.** A click on an embed's name opens the work in the Side. The button reads "Open" and is named
  "Open <title>"; it used to read "Open source", which reads like open-source software.
- **Board preview.** It places the current page's visible nodes where they sit on the board. Before, it scattered
  them by index.
- **Named arrows.** The slide and card arrows now have names.
- **Errors.** A refused compact/expand in a thread's embed list now shows an error. Before, it was an unhandled
  rejection.

## What I removed

- `workbar-overflow.ts` and its test.
- The expanded workbar mode and its setting.
- Per-command density and its "Button size" setting.
- `swapWorkbarCommandOrders` and the order override.
- Their CSS.
- The header spinner, the sync message and the retry/reconnect/sign-in links.
- The rule that hid status under 780 px, and `headerSyncMessage`.
- The `syncMessage` prop on every studio but SheetsStudio (see the landing merge note).

No compat shims.

## Tests and gates

New or changed tests:

- `adaptive-groups`, `workbar-plans` (every type, every tab, every width), `artifact-workbar.component`;
- `preferences-merge`, `settings-application.component`;
- `artifact-status` (13), `artifact-status-control.component` (12), `editor-field-moments` (15);
- `command-tab-inference` (+13), `embed-frame.component` (5), `embed-candidates` (3);
- `application-dispatcher` (patches `groupOrder`, not the removed `expanded`), `motion-integrity` (allows `scale`,
  `translate` and `rotate`, which composite like `transform`).

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `npx tsc --noEmit -p convex/tsconfig.json` | pass |
| `npm run lint` (zero warnings) | pass |
| `check:architecture`, `copy`, `design-tokens`, `capabilities`, `secrets`, `deploy-env`, `skills` | all pass |
| `npx vitest run --maxWorkers=3` | 4630 passed, 1 skipped, 1 failed; 2 files failed, neither from this lane (below) |

Two failures are pre-existing and come from files this lane does not touch:

- `skills.test.ts` does not load: it imports `scripts/bundle-skills.mjs`, whose `#!/usr/bin/env node` line vitest
  cannot parse (SyntaxError). That belongs to the A2b lane.
- `command-parity` fails on the base commit too (`401bc4d3`), not from this lane. Twelve school and ManageBac mutations
(`school:setMode`, `managebac:attachSchoolFile`, …) shipped in `ad498215` without a command or a written reason. That
belongs to the F1 school lane or the coordinator.

## What needs a live check

- **Workbars:**
  - every editor at 360 to 1360 px: the order things fold matches the plan, nothing jitters on resize;
  - customise mode: drag and keyboard reorder persist across reloads.
- **Status control:**
  - the eight states against a real Bridge replica, Office lock and native conflict;
  - the hover sentence's folder trail;
  - retry, reconnect, sign-in and keep-version actions.
- **Field moments** on a real field canvas:
  - an AI edit with and without a cursor (the prism travel);
  - a collaborator adding a card;
  - deleting a board node;
  - dragging a slide object;
  - frame cost while typing in a long document.
- **Embeds:**
  - the picker's related and semantic ordering on a real index;
  - a board preview of a real flow chart.

## Decisions

- **The header uses AdaptiveBar's planner** rather than a second overflow, so the header and the workbar shed the same
  way and More stays single.
- **Open in Word and Show in folder** are modelled but not offered (`can` is false). The Bridge has no open or reveal
  request, so a button would lie.
- **The native conflict banner stays.** Its actions are also in the status popover; the banner is the louder
  entry point while a conflict is open.
- **Field moments never fire for your own typing**, so a keystroke is never an event. Bulk batches are ignored, so a
  re-render or a paste of a whole document does not set the page alight.
- **The prism is found by its accessible name** (`canvas[role="button"][aria-label^="Spectra"]`) until the shell
  exposes a hook.
- **Not done: one rich-content renderer in every editor** (EDITORS.md, Shared rich content). Moving documents, slide
  text, board notes, quiz and flashcards onto `rich-content/` is a cross-editor migration, not a polish step.
  - Today `SpectraRichContent` renders chat, comments and the workbench; the editors keep their own renderers.
  - A verified citation in `SpectraRichContent` is a button with no action.
- **Not done: inline editing of an embed on double-click.** No type supports inline editing yet.

## Merge notes

- **Main.** At `d1907c4c` it merges into `lane/editors` with no conflicts (`git merge-tree`), so I did not merge it.
- **F2 (Devices / Bridge).**
  - The status control needs Bridge requests to open a work's file in its desktop app and to reveal it in its folder.
  - When they exist, set `can["open-in-office"]` and `can["show-in-folder"]` in `artifact-studio.tsx` (the
    `artifactStatus` memo) and handle both kinds in `handleStatusAction`.
  - The model, words and tests are ready.
- **Shell (island).** Give the island's prism canvas a `data-island-prism` attribute. Then
  `editor-field-moments.ts` (the `PRISM` selector) can find it without matching its accessible name.
- **Landing.** `src/app/landing` passes `syncMessage` to `SheetsStudio`. Drop it there, then remove the unused prop
  from `sheets-studio.tsx`.

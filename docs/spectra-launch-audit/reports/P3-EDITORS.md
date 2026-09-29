# P3-EDITORS: editor behaviour, collaboration safety, undo, clipboard

- **Branch:** `p3/editors`, from main `d04fcd6f`. Worktree `<local-workspace>`.
- **Scope:** behaviour and logic of every artifact editor (document, sheets, presentation, whiteboard, code, quiz, flashcards, plan, timetable) and the shared shell (`artifact-studio.tsx`, `artifact-studio-value-utils.ts`, workbar, persistence, draft recovery). Styling and presence visuals belong to the ui-system agent. The AI run loop, the Office lenses/bridge and `convex/managebac*` were out of scope.
- **Method:** for each editor I listed its first-week jobs and traced each one: UI event → studio command → studio state → shell `changeContent` → debounced `synchronizeDraft` → `NativeArtifactYjsModel.replaceSnapshot` → structured Yjs adapter → peer projection → shell reconciliation → studio re-render. Most defects came from three root causes, each fixed once in shared code and then applied per studio:
  1. **Whole-value writes.** A studio emits its whole value. Anything it held stale (an undo snapshot, a render closure held across an `await`, a React draft behind the live room) overwrote newer work, including a collaborator's, and synced that revert to everyone.
  2. **Structured Yjs lists were rewritten, not diffed.** Two peers editing a list concurrently duplicated every item.
  3. **Orphaned handlers.** A layout refactor kept the handlers but removed the controls that called them.

## Commits

| Commit | Subject |
| --- | --- |
| e30d64db | fix(collaboration): merge concurrent list edits instead of duplicating every item |
| 16f6f0ef | fix(collaboration): stop a studio save from reverting a peer's unabsorbed edit |
| 8c2fd919 | fix(presentation): commit slide text as it is typed and undo without reverting peers |
| 58708e7d | fix(whiteboard): undo one's own edit without reverting collaborators |
| cfea190b | fix(sheets): undo only this person's edit instead of restoring a stale workbook |
| 1d2f1486 | fix(presentation): record an import as an undoable edit pair |
| aa797127 | fix(code): restore adding, renaming, duplicating and deleting source files |
| 4802de09 | refactor(editors): delete orphaned flashcard, presentation and studio code |
| a7e462e7 | feat(editors): give quiz, flashcards, plan and timetable a real undo |
| b6a5b4ad | fix(sheets): paste what was copied, through the native clipboard events |
| bc5f2aa5 | feat(whiteboard): copy, cut and paste objects, text and images |
| 0cdeb5de | fix(presentation,whiteboard): apply edits that finish after an await to the current value |
| 204b788f | fix(quiz,flashcards,code): build post-upload edits on the current content |
| 516626db | fix(timetable): add imported events to the current timetable |
| 814cc198 | fix(code): undo only this person's typing in a shared source file |

## Findings ledger

### Fixed

| # | Sev | Where | Finding / fix |
| --- | --- | --- | --- |
| E1 | High | `work/models/yjs/shared.ts:112` `replaceYArray`; `structured-adapters.ts:188,489`; `scripts/collaboration-native-projection.mjs:527` | **Concurrent list edits duplicated every item.** A keyed list's `order` array was cleared and refilled on every write. When two peers added or reordered at the same time, the CRDT kept both refills, so the projection showed each item twice (quiz questions, flashcards, slides, tasks). `replaceYArray` is now a prefix/suffix trim plus an LCS minimal edit. An emptied keyed list stays a collection. The projection (client and gateway) dedupes ids. Tests: `structured-yjs-concurrency.test.ts` (two Y.Docs: concurrent add, delete, reorder, empty list). |
| E2 | High | `artifact-studio.tsx:3604` `synchronizeDraft`; `artifact-studio-value-utils.ts:495,621` | **An autosave reverted a peer's edit that React had not absorbed yet.** The room projection is coalesced (120 ms) and reconciliation runs a render later. The shell's 140 ms debounced save wrote the whole React draft, erasing the peer's newer value. The draft's own changes since the baseline are now rebased onto the live value before the write (`draftContentForLiveWrite`). Concurrent edits to one string merge when their splices are disjoint (`mergeConcurrentText`), and overlapping splices fall back to a conflict. Tests: `structured-yjs-concurrency.test.ts` "draft into changed room" and the text-merge cases. |
| E3 | High | `presentation-studio.tsx:2593,2618` | **Slide text was saved only on blur.** Typing went to a local gesture copy. A reload or crash before blur lost it, peers saw nothing while you typed, and the blur write reverted whatever peers changed meanwhile. Text now commits per keystroke, and one undo step covers the whole typing session. Test: `presentation-studio-collab.test.tsx`. |
| E4 | Med | `presentation-studio.tsx:2011`, `whiteboard-studio.tsx:1683`, `sheets-studio.tsx:1752`; helpers `artifact-studio-value-utils.ts:639` | **Undo reverted collaborators.** All three studios restored a stored whole snapshot on Ctrl+Z, undoing every peer or AI edit made since. History entries are now `{before, after}` pairs replayed by a three-way rebase onto the current value (`applyStudioHistory`, `commitStudioGesture` for drags). Tests: `presentation-studio-collab`, `whiteboard-studio-undo`, `sheets-studio-undo`. |
| E5 | Med | `presentation-studio.tsx` import path | The PPTX import still pushed a bare deck onto the new history stack. Undo after an import misbehaved, and the file did not typecheck. It now records a `{before, after}` pair. |
| E6 | High | `code-studio.tsx:1019,2541,2961`; `capabilities/studios.ts` | **Code files could not be added, renamed, duplicated, set as entry or deleted.** The StudioItemRail refactor dropped the new-path form and the per-file menu. "Add file" set a flag that nothing read, and the other handlers could not be reached at all. "Add file" (rail and workbar) now opens a path form in the rail. Rename, Duplicate, Set as entry and Delete are workbar commands on the active file, registered in the capability IR. Test: `code-studio-files.test.tsx`. |
| E7 | Med | `artifact-studio.tsx:2040,5096,5202`; `artifact-studio-value-utils.ts:664` | **Quiz, flashcards, plan and timetable had no undo.** A deleted question, card, task or lesson could not be taken back. The shell now keeps a coalescing history for these types (a burst of contiguous typing is one step) and answers Ctrl/Cmd+Z, Shift+Z and Y outside text fields, which keep native text undo. It replays through the same rebase, so undo never reverts a peer. When focus fell to `<body>` because the clicked control was removed, the last studio used owns the shortcut. Tests: `studio-history.test.ts`. |
| E8 | High | `sheets-studio.tsx:1900,3138` | **Ctrl+V pasted a stale in-sheet copy instead of what was on the clipboard.** After any copy inside the grid, pasting a range copied from Excel, Google Sheets or the web re-pasted the old cells. Paste also used `navigator.clipboard.readText` from keydown, which prompts or fails. Copy, cut and paste now use the native clipboard events. Spectra's block, with its formulas and formats, answers a paste only while the system clipboard still holds its text. Test: `sheets-studio-clipboard.test.tsx`. |
| E9 | Med | `whiteboard-studio.tsx:2123` | **The whiteboard had no clipboard.** Ctrl+C/V did nothing, and a screenshot or notes could not be pasted onto the board. Copy and cut now put objects on the clipboard as text and keep them, with their connectors, for an in-board paste. A pasted image uploads like an inserted one. Other pasted text becomes a text object, or a note when it is long. Test: `whiteboard-studio-clipboard.test.tsx`. |
| E10 | High | `presentation-studio.tsx:1584`, `whiteboard-studio.tsx:691`, `quiz-studio.tsx:706`, `flashcard-studio.tsx:596`, `code-studio.tsx:823`, `timetable-studio.tsx:572` | **Edits that finish after an `await` reverted everything made meanwhile.** Inserting a picture, card image, question image or code asset, a deck or calendar import, and whiteboard undo across embed reconciliation all built on the value captured by the render that started them. When the upload finished they emitted a whole stale value, reverting the user's and collaborators' edits. Each studio now builds on a latest-value ref that is advanced on every commit. Tests: `presentation-`, `whiteboard-`, `quiz-`, `flashcard-studio-async-edit.test.tsx`. The timetable import chain has no jsdom harness yet, so it is covered by the live script. |
| E12 | High | `code-studio.tsx:235` `codeEditorCollaboration`, `codeEditorBasicSetup` | **Ctrl+Z in a shared code file reverted a collaborator's typing.** CodeMirror's `history()` records every transaction that is not marked `addToHistory: false`, and y-codemirror dispatches remote edits unmarked. So undo reverted the latest change by anyone and synced that revert to the room. While a file is shared, the editor now binds yCollab's `Y.UndoManager` keymap (local origins only) and turns off CodeMirror history. Test: `code-studio-undo.test.ts` (two Y.Docs and a real EditorView; on the old configuration undo removed the peer's line). |
| E11 | Low | `flashcard-studio.tsx`, `presentation-studio.tsx`, `artifact-studio.tsx`, `code-studio.tsx` | **Dead code deleted.** Removed: the flashcard bulk-selection toolkit, section rename, settings writer, a filter whose setter nothing called (every branch was unreachable), an unread drop-target state, an unused AI-preview summariser, and the code rail's orphaned content search, byte total and icon picker. |

### Reported, not fixed

| # | Sev | Where | Finding / why not fixed |
| --- | --- | --- | --- |
| R1 | Med | `quiz-studio.tsx:906` `removeQuestion`, `removeQuestionMedia`; `flashcard-studio.tsx:807` `releaseUnusedDeckMedia` | Deleting a question, card or image **revokes its asset immediately**. Undo (E7) or a History restore brings the item back with a broken image. Fixing it needs a storage decision: keep assets until a server-side unreferenced-asset sweep runs, or revoke them on a delay. There is no such sweep in `convex/` today. Owner: product plus whoever owns asset lifecycle. |
| R2 | Med | `src/features/spectra/__tests__/action-protocol.test.ts:564` | **Pre-existing failure on main, not caused by this branch.** The test expects `reasoningProfile: "high"`, but `fcf9dbbb` (xhigh effort on every Spectra model turn) returns `"xhigh"`. This is the AI engine's test contract, so it is left for the ai-engine agent. |
| R3 | Low | `artifact-studio.tsx:2040` | The new quiz/flashcards/plan/timetable undo is **keyboard-only**. A workbar Undo/Redo button needs `history.*` capability IR entries for each type plus placement, which is UI work (ui-system). |
| R4 | Low | `code-studio.tsx:3029` | CodeMirror is keyed by the active file id, so **switching files discards that file's undo history** (CodeMirror history or the per-mount UndoManager). The Yjs text is intact. The fix is to keep one EditorState or UndoManager per file. |
| R5 | Low | `code-studio.tsx` | New file and Rename need the Files rail, which only exists on the full surface. In a side panel, only Duplicate, Set as entry and Delete are offered. |
| R6 | Low | `presentation-studio.tsx:4004` | Speaker-notes typing dispatches `notes.set` per keystroke and records **one undo step per character**. It needs the E3 typing-session grouping. |
| R7 | Low | `whiteboard-studio.tsx:1614` `finishPointer` | A drag's undo entry is taken as `after = board` at drop time. It can include a peer change that landed during the drag, which undo would then also revert. The fix is to record the gesture copy, as presentation does. |
| R8 | Low | `sheets-studio.tsx:1752` | Sheet undo rebases on cell addresses. Undoing a row or column insert after a peer edited shifted cells can leave that edit at the pre-shift address. It needs identity-keyed rows (`rowIdentities` exists but is not used for history). |
| R9 | Low | `native-artifact-model.ts:430,666` `planSheetsCellProjection` | The sheets write plans cells against the model snapshot, not a rebased draft (sheets is excluded from E2). There is a sub-frame window where a remote cell refreshed into the snapshot but not yet into React could be overwritten by an unrelated local cell write in the same plan. I found no reproduction. |
| R10 | Low | `plan-studio.tsx:392` `importPlan` | This import builds on the plan captured before `await file.text()`. The window is milliseconds, far shorter than E10's uploads, so it was left. |

### Investigated and rejected as not real

- **Document undo reverting peers.** `document-studio.tsx:963` disables StarterKit history when collaborating. TipTap's Collaboration extension then installs y-tiptap's `yUndoPlugin`, whose UndoManager tracks only local origins. The workbar undo (`document-studio.tsx:2513`) routes to it. Not a defect, unlike code (E12).
- **`documentStubHandlers` noops** (`commands/office/document-commands.ts:1634`). These are deliberate stubs for the capability audit, not dead buttons.
- **Gateway `syncRecord` rewriting live rooms.** At `scripts/collaboration-native-projection.mjs:514` it runs only inside the `gateway-bootstrap` transaction for an empty room.
- **Flashcard delete missing.** Single-card delete exists in the card header (`flashcard-studio.tsx:2365`). Only the unreachable bulk toolkit was dead (E11).

## Tests and gates

- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx eslint <touched files> --max-warnings=0`: clean.
- `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets`: all pass.
- **Full Vitest** (`--maxWorkers=3`, run before E12): 452 files passed, 1 failed. The failure is R2, a pre-existing AI test contract. After E12: the code-studio tests (`code-studio-undo`, `code-studio-files`, `use-modal-focus`) pass, and tsc and eslint are clean.
- **New tests, all shown failing on the pre-fix code before passing:**
  - `structured-yjs-concurrency.test.ts`
  - `presentation-studio-collab.test.tsx`
  - `whiteboard-studio-undo.test.tsx`
  - `sheets-studio-undo.test.tsx`
  - `code-studio-files.test.tsx`
  - `sheets-studio-clipboard.test.tsx`
  - `whiteboard-studio-clipboard.test.tsx`
  - `presentation-studio-async-edit.test.tsx`
  - `whiteboard-studio-async-edit.test.tsx`
  - `quiz-studio-async-edit.test.tsx`
  - `flashcard-studio-async-edit.test.tsx`
  - `code-studio-undo.test.ts`
- `studio-history.test.ts` is a unit test for the new helper.

## Needs live verification (browser agent)

Use two signed-in browsers, A and B, in the same class, on the same artifact, with collaboration synchronized (the presence avatars are visible). "Wait" means about 2 s for sync. After each check, reload both browsers and confirm the result persisted.

**Structured lists (E1): quiz, flashcards, plan.**
1. A and B open the same quiz. Within one second of each other, A adds a question and B adds a question.
   - Expected: both browsers show exactly the original questions plus two new ones, and none is duplicated.
2. A deletes question 2 while B reorders questions 3 and 4.
   - Expected: both show the delete and the reorder, and nothing is duplicated.
3. Repeat 1 in a flashcard deck (add card) and in a plan (add task).

**Save does not revert a peer (E2).**
1. In a plan, A renames task 1. Within about 100 ms, B ticks task 2 done.
   - Expected: after the wait, both show the renamed task 1 and task 2 done.
2. A and B type in the same quiz prompt at different ends ("colour" becomes "colours" on A and "color" on B).
   - Expected: both converge on "colors". Overlapping edits may show the conflict banner, but must not silently lose text.

**Presentation (E3, E4, E5, E10).**
1. A types in a slide text box and does not click away. B watches the same slide.
   - Expected: B sees the text appear while A types.
2. A reloads without blurring the box.
   - Expected: the text is kept.
3. A types in a box on slide 1 while B edits slide 2. A presses Ctrl+Z with focus outside the text box.
   - Expected: A's typing is undone as one step, and B's slide 2 edit remains.
4. A inserts a large picture (Insert › Image). While it uploads, B edits slide 2 text.
   - Expected: the picture appears, and B's edit remains in both browsers.
5. A imports a .pptx, then presses Ctrl+Z.
   - Expected: the deck returns to the slides it had before the import.

**Whiteboard (E4, E9, E10).**
1. A edits their sticky. B edits a different sticky. A clicks the empty canvas and presses Ctrl+Z.
   - Expected: A's sticky reverts, and B's edit stays.
2. A selects two connected notes, presses Ctrl+C, then Ctrl+V twice.
   - Expected: two further copies appear, offset each time, with their connector. A paste into a text editor gives the notes' text.
3. Copy a paragraph from any web page, click the canvas, press Ctrl+V.
   - Expected: a note containing that text.
4. Copy a screenshot to the OS clipboard, click the canvas, press Ctrl+V.
   - Expected: an image object uploads and appears in both browsers.
5. While a pasted image uploads, B moves a note.
   - Expected: B's move is kept.
6. Ctrl+X on a selected note.
   - Expected: it is removed, and Ctrl+V restores a copy.

**Sheets (E4, E8).**
1. A types in A1. B types in B2. A clicks the grid and presses Ctrl+Z.
   - Expected: A1 reverts, and B2 is kept. Ctrl+Y re-applies A1.
2. Select A1:B2 and press Ctrl+C. In another app (Excel or Google Sheets), copy a 2×3 range. Click C5 in Spectra and press Ctrl+V.
   - Expected: the external 2×3 values land at C5, and there is no permission prompt.
3. Copy A1:B2 in Spectra (including a formula), select D1, press Ctrl+V.
   - Expected: the formulas and formats paste, with references adjusted as before.
4. Toolbar Paste special › Values after an in-sheet copy.
   - Expected: it still works.
5. Firefox: Ctrl+C and Ctrl+V inside the grid work.

**Code (E6, E10, E12).**
1. Fullscreen code artifact. Click "Add file" in the Files rail, type `src/util.js`, press Enter.
   - Expected: the file is created and opened.
2. Workbar ⋯ › Rename file, change the path, press Enter.
   - Expected: the rail shows the new path.
3. ⋯ › Duplicate file.
   - Expected: a `-copy` file appears.
4. ⋯ › Set as entry file.
   - Expected: the item is disabled on the current entry, and Run uses the new entry.
5. ⋯ › Delete file, then confirm.
   - Expected: the file is removed. On the last remaining file, Delete is disabled.
6. B sees every file change live.
7. While A uploads an asset in Settings, B edits another file.
   - Expected: B's edit is kept.
8. A and B open the same file. A types `mine();` on the last line. Then B types `// peer` on line 1. A presses Ctrl+Z in the editor.
   - Expected: only `mine();` is removed, and `// peer` stays in both browsers. Ctrl+Shift+Z (or Ctrl+Y) re-applies it.
9. Solo (no collaborator connected): typing then Ctrl+Z still undoes.

**Quiz, flashcards, plan, timetable undo (E7).**
1. Quiz: delete question 3 with its delete button, then press Ctrl+Z.
   - Expected: question 3 returns in place. Ctrl+Shift+Z deletes it again.
2. Type a sentence in a prompt, click outside, press Ctrl+Z.
   - Expected: the sentence is undone as one step.
3. Inside the prompt field, Ctrl+Z keeps the browser's own text undo.
4. With B editing question 1, A undoes A's own delete of question 3.
   - Expected: B's question 1 edit remains.
5. Repeat step 1 for a flashcard (Remove card), a plan task (delete) and a timetable lesson (delete).
6. With two studios open side by side, Ctrl+Z after a delete affects only the studio just used.

**Quiz and flashcard media (E10, R1).**
1. A adds a question image (or a card image). While it uploads, B edits another question (or card).
   - Expected: both edits are present afterwards.
2. R1 check: delete a question that has an image, then press Ctrl+Z.
   - Currently expected: the question returns with "Media unavailable". Record the result for the R1 decision.

**Timetable import (E10).**
1. A imports a .ics with several events. During the upload/progress label, B renames an existing lesson.
   - Expected: the imported events appear, and B's rename is kept.

**Document (regression only).**
1. Bold, a list, a table and an image insert.
2. Ctrl+Z and Ctrl+Y.
3. Paste from Word or Google Docs keeps headings, lists and bold.
4. Two browsers type in different paragraphs, and both edits are kept.

## Shared files touched

- **Shared shell:** `artifact-studio.tsx`, `artifact-studio-value-utils.ts`.
- **Collaboration model:** `work/models/yjs/shared.ts`, `work/models/yjs/structured-adapters.ts`, and the gateway's `scripts/collaboration-native-projection.mjs`.
- **Capability IR:** `capabilities/studios.ts`, which gains five `code` entries.
- **Studios:** `presentation-studio.tsx`, `whiteboard-studio.tsx`, `sheets-studio.tsx`, `code-studio.tsx`, `quiz-studio.tsx`, `flashcard-studio.tsx`, `timetable-studio.tsx`.
- **Markup:** the only markup changes are a path form inside the code Files rail's existing `tools` slot, and clipboard event props on the sheets grid and whiteboard canvas. No classes were renamed.

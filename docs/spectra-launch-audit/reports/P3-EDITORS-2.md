# P3 editors-2: undo, asset retention, shared primitives and stale imports

Branch `p3/editors-2`, taken from main `68275672`. It covers brief items R1, R3, R4, R5, R6, R7, R8 and R10, plus the UI residuals, and adds five findings that were outside the brief.

- Every behaviour fix has a test that failed before the fix and passes after it.
- No browser or live verification was run. The script at the end lists what to check live.

## Findings ledger

### Fixed

| ID | Sev | Where | Root cause → fix |
|---|---|---|---|
| R1 | High | `quiz-studio.tsx`, `flashcard-studio.tsx` (removeQuestionMedia / removeQuestion / removeDeckMedia) | **Cause:** removing or replacing an image, a question or a card revoked the asset. Undo or a History restore then brought back a broken image, even though every retained version still referenced it. **Fix:** an in-editor delete no longer revokes anything. Assets are released with the artifact (`artifactIntakeLifecycle` purge) or through code's explicit "Revoke everywhere". The revoke on a failed flashcard import stays, because that content never landed. |
| R3 | Med | `capabilities/studios.ts` `CONTENT_HISTORY_SPECS`; `artifact-workbar.tsx:60` `contentHistoryBindings`; `artifact-studio.tsx` (contentHistory); `artifact-studio-value-utils.ts` (canUndo/canRedo) | **Cause:** quiz, flashcards, plan and timetable could only undo through Ctrl+Z. **Fix:** each workbar now leads with Undo and Redo, which step the shell history and are disabled when that history is empty. |
| R6 | Med | `presentation-studio.tsx:2624` beginTyping/finishTyping | **Cause:** speaker-notes typing was recorded one keystroke per step. **Fix:** a focus session is now one undo step. A second flaw was also fixed: the old E3 text-undo reverted a peer's edits made during the typing, and the session now replays through `commitStudioGesture`. |
| R7 | Med | `whiteboard-studio.tsx:1647` finishPointer | **Cause:** drag undo restored the whole pre-drag board, which reverted peers' edits. **Fix:** the entry is now the snapshot plus only the dragged nodes' geometry. Whiteboard text typing is also now one step per focus session (it was one step per keystroke). |
| E-code | High | `code-studio.tsx:244` `codeEditorCollaboration` | **Cause:** a new Y.UndoManager and yCollab were created on every render. CodeMirror reconfigured, the undo command read a fresh empty manager, and collaborative undo died after the first re-render, which broke P3 E12 live. **Fix:** one binding and one manager are cached per shared Y.Text (a WeakMap keyed by file). |
| R4 | Med | same | Undo history is now kept per file across a file switch (a consequence of the cache above). |
| R8 | Med | `sheets-studio.tsx:752` `applySheetsHistory`; `sheets/model.ts:2552/2571` | **Cause:** sheet undo replayed by A1 address, so undoing a row or column insert put a peer's edit on a shifted row back at the wrong address. **Fix:** history is now rebased on row and column identity keys and mapped back to addresses. `shiftIdentityMap:2440` now uses the same implicit id format as the rest of the model. |
| UI-1 | Low | `artifact-blueprint-sheet.tsx` | The hand-rolled modal and the native select belonged to `ArtifactBlueprintSheet`, which is **not rendered anywhere** (dead since the studios took over). It was deleted. The exports still in use (`blueprintChoices`, `createDefaultArtifactPayload`) are kept. |
| UI-2 | Med | `artifact-comments-panel.tsx:353` | **Cause:** the panel closed on any window Escape, so pressing Escape in its notifications menu or its Reattach list closed the whole panel. Those lists also opened at `z-dropdown`, under the panel. **Fix:** the panel is now on the shared Dialog (layer `panel`, edge-sheet styling). |
| UI-3 | Low | `timetable-studio.tsx:310` and the event editor | Calendar, Recurrence, Show as, Reminder and Linked work now use SelectField. Empty-string values map to sentinels. A custom imported RRULE or reminder now shows as itself; the native select showed it as "Does not repeat" or "None". |
| UI-4 | Low | `components/ui/select.tsx:224` (shared, named) | **Cause:** SelectField went uncontrolled when its value was unmatched, so action pickers ("Link work…", Plan's "Add reminder…") kept showing the last pick. **Fix:** it is now always controlled, with `""` showing the placeholder. |
| UI-5 | Low | `document-citation-pickers.tsx` (new), `document-studio.tsx`, `spectra-document.css` | The Existing Word source and Source type pickers now use SelectField. The inline panel's `button` CSS no longer styles the Select trigger. |
| R10 | Low | `plan-studio.tsx:125/266` | **Cause:** the CSV import landed on the plan as it was captured before `await file.text()`. **Fix:** import and commit now read the latest content through a ref. |
| E-quiz | Med | `quiz-studio.tsx:1439` | **Cause:** a quiz import appended to the questions as they were before its upload and parse, so a question added meanwhile was dropped. **Fix:** it now appends to `latestQuizRef`. |
| E-wb | High | `whiteboard-studio.tsx:2656` | **Cause:** a board import (CSV, SVG, PDF or package) emitted the whole board it had started from, after the original's upload and conversion. That reverted peers' edits and dropped their new stickies. **Fix:** the import is now replayed onto the current board. |
| R5 + E-tab | Med | `commands/registry.ts:57` `inferTab`; `code-studio.tsx:2473` | **Cause:** any add/new/insert command was inferred onto the "Insert" tab, even for types without one: code, quiz, flashcards, plan, agent and timetable. Code's New file sat on a tab that never renders, on every surface. **Fix:** an inferred tab the type lacks now falls back to General. New file and Rename are offered in a side panel too, and the path form opens above the editor there. |

### Reported, not fixed

| Sev | Where | Why |
|---|---|---|
| Med | `quiz-studio.tsx:626`, flashcard equivalent | The asset list loads once per artifactId. A peer's newly added image shows "Media unavailable" until reload or the next local upload. It needs a live asset subscription, which is out of time. |
| Low | `sheets` history | Row heights and hidden rows or columns are still positional in history. A formula a peer typed after an insert is not rewritten on undo. |
| Low | `code-studio.tsx` | Solo mode (no collaboration document) still loses CodeMirror history when switching files. This is rare because a collaboration document normally exists. The undo selection restore is also lost after a file remount. |
| Low | `timetable-studio.tsx:794`, `flashcard-studio.tsx:954/1339` | Import de-duplication compares against the pre-await snapshot. The write itself uses the latest content, so the only effect is that a rare duplicate can slip through. |
| Low | `plan-studio.tsx` status chip | This native select is deliberate (the comment gives the per-row cost) and was left as is. |
| Low | `artifact-comments-panel` | The panel now covers the viewport with the veil, where it used to cover only the studio pane. This is a design choice from converting it to the shared Dialog. |
| Low | UI-3 trigger | The trigger height is the SelectField `sm` size, not the 34px of the old native select. |

### Rejected

- **Revoking assets on in-editor delete.** This is not needed for storage: the artifact-deletion purge releases assets, and retained versions keep their references.

## Tests and gates

- **New tests:**
  - studio-asset-retention, studio-history-workbar, sheets-history-identity
  - artifact-comments-panel-dialog, timetable-event-selects, document-citation-pickers
  - plan-import-latest, quiz-import-latest, whiteboard-import-latest
  - command-tab-inference
- **Extended tests:** studio-history, presentation-studio-collab, whiteboard-studio-undo, code-studio-undo, code-studio-files, plan-reminders (the dead-sheet assertions were removed).
- **tsc:** clean.
- **eslint:** clean on every touched file.
- **Gates:** check:architecture, copy, design-tokens, capabilities and secrets all pass.
- **Full vitest** (`--maxWorkers=3`): 471 files passed and 1 skipped; 4166 tests passed and 1 skipped; 0 failed.

## Needs-live-verification script

Two browsers, A and B, on the same work, unless a step says otherwise.

1. **Quiz image (R1).**
   - **Do:** Add an image to question 1. Delete question 1, then press Ctrl+Z.
   - **Expect:** the question and its image render.
   - **Do:** Remove the image, then open History and restore the earlier version.
   - **Expect:** the image renders.
2. **Flashcards (R1).**
   - **Do:** Open Advanced card settings, remove the card image, then press Ctrl+Z.
   - **Expect:** the image renders.
   - **Do:** Replace the image, then undo.
   - **Expect:** the old image renders.
3. **Workbar Undo and Redo (R3).**
   - **Do:** Open quiz, flashcards, plan and timetable in turn.
   - **Expect:** Undo and Redo sit first in the bar and are disabled before any edit.
   - **Do:** Edit, then click Undo.
   - **Expect:** the edit is reverted and Redo becomes enabled.
4. **Speaker notes (R6).**
   - **Do:** A types a sentence in the speaker notes. B edits a slide title meanwhile. A blurs the notes and presses Ctrl+Z.
   - **Expect:** the whole sentence goes in one step, and B's title stays.
5. **Whiteboard drag (R7).**
   - **Do:** A drags a sticky. During the drag, B edits another sticky. A presses Ctrl+Z.
   - **Expect:** A's sticky moves back, and B's edit stays.
   - **Do:** A types in a sticky, blurs it and presses Ctrl+Z.
   - **Expect:** the whole text is undone in one step.
6. **Code undo (E-code, R4).**
   - **Do:** In a collaborative code work, type, wait for a re-render (the sync badge changes), then press Ctrl+Z.
   - **Expect:** the typing is undone.
   - **Do:** Switch to another file and back, then press Ctrl+Z.
   - **Expect:** the earlier typing is undone.
7. **Sheets insert (R8).**
   - **Do:** A inserts a row above row 3. B edits a cell in the shifted row. A presses Ctrl+Z.
   - **Expect:** the row is removed, and B's value sits in the row it moved back to.
8. **Comments (UI-2).**
   - **Do:** Open Comments and open the bell menu.
   - **Expect:** the menu is visible above the panel.
   - **Do:** Press Escape.
   - **Expect:** only the menu closes.
   - **Do:** Press Escape again.
   - **Expect:** the panel closes and focus returns to the Comments button.
   - **Do:** Open Reattach on an orphaned comment.
   - **Expect:** the list is visible.
9. **Timetable (UI-3, UI-4).**
   - **Do:** Open an event and set Recurrence to Weekly, then to Does not repeat.
   - **Do:** Link a work.
   - **Expect:** the picker returns to "Link work…".
   - **Do:** Open an imported event with a custom RRULE.
   - **Expect:** it shows "Custom (…)".
   - **Do:** In Plan, add a reminder.
   - **Expect:** the picker resets to "Add reminder…".
10. **Document citation (UI-5).**
    - **Do:** Open a DOCX with Word sources and insert a citation. Pick an existing source, then New supplied source, then set Source type to Book.
    - **Expect:** the triggers are not bold or padded like the panel buttons.
11. **Imports (R10, E-quiz, E-wb).**
    - **Do:** A starts a large CSV or PDF import (plan, quiz or whiteboard). Before it finishes, B adds a task, question or sticky and edits an existing one.
    - **Expect:** after the import, B's additions and edits are kept alongside the imported items.
12. **Code New file (R5, E-tab).**
    - **Do:** Open a code work in the side panel. Open the ⋯ menu and choose New file, type a path and press Enter.
    - **Expect:** the file is created and opened.
    - **Do:** Choose Rename file.
    - **Expect:** it renames the file.
    - **Do:** On the full surface, open the General ⋯ menu.
    - **Expect:** it lists New file.
    - **Do:** Check that quiz, plan and timetable commands named "Add …" appear in their bars.

## Shared files touched (named)

- **Shell, minimal changes:**
  - `artifact-studio.tsx`
  - `artifact-studio-value-utils.ts`
  - `artifact-studio-shell.tsx`
- **Others:**
  - `artifact-workbar.tsx`
  - `components/ui/select.tsx`
  - `commands/registry.ts`
  - `styles/spectra-document.css`

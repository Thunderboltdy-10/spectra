# Editors and artifacts

## The workbar

The workbar is the command bar inside each artifact editor.

- **When space allows,** the workbar shows every command inline. It changes form only when there is not enough room.
- **It runs on the shared AdaptiveBar engine** (see [LANGUAGE.md](LANGUAGE.md#adaptive-commands-across-the-whole-app)),
  but each editor's collapse plan is written by a person, tab by tab. It is not derived from generic priority tiers
  (today's `workbar-overflow` drops labels uniformly, which is the problem).
- **Undo and redo come first.** They are icons only and never collapse.
- **Universal symbols are never labelled.**
- **Some commands depend on their words** (Insert citation, Speaker notes, Freeze panes). They keep their label
  longest. When they must give way, the whole group moves into a dropdown (icon plus caret, or the group name), so the
  command is never shrunk to an ambiguous icon.
- **Groups give way as units,** the way the Office ribbon does. Typically:
  1. secondary groups move into dropdowns first;
  2. then labels go from commands whose icons are unmistakable;
  3. the most-used group keeps its full form longest.
- **Tabs and contextual tabs.**
  - Tabs follow the Office-style structure (Home, Insert, and so on).
  - Contextual tabs (Table, Image, Chart, Shape) appear while their object is selected.
- **Users can reorder.**
  - In a customise mode, the user can drag commands and groups into a different order.
  - The order is saved per user and per editor.
  - Users cannot change which commands collapse or how. The plan follows each command by id wherever it has been
    moved.
- **Each plan is reviewed** with screenshots at the editor widths that really occur:
  - fullscreen with the companion open and closed;
  - in the Side at its default and minimum widths.

## The status control

Every artifact shows its state in one control in its header, so a glance tells the user whether their work is safe
and where it is.

**Where it sits.**

- The control sits at the right end of the artifact header, before the workbar's More.
- It is **pinned**: AdaptiveBar never collapses it, whatever the width.

**What it shows.** Its glyph comes from the status set (see [ICONS.md](ICONS.md#status)). While something is
happening, a short word or two appears beside it:

| State | Glyph | Words while it happens |
| --- | --- | --- |
| Saved, nothing pending | The saved glyph, quiet in ink | None |
| Saving | Saving (the cloud fills) | "Saving" |
| Offline, kept on this device | Offline | "Offline" (it stays while offline) |
| Sending to or from the desktop file | Syncing (arrows turn) | "Updating *Essay.docx*" |
| Waiting for Office to release the file | Waiting for Office, in the needs-you hue | "Open in Word" |
| Read only | Read only | "Read only" |
| Two versions | Two versions, in the problem hue | "Two versions" |
| Problem | Problem | One plain line, for example "Couldn't save. Retrying" |

- **Hover** shows a sentence in a tooltip: "Saved 2 min ago, and on your laptop in *Documents › Biology*."
- **Click** opens a small popover with the details and the actions that state allows:
  - the last save;
  - the desktop file and which device holds it;
  - who has it locked in Office;
  - Open in Word;
  - Show in folder;
  - Keep this version;
  - Compare.

**Movement.** Changes animate inside the glyph (see [MOTION.md](MOTION.md#artifact-status)), and the words slide out
of it and back.

**Words.** Nothing technical: no file system paths beyond a friendly folder trail, and no lock or replica jargon.

## Shared rich content

Text looks and behaves the same in every artifact type:

- documents;
- slide text boxes;
- whiteboard notes;
- quiz questions and answers;
- flashcards;
- plans and tasks;
- comments;
- AI replies.

**One model and one renderer.** `src/features/spectra/rich-content/` and `spectra-rich-content.tsx` provide the
primitives:

- paragraph, headings, lists and checklists;
- callout, quote, code, math;
- citation, link and embed.

**One set of tokens.** Spacing, type scale and colours come from the same tokens in every editor.

**One subset of formatting commands** appears wherever text is edited.

**No editor may restyle these primitives locally.** A text box in a slide must not look like a different product from
a paragraph in a document.

## Embeds

Embedding one artifact inside another must be easy, and the embed must be useful where it sits:

- **Inserting:** `/` → Reference opens a small search at the caret (`inline-reference-picker.tsx`). Recent and related work comes first; Enter or a click sets the work into the page right there. Nothing else on screen moves, dims or blurs.
- **The card:** the shelf's index card set into the page. The tab names the work, its kind is in the icon and hue, and the face is the work itself.
- **The face is the work, nothing else:** flashcards show the cards (turn and step), a quiz shows its questions to answer (a published quiz keeps answers as a private practice attempt and checks them at the end), a presentation shows its real slides, a visualisation runs. No editing tools or summaries on the face.
- **Options:** everything about the embed itself (open, edit here, show more or less, keep this version or follow the live work, remove) sits in one three-dots menu on the card's border.
- **Opening:** a click on the face opens the work in the Side. A double-click edits it inline where the type allows.
- **Stacking:** several works can share one card, a tab each (no folder here; that is the shelf's). "Add another work here" in the menu opens the picker beside the card, and a reference dragged by its grip onto another joins it. "Give it a card of its own" splits one out again. The others ride in the node's `stack` attribute with their placement ids, so each is as placed, saved and seen by Spectra as any reference (`reference-stack.ts`).

## Per-artifact notes

**Planner task.**

- A task is one thing by default: a title, an optional due time, notes, and done.
- Subtasks are optional. They are added only when they are meaningful.
- The AI must not explode a single task into a checklist.

**Calendar.** See [SHELL.md](SHELL.md#per-page-defaults).

**Agents (user-built).** Testing and training get a proper bench (later wave):

- run an agent against sample prompts;
- compare the outputs;
- adjust its instructions;
- save the cases as tests.

**All editors.**

- Empty, loading and problem states come from the kit.
- AI writing shows as AI light (see [MOTION.md](MOTION.md#spectra-writing-ai-light)).
- The field never covers content (see [LIFE.md](LIFE.md#in-editors)):
  - elements condense and dissolve;
  - drags leave wakes;
  - the margins come alive.
- Elements the user creates, moves or deletes behave as physical things:
  - a slide shape lifts when picked up and settles when dropped;
  - a deleted board node dissolves.

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

Embedding one artifact inside another must be easy:

- **Inserting:** `/` → Embed → semantic search. Recent and related items come first.
- **The frame:** a consistent frame with a live preview, resize handles and a type glyph.
- **Opening:** a click opens the embedded artifact in the Side. A double-click edits it inline where the type allows.
- **Tooling:** the editors lane audits today's friction in `artifact-embed*.tsx` and removes it.

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

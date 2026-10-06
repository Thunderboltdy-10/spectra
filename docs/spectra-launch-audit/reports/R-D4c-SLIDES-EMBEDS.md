# R-D4c — Slides text and inline embeds

Lane D4c, branch `lane/slides`, from main at `3038373f`. This lane had two goals:

1. Slide text boxes use the shared rich field, with the same command set as every other editor.
2. An embedded work can be edited where it is embedded.

## 1. Commits

| Commit | What |
|---|---|
| e4e504a6 | The slides model gains checklists, quotes, code and equations. `slideParagraphsAfterEdit` keeps the deck's own paragraph and run properties through an edit. |
| 568808dc | PowerPoint export writes each slide paragraph as its own DrawingML paragraph, with its bullet (including numbered and ☐/☑), level and alignment. |
| 8e21742d | `fieldExtensions` becomes the one TipTap schema every field shares. Run sizes scale with `--rich-pt`. Autocomplete takes a surface. A format-bar button can be off with a stated reason. |
| 5c0813f6 | `SlideTextField` replaces the slide textarea. The studio stores paragraphs, and the CSS and tests follow. |
| 347c0db8 | The embed projection gains `canEditSource`. |
| adf328e3 | Embedded works can be edited in place. Pinned versions are read-only and offer Follow live. A live embed can be pinned. The host keeps its keys out of the nested work. |

## 2. Slide text on the shared rich field

### The field

`components/slide-text-field.tsx` is the same TipTap field and `RichTextFormatBar` as every other field. It uses `fieldExtensions({ box: true })`, which drops headings, rules and the trailing empty line.

Commands available in a slide text box:

- bold, italic, underline, strike;
- bullets, numbering, checklist;
- quote, inline code, link;
- inline and block equations.

The command bar floats beside the box: it is portalled, flips below the box near the top of the window, and pressing it keeps the caret.

### What still works

| Capability | How it carries over |
|---|---|
| Local autocomplete | `SpectraTiptapAutocomplete` with `surface: "slide_text"`, following the writing preferences. |
| AI region and writing light | `data-ai-region` and the target attributes sit on the field host. `AiTextResolve` resolves from that host. |
| Undo | A typing session is still one studio undo step, from focus to blur (the collaboration tests were rewritten for the field and pass). Inside the field, TipTap's own history applies. Text arriving from a peer, Spectra or replace is applied as a minimal diff, outside history, so the caret follows it. |
| Find and replace | Unchanged. It goes through `withPresentationObjectText`, then `retextPresentationParagraphs`, which keeps paragraph and run properties. |
| Overflow measurement | The same rAF measurement on the field host, keyed by the paragraphs. The "Text overflows this object" indicator stays. |
| Deck run formatting | Runs keep font, size (scaled by `--rich-pt` to the canvas), colour, link and alignment. Properties the shared model does not carry are kept by `slideParagraphsAfterEdit`. |
| PPTX import and export | See "Linked PowerPoint decks" below. Export writes real paragraphs (568808dc). |

### Linked PowerPoint decks

This applies when `deck.nativeBinding` is set, or the object has a `nativeShapeId`.

- **The rule.** The office lens refuses a write whose readback is not exactly DrawingML (`OFFICE_READBACK_MISMATCH`). So linked boxes only ever store DrawingML.
- **Commands that are off.** Checklist, Quote, Inline code, Inline equation and Block equation are disabled with the reason "PowerPoint text cannot hold this…". The reason is the button's tooltip and its `aria-describedby`.
- **Pasted content.** It is degraded by `nativePresentationParagraphs`: ☐/☑ prefixes, italic quotes, and code and equations in Consolas and Cambria Math.
- **Plain boxes.** A box that never had paragraphs stays `{ text }` until it is formatted.

### Life

- A ticked checklist item in a slide pulses green through `DONE_TICKS` (`li[data-type='taskItem']`).
- Spectra's writing shows by the region's CSS light.
- Nothing else in LIFE.md's table applies inside slide content.

### Auto-fit (not a regression)

The canvas never auto-fitted text. The textarea only measured overflow. That measurement is kept. The PowerPoint export still writes `normAutofit` (`fit: "shrink"`).

## 3. Editing an embedded work in place

### Where and when

- **Hosts.** Document reference nodes (when the document is editable) and board embed nodes (`editInPlace`). Chat and other read-only renders do not edit in place: a click opens the work in the Side.
- **Conditions** (`editableInPlace`): the embed is ready and live, the source is available, and `canEditSource` is true. `canEditSource` is computed on the server and means the reader holds modify on the source; a retained pin never qualifies. The type must be document, cards, quiz, plan task, slides, sheets, timetable or board. Code and agents need the whole stage, so they open in the Side.

### Entering, editing and leaving

| Step | Behaviour |
|---|---|
| Single click | Opens the work in the Side, about 260 ms later, so that a double-click can edit instead. |
| Enter | A double-click on the preview, or **Edit here**. Controls inside the preview keep their own clicks. |
| Edit | The work's own `ArtifactStudio` (`mode="tab"`, compact, lazily loaded) opens in the embed's frame. Its own workbar, history and sync come with it. A ghost (`data-life-ghost`) shows while it loads. A failure is announced, with Try again. |
| Leave | Done, Escape, or the studio's own close. Unsynchronised changes go through the studio's own close, which asks first. The studio's expand opens the work full. |

### The embed's workbar

The embed's frame header holds its commands. They are the same commands the panel and A4's `manage_embed` use: resize (Expand/Collapse), **Pin** (the latest saved version), **Follow live**, recheck (`RetainedPinRecovery`, unchanged), Open and Remove.

A pinned embed shows "Pinned, read-only" and cannot be edited. Follow live and Use live source now reach the inline host too.

The frame's glyphs are Spectra glyphs (Pencil, Pin, Radio, Check). The nested studio's own workbar keeps its lucide icons.

### Isolation from the host

- **Document.** The reference node's `stopEvent` claims every event inside `[data-embed-editor]`: presses, keys and clipboard. Without this, a click in a nested sheet would select the node, and a paste would land in the document.
- **Board.** `canvasKeyDown` ignores keys from inside the nested work, so Delete cannot remove the board node.
- **Studio.** Its history shortcut skips targets inside a nested embed editor. Its Escape-to-close stands down while one is open, and the frame takes Escape.

### Life

- **Entering:** the preview (`data-life-key="embed:<id>"`, also `data-life-launch`) morphs into the editor frame (`launchFrom` and `useLifeLanding`).
- **Leaving:** the frame folds back into the preview (`useLifeReturn`).
- **Loading** shows a ghost.

## 4. Tests

- `slide-text-field.component.test.tsx` (6 tests): deck type on the field, edits keeping unseen properties, nested bullets, and the shared commands stored as slide paragraphs. Also: a linked deck's disabled commands with their reason and the DrawingML degrade; following a peer's edit without echoing it; locked boxes.
- `presentation-studio-collab.test.tsx`: the typing, collaborator and undo tests now drive the rich field.
- `rich-content-model.test.ts` and `presentation-model.test.ts`: Spectra-only slide text round trips, and `slideParagraphsAfterEdit`.
- `presentation-io.test.ts`: native paragraphs, bullets, levels and ticks in the export.
- `embed-inline-edit.component.test.tsx` (7 tests): double-click edits without also opening the Side, while a single click opens the Side. Also: Edit here, Done and the studio's close; ghost, failure and retry; Escape folds back to the keyed preview; pinned read-only with Follow live; Pin calls `update` with the latest version; the eligibility rules.
- `convex/authority.test.ts`: `canEditSource` is false for a reader and true for the owner.

## 5. Gates (worktree, at adf328e3 plus this report)

| Gate | Result |
|---|---|
| `tsc -p tsconfig.json` | pass |
| `tsc -p convex/tsconfig.json` | pass |
| `eslint . --max-warnings=0` | pass |
| `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets`, `check:skills` | pass |
| `check:deploy-env` | skipped by design outside Vercel builds |
| `vitest run --maxWorkers=3` | 573 files and 4973 tests pass; 1 skipped (as on main) |

## 6. Remaining gaps

- **Nested studio keys.** A nested studio is a second full studio on the page. Shortcuts that studios register on `window` without checking their own surface could reach both. History and Escape are handled. The other window-level shortcuts (the slides studio's, for one) have not been audited for every embedded type.
- **A source open twice.** If the same work is also open in the Side, Done with unsynced changes sends `work.requestClose` to both copies.
- **Pin takes the latest saved version,** not the live content at that moment. The tooltip says "latest saved version". To pick an older version, use the embeds panel.
- **Slide edge cases:**
  - Callouts in slide text read back as quotes.
  - A code or equation block inside a list item leaves the list on re-read.
  - An empty parent bullet directly above a deeper bullet is dropped on the first edit, because the editor's filler line is indistinguishable from it.
- **Not checked in a browser in this lane:** the floating bar's placement on a zoomed canvas, and how the embed frame sizes on a small board node.

## 7. Visual checks to run

1. **Slide text in a Spectra deck.** Type in a box, format a word bold and red, and add a checklist and an equation.
   - The bar floats above the box (below it near the top of the window).
   - Thumbnails match the canvas.
   - Overflow shows the indicator.
2. **Slide text in a deck imported from PPTX.** Checklist, Quote, Code and Equation are greyed out, with the reason on hover. Export and reopen in PowerPoint: bullets, numbering, levels and alignment survive.
3. **A document with a live slides embed.**
   - A double-click morphs the preview into the studio frame. The ghost shows while it loads.
   - Edit a slide, then press Esc: the frame folds back into the preview, and the preview shows the edit.
   - A single click opens the Side.
4. **The same embed, pinned.** It shows "Pinned, read-only" and no Edit here. Follow live returns it to live.
5. **A board with a document embed.** Edit it in place. Delete and Backspace inside the nested work do not remove the board node.

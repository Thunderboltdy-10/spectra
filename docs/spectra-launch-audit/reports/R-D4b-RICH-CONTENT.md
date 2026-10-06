# R-D4b — Shared rich content

Lane D4b, branch `lane/rich`. Goal: text looks and behaves the same in every
artifact type. That means one model, one renderer, one stylesheet scope and one
formatting-command set wherever text is edited.

## 1. Audit: where text was rendered and edited (before)

| Surface | Stored as | Read-only render | Editor | Problems found |
|---|---|---|---|---|
| Document | ProseMirror (Yjs) | — | TipTap (full) | Body size resolved to 13.5px through four conflicting rule sets. Callout backgrounds were invalid CSS. Headings, quotes, links and tables were restyled in three files. |
| AI replies | Markdown | `SpectraRichContent` handed most blocks to a second react-markdown renderer (`chat/rich-text.tsx`) with its own Tailwind look | — | Two renderers that looked different. The "adapter" table returned the source untouched for all 12 entries. |
| Comments | Markdown | `SpectraRichContent` plus `whitespace-pre-wrap` | textarea | Local restyle. |
| Quiz question | Editor HTML | Take/print views: `plannerDescriptionText` (tags stripped). Embeds: a hand-rolled `richText()` stripper. | `ArtifactRichTextEditor` | Formatting and math were lost on every read surface. |
| Quiz options / explanation | text | raw string | input / textarea | Explanation could not hold lists or math. |
| Flashcard faces | Editor HTML | Viewer: `dangerouslySetInnerHTML`. Study and print: `<strong>{html}</strong>` (**literal tags shown**). Embed: a third stripper. History: raw string. | `ArtifactRichTextEditor` (card) | Raw HTML shown to learners. Typed answers were checked against markup. |
| Plan task description | text | — | textarea | No formatting. |
| Task notes / school notes | text | `<p>` with `pre-wrap` | textarea | No formatting. |
| Board notes, shapes, cards | text | textarea (read-only) | textarea | No formatting. A local textarea look. |
| Slide text boxes | DrawingML paragraphs and runs | textarea, including thumbnails and present mode | `LocalAutocompleteTextarea` | **Every keystroke rebuilt every paragraph as one unstyled run**, so imported bold, colour, links, bullets and levels were lost. Thumbnails and presenting never showed run formatting. |
| History snapshots | document blocks / quiz / cards | hand-built `<h4>`/`<aside>`/`<p>` with local callout colours | — | A second document look. |
| Result card summary | Markdown | react-markdown | — | — |

## 2. What changed

1. **Model** (`src/features/spectra/rich-content/`).
   - One AST (version 2) covers paragraph, headings, nested lists and checklists, quote, callout (info/tip/warning), code, math (inline and block), table, citation, work reference, link, media, embed, rule, source note and footnote. Runs carry an optional font, size and colour.
   - Adapters, one per stored format:
     - `markdown` reads and writes;
     - `html` reads, from an inert `DOMParser` document;
     - `prosemirror` reads and writes;
     - `slides` reads and writes paragraphs and runs.
   - Helpers: `richContentFromStored` (sniffs whether a value is HTML or Markdown), `plainTextFromStored`, `isStoredHtml`.
   - The Markdown serializer escapes only what would re-parse differently. Round trips are tested.
2. **Renderer.**
   - `SpectraRichContent` draws the model natively with exactly the DOM TipTap writes (task lists, callouts, equations, citations, tables), with no classes on primitives.
   - Code is highlighted lazily (`rehype-highlight` on a hast tree). Only safe hrefs are rendered (/, http(s), mailto), and external links get `noopener`.
   - `SpectraStoredText` draws any stored field (HTML or Markdown).
     - `inline` keeps an option inside its line.
     - An empty field (`<p></p>`) shows its fallback.
   - `EquationPreview` is shared with the editors.
3. **One stylesheet scope** (`src/styles/spectra-prose.css`, in `@layer components`).
   - Used by the document ProseMirror, every field and every render.
   - Hosts set only `--prose-size`, `--prose-leading` and `--prose-font`; everything else is in em.
   - Modifiers:
     - `.spectra-prose-inline` / `.spectra-prose-inherit` take the host's type;
     - `.spectra-prose-line` clamps to one line.
4. **Read-only surfaces now go through the renderer.**
   - Quiz: take, review, print and embed prompts and options; explanations.
   - Flashcards: the viewer face (no more `innerHTML`), study faces, print faces, embed faces, history cards.
   - History snapshots: documents (from the snapshot's ProseMirror JSON), quiz and cards.
   - Comments, both the panel and the inspector.
   - School task notes.
   - Board notes, shapes and cards at rest.
   - Slide text in thumbnails, present mode and read-only viewers (through the slides adapter).
   - Labels and aria text use `plainTextFromStored`. Typed flashcard answers are compared as words.
5. **One field, one command set.**
   - `ArtifactRichTextEditor` takes `format: "html" | "markdown"` (`editor/field-format.ts`) and the same text schema as a document: checklists, callouts, text style, alignment and equations.
   - `RichTextFormatBar` commands: bold, italic, underline, strike, bullet, numbered, checklist (new), quote, inline code, link, inline equation, block equation.
   - New: `label` (sets `role=textbox` and `aria-label`), `autoFocus`, and the `bare` variant (a floating bar for board objects).
   - Moved to the field, storing Markdown: plan task description, task notes and personal notes, quiz explanation, and board note/shape/text/card body (the field opens on double-click).
6. **Slides.** `retextPresentationParagraphs` keeps the deck's formatting through plain-text edits:
   - unchanged lines keep their paragraph;
   - a changed line keeps the runs around the edit;
   - a new line copies its neighbour's bullet, level and run style.

   This also covers the AI find/replace path, which calls `withPresentationObjectText`. No AI file was edited.

## 3. Removed

- `src/components/chat/rich-text.tsx` (react-markdown renderer) and the `.chat-rich*` CSS.
- The local primitive restyles in `spectra-app.css` and `spectra-document.css`:
  - tiptap-root, planner-description, document colour/size/heading/quote/link/callout rules;
  - continuous-mode sizes, card/compact margins and the heading `!important`;
  - the deck study `<strong>` face, print `p`, `.whiteboard-node textarea`, `.spectra-task-notes` type, the quiz print `h2`, and the table look.
- Helpers: `plannerDescriptionText`, `plannerDescriptionHtml`, the three tag strippers (`artifact-embed`, `artifact-embed-quiz`, studio), and `rich-content/parser.ts`.
- The tiptap classes in `document-studio.tsx`; `font-serif` on fields.
- **Now unused dependencies:** `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`. `package.json` was not edited (lane rule). The orchestrator can drop them.

## 4. Tests and gates

New or extended tests:

- `rich-content-model` (14): round trips for every adapter.
- `rich-content-render` (9):
  - DOM contract and link safety;
  - stored HTML drawn as written, inline options, empty fallback;
  - slide runs and bullets;
  - stylesheet and command-set assertions.
- `artifact-rich-text-collaboration` (+2): Markdown in and out with a checklist and math; accessible name.
- `presentation-model` (+4): run retention, new-line style, deletion, the edit path.
- `whiteboard-studio-font-weight` (+1): a note's Markdown drawn as itself, plus a `--prose-size` assertion.
- Migrated to the new DOM:
  - `whiteboard-studio-undo` and `task-studio` stub the field with a textarea; the field itself is covered separately;
  - `references-context-sources`.

Life hooks were not moved:

- `editor-field-moments`, `ai-region-decoration` and the writing band tests pass unchanged.
- `AiTextResolve` still keys on `closest('[data-ai-region="true"]')`, which every new host keeps.

Gates (worktree, final tree):

- `npx tsc --noEmit -p tsconfig.json`: pass. `-p convex/tsconfig.json`: pass.
- `npm run lint` (`eslint . --max-warnings=0`): pass, 0 warnings.
- `check:architecture`, `copy`, `design-tokens`, `capabilities`, `secrets`, `deploy-env` (skipped outside Vercel) and `skills`: all pass.
- `npx vitest run --maxWorkers=3`: **565 files passed, 1 skipped; 4883 tests passed, 1 skipped.**
- `next build` was not run (lane rule).

## 5. Needs a live or visual check

- **Document body size.** It is now `--text-editor` (16px) with leading 1.7, up from an accidental 13.5px.
- Document callouts and quotes in the new shared look, light and dark.
- Field toolbars: compact fields still reveal the bar on focus, and the checklist button sits after numbered.
- **Board.** At rest, note text is drawn by the renderer (padding 14/15, leading 1.45). In edit mode, the floating bar sits above the object, and the link form sits above the bar. Check small notes, rotated nodes and zoom.
- **Slides.** In thumbnails and present mode, check run colours and sizes, bullet indent, `--prose-gap: 0`, and title and body fonts through `.presentation-object-text`.
- Flashcard study and print faces (display face, clamp sizes), and the quiz print sheet.
- Comments without `pre-wrap`: single newlines are breaks in the model, so the look should match.

## 6. Decisions and why

- **The `components` layer and em sizing.** Host utilities win, and a host sets one size: a heading in a card face and in a document keep their proportion. Unlayered legacy rules would have overridden the layer, so they were deleted rather than patched.
- **Formats stay per surface; there is no single stored format.**
  - Quiz questions and card faces keep editor HTML, so existing data needs no migration.
  - New fields (descriptions, notes, explanations, board text) use Markdown, which the AI and imports already write.
  - The field reads either format through the model.
  - Plain text that existed before is valid Markdown. A first edit may escape stray `*`, `_` or `#`.
- **Slide text boxes keep their textarea editor; they did not move to the TipTap field.**
  - The textarea carries local autocomplete (`surface="slide_text"`), overflow measurement and an object-level style model that A-lane tooling writes.
  - Moving it would have dropped features for parity.
  - Instead, the data-loss bug is fixed at the model, and every shown slide draws its runs.
  - Full in-place rich editing of slide runs is the remaining gap. It needs the slides codec (already written and tested) wired to a run-aware editor, plus autocomplete parity.
- **Quiz options and the card header stay single-line inputs.** Their stored text is still drawn by the model, inline.
- **The flashcard cloze field stays a textarea.** Cloze marking is selection-based on raw `{{c1::…}}` text.
- **Fields cannot hold some blocks.** Tables, media, embeds, source notes and footnotes are flattened to readable text inside a field (the field schema cannot hold them). Headings are capped at H3. The renderer shows them all.
- **Code highlighting runs only in read-only renders.** Editors keep plain code blocks for speed.
- **No external-link glyph** was added to links. The shared look marks links by colour and underline only.
- **Embed rendering is shared; embed commands are not.** Embed blocks render through `ArtifactEmbedById`. Embed commands and AI tooling (A4) were not touched.

## 7. Merge notes

- `artifact-studio.tsx` changes:
  - the snapshot renderer;
  - the format bar's checklist and `ListChecks` import;
  - removal of `plannerDescription*` and the `sanitizeDocumentHtml`/`markdownToDocumentHtml` imports.

  Main's `beginCreation()` change in the duplicate flow is elsewhere in the file, so expect a small textual conflict only.
- `artifact-comments-panel.tsx`: the only change is the `className` on `SpectraRichContent`. The `<div data-comment-body>` wrapper is kept.

# R-L6 Search anchors

Branch `lane/anchors`, from main at cbc17be1.

A search result or citation that points inside a work now opens the work at the matched place. The place is scrolled into view and briefly marked: the target-pulse ring is drawn on its own layer, and light arrives into it from the press that asked (LIFE.md, send). An unknown or stale place opens the work normally, and nothing is said about it.

## How it flows

- **Opening with a region.** `work.open` carries an optional `region: { id, label?, excerpt? }`. The region is bounded by `workRegionFrom`: id up to 400 characters, label up to 240, excerpt up to 600.
  - The shells (spectra, chat, route side panel) and `app.work.open` call `expectLanding(workId, region)` before they open the work.
  - Each landing is held per work for 15 s (`anchors/open-anchor.ts`).
- **Landing in the studio.** `useOpenAnchor(workId, resolve, { ready })` claims the landing once the studio is ready (`anchors/use-open-anchor.ts`). Then:
  1. It runs the resolver's `select` (show the slide, sheet, file, card or view).
  2. It polls `find` every 80 ms, up to 25 tries.
  3. It scrolls the element to the centre. The scroll is instant under reduced motion, and skipped when the resolver sets `scroll: false`.
  4. It marks the element for 1.2 s, clipped to the studio.
  - `OpenAnchorScope enabled={!instanceKey}` keeps inline copies of a work (embeds and previews) from landing.
- **Who sends a region:**
  - the command bar (`kbar.ts`);
  - global search (`context-controls.tsx`);
  - the companion's Related tab;
  - citations: `[n]` with an evidence id, where `source` means the whole work;
  - Spectra AI's `open_in_spectra` (via `navigate_spectra`): `region` is accepted only for an artifact, and Follow AI carries it into `work.open`, or lands in place if that work is already open.
  - The AI `search` tool lists `region <id>` on each artifact hit, so the model can pass it on.
- **Refining the place.** A semantic chunk packs several units under the first unit's region. The result's snippet (the excerpt) refines the landing to the unit the passage is really in (`bestByExcerpt` and `itemInPassage` in `anchors/locate.ts`).

## Per studio

| Studio | Region it reads | What lands | Limits |
| --- | --- | --- | --- |
| Slides | slide id; `slide-N` / "Slide N: …" by position | Switches to the slide, scrolls the canvas to it and marks it | Lands on the whole slide, not an element within it |
| Sheets | sheet id (first range), row identity or `sheetId:row:N`, label "Name A1:F40", "Sheet!B4", "A1:C9" | Shows the sheet, selects the range and scrolls the grid to it; the ring spans the whole range; a multi-row range is narrowed to the row the excerpt matches | Hidden sheets never land; a range on the active sheet is assumed when no sheet is named |
| Document | top-level `data-block-id`; nested block id; `block-N`; heading named in the label or locator | Scrolls to the block the passage is in, refined from the region's block, and marks it with an overlay (the editor DOM is never mutated) | Lands on a whole block, not a character range |
| Whiteboard | node id; frame id (refined to the member node the excerpt matches); edge id (its `from` node) | `revealNode` frames the node on the canvas, then it is marked | The canvas pans rather than scrolls |
| Quiz | question id; "Question N"; `quiz-setting:instructions` | Builder view with the question active, scrolled and marked; instructions open the settings view | Editors only: a learner's attempt is never moved |
| Flashcards | card id; "Card N"; excerpt across packed cards | Card made active, switching from the progress view to the cards view | Lands on the whole card |
| Code | file id, path or "File N"; the line found from the excerpt | Opens the file in code (preview becomes split), CodeMirror centres the line, and the line is marked | Does not take focus; no line when the excerpt is not in the current source |
| Timetable | event id; excerpt over title, location and notes | Moves the visible week to the event if needed, selects it and marks it | Personal timetable only once loaded |
| Task | `task:taskTitle`, `task:description`, `task:subtask:<id>:title` | The title, notes or step is scrolled and marked | `task:progressNote` is not rendered, so it is not landed |
| Agent | `agent:profile`, `agent-instructions`, `agent:routing` | Switches to the overview or releases view (and opens the brief) and marks the part | Lands on the section, not a line |

The threads view: thread results still open the conversation and do not scroll to the message, because messages have no stable DOM ids yet. That is the one source in the brief that is not landed.

## Convex changes

There is no new module and no `api.d.ts` change.

- **`convex/schema.ts`.** Items in `semanticRelatedCache.neighbors` gain an optional `chunkKey`. The field is optional, so no migration is needed. Existing cache rows simply have no passage until they are recomputed.
- **`convex/semantic.ts`:**
  - `related` now runs one extra chunk vector search with the work's centroid (`withPassages`, 96 hits). It keeps the best chunk for each similar work that has a region, and caches its key.
  - `relatedHydrate` loads that chunk and checks it is readable (owner-only chunks are checked). It returns:
    - `snippet` from the passage;
    - `location` set to the passage label;
    - `anchor.regionId`.
  - A new internal query, `chunkRefs`, supports this.
- **`shared/semantic-types.ts`.** `RelatedResult` gains `location?`.

## Tests

- **Locating and landing:**
  - `anchor-locate.test.ts`: the region parsers, the sheet resolver and the document resolver;
  - `open-anchor.test.tsx`: the store, then the hook's land, mark, expire, ready and scope behaviour, plus `scroll: false`.
- **Senders:** `kbar.test.ts`, `application-dispatcher.test.ts`, `global-search.component.test.tsx`, `rich-content-citation.component.test.tsx` and `work-companion.component.test.tsx`.
- **The AI chain:**
  - `search-tool.test.ts`: the region in a search hit;
  - `tools.test.ts`: `open_in_spectra` parsing;
  - `application-action-contract.test.ts`: the payload;
  - `ai-ui-events.test.ts` and `follow-ai.test.ts`.
- **Related passages:** `convex/semantic-search.test.ts`.

## Left

- Component tests for each studio resolver inside the real studios. The resolvers are covered through the shared hook and the pure locators, but not mounted per studio.
- Thread message landing (needs message DOM ids).
- Only the visible part of a sheet range is marked.
- No live check. The scroll and mark have not been seen in a browser, by the rules of this lane.

# Flashcard deck artifact plan

## Product and model

This type inherits the artifact standard. Preserve the reference’s sections, card rail, front/back editor, hints, metrics, details, and progressive creation. Add a complete authoring and study product.

Deck content contains ordered sections and stable card IDs. Cards support front/back rich content, cloze/image occlusion, media, accepted alternatives, hint, explanation, source/citation, tags, difficulty, learning objective, language, and optional bidirectional generation. Study state is not shared artifact content: each user has private per-card scheduling/attempt records, algorithm version, ease/stability/difficulty, lapses, next due, and history.

Authoring supports bulk edit, multi-select/move, duplicate detection, search/filter, card templates, validation, import/export CSV/TSV/Anki-compatible packages where legally/technically feasible, print, and preview. Sharing the deck never shares a student’s answers or study history. Teachers may see aggregate assigned-deck progress only under explicit assignment policy and cohort thresholds.

Collaboration uses ordered structured collections and rich-text CRDT regions. Presence marks selected cards/fields. Comments anchor to card/side/region. History renders old deck structure and cards; partial restore can restore cards/sections without overwriting private study state.

AI can derive cards from permitted sources with coverage map, create pending sections/cards, edit selected fields, rebalance difficulty, detect ambiguity/duplicates, generate distractor-like alternatives only where appropriate, and cite sources. It must not fabricate source coverage. Blue traces bind to actual cards/sides.

## UI, failure, migration

Full screen has section/card navigation, editor, preview/study, details/comments/history. Panel mode edits one card; embeds offer deck preview or private study session. Large decks virtualize rails and context fragments. Partial generation leaves valid draft cards and a missing-requirements report. Import quarantines malformed cards.

Migrate existing deck content into stable sections/cards, preserve placements/links, and keep current user study data only after separating it from shared content. Remove hard-coded deck rendering/operation branches.

## Tasks

### DECK-01 Define sections, card variants, rich regions, sources, validation, and private study schema

- [ ] Implemented
- [ ] Independently verified

### DECK-02 Build authoring, bulk operations, templates, search/filter, preview, study, and responsive representations

- [ ] Implemented
- [ ] Independently verified

### DECK-03 Implement collaboration, presence, comments, meaningful versions, and content-only restore

- [ ] Implemented
- [ ] Independently verified

### DECK-04 Implement typed AI coverage/create/edit/rebalance/deduplicate operations and region traces

- [ ] Implemented
- [ ] Independently verified

### DECK-05 Implement private scheduling/attempts and privacy-safe assigned-deck aggregates

- [ ] Implemented
- [ ] Independently verified

### DECK-06 Implement permission-safe embeds, context, citations, and source-revocation behavior

- [ ] Implemented
- [ ] Independently verified

### DECK-07 Implement CSV/TSV/package import/export, print, quarantine, and fidelity reports

- [ ] Implemented
- [ ] Independently verified

### DECK-08 Migrate current decks/study records and prove scale, privacy, restore, and concurrent reorder

- [ ] Implemented
- [ ] Independently verified


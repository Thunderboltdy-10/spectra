# Flashcard deck artifact plan

## Product and reference contract

The deck inherits the artifact standard. `02_flashcard_deck_editor.png` is the executable full-screen specification for shell, sections/card rail, front/back editor, hints, metrics, details, linked work, and progressive creation. Its visible manual Save/Discard affordance is reinterpreted as synchronized draft validity and explicit revert of the current coherent edit group; AI and collaborators always operate on live state. Every visible control must work, with progressive disclosure for advanced card metadata.

Decks are private by default. Read-only viewers can study their own copy of session state; modify access permits authoring. Workspace projection may be removed per deck. Sharing never exposes another user’s answers, scheduling, or study history.

## Model, study, and collaboration

Deck content contains ordered sections and stable card/side/field IDs. Cards support rich front/back content, cloze and image occlusion, media, accepted alternatives, hint, explanation, sources/citations, tags, difficulty, learning objective, language, and optional bidirectional generation. Study state is separate private user data: card/version, scheduler algorithm/version, attempts, ease/stability/difficulty, lapses, next due, and history.

Authoring supports bulk edit, selection/move, duplicate detection, search/filter, templates, validation, print, preview, and staged CSV/TSV and Anki-compatible interchange where legally and technically feasible. Common front/back/hint actions remain prominent; advanced scheduling/source/template fields live in inspectors.

Ordered collections and rich regions use self-hosted Yjs/domain operations with live synchronized validity. Stable semantic regions are card side, cloze, hint, explanation, source, tag, and selected metadata field. Same region uses exclusive active ownership; different cards/sides can update concurrently. Presence identifies card/field, comments anchor to card/side/region, and reconnect never becomes offline editing.

## AI skill, effects, history, analytics

The on-demand deck skill covers when to create a deck, regions, inspection, coverage, operations, preservation, validation, approvals, relationships, and effects. AI can derive cards from permitted documents/presentations, build a coverage map, create sections/cards, edit selected fields, rebalance difficulty, detect ambiguity/duplicates, and cite sources without fabricating coverage. It loads only this guide when deck work is needed.

Blue effects bind to the actual card/side/field: text forms or morphs, cloze/occlusion regions appear, and independent cards animate concurrently. All effects fully clear after every terminal state and have reduced-motion behavior.

Human authoring sessions and every coherent AI batch create distinguishable versions. AI begins with a user checkpoint when live human changes are uncheckpointed. History renders deck structure/cards, supports type-aware comparison and partial restore without overwriting private study state, and restore creates a new current version. Teachers receive only limited, purpose-bound assigned-learning aggregate signals; no small-cohort suppression is applied, but no response, private thread, prompt, or memory content enters analytics.

## Import, failures, representations, migration

Import supports CSV/TSV with mapping, Anki APKG where feasible, and controlled plain-text/Markdown card formats. Export supports CSV/TSV, print/PDF, and compatible packages where feasible. Quarantine malformed archives/media/scripts, retain originals, report unsupported templates/scheduling/media/formatting, and distinguish shared deck content from private study-state migration.

Full, panel, card, live/pinned embed, study, print, history, narrow, touch, and reduced-motion representations are complete. Explicit states include partial generation, missing source/media, revoked source, malformed import, invalid answer pair, duplicate, collaboration conflict, reconnect, interrupted study sync, permission loss, and partial restore.

## Tasks

### DECK-01 Define sections, card variants, stable side/field regions, sources, validation, versions, and private study schema

- [ ] Implemented
- [ ] Verified

### DECK-02 Build exact reference authoring plus bulk/template/search/filter/preview/study/panel/card/embed/history/print/responsive representations with every control functional

- [ ] Implemented
- [ ] Verified

### DECK-03 Implement live collaboration, presence, comments, exclusive region ownership, reconnect/recovery, meaningful versions, user-before-AI checkpoints, and content-only restore

- [ ] Implemented
- [ ] Verified

### DECK-04 Implement on-demand skill, typed AI coverage/create/edit/rebalance/deduplicate operations, real card/side effects, validation, cleanup, and reduced motion

- [ ] Implemented
- [ ] Verified

### DECK-05 Implement private scheduling/attempts and privacy-safe, limited assigned-experience aggregates without cohort suppression

- [ ] Implemented
- [ ] Verified

### DECK-06 Implement private-default grants, workspace exceptions, public-study choice, permission-safe embeds/context/citations, and source revocation

- [ ] Implemented
- [ ] Verified

### DECK-07 Implement CSV/TSV/text/package import/export and print/PDF with mapping, quarantine, unsupported-feature/fidelity reports, recovery, and tests

- [ ] Implemented
- [ ] Verified

### DECK-08 Migrate current decks/study records, remove legacy branches, and prove every actual UI control, scale, privacy, mixed collaboration, history, embeds, and recovery

- [ ] Implemented
- [ ] Verified


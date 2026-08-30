# Flashcards Capability Inventory

**Scope:** Spectra Nova `flashcard_deck` artifacts: authoring, organization, private study state, statistics, and portable interchange.
**Leaders reviewed:** Anki and Quizlet.
**Generated:** 2026-08-30 for P12.I2.
**IR baseline before P12.I2:** 26 capabilities (15 Flashcards-owned studio definitions plus 11 shared field-format definitions).
**Standing IR baseline after P12.I2:** 63 capabilities.
**P12.I2 target:** every `ship` row below is represented by a typed `CapabilityDefinition`; refusals and deferrals are visible product truth, never ghost controls.

## Contract

`ship` means this unit owns a working path and focused evidence. `refuse-honestly` means the product gives a precise limitation instead of a control that cannot complete. `defer-with-owner` names the phase or system that owns a later implementation. These are the only statuses in this inventory.

Flashcard content remains collaborative artifact data. Review scheduling, ratings, retention, and leech state remain private per-user data. Import and export create or download copies; they never imply a live Anki or Quizlet connection.

## Authoring and bulk editing

| Status          | CapabilityDefinition local id | Anki / Quizlet expectation                   | Spectra P12.I2 contract                                                                                                                |
| --------------- | ----------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ship            | `add-card`                    | Create a note/card                           | Add a basic card through the shared work kernel.                                                                                       |
| ship            | `card.update`                 | Edit prompt and answer                       | Update the selected card with typed, normalized fields.                                                                                |
| ship            | `card.duplicate`              | Duplicate an existing note                   | Clone authored content with a fresh stable card id.                                                                                    |
| ship            | `card.delete`                 | Delete a note/card                           | Delete one selected card with an honest last-card guard.                                                                               |
| ship            | `card.bulk-select`            | Select many browser rows                     | Enter or clear bulk selection without mutating study state.                                                                            |
| ship            | `card.bulk-update`            | Batch-edit note fields                       | Apply section, reverse-study, hint, or explanation changes to selected cards.                                                          |
| ship            | `card.bulk-delete`            | Delete selected notes                        | Remove selected authored cards in one operation.                                                                                       |
| ship            | `card.bulk-tag`               | Add/remove tags in bulk                      | Add or remove normalized tags on the selection.                                                                                        |
| ship            | `template-concept`            | Basic-and-reversed / concept preset          | Add a concept pair with an accompanying cloze card.                                                                                    |
| ship            | `template-language`           | Vocabulary note type                         | Add a front/back vocabulary card with reverse study enabled.                                                                           |
| ship            | `template-formula`            | Formula note type                            | Add a formula card with an explanation scaffold.                                                                                       |
| ship            | `cloze.insert`                | Multiple `c1`, `c2`, … deletions             | Insert or update a numbered cloze deletion without flattening other clozes.                                                            |
| ship            | `cloze.hint`                  | `{{c1::answer::hint}}`                       | Set the hint for one numbered cloze deletion.                                                                                          |
| ship            | `hint.edit`                   | Per-note hint fields                         | Set or clear a card-level hint.                                                                                                        |
| ship            | `explanation.edit`            | Extra/back explanation fields                | Set or clear a post-answer explanation.                                                                                                |
| ship            | `reverse.toggle`              | Generate reverse card                        | Enable or disable reverse study for a basic card.                                                                                      |
| ship            | `occlusion.create`            | Image Occlusion masks                        | Create an image-occlusion card with normalized rectangles and alt text.                                                                |
| ship            | `occlusion.update`            | Move, resize, label, and remove masks        | Replace a card's normalized mask set through a typed operation.                                                                        |
| refuse-honestly | —                             | Arbitrary Anki HTML/CSS/JavaScript templates | Spectra imports safe text and supported image occlusions only; custom template code is not executed or preserved as editable behavior. |
| refuse-honestly | —                             | Anki add-ons and add-on fields               | Add-ons are never executed. Unknown add-on behavior is reported during import.                                                         |
| refuse-honestly | —                             | Audio/video recording and playback           | This unit does not claim rich-media parity. Unsupported media is reported and the surrounding safe text remains importable.            |

## Deck organization and options

| Status           | CapabilityDefinition local id | Anki / Quizlet expectation                           | Spectra P12.I2 contract                                                                                       |
| ---------------- | ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ship             | `rail`                        | Card browser / deck rail                             | Show or hide the dense card rail.                                                                             |
| ship             | `browse`                      | Browse without scheduling                            | Return from study/statistics to authored deck browsing.                                                       |
| ship             | `add-section`                 | Group cards                                          | Add a named top-level deck section.                                                                           |
| ship             | `deck.child.create`           | Anki `Parent::Child` decks                           | Create a nested deck path below an existing path.                                                             |
| ship             | `deck.child.move`             | Move cards between subdecks                          | Move selected cards to a normalized nested deck path.                                                         |
| ship             | `deck.child.rename`           | Rename a deck branch                                 | Rename one branch and its descendants deterministically.                                                      |
| ship             | `tag.rename`                  | Rename a tag                                         | Rename a tag across authored cards.                                                                           |
| ship             | `tag.merge`                   | Consolidate tags                                     | Merge one or more tags into a normalized destination.                                                         |
| ship             | `deck.options`                | Deck-specific SRS options                            | Set desired retention, daily limits, learning steps, relearning steps, maximum interval, and leech threshold. |
| ship             | `deck.preset`                 | Options groups / study presets                       | Apply `gentle`, `balanced`, or `intensive` defaults, after which every option remains editable.               |
| refuse-honestly  | —                             | Shared preset synchronization with AnkiWeb           | Presets are Spectra artifact settings; they are not linked to AnkiWeb.                                        |
| defer-with-owner | —                             | Global tag hierarchy manager spanning every artifact | Owner: P13 knowledge/navigation track. P12 ships nested tag strings and deck-local rename/merge only.         |

## Study and scheduling

| Status          | CapabilityDefinition local id | Anki / Quizlet expectation                                  | Spectra P12.I2 contract                                                                                       |
| --------------- | ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ship            | `study.start`                 | Start a filtered due session                                | Build a private queue from due, new, and learning cards using deck limits.                                    |
| ship            | `study.reveal`                | Reveal answer                                               | Reveal without rating or changing authored content.                                                           |
| ship            | `study.navigate`              | Keyboard next/previous                                      | Move within the active private session.                                                                       |
| ship            | `study.rate`                  | Again / Hard / Good / Easy                                  | Apply an FSRS-family stability/difficulty update and persist the next due date.                               |
| ship            | `study.undo`                  | Undo last review                                            | Remove the latest review effect and restore the previous private scheduling snapshot.                         |
| ship            | `study.bury`                  | Bury until tomorrow                                         | Hide a card from the remainder of the current day.                                                            |
| ship            | `study.suspend`               | Suspend card                                                | Exclude a card from automatic queues until resumed.                                                           |
| ship            | `study.resume`                | Unsuspend card                                              | Return a suspended card to scheduling.                                                                        |
| ship            | `study.reschedule`            | Set due date / reset interval                               | Assign a new due instant without editing the card.                                                            |
| ship            | `study.reset`                 | Forget/reset card                                           | Return one card's private state to new.                                                                       |
| ship            | `study.leech`                 | Flag and manage leeches                                     | Derive leeches from lapse count and allow suspend or clear.                                                   |
| ship            | `progress`                    | Review progress                                             | Open the private study dashboard.                                                                             |
| refuse-honestly | —                             | Quizlet Learn adaptive modes backed by proprietary services | Spectra exposes its FSRS-family scheduler and parameters; it does not imitate undisclosed Quizlet algorithms. |
| refuse-honestly | —                             | Competitive live games                                      | Match/Gravity-style multiplayer games are outside the authored-deck and private-study contract.               |

## Statistics

| Status           | CapabilityDefinition local id | Anki / Quizlet expectation             | Spectra P12.I2 contract                                                                                               |
| ---------------- | ----------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ship             | `stats.retention`             | Answer-button and true-retention stats | Show rolling review count, remembered rate, and desired-vs-observed retention.                                        |
| ship             | `stats.forecast`              | Future due forecast                    | Bucket the current user's scheduled reviews for the next 30 days.                                                     |
| ship             | `stats.heatmap`               | Calendar review heatmap                | Bucket private review history by local calendar day.                                                                  |
| ship             | `stats.leeches`               | Leech list                             | List cards at or beyond the deck leech threshold without leaking authored answers into shared state.                  |
| ship             | `stats.reset`                 | Reset personal progress                | Clear private scheduling/history for this deck only after explicit confirmation.                                      |
| defer-with-owner | —                             | Classroom/cohort analytics             | Owner: P13 learning analytics. Private Flashcards history is not repurposed as a teacher-visible cohort store in P12. |

## Import, export, and interoperability

| Status          | CapabilityDefinition local id | Anki / Quizlet expectation                                                               | Spectra P12.I2 contract                                                                                                      |
| --------------- | ----------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ship            | `import`                      | Import deck data                                                                         | Open the existing P11 import flow through typed IR.                                                                          |
| ship            | `import.preview`              | Map fields before commit                                                                 | Parse supported input, report warnings, and preview normalized cards before replacement or append.                           |
| ship            | `import.commit`               | Append or replace imported notes                                                         | Commit a reviewed import with an explicit append/replace mode.                                                               |
| ship            | `export-csv`                  | CSV export                                                                               | Download authored card fields as UTF-8 CSV.                                                                                  |
| ship            | `export-tsv`                  | Tab-delimited export                                                                     | Download authored card fields as UTF-8 TSV.                                                                                  |
| ship            | `export-package`              | Portable deck package / APKG interchange                                                 | Download Spectra's versioned portable package; APKG import is adapted and never described as a lossless round-trip.          |
| ship            | `print`                       | Printable cards / PDF via print                                                          | Open the print layout for browser printing or Save as PDF.                                                                   |
| refuse-honestly | —                             | Live Quizlet sync                                                                        | Quizlet does not provide a stable open deck-sync contract for this product; Spectra offers reviewed copy import/export only. |
| refuse-honestly | —                             | Live AnkiWeb sync                                                                        | Spectra does not impersonate AnkiWeb clients or retain Anki credentials. Import/export are explicit copies.                  |
| refuse-honestly | —                             | Lossless round-trip of unsupported APKG media, scheduling, add-ons, and custom templates | Import reports discarded or adapted data. Spectra never labels the portable package as a lossless APKG export.               |

## Interaction, accessibility, and responsive truth

| Status          | CapabilityDefinition local id | Anki / Quizlet expectation                       | Spectra P12.I2 contract                                                                                             |
| --------------- | ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| ship            | `study.rate`                  | Keyboard-first reviews                           | Space reveals; 1–4 rate Again/Hard/Good/Easy; commands remain discoverable and focus-safe.                          |
| ship            | `card.bulk-select`            | Efficient browser selection                      | Bulk mode is keyboard reachable with visible selection count and escape path.                                       |
| ship            | `progress`                    | Dense statistics on small screens                | Study, options, and statistics controls stay inside the responsive workbar/overflow grading.                        |
| refuse-honestly | —                             | Offline background scheduling and push reminders | P12 computes due state locally/server-side when Spectra is used; it does not promise OS-level background reminders. |

## Closure checklist

- Every `ship` id is capability IR, not a studio-local registry.
- Authored card/deck data and per-user scheduling/history have separate schemas and mutation paths.
- Scheduler tests cover determinism, monotonic intervals, desired-retention sensitivity, lapses, and leech thresholds.
- Schema v4 migration provides deterministic defaults for legacy flat sections and legacy scheduler state.
- AI manifest operations and the human workbar name the same operation families.
- Conformance, keyboard, and narrow-width tests cover the expanded definitions.
- Every refusal is visible at the relevant import, options, or statistics boundary.

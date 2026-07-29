# Quiz artifact plan

## Product boundary and reference contract

Quiz is strictly practice and formative learning. Do not implement high-stakes assessment, proctoring, punitive grading, locked-down browsers, or consequential gradebook decisions. `03_quiz_builder.png` is the executable full-screen specification for shell, question rail, type, options, difficulty, points, timing, objectives/standards/media, preview, and progressive AI work. The answer-option design is corrected to one clear way to mark an option correct; the reference’s redundant selector is not duplicated. Every other visible control must function.

Quizzes are private by default with read-only/modify sharing, workspace exceptions, and explicit public practice mode only. Answer keys, rubrics, peer responses, and attempts remain permission-separated.

## Model, attempts, and editing

Content includes instructions, sections, stable questions/fields/options, single/multiple choice, true/false, short/long response, numeric, matching, ordering, fill/cloze, formative answer/rubric/explanation, feedback, optional practice points, difficulty, objectives/standards, sources, media, randomization pools, timing guidance, accommodations, attempt policy, and published-practice state.

Attempts are immutable user-owned or assignment-scoped learning records pinned to a quiz version and randomized presentation manifest. They store responses, timing, submit state, formative score components, released feedback, and audit. Editing a published practice quiz creates a draft/new version; active attempts remain pinned. Restore never changes submitted attempts. Subjective AI feedback is clearly advisory and can require configured human review.

Common question/option actions are obvious; advanced standards, pools, timing, accommodations, and release settings use progressive disclosure. The one correct-answer affordance updates the canonical answer model and preview consistently.

## Live collaboration, AI, effects, and history

Authoring uses self-hosted Yjs/domain operations with live synchronized validity. Stable regions include question field, answer option, correct state, rubric, feedback, source, and quiz setting. Same region has exclusive ownership/conflict control; independent questions/options may update concurrently. Presence and comments are field-aware. Attempt response sync is online-first and idempotent: network loss shows reconnect/unsynchronized state and prevents unsafe submission, without offline editing promises or local offline queues.

The on-demand quiz skill defines formative purpose, selection, regions, operations, inspection, preservation, validation, approval, related source artifacts, and effects. AI can plan coverage, generate questions progressively, edit selected fields, validate correctness/ambiguity, generate explanations/rubrics, and run bias/accessibility/source-coverage checks. It never converts advisory formative feedback into a high-stakes decision.

Real effects occur on the actual question/option/correct-state/rubric being produced or changed; independent operations animate concurrently and all effects clear after terminal states. Human authoring sessions and every coherent AI batch are distinct history entries. AI checkpoints live unversioned user work first. Universal comparison is question-aware; restore creates a new current quiz version.

## Imports, representations, failures, migration

Staged import supports QTI 2.x after feasibility validation, Moodle XML where feasible, CSV/TSV for mapped simple types, and structured JSON; export supports QTI where supported, CSV/JSON, and print/PDF. Import quarantine scans archives/media, preserves originals, maps fields explicitly, reports unsupported interactions/scoring/media/metadata and fidelity, and never silently upgrades content into high-stakes behavior.

Builder, preview/practice, assigned practice attempt, results/review, compact card, interactive live/pinned embed, comparison/history, narrow, touch, and reduced-motion states are complete. Handle missing media/source, invalid answer configuration, duplicate correct states, stale versions, reconnect, interrupted idempotent submission, revoked access, partial AI generation, conflict, import quarantine, and unavailable feedback.

## Tasks

### QUIZ-01 Define formative quiz/question/option/rubric schemas, stable regions, practice publish lifecycle, validation, and answer visibility

- [ ] Implemented
- [ ] Verified

### QUIZ-02 Define immutable practice attempts, version pinning, online synchronization, idempotent submission, accommodations, advisory feedback, and release

- [ ] Implemented
- [ ] Verified

### QUIZ-03 Build exact reference builder with one correct-answer control plus preview/attempt/results/card/embed/history/responsive states and every control functional

- [ ] Implemented
- [ ] Verified

### QUIZ-04 Implement live author collaboration, field-aware comments/presence, region claims/conflicts, reconnect/recovery, coherent versions, user-before-AI checkpoints, and restore

- [ ] Implemented
- [ ] Verified

### QUIZ-05 Implement on-demand skill, AI coverage/generation/edit/explanation/rubric/ambiguity/correctness/bias/accessibility checks, real region effects, and cleanup

- [ ] Implemented
- [ ] Verified

### QUIZ-06 Implement private-default/assignment/public-practice permission policies and prove no answer, rubric, response, prompt, thread, or peer leakage

- [ ] Implemented
- [ ] Verified

### QUIZ-07 Implement QTI/Moodle XML/CSV/TSV/JSON import and supported export/print with quarantine, mapping, fidelity, recovery, and tests

- [ ] Implemented
- [ ] Verified

### QUIZ-08 Migrate current quizzes, remove legacy branches, and prove every actual UI control, formative boundary, scale, mixed collaboration, history, embeds, and recovery

- [ ] Implemented
- [ ] Verified


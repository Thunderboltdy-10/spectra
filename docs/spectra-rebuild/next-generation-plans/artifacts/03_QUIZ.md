# Quiz artifact plan

## Scope and boundary

The quiz inherits the artifact standard. Initial positioning is practice and formative assessment, not high-stakes proctoring (D-18). Preserve the reference builder’s question rail, types, options, difficulty, points, timing, Bloom/standards/media, preview, and structured progressive AI work.

## Domain model

Quiz content includes instructions, sections, stable questions, question types (single/multiple choice, true/false, short/long response, numeric, matching, ordering, fill/cloze), options, answers/rubrics, feedback, points, difficulty, objectives/standards, sources, media, randomization pools, timing, accommodations policy, attempt policy, publish state. Answers/rubrics can be permission-separated from student viewers.

Attempts/submissions are immutable user-owned/assignment-scoped records with quizVersionId, randomized presentation manifest, responses, timing, accommodations, submit state, score components, feedback release, grader decisions, and audit. Editing a published quiz creates a draft/new version; active attempts stay pinned. Restore never changes a submitted attempt.

Collaboration covers authoring, with presence/comments per question/field. Students taking an attempt do not share an authoring room. AI can plan coverage, generate questions progressively, edit selected questions, validate answer correctness and ambiguity, generate rubrics/explanations, and run quality/bias/accessibility checks. It cannot grade subjective work as final without configured human review.

## Experience, permissions, failures

Builder, preview/test, assigned-attempt, results/review, compact card, interactive embed, and history are distinct representations. Embedded attempts state their mode and identity; public embeds are practice only. Autosave responses locally/server-side with clear offline/submit behavior. Submission is idempotent and online-authorized.

Question import/export supports QTI if selected after feasibility work, plus CSV for simple types and PDF/print. Missing media, invalid scoring, duplicate correct answers, stale published versions, lost connectivity, and interrupted submission have explicit recovery.

Migrate current quiz content into stable questions and versioned answer permissions. Existing test responses, if any, require a separate privacy/integrity audit before migration.

## Tasks

### QUIZ-01 Define quiz/question/rubric schemas, publish lifecycle, validation, and answer visibility

- [ ] Implemented
- [ ] Independently verified

### QUIZ-02 Define immutable attempt/submission/version pinning, autosave, accommodations, grading, and release

- [ ] Implemented
- [ ] Independently verified

### QUIZ-03 Build builder, preview, attempt, results, card, embed, history, and responsive states

- [ ] Implemented
- [ ] Independently verified

### QUIZ-04 Implement author collaboration, question comments, versions, and published-draft branching

- [ ] Implemented
- [ ] Independently verified

### QUIZ-05 Implement AI coverage, generation, edit, rubric, ambiguity, correctness, bias, and accessibility checks

- [ ] Implemented
- [ ] Independently verified

### QUIZ-06 Implement assignment/privacy policies and prove no answer/rubric or peer-response leakage

- [ ] Implemented
- [ ] Independently verified

### QUIZ-07 Implement QTI/CSV/print import/export with quarantine and fidelity reports

- [ ] Implemented
- [ ] Independently verified

### QUIZ-08 Migrate current quizzes and prove submission idempotency, offline recovery, restore, and scale

- [ ] Implemented
- [ ] Independently verified


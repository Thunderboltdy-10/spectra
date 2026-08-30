# Quiz capability inventory

**Unit:** P12.I1 quiz depth

**Leaders:** Kahoot, Google Forms, Canvas New Quizzes

**Scope:** formative authoring, private or submitted attempts, review, and cohort insight
**IR census:** **78 measured definitions** (23 retained, 50 shipped depth definitions, 5 truthful formative-scope refusals), up from 23 at entry.

This inventory is the P12.I1 contract under CANON R26. Every row has one disposition:

- `ship`: implemented in the quiz model, studio/attempt surface, and capability IR where it is an action.
- `refuse-honestly`: kept visible with the exact plain-language reason below; it never becomes an enabled ghost.
- `defer-with-owner`: not claimed by P12.I1 and assigned to a named later owner.

The leaders are comparison points, not compatibility claims. Kahoot is strongest at playful live delivery, Google Forms at low-friction collection and branching, and Canvas New Quizzes at assessment authoring, banks, scoring, review controls, and analytics. Spectra deliberately targets a calm formative-practice slice: serious question depth and feedback without consequential grading or surveillance.

## Leader comparison and disposition

| Family        | Capability                                                               | Kahoot              | Google Forms               | Canvas New Quizzes         | P12.I1 disposition | Spectra contract                                                                                              |
| ------------- | ------------------------------------------------------------------------ | ------------------- | -------------------------- | -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Authoring     | Add, duplicate, remove, and reorder questions                            | Yes                 | Yes                        | Yes                        | ship               | Stable question IDs survive every edit; reorder is one typed operation.                                       |
| Authoring     | Change question type without replacing unrelated content                 | Yes                 | Yes                        | Yes                        | ship               | A normalized type transition preserves prompt, metadata, and compatible answer data.                          |
| Authoring     | Rich prompts, explanations, links, equations, and media alternative text | Partial             | Yes                        | Yes                        | ship               | Existing field-format IR remains; media requires useful alt text before publish.                              |
| Types         | Multiple choice and true/false                                           | Yes                 | Yes                        | Yes                        | ship               | Existing auto-scored types remain version-pinned in attempts.                                                 |
| Types         | Multiple answers / select all                                            | Yes                 | Yes                        | Yes                        | ship               | Stable option IDs and proportional partial credit are supported.                                              |
| Types         | Ordering                                                                 | Yes                 | No                         | Yes                        | ship               | Keyboard buttons remain available; seeded shuffling does not destroy authored order.                          |
| Types         | Matching                                                                 | Puzzle-style        | No                         | Yes                        | ship               | Stable pair IDs, shuffled choices, proportional scoring, and pair feedback ship.                              |
| Types         | Numeric answer with tolerance                                            | Type-dependent      | Response validation only   | Yes                        | ship               | Absolute tolerance is authored, validated, and graded by shared operations.                                   |
| Types         | Fill blank with accepted variants                                        | No                  | Short answer               | Yes                        | ship               | Accepted variants normalize case and whitespace.                                                              |
| Types         | Short answer                                                             | Open response       | Yes                        | Yes                        | ship               | Exact formative key remains available; no consequential grading claim.                                        |
| Types         | Long response with rubric guidance                                       | Open response       | Paragraph                  | Essay                      | ship               | Advisory review only; the attempt result says it needs reflection, not a grade.                               |
| Types         | Hotspot / image region                                                   | Pin answer          | No                         | Yes                        | ship               | Author regions over one image; attempt mode has pointer and keyboard region choices.                          |
| Types         | Multi-part question / shared stimulus                                    | Limited             | Sections only              | Stimulus + questions       | ship               | One prompt can own ordered auto-scored parts with stable part IDs.                                            |
| Banks         | Explicit question banks                                                  | Question bank       | Import/copy                | Item banks                 | ship               | Named banks live in the quiz model and assign questions by stable ID.                                         |
| Banks         | Pools / random draw                                                      | Random questions    | No native pool             | Item-bank random selection | ship               | Pool membership and draw count remain deterministic for a pinned attempt seed.                                |
| Banks         | Create, rename, and remove banks                                         | Yes                 | No                         | Yes                        | ship               | Removing a bank unassigns questions; it never deletes the questions silently.                                 |
| Randomization | Shuffle questions                                                        | Yes                 | Yes                        | Yes                        | ship               | Seeded and persisted per attempt.                                                                             |
| Randomization | Shuffle answer options                                                   | Yes                 | Yes                        | Yes                        | ship               | Stable option IDs keep response and feedback identity intact.                                                 |
| Timing        | Whole-quiz countdown                                                     | Yes                 | Add-on dependent           | Yes                        | ship               | Server owns expiry and submission; client clocks are presentation only.                                       |
| Timing        | Deadline                                                                 | Assignment schedule | Stop accepting responses   | Assignment schedule        | ship               | Existing deadline policy remains server-enforced.                                                             |
| Timing        | Per-question timer                                                       | Yes                 | No                         | No general per-item timer  | ship               | Server-persisted question start/expiry state prevents refresh resets.                                         |
| Timing        | Learner time multiplier                                                  | No                  | No                         | Accommodations             | ship               | Existing safe multiplier applies to both quiz and question timers.                                            |
| Scoring       | Per-question points                                                      | Yes                 | Yes                        | Yes                        | ship               | Points remain positive and attempt versions remain immutable.                                                 |
| Scoring       | Partial credit                                                           | Type-dependent      | Limited                    | Yes                        | ship               | Proportional credit for multi-answer, matching, hotspot, and multipart responses.                             |
| Scoring       | Incorrect-answer penalty                                                 | No                  | No                         | Yes on supported types     | ship               | Optional bounded penalty cannot reduce an item below zero.                                                    |
| Feedback      | General explanation                                                      | Yes                 | Yes                        | Yes                        | ship               | Existing explanation release policy remains server-authoritative.                                             |
| Feedback      | Correct-answer feedback                                                  | Yes                 | Yes                        | Yes                        | ship               | Separate correct and incorrect feedback fields.                                                               |
| Feedback      | Feedback per answer option / pair / region                               | Yes                 | Yes                        | Yes                        | ship               | Feedback keys use stable answer IDs; no positional association.                                               |
| Attempts      | Attempt limits                                                           | Assignment options  | Limit add-on/workaround    | Yes                        | ship               | Existing experience contract remains the single attempt-limit truth.                                          |
| Attempts      | Resume an attempt                                                        | Yes                 | Edit response              | Yes                        | ship               | Resume is explicit and version-pinned.                                                                        |
| Review        | Answer release timing                                                    | Yes                 | Yes                        | Yes                        | ship               | Immediate, after submit, after deadline, or never; enforced on the server.                                    |
| Review        | Granular review contents                                                 | Limited             | Scores/answers             | Yes                        | ship               | Policy independently controls score, correctness, answers, feedback, and explanations after the release gate. |
| Review        | Results visibility                                                       | Reports             | Response summaries         | Result view                | ship               | Learner, teacher, or both; private response content never enters cohort aggregates.                           |
| Accessibility | Semantic question grouping and progress status                           | Partial             | Strong baseline            | Strong baseline            | ship               | Attempt mode keeps visible labels, status, focus order, and a question navigator.                             |
| Accessibility | Keyboard operation for ordering and hotspot                              | Partial             | Not applicable             | Partial                    | ship               | Every pointer action has a named button/radio alternative.                                                    |
| Accessibility | Reduced motion and non-color result cues                                 | Partial             | Yes                        | Yes                        | ship               | Existing Spectra tokens and motion preferences apply; icons/text accompany color.                             |
| Accessibility | Explicit attempt policy                                                  | No                  | No                         | Accommodations             | ship               | Author can require keyboard-safe interactions and visible timing warnings; validation reports violations.     |
| Analytics     | Submission and in-progress counts                                        | Yes                 | Yes                        | Yes                        | ship               | Existing cohort summary remains.                                                                              |
| Analytics     | Score distribution                                                       | Yes                 | Charts                     | Yes                        | ship               | Anonymous buckets only; no learner identity in the aggregate response.                                        |
| Analytics     | Duration median / range and timeouts                                     | Yes                 | Timestamps                 | Yes                        | ship               | Aggregate duration metrics and timed-out count are server-computed.                                           |
| Analytics     | Per-question correctness and common answers                              | Yes                 | Yes                        | Yes                        | ship               | Existing per-question rows gain score distribution and omit private free-text where unsafe.                   |
| Analytics     | Export aggregate report                                                  | Yes                 | Sheets export              | CSV                        | ship               | CSV export contains aggregate metrics only.                                                                   |
| Publishing    | Validate then publish immutable formative version                        | Host/start          | Accepting responses toggle | Publish/assign             | ship               | Publish refuses incomplete answer models, inaccessible media, or invalid bank/pool settings.                  |
| Publishing    | Unpublish new attempts without mutating history                          | End game            | Stop responses             | Unpublish                  | ship               | Existing version-pinned attempts and responses remain readable.                                               |
| Interchange   | QTI 2.x import and QTI 2.2 export                                        | Spreadsheet import  | Forms import ecosystem     | Native QTI                 | ship               | Existing conversion notes remain explicit; hotspot/multipart fidelity is reported.                            |
| Interchange   | Moodle XML import                                                        | No                  | No                         | No                         | ship               | Existing Moodle import remains; unsupported details get warnings.                                             |
| Interchange   | CSV/TSV and Spectra JSON                                                 | Spreadsheet         | Sheets                     | CSV reports                | ship               | Stable IDs are generated on import and retained on JSON round-trip.                                           |
| Interchange   | Live Kahoot / Google Forms / Canvas connection                           | Live product        | Live product               | Live product               | defer-with-owner   | Owner: later Tier-2 connector fleet. P12.I1 offers import/export only and never labels it sync.               |
| Delivery      | Synchronous game lobby, podium, streaks, and music                       | Core                | No                         | No                         | refuse-honestly    | “Live game hosting is not part of this formative quiz. Share a published practice link instead.”              |
| Assessment    | Locked browser or remote proctoring                                      | No                  | Add-ons                    | Ecosystem                  | refuse-honestly    | “Spectra does not monitor or lock a learner’s device.”                                                        |
| Assessment    | Consequential grades / gradebook writeback                               | Reports only        | Quiz scores                | Core                       | refuse-honestly    | “This quiz is formative practice and does not write grades.”                                                  |
| Assessment    | Teacher manual scoring queue                                             | Reports             | Manual review              | Core                       | refuse-honestly    | “Manual grading is outside formative practice. Use advisory rubric feedback instead.”                         |
| Assessment    | Roster assignment and class moderation                                   | Groups              | Classroom integration      | Core                       | refuse-honestly    | “Class assignment and moderation are not available in the formative quiz studio.”                             |

## Capability IR contract

The quiz catalog lives in `capabilities/studio-quiz.ts`; `studios.ts` no longer owns quiz definitions. The 78-definition target is grouped as follows:

| Group                                                             |  Count | Notes                                                  |
| ----------------------------------------------------------------- | -----: | ------------------------------------------------------ |
| Existing studio navigation and attempt actions                    |     12 | Stable IDs retained.                                   |
| Existing rich-field formatting and insertion                      |     11 | Stable IDs retained.                                   |
| Question authoring and answer-model depth                         |     18 | Includes hotspot and multipart.                        |
| Banks, pools, randomization, timing, and delivery settings        |     17 | Typed parameters, deterministic attempt projection.    |
| Scoring, feedback, review, analytics, publishing, and interchange |     15 | AI-exposed authoring verbs map to manifest operations. |
| Visible formative-scope refusals                                  |      5 | Disabled with the exact reasons above.                 |
| **Total**                                                         | **78** | Measured again at close-out.                           |

Every AI-exposed definition names a manifest operation. Every visible workbar or settings binding resolves back to one definition. Refusals have no mutating executor: their generic refusal presenter must return the same sentence to human and AI callers.

## Acceptance checklist

- Legacy v3 content normalizes through one explicit v4 migration; incomplete collaborative drafts stay readable.
- UI and Convex grading import the same pure operations; answer release remains server-enforced.
- Hotspot and multipart authoring, attempt input, grading, review, and import/export behavior are covered by focused tests.
- Per-question timing is server-persisted and cannot be reset by refresh or navigation.
- Banks and pools retain stable identity; a pinned attempt sees a deterministic selected order.
- Workbar projection preserves capability truth at narrow width and moves lower-priority actions into overflow.
- Capability conformance proves unique IDs, manifest symmetry, workbar reachability, and refusal reasons.
- Cohort analytics expose anonymous aggregates, never prompts or private free-text response content.
- Proctoring, gradebook, manual grading, roster assignment, and live-game hosting are visibly refused.

## Comparison references

- Kahoot Help: question types, question bank, game options, reports, and assignments.
- Google Forms Help: quiz keys and feedback, response settings, sections, validation, and summaries.
- Canvas Guides: New Quizzes item types, item banks, stimulus questions, scoring, result-view settings, accommodations, and reports.

These references establish leader breadth only. Actual acceptance is against Spectra’s code, generated capability catalog, and focused P12.I1 tests.

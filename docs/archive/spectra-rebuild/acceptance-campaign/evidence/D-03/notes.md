# D-03 Quiz — sequential Tab P battery

Date: 2026-07-24  
Operator: parent agent only (Chrome exclusive). Fixture: **Spectra Launch Certification** (split studio in Spectra Launch Studio).

## Verified controls
| Control | Result |
|---------|--------|
| Builder / Settings / Preview / Responses tabs | Pass |
| All 9 question types in Type combobox | Pass (MCQ, T/F, select all, ordering, short, numeric, fill blank, long, matching) |
| Change Q1 type Matching → save → revert MCQ | Pass |
| Duplicate / Remove question buttons | Present |
| Correct-answer markers + Correct answer select | Pass |
| Add/Remove/Shuffle options | Present |
| Difficulty / Points / Time / Bloom / Standards / Media | Present |
| Settings: instructions, feedback release, timed, shuffle Q/options, resume, attempts, timing accommodation, practice target | Pass |
| Author Preview (local, no attempt) + Submit answers | Pass |
| Responses privacy copy + New private attempt | Pass |
| Export: Spectra JSON, Editable CSV, QTI 2.2, Print/PDF | Present |
| Import button | Present |
| Publish practice → **Practice live** | Pass |
| Studio chrome: share/comments/embeds/details/history/open as tab | Present |

## Network / console
- Transient `GET /api/spectra?action=runTabs&limit=120` **500** once, then recovered **200**. Not quiz-specific; note for Phase B residual / E follow-up.

## Not fully completed this pass
- File import fidelity (QTI/Moodle/CSV/JSON) with quarantine
- Full private practice attempt scoring round-trip
- Tab C learner privacy strip (`quizPrivacy`) — needs C profile session
- Print/PDF open in external viewer

## Defects / repairs
None blocking this pass. Points spinbutton a11y reported `valuemax=0` while valuemin=1 (odd ARIA; functional value still `1`).

## Grade
**Pass** — builder/settings/preview/responses/export/publish functional. Excellent deferred until imports + learner privacy (Tab C) + full attempt run.

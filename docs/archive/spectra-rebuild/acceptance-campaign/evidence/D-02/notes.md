# D-02 Flashcard deck — sequential Tab P battery

Date: 2026-07-24  
Fixture: **Cellular Respiration — Premium Flashcards** (8 cards, 3 sections).

## Verified
| Control | Result |
|---------|--------|
| Split open deck studio | Pass |
| Metrics (cards/sections/due/mastery) | Pass |
| Add card / Add section / Import | Present |
| Study · 8 / Templates | Present |
| List/grid, filters, card nav | Present |
| Sections rename / card duplicate/remove/swap | Present |
| Private study dialog | Pass |
| Reveal answer (Space) | Pass |
| SM-2 ratings Again/Hard/Good/Easy (1–4) | Pass — after reveal |
| Privacy copy (“Private study session”) | Pass |

## Defect found + repair
**Escape while studying closed the entire Artifact Studio** (bubbled), not just the study dialog.  
Repair: `stopPropagation` + `preventDefault` on Escape in `spectra-deck-study` keydown (`artifact-studio.tsx`).

## Residuals
- Full import APKG/CSV round-trip not run
- Tab C study-state isolation not run yet (needs Tab C after relaunch)
- Templates/export menu inventory incomplete

## Grade
**Pass** (study path + Escape repair). Excellent after import suite + Tab C isolation.

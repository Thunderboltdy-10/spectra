# P1.V3 w1w5 — targeted re-walk of W1–W5

Run date: 2026-08-26
Verifier surface: Playwright session `spectra`; Settings / Library on `http://localhost:3000`; rebuilt Bridge + Word on hidden desktop `P1V3W15`. Fixture `Downloads\spectra-p1v3-rerun-fixture\Last-year essay.docx`. Not the 942-byte stub, not PS 6/PS 8. Convex serving (`npx convex dev --typecheck=disable`). No product code changed.
Scope: W1–W5 only (not pairing, not mount-from-scratch, not W6 / P2.I1).
Verdict: **REJECTED for remaining W1 completion and W3.** W2, W4, W5 independently closed.

## Card results

| Finding | Observed | Result | Evidence |
| --- | --- | --- | --- |
| W5 waiting-while-connected | Header **Connected**. Stub `spectra-p1v3-fixture` detail “1 file will retry…” chip **Waiting to retry**, not Waiting for Bridge. | Pass | `00` |
| W2 Location vs replica list | Location **This device**. List: This device · Up to date; Spectra · Not available here. Radios Keep on this computer. | Pass (those two agree) | `01` |
| W1 F6 Keep in Spectra | Radios locked Moving… ~70s still pending; ~150s stall-fail restored This PC. Consequence “Stored in Spectra” never became true. Duplicate “The last storage change did not finish.” Disk file kept. | Radios no longer strand; completion still fails | `02`–`05` |
| W3 Word save vs Up to date | Hidden Word opened the fixture (Compatibility Mode). Marker `P1.V3 W1W5 WORD-LOCK` saved (log). Spectra still **This device · Up to date · Last verified 11m ago**. Never Waiting for Word. | Fail | `06`–`09`, `word-insert.log` |
| W4 real browser-offline | `setOffline(true)` on Settings: no “Something went wrong”, no Request ID, no AUTH_NOT_SIGNED_IN. Banner + header **Offline**; all folder chips **Offline**. | Pass | `10` |

Library row still said **Unavailable on this device** while the studio said This device · Up to date (`01`). Not W2 (Location vs replica list now agree). Owner P1.I3.

## Independently closed

- P1.V3-W2 Location/replica agreement
- P1.V3-W4 Settings survives real offline without Convex dump
- P1.V3-W5 Waiting to retry while Connected

## Still open

- P1.V3-W1 Keep in Spectra never completes (stall-fail exits pending; attach/verify does not)
- P1.V3-W3 Up to date while Word holds newer/locked bytes
- P1.V3-W6 P2.I1 (not this walk)
- P1.V3-W7 MED Library list “Unavailable on this device” vs studio This device (I3)
- P1.V3-W8 LOCAL duplicate “did not finish” sentence (I4)

## Checks

Focused Vitest: 48 passed / 2 pre-existing I2 string-scans in `bridge-contract.test.ts`, not rewritten.
Hidden Word pid 19728 and Bridge pid 3520 killed. Pablo Word 24396 remained. Desktop `P1V3W15` closed. Do not `convex push`.

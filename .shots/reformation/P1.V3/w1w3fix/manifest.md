# P1.V3 W1/W3 implementer live retest

Run date: 2026-08-26. Isolated fixture `<local-workspace> essay.docx`. Hidden desktop `P1V3Rem`. Pablo Word pid 24396 (`PS 6` / `PS 8`) not touched. No `convex push`.

## What was lying

Bridge queued `op: locked` with no content hash. Outbound drain treated `None == stored hash` as superseded and never called `reportChanges`, so Convex never set `office-locked` and the studio stayed **Up to date** while Word held the file. The same poll loop skipped payload drains whenever `reconcileMissingResources` raced (`MOUNT_SCAN_NOT_CURRENT`), so Keep in Spectra never ingested disk bytes.

## Live result after the fix

| Shot | Observation |
| --- | --- |
| `00` | This PC; radios enabled; W8 failure copy once |
| `01` | Hidden Word open → **Waiting for Word** / This device · Waiting for Word to finish saving |
| `02` | Marker saved (`word-insert.log`); still Waiting, not Up to date |
| `03` | Word killed; leftover `~$` still showed Waiting (stale owner file) |
| `04` | Share-lock is the live hold; leftover `~$` ignored → **Up to date · Last verified 0s ago** |
| `05`/`08` | Keep in Spectra completed: Location **Spectra**; This device · Not available here; Spectra · Up to date; radios enabled; disk file remains (44902 bytes) |
| `07` | Library row is `Last-year essay.docx` without Unavailable on this device |

Out of scope: `05` unfinished-control alert (W6 / P2.I1). Header **Syncing…** can remain while replica disclosure is Up to date (transport/pendingCount); storage labels match.

## Environment

Convex `npx convex dev --typecheck=disable` on `proper-orca-653`. Bridge rebuilt `cargo build -p spectra-bridge`, launched on `P1V3Rem`.

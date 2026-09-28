# F-02 Presence foundations

Date: 2026-07-26. Status: in progress. Current grade: Pass.

## Baseline

Both profiles reached `Live · 1 here`, but the original surface exposed only a
24 px anonymous avatar. It had no visible name, cursor, region activity, or
clear connection between the collaborator and the canvas. This was materially
below the supplied reference and the campaign's Excellent bar.

Evidence `01`–`06` captures the two-user baseline and edit probe.

## Edit probe

- A C insertion appeared on P and both documents converged.
- A single final keystroke took approximately 1.76 s to become visible on P:
  safe, but above the <300 ms Excellent budget.
- Undo initially disappeared locally, then propagated and converged on both
  profiles after roughly 3 s. No peer content was lost.

## Repair

- Preserve local account/name/actor awareness when later presence fields update.
- Publish normalized, throttled artifact-relative human cursor positions.
- Render smooth named cursors directly over the artifact.
- Replace the anonymous dot with a clearer `Here now` control and live activity
  summary; retain a detailed collaborator popover.
- Keep reduced-motion behavior informative.

Evidence `07`–`08` shows the repaired named C cursor (`Pablo MD`) and active
presence on P.

Remaining: active-region labeling across editor types, leave/refresh/idle ghost
checks, and a lower-latency rerun.


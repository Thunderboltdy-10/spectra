# P8.V1 evidence contract

Evidence lives under `.shots/reformation/P8.V1/`. The source-controlled manual
describes how to produce it; the ignored evidence tree records what happened.

## Directory shape

```text
.shots/reformation/P8.V1/
  manifest.json
  run-state.json
  browser/<card>-<sequence>-<state>.{png,json,yml,webm,trace}
  cost/<label>.json
  native/<card>/<hash-or-readback>.json
  faults/<card>/<transition>.json
  reports/<check>.txt
```

`run-state.json` is the resumable queue. `manifest.json` is the durable claim.
Never replace a failed sequence with its rerun; add a `repair-<n>` sequence and
link both in the repair record.

## Required record per card

- card id, exact commit/build/instance, actor ids and starting route;
- user goal and the transition being stressed;
- attempted, observed, believed, and final durable/native truth;
- numbered before/intermediate/timeout/recovery/reload evidence;
- browser and Convex metric window labels;
- feel note: what a person would conclude or be unable to do;
- verdict and, on failure, severity/class/blast radius/consumer reruns;
- repair commit and before/after links when changed.

Paths must exist, be non-empty, and postdate the action. Screenshots contain no
secrets, provider keys, invitation tokens, or private file contents beyond the
authorized sacrificial corpus.

## Screenshot analysis rubric

For each full-frame image answer in this order:

1. **Orientation:** Can a person tell the route, active work, active actor, and
   primary next action in one glance?
2. **Reachability:** Can they read the first and last content and reach every
   action without another layer covering it?
3. **Geometry:** Do panes consume shared space deliberately? Are rows aligned,
   overflows intentional, and state effects bounded to their subject?
4. **Hierarchy:** Is there one primary action per moment? Do duplicate corner
   icons or equally loud clusters compete?
5. **Typography and fidelity:** Do size, family, weight, style, truncation, and
   control state agree with the content and Spectra tokens?
6. **Truth:** Does the visual state agree with durable, collaborative, native,
   permission, and connectivity truth at that timestamp?
7. **Recovery:** Is the exit or next action visible without prose archaeology?
8. **Calmness:** Does the surface stay alive without noise, blur, large washes,
   stacked explanations, or robotic vocabulary?

Write observations literally. “Looks off” is not evidence; “the last paragraph
is 38 px behind the 64 px composer at maximum scroll, with no remaining
scrollHeight” is. A heuristic flag is a prompt for human inspection, not an
automatic product verdict.

## Verdict semantics

- `passed`: every expected truth is evidenced on the current candidate.
- `failed`: a reproduced product or budget failure exists; repair is active.
- `blocked`: only a stop-and-ask boundary or true multi-independent-seam class.
- `pending`/`running`: no claim of truth.

GO is allowed only after Z0 and Z1 pass without intervening edits. NO-GO names
the exact failed cards and remains resumable P8.V1 work. No chat summary can
upgrade a card or replace the files above.

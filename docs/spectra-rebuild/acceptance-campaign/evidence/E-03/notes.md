# E-03 Focused-edit battery

Operator: parent agent (Chrome exclusive). Workspace: Spectra Launch Studio.

Goal: with each fixture open and focused, one localized edit; preserve untouched regions; capture blue AI region traces.

## Matrix

| Type | Fixture | Edit prompt | Result |
|------|---------|-------------|--------|
| document | Enzyme Inhibitors Study Notes | `rewrite section 2 more concisely` | **Pass** (after section remap) |
| flashcard_deck | Enzyme Inhibitors � Short Deck | `add a card about IC50 vs Ki for inhibitors` | **Pass** |
| quiz | Enzyme Inhibitors Quiz | `add a question about Lineweaver-Burk plots after question 4` | **Pass** |
| planner_task | Enzyme Revision | `add a subtask to review Lineweaver-Burk plots tomorrow` | **Pass** |
| agent | Cell Biology Study Coach | `add a routing example for questions about mitosis checkpoints` | **Pass** |
| timetable | Glycolysis Revision � This Week | `add a 30-minute quiz block on Friday afternoon` | **Pass** |
| presentation | Enzyme Inhibitors: An Introduction | `make slide 3 more concise and keep the speaker notes` | **Pass** (after focused encouragement fix) |
| sheets | Enzyme Km & Vmax Comparison | `add a validation column that flags whether each enzyme's Km is below 5` | **Pass** |
| code | Tiny Mitosis Phases Sketch | `add a small label under metaphase that says chromosomes align` | **Pass** |
| whiteboard | Enzyme Inhibition Types Concept Map | `recolor the competitive inhibition node to a clearer blue` | **Pass** (after coerce) |

## Document focused edit � 2026-07-25 ~02:52 � Alarming

- Fixture open + composer "about this document"; focus Studio + context.
- Strip Ready To Continue; `1 actioncompleted`; Version history v2 "Spectra updated 2 regions".
- **Corruption:** heading `1.3 Uncompetitive Inhibition` replaced by irreversible prose as an H2; uncompetitive Km/Vmax examples orphaned under it; original `2. Irreversible Inhibition` left in place (duplicate). Not surgical.
- Mid-edit `data-ai-region` count 0.
- Repair: contentPatch/block-targeting helpers + section remap wired in run route.

## Document structure recovery � 2026-07-25 ~02:55

Follow-up focused prompt restored headings correctly: `1.3 Uncompetitive Inhibition` present, bad irreversible-as-heading gone, single �2. Fixture usable again. Root contentPatch targeting still needs clean retest of `rewrite section 2 more concisely`.

## Quiz focused edit � 2026-07-25 ~02:57 � Pass

- Fixture: Enzyme Inhibitors Quiz open.
- Prompt: `add a question about Lineweaver-Burk plots after question 4`
- Strip Ready To Continue; QUESTIONS (10) -> (11); new Q5 `On a Lineweaver-Burk plot, what pattern do uncompetitive inhibitors produce?`
- Soft: mid-edit data-ai-region 0.

## Deck focused edit � 2026-07-25 ~02:58 / 03:01

1. First attempt Failed: `Content patch index is out of range: /cards/-` (append pointer unsupported).
2. Fix: `applyResolvedContentPatch` + `readContentPointer` honor JSON Pointer `-` append.
3. Retest: cards 10->11 applied, but verify Failed `did not contain the requested content change` (normalize added fields). Verify loosened for `/-` append paths.

## Deck retest � 2026-07-25 ~03:03 � Pass

- Prompt: `add a card about IC50 vs Ki for inhibitors`
- Strip Ready To Continue; Cards 11->12; IC50/Ki content present; `1 actioncompleted`.
- Append-path + verify looseness fixes confirmed.

## Sheets focused edit � 2026-07-25 ~03:05 / 03:11 � Alarming (root causes found)

### Attempt 1 � Failed (context budget false positive)
- Prompt as above; sheet open.
- User-facing: `Spectra paused this agent after its reliability context budget.`
- Root: `runSpectraAgentLoop` summed `usage.totalTokens` across turns and compared to `maxTotalTokens` (default 250k). Multi-turn sheet edits with ~90k prompt/turn crossed the cap falsely.
- Fix: treat `maxTotalTokens` as **per-turn prompt** budget; separate loose cumulative spend cap (`�4`). Unit tests added.
- Also: mark reliability budget pauses as quiet-retryable in `plan-diagnostics`.

### Attempt 2 � Off-rails create (wrong focus)
- After deselect/close, composer said "about this sheet" but focus chip showed **Spectra Launch Studio** (workspace).
- Run narrated "Reviewing Enzyme Km & Vmax Comparison" then **Create a test flashcard / Creating Test** � cancelled.
- Roots:
  1. `naturalFocusMode` preferred workspace over open `commandFocusArtifact` whenever a workspace existed.
  2. Strip Deselect still called `onOpen`, reattaching the failed thread.
  3. Close live thread did not clear `composerThread`/continuation.
  4. `provisionalSingleCreation` could still arm create tools alongside focused updates.
- Fixes: artifact-first natural/effective focus; Deselect ? `onDeselect` clears continuation + live panel; close live thread clears continuation; suppress single-creation when `directFocusedAction`.

### Retest � 2026-07-25 ~03:21 � Pass

- Hygiene: New chat + focus chip `Enzyme Km & Vmax Comparison` + sheet Saved.
- Strip Ready to continue; `1 actioncompleted`; columns 10?11.
- Surgical content: header `Km < 5?`; Enzyme A `? Below 5` (3.2); Enzyme B `? Not below` (5.5).
- Preservation: interpretation paragraph intact; both charts + stats intact.
- Soft: mid/post `data-ai-region` still 0.

## Document clean retest � 2026-07-25 ~03:23 � Pass

- Focus chip `Enzyme Inhibitors � Study Notes`; New chat; prompt `rewrite section 2 more concisely`.
- Strip Ready to continue; `1 actioncompleted`.
- Headings preserved: `1.3 Uncompetitive Inhibition`, `2. Irreversible Inhibition` (no irreversible prose as H2).
- Soft: `data-ai-region` 0.

## Sheets retest � 2026-07-25 ~03:21 � Pass

- See matrix. Column `Km < 5?` with ?/? flags; charts + interpretation preserved.

## Planner � 2026-07-25 ~03:25 � Pass
Subtask Lineweaver-Burk added; Ready to continue.

## Timetable � 2026-07-25 ~03:39 � Pass
Friday afternoon quiz block; Ready to continue. Soft: AI regions 0.

## Code � 2026-07-25 ~03:41 � Pass
Metaphase label `chromosomes align`; Ready to continue.

## Agent � 2026-07-25 ~03:43 � Pass
Routing example for mitosis checkpoints; Ready to continue.

## Whiteboard � 2026-07-25 ~03:26 � Alarming
Repeated invalid `propose_operation` (invalid_union). Coerce subagent in flight.

## Presentation � 2026-07-25 ~03:30 � Alarming
Quiet encouragement retry abandoned focused update and streamed hollow presentation create. Fix: keep focused-update tool lock on encouragement path.

## Soft across E-03
Mid-edit `data-ai-region` still typically 0 � AI region subagent in flight.

## E-03 close — 2026-07-25 ~03:47

All 10 types Pass after reliability fixes. Soft: mid-edit data-ai-region often 0 (region depth ongoing).

# R-L1 — Agents bench

Lane L1, branch `lane/bench`, worktree `<local-workspace>`. This lane gives user-built agents the bench
that EDITORS.md asks for. Creators can:

- run an agent on sample questions;
- compare its answers;
- adjust its instructions in place;
- save a question as a test that Run checks includes.

Main was last merged in at `8356a3d8`, in merge commit `ebbc8619`. The coordinator lands the branch.

Nothing was run live: there was no dev server, browser, `next build`, `convex dev`/`deploy`, or model call. Every
path is unit-tested with mocks.

## Commits

| Commit | Step |
|---|---|
| 2dd78885 | Pure bench logic (`agents/foundry/bench.ts`). Saved checks become a `checklist` case in the regression layer. Two answers compare as points new, dropped and reworded, plus shape changes. The instructions behind the brief can be read, edited and written back. A failed check suggests its own fix. The evaluate route parses and words checklist cases. |
| 1b76b5a3 | Convex: the `agentBenchCases` and `agentBenchRuns` tables, and the bench queries and mutations in `agents.ts`. `spectraArtifacts.agentBenchRelease`. A publish gate that needs a passing run newer than the newest saved test. Both tables are registered for the school purge. |
| 0f165dea | New `/api/spectra/agents/bench` route that streams an agent's answer as NDJSON. Run checks (`/agents/evaluate`) now loads saved tests into the suite. The main route gains `agentBench`, `saveAgentBenchCase` and `removeAgentBenchCase`. |
| 4bbf50e2 | The Bench mode in the agent editor, with its client, styles and component tests. Also fixes the empty Overview (see below) and moves the bench error codes onto 4xx statuses. |
| ebbc8619 | Merge of main. The only conflict was the icon import in `agent-foundry.tsx`: main's glyph icons were kept, plus `Play`. |

## What was built

### 1. Bench section

The agent editor's modes are now Overview · **Bench** · Checks · Releases (`work/registry/registry.ts`). The Bench mode
needs `edit`, which matches `modify` on the server.

- **Asking.** A question box and Run. Sample chips come "From its examples", meaning the skills' example inputs.
  Saved tests are listed first, then recent questions.
- **Streaming.** Each answer streams in through the route:
  - the route builds the same system prompt as Run checks (`agents/lab-prompt.ts`, moved verbatim from the evaluate
    route) and calls `callSpectraModel`, so the model and reasoning come from env only;
  - the client sends the draft's unsaved content, so a rerun after an edit answers with the edit;
  - while text arrives, the answer block has `data-ai-region="true"`, `useLifeGlow` and `useWritingFront`;
  - when it settles, the answer renders through `SpectraRichContent`.
- **Bar.** The bar's primary action is **Run all**, and it keeps the Competence toggle.
- **Life.** Questions form with `useLifeArrival(..., "human")` and leave with `useLifeDeparture`.

### 2. Compare

A "Compare with" radiogroup offers two choices.

- **Its answer before.** This is the previous run of the same question.
- **Release N.** This is the newest published release.
  - The route answers with that release's frozen content.
  - In this mode, running a question also asks the release once if it has not answered yet.

Both answers sit side by side, and stack in a narrow pane. Below them, "What changed" summarises the difference:

- chips such as "1 new point", "1 point dropped" or "Longer", and shape changes like lists or headings;
- the new and dropped points themselves.

There is no raw text diff.

### 3. Adjust instructions

An Instructions panel on the bench has:

- objective;
- tone;
- length;
- what the agent must not do;
- for each skill, its purpose, procedure and must / must-not output rules.

It shows "Changed: …" and offers **Apply and run again**, **Apply** and **Discard**. Apply goes through the editor's
own `commit`, so it autosaves like any other edit.

`improvement.ts` cannot produce text suggestions: its proposals come from failed runs and target the competence
ledger. The bench offers its own suggestions instead, derived from the checks. When a saved check fails, the question
shows a line like "Essay feedback should include 'next step'". **Add to the skill** writes that rule into the matching
skill's output contract.

### 4. Save as test

**Save as test** opens a form. A test checks a few things in the answer:

- "A good answer includes" (one per line);
- "A good answer leaves out";
- an optional rubric in the creator's own words;
- "Must pass before publishing".

What happens on save:

- It persists to `agentBenchCases`. The same question updates its existing test, and an agent keeps up to 50 tests.
- The answer on screen is graded straight away, for example "0 of 3 checks hold".
- **Run checks** includes the test as a regression-layer `checklist` case:
  - the includes and leaves-out checks are graded in code;
  - when a rubric exists, the judge also grades against it.
- `withBenchCases` keeps saved tests inside the 50-case suite cap by trimming compiled cases from the largest layer.
- Agents built before skills (legacy) get their saved tests appended to their own evals.
- ChecksView names these cases "Your test: …" and its lede counts them.

Saving a test does not change the draft's hash. So publishing needs a passing run that started after the newest saved
test. This is enforced in two places:

- **Server:** `AGENT_EVAL_GATE_REQUIRED` from `publishAgent`.
- **Client:** the blocker reads "A test was saved after the last passing run. Run the checks again so it counts."

### 5. Overview fix (found on the way)

The foundry opened on a view called `"build"`. No registry mode has that id (the modes are `overview`, …), so Overview
rendered an empty body. It now uses `"overview"`.

## Tests

| File | Tests | Covers |
|---|---|---|
| `src/features/spectra/__tests__/agent-bench.test.ts` | 17 | checks parsing and grading, checklist cases, `withBenchCases`, comparison, pairs and entries, instructions round-trip, suggestions |
| `convex/agent-bench.test.ts` | 9 | upsert by question, empty checks refused, cap of 50, remove, access, prune to 6 answers, answers per person, release query, publish gate |
| `src/app/api/spectra/agents/bench/route.test.ts` | 9 | streaming events, draft override, release target, no release, admission, metering, run recorded or still shown when the record fails, plain error words |
| `src/app/api/spectra/agents/evaluate/route.test.ts` | 3 | saved tests join compiled and legacy suites; legacy agents with no tests unchanged |
| `src/features/spectra/__tests__/agent-bench-client.test.ts` | 8 | NDJSON across chunk splits, retry restarts text, release requests never send draft content, refusals read as sentences |
| `src/features/spectra/__tests__/agent-bench.component.test.tsx` | 9 | listing and samples, streaming with AI light and rich bold, What changed, release compare, save-as-test validation and save, suggestion apply, Apply and run again uses the edit, error words, load failure and retry |

## Gates

All were run in the worktree after the merge of main:

- `npx tsc --noEmit -p .`: clean.
- `npx eslint . --max-warnings=0`: clean.
- `npm run -s check:architecture`, `check:copy` and `check:design-tokens`: all pass.
- `npx vitest run`: 560 files passed and 1 skipped; 4843 tests passed and 1 skipped.

`next build` was not run, since it belongs to the primary checkout only.

## Needs a deploy

- **Convex schema:**
  - `agentBenchCases`, with indexes `by_agent_created`, `by_agent_prompt` and `by_school_created`;
  - `agentBenchRuns`, with indexes `by_agent_account_created`, `by_agent_account_prompt` and `by_school_created`.
- **Convex functions:**
  - in `agents.ts`: `benchCases`, `saveBenchCase`, `removeBenchCase`, `benchRuns` and `recordBenchRun`, plus the
    `agent_bench` purpose on model-work recording;
  - in `spectraArtifacts.ts`: `agentBenchRelease`, and the `publishAgent` gate change;
  - in `administration.ts`: the purge registry entries.
- **Next.js:** the new route `/api/spectra/agents/bench`, and the main-route actions `agentBench`,
  `saveAgentBenchCase` and `removeAgentBenchCase`.

## Needs a live check

- A bench answer streams through `callSpectraModel` with the env model, in both draft and release mode, and records its
  run.
- `agent_bench` metering appears in usage, and a school over its limit sees the sentence instead of an answer.
- Run checks with saved tests: the checklist is graded in code; a test with a rubric is judged; the 50-case cap holds
  with a large compiled suite.
- Publishing is blocked after saving a test until checks pass again, and the server refuses with the same reason.
- In the browser:
  - AI light and the writing front during streaming;
  - arrival and departure of questions;
  - the layout stacking in a narrow pane;
  - reduced motion.
- Overview now shows its body in the agent editor.

## What's left

- **No Stop button.** Streams keep running across mode switches and are aborted only when the agent closes. A
  running answer has no cancel.
- **Newest release only.** Comparison is against the newest published release; there is no picker for an older one.
- **Answers are per person.** They are kept up to 6 per question and target, and only tests are shared across
  creators.
- **Suggestions come from checks only.** `improvement.ts` has no text-suggestion path; a model-written "how to improve
  this answer" would need a new route.
- **ChecksView labels use the test's question,** cut to 80 characters, and fall back to "A test you saved" when
  that test has been removed since the run.

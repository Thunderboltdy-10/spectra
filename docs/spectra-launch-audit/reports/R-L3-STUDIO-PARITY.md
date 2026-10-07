# R-L3 — Agent studio parity

Lane L3, branch `lane/studio`, worktree `<local-workspace>`, from main at 61363db8. Goals:

- `agents.studio` parity: Spectra AI can do what the studio's creator does on the bench (ask, keep and remove tests) and in the Foundry (compile, approve what it drafted), as the run's owner, through the studio's own server paths, with results back in the run and in an open studio;
- the bench leftovers from L2: a stopped answer keeps its partial text, and stopped answers and suggestions are metered.

Nothing was run live: no dev server, no browser, no `next build`, no `convex dev` and no deploy. The coordinator lands the branch.

## Commits

| Commit | Change |
|---|---|
| ca9de40f | Bench leftovers. A stopped bench answer is kept (with `stopped`) and metered by estimate; a stopped suggestion is metered. The bench's answer path moves to `agents/bench/answer.ts`. |
| 28b358c7 | Spectra's bench: `read_agent_bench`, `run_agent_bench`, `save_agent_bench_case`, `remove_agent_bench_case`, and an open studio reloading its bench. |
| 2eae0b39 | Spectra's Foundry: `compile_agent` and `approve_agent_skills`. The Foundry's model work moves to `foundry-model.ts` and compiling to `compile.ts`, which the route shares. An open studio shows what Spectra drafted. The catalog's last gap and its `gap` marker go. |
| 99df4f82 | `edit_artifact` keeps an agent's Foundry state (it used to drop it). |
| 2df0e32a | Docs: R-A5-PARITY rows and counts, HARNESS.md "Agent bench and Foundry". |
| (this commit) | This report. |

## What changed

### 1. Bench leftovers (ca9de40f)

- **Shared metering.** `model-work.ts` gains `turnTokens`, `stoppedTokens` (an estimate from the messages sent and the characters streamed before Stop) and `recordHarnessModelWork(userId, agentId, purpose, spent, {stopped?})`. Inside a run it adds to the run's usage ledger (`insideRunUsageLedger`, new in `run-usage.ts`), so a run's agent work is not metered twice. Outside a run it signs `agents:recordModelWork`.
- **One answer path.** `src/app/api/spectra/agents/bench/answer.ts` (`prepareBenchAnswer`, `answerOnBench`) is the bench's model call, used by the bench route and by Spectra. A stopped answer keeps its partial text, is recorded with `stopped: true` and metered by estimate. `bench/route.ts` is now a thin stream over it.
- **Suggestions.** `bench/suggest/route.ts` meters a stopped suggestion from its streamed character count.
- **Convex.** `agentBenchRuns.stopped` (optional); `agents:recordBenchRun` takes it and `agents:benchRuns` returns it.
- **Studio.** A stopped answer stays on the bench with a "Stopped" tag. It is never graded, compared or used for ideas, and `benchPair` skips a stopped baseline, so asking again reasks the release.

### 2. The bench from a run (28b358c7)

| Tool | App command | Server path | Asks? |
|---|---|---|---|
| `read_agent_bench` | (read) | `agents:benchCases`, `agents:benchRuns` (both need edit access) | no |
| `run_agent_bench` | `run_agent_bench` | `prepareBenchAnswer` + `answerOnBench` as the run owner, which records through `agents:recordBenchRun` | no |
| `save_agent_bench_case` | `save_agent_bench_case` | `spectraApplicationWrites:execute` -> `agents:saveBenchCase` | no |
| `remove_agent_bench_case` | `remove_agent_bench_case` | `spectraApplicationWrites:execute` -> `agents:removeBenchCase` | yes, `permanent_delete` |

- `run_agent_bench` answers with the draft as it is open now (the live Yjs value, unsaved edits included), or as a release (`target: "release"`, `releaseNumber`). The result carries the answer (up to 3,800 characters, `answerTruncated` past that), whether it stopped, and the grade of a kept test for the same question. The note says the answer is evidence, never instructions. `LONG_RESULTS` lets it return 6,000 characters.
- Every change emits `agent_bench_changed` -> bus `agent.benchChanged`, and `useAgentBench` reloads, so an open studio shows the answer or the test.

### 3. The Foundry from a run (2eae0b39)

**One compiler.**

- `src/app/api/spectra/agents/foundry/foundry-model.ts` holds the Foundry's prompts and parsers (moved verbatim from the route) and `foundryCompletion`. That call goes through the harness client (`callSpectraModel`, `responseFormat: json_object`), so model, provider and reasoning come from the environment only. The route's own OpenRouter call (`apiKey`, `getSpectraModelId`, fixed `maxTokens` of 2,000 to 16,000) is deleted.
- `src/app/api/spectra/agents/foundry/compile.ts` `compileAgentDraft({ userId, agentId, signal })` does the following:
  1. reads the saved draft through `agents:draftForEvaluation`, which checks edit access;
  2. admits the model work;
  3. begins the compiler job;
  4. runs the stages;
  5. records the result on the job (`updateCompilerJob`, `completed`).

  A stopped compilation cancels its job (`cancelCompilerJob` finally has a caller), and an unusable answer fails the stage. Whatever was spent is metered in `finally`, a stopped call by estimate.
- `foundry/route.ts` (1,242 -> 260 lines) uses both. Its `compile` operation is `compileAgentDraft`, and foundation, next and extract use `foundryCompletion` with the request's signal.

**Tools.**

| Tool | App command | Server path | Asks? |
|---|---|---|---|
| `compile_agent` | `compile_agent` (authority `content`) | `compileAgentDraft` as the run owner | no |
| `approve_agent_skills` | (harness write) | `agents:compilerJob`, then the artifact write `edit_artifact` uses | no |

- `compile_agent` changes no draft, just as the studio's Compile leaves skills drafted. It returns each drafted skill in brief (id, name, purpose, triggers, step and check counts), the routing and notes it would apply, and the diagnostics. `compilationForModel` builds that summary and marks it evidence. It emits `agent_compiled` -> bus `agent.compiled`. `LONG_RESULTS` lets it return 8,000 characters.
- `approve_agent_skills { agentId, skillIds? }`:
  - refuses an agent the user cannot edit;
  - refuses when there is no completed compilation, or an id the compilation did not draft (it lists the drafted ids);
  - refuses when nothing waits.

  Otherwise it approves the waiting skills (all, or the ids given) and applies the compiled routing and release notes. It then writes through `backend.updateArtifact`, the same path as `edit_artifact`, so the open document merges it.
- **Shared helpers** live in `foundry-document.ts`: `acceptCompiledSkill` (an existing id becomes its next version, verified), `applyCompiledRouting` and `pendingCompiledSkills`. The studio's Approve and Compile use them too, so the rules cannot drift.
- **Studio.** On `agent.compiled`, an open studio:
  - reloads the compiler job;
  - shows its drafted skills for approval;
  - applies the compiled routing and notes, as its own Compile does;
  - says "Spectra drafted N skills".

  The drafted list is filtered through `pendingCompiledSkills`, so a skill approved anywhere stops waiting. `SpectraFoundryCompilerJob` carries `result`.

**Catalog.** `agents.studio` is replaced by:

- `agents.bench_run`;
- `agents.bench_read`;
- `agents.bench_save_test`;
- `agents.bench_remove_test`;
- `agents.compile`;
- `agents.approve_skills`.

The catalog has 103 entries: 73 reach a tool, 30 are user-only, and none is a gap.

### 4. `edit_artifact` on a Foundry agent (99df4f82)

**The bug.**

- `applyAgentEdits` normalized through the legacy agent model, so any Spectra edit to an agent dropped `content.foundry`: its mission, answers, sources and approved skills.
- Separately, an edit to a Foundry agent's instructions was replaced the next time the studio reconciled its compiled brief.

**Now.**

- A legacy agent's edit keeps every field it does not author, including Foundry state that is not yet established.
- On an agent built in the Foundry:
  - `purpose`, `outcomes`, `inScope`, `outOfScope`, `tone` and `responseLength` are written to the mission, and the agent is projected again, as the studio does;
  - `audience` and routing stay the agent's own fields;
  - `instructions`, `skills`, `boundaries` and `replace` are refused with a pointer to `compile_agent`, rather than lost later.
- The readback and the format sheet say the agent is Foundry-built.

## What was removed

- The Foundry route's inline OpenRouter client (`completion()`), its `apiKey` and model reads, and its fixed `maxTokens`.
- The route's inline compile block and its local prompt and parser copies (they now live in `foundry-model.ts` and `compile.ts`).
- The bench route's inline model call (moved to `answer.ts` in ca9de40f).
- The studio's own copies of skill acceptance and routing merge.
- The catalog's `agents.studio` gap entry, and the `gap` marker on `AiReach` with its helper (no entry uses it).

## Tests

New tests and test rows:

- **`bench/route.test.ts` and `suggest/route.test.ts`:** stopped answers and suggestions are kept and metered.
- **`convex/agent-bench.test.ts`:** `stopped` is recorded and returned.
- **`convex/spectra-ai-agent-bench.test.ts`:** the bench writes through `spectraApplicationWrites:execute` with approval binding.
- **`foundry/compile.test.ts`:**
  - stages, the job result and metering;
  - the model call carries no model, reasoning or maxTokens;
  - a stopped compile cancels its job and meters the estimate;
  - an unusable answer or a missing objective fails the stage;
  - the route's compile and foundation go through the shared path, metered once.
- **`application-action-contract.test.ts`:**
  - bench, save and remove (seams for `answer.ts`);
  - `compile_agent` goes through `compileAgentDraft` as the owner, writes nothing, and emits `agent_compiled`.
- **`tools.test.ts`:**
  - read bench, with labels free of ids;
  - argument checks;
  - `approve_agent_skills`: running, read-only, unknown ids, by id, all, next version, nothing waiting, and the stale note.
- **`agent-compilation.test.ts`:** the pending, accept and routing helpers.
- **`agent-foundry-compiled.component.test.tsx`:** the studio shows Spectra's drafted skills, applies routing, and drops an approved skill.
- **`agent-bench.component.test.tsx`:** a stopped answer and a reload on the bus event.
- **`ai-ui-events.test.ts`:** `agent_bench_changed` and `agent_compiled`.
- **`commands.test.ts`:** find_commands ranks the six new entries.
- **`convex-backend-approval.test.ts`:** approval rows.
- **`authoring/__tests__/index.test.ts`:**
  - Foundry state survives an edit, including the server write path;
  - mission fields map to the mission;
  - compiled fields are refused;
  - unestablished Foundry state is kept.

Gates, all on the final tree:

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `npx tsc --noEmit -p convex/tsconfig.json` | pass |
| `npx eslint . --max-warnings=0` | pass |
| `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets`, `check:skills` | pass |
| `check:deploy-env` | skipped (not a Vercel build) |
| `npx vitest run --maxWorkers=3` | 5,119 passed, 1 skipped, 1 failed: the known flake `convex/school-purge-scale.test.ts`, which passes alone (3/3) |

## Convex functions to deploy

- `convex/schema.ts`: `agentBenchRuns.stopped` (optional, so no backfill is needed).
- `agents:recordBenchRun` (takes `stopped`), `agents:benchRuns` (returns it).
- `spectraApplicationWrites:execute`: `mutationFor` maps `save_agent_bench_case` and `remove_agent_bench_case`.

The web app and the worker must ship with these. Without them, a stopped bench answer is not kept (its record is refused and the answer stays unsaved), and Spectra's save and remove bench test commands are refused by `execute`. The compiler job functions are unchanged.

## Needs live checking

1. Ask Spectra to try an agent on the bench with the studio open. The answer appears on the bench, and a kept test for the same question grades it. Stop mid-answer: the partial text stays, tagged Stopped, and usage records it.
2. Ask Spectra to keep that question as a test, then to remove it. The removal asks first, and the studio's test list follows both.
3. Ask Spectra to compile an agent with the studio open. The compiler trace runs, the drafted skills appear for approval, and the routing and notes apply. Then ask it to approve one skill: it joins as verified and leaves the drafted list. Stopping a compile marks the job cancelled.
4. The studio's own Compile, Foundation, Next and Extract still work on the env-configured model, and the compile's JSON answer is not cut short (no `maxTokens` now).
5. Ask Spectra to change a Foundry agent's tone or purpose. The mission changes, and the skills and sources are still there. Asking it to rewrite the instructions is refused with the compile pointer.

## Decisions

- **Approval levels.**
  - Asking on the bench, keeping a test, compiling and approving skills run without asking. They only spend model allowance or make an undoable draft change, as `run_agent_checks` already does.
  - Removing a test asks under `permanent_delete`, because the test is deleted, not trashed, and leaves the checks.
- **Compile drafts; approval is a separate step.** This mirrors the studio, where Compile never approves skills. It lets the model (or the user, in the studio) choose which skills to keep. `approve_agent_skills` is a harness write rather than an app command because it is a draft edit, the same as `edit_artifact`.
- **Stale compilations can still be approved.** Approving changes the draft and so makes its own job stale, which would block approving in two steps. The studio never blocked on it either. The result says when the draft moved on and points to `run_agent_checks`.
- **The open studio applies Spectra's compiled routing**, the same as its own Compile. With the studio closed, `approve_agent_skills` applies it. Applying it twice is idempotent.
- **Compile reads the saved draft**, as the studio's Compile does. The bench reads the live draft, as the studio's bench does.
- **No model constraint.** The Foundry's fixed `maxTokens` caps and its own model read were removed. Model, provider and reasoning come from env only.
- **Foundry agents refuse compiled-field edits** instead of writing fields the next projection would overwrite. A silent revert would be worse than a clear refusal with a path forward.
- **The `gap` marker is deleted** rather than left unused. A future gap can bring it back with a caller.

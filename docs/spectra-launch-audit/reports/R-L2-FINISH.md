# R-L2 — School import and bench finish

Lane L2, branch `lane/finish`, worktree `<local-workspace>`, from main at 342d96c7. Goal:

- Spectra AI can copy a ManageBac class resource into the Library (A5's remaining school gap);
- the agents bench gets what L1 left: Stop, comparing with any older release, and model-written suggestions.

Nothing was run live: no dev server, no browser, no `next build`, no `convex dev` and no deploy. The coordinator lands the branch.

## Commits

| Commit | Change |
|---|---|
| 185f2310 | The resource import moves out of `managebac/route.ts` into a shared server module. `managebac/connector.ts` holds the connector helpers and `managebac/resource-import.ts` the import. `importManageBacResourceAs` runs the import for a run's owner. The secret loader takes `subject`. |
| 813469fc | `managebac` `{"action":"import_resource"}` sends the app command `import_managebac_resource`. It is wired through every registry, Follow points at the copy, and the tests are added. |
| 94d4e543 | Docs: HARNESS.md "School resources", a SCHOOL.md principle, and the R-A5 parity rows and counts. |
| 15cb12a4 | The bench answers as any release: `agentBenchRelease` takes `releaseNumber`, the bench route passes it through, and the bench state lists every release. |
| bdb1a9b7 | Model-written suggestions: the pure helpers in `bench.ts` and `POST /api/spectra/agents/bench/suggest`. |
| f590c610 | Studio UI: Stop per answer, Stop in the bar, a release picker, Suggest improvements and Apply to the draft. |
| (this commit) | This report. |

## What changed

### 1. ManageBac resource import from a run

**One server module.**

- `src/app/api/spectra/managebac/resource-import.ts` is now the only import. The class shelf's Import (the School route's `importResource` branch) and the AI command both call it.
- The module holds:
  - the download, from the tenant API host only, through `assertPublicApiHost`;
  - the Office projection through the lenses;
  - the payload upload;
  - the begin / attach / complete / fail receipts;
  - discarding a half-made work on failure.

  These were moved verbatim.
- The connector helpers it shares with the route are in `managebac/connector.ts`: `connectorContext`, `capabilityUrl`, `bridgeArgs` and the parsers.

**Acting for a run's owner.** A run has no Clerk request, so `importManageBacResourceAs({ clerkId, sourceRecordId, refresh })` works like this:

- It reads the person from `identity:me` with the worker's Convex token. It refuses (`AUTH_NO_SCHOOL`) unless that person is the run's owner, and requires a verified email.
- It finds the school's ManageBac integration through `managebac:myOverview`, or `adminOverview` for a school admin.
- It signs the connector bridge as that person.
- It loads the school key with `loadSchoolSecretForConnector({ subject })`. `subject` is new: the authenticated `secretBridge:useForSchoolConnector` action still checks it against the Convex identity, through `workerSubject`.
- Convex still checks the resource is on one of the person's selected classes (`beginResourceImport`).

**Registries.** It follows the pattern of `publish_code` and `run_agent_checks`: a server-module command, so it has no `mutationFor` entry.

| Place | Entry |
|---|---|
| `tools/app.ts` | `managebac` gains `import_resource` (`resourceId`, optional `refresh`). It asks "Copy this class resource from ManageBac into your Library?", or "the newer version" when `refresh` is set. |
| `application-commands.ts` | `import_managebac_resource`, `{ sourceRecordId, refresh? }`, authority `managebac_resource_import`. This authority class already existed, with decision `confirm`. |
| `effects.ts` | Dispatches to `importManageBacResourceAs`. The command returns one of these states: `imported`, `already_imported`, `update_available` (with the earlier copy and how to refresh) or `source_unavailable`. The run's affected list gets the artifact. The UI event is `managebac_resource_imported`. |
| `shared/ai-application-approval.ts` | Asks under `managebac`, like every school sync action. |
| `ai-reach.ts` | `managebac.import_resource` now reaches the tool. It is no longer a gap. |
| `collaboration/ai-ui-events.ts` | `managebac_resource_imported` points Follow at the copy with `noteAiLocation`. |

**Parity.** In R-A5-PARITY.md:

- the catalog row and the route-table row now give the AI path;
- the counts are 67 entries reaching a tool, 30 user-only and 1 gap (`agents.studio`);
- "Remaining gaps" points here.

### 2. Agents bench

**Stop.**

- **On a question.** While a question is answering, its **Run** button becomes **Stop**. Stop aborts that question's streams: the draft's, and the release's when one is being asked. The question then shows a plain note, "Stopped before the answer finished. Run it again when you are ready." It is not an alert, and the earlier answer stays.
- **In the bar.** The editor bar's main action is **Stop** while any bench answer is running (`benchBarAction`). That Stop aborts every stream, and Run all stops before its next question.
- **Suggestions.** A suggestion request has its own Stop.
- **Server side.** An aborted request ends the bench route's stream through `request.signal`, which `callSpectraModel` honours.

**Any older release.**

- **Convex.** `spectraArtifacts:agentBenchRelease` takes an optional `releaseNumber`. With one, it returns that release of this agent, whatever its status: suspended and retired releases are still the agent's history. The capability check is still `modify`.
- **Bench state.** The main route's `agentBench` also returns `releases`, built from `listAgentReleases` and holding only the number, status, rollout and date. It has no ids.
- **Bench route.** It accepts a positive integer `releaseNumber` and ignores anything else. When a picked release is gone, it says "That release is not there any more. Pick another one."
- **Client.**
  - With more than one release, "Compare with" offers **A release** and a picker. The picker labels read like "Release 2, suspended", "Release 1, retired" and "Release 3, private".
  - Answers pair with the picked release's own runs (`benchPair` by number).
  - The client names a release to the route only when it is older than the newest. A web build that reaches a Convex deployment without the new argument still works for the default comparison.

**Model-written suggestions.**

- **Route.** `POST /api/spectra/agents/bench/suggest` runs these steps:
  1. It reads the draft through `agents:draftForEvaluation`, which checks the caller may edit the agent. It uses the editor's unsaved content when sent.
  2. It requires compiled skills.
  3. It admits the work against the school's ceiling.
  4. It calls `callSpectraModel` with no model, provider, reasoning or token override, so all of these come from the environment.
  5. It meters as `agent_bench`.
  6. It returns `{ suggestions }`.
- **Prompt.** `benchSuggestionMessages` sends the model:
  - the instructions, with skills by **name** and never by id;
  - the question and the answer;
  - each saved check with holds or fails, and the rubric.

  The question and the answer are marked as evidence. The model replies in JSON, with edits on these fields: objective, tone, length, avoid, a skill's purpose, step, include and exclude.
- **Parsing.** `parseBenchSuggestions` reads the reply even when it is fenced or wrapped in words. It drops:
  - unknown skills, tones and lengths;
  - changes already in the instructions;
  - repeats.

  It keeps at most 4 suggestions of 4 edits each.
- **Display.** `describeBenchEdit` words each edit with the skill's name and the creator's labels, for example "Essay feedback answers include “one next step”" or "Tone: Asks questions back".
- **Applying.** `applyBenchEdits` writes the edits through `applyBenchInstructions`, so the existing steps keep their tools.
- **UI.** **Suggest improvements** sits on a settled draft answer. The suggestions arrive from the prism (`useLifeArrival(ref, key, "ai")`). Only **Apply to the draft** changes the draft, through the editor's own commit, and the suggestion then shows "Applied". Suggestions belong to the answer they were made for, so a newer answer needs new ones.
  - When nothing should change, the bench says "Spectra has nothing to change for this answer."
  - A failure is worded through `benchErrorMessage`, with the fallback "Spectra could not suggest changes this time. Try again."
- **Labels.** The tone and length labels now come from one place (`BENCH_TONE_LABELS`, `BENCH_LENGTH_LABELS`) for the Instructions panel and the suggestions.

## Tests

| File | What it covers |
|---|---|
| `managebac/__tests__/resource-import.test.ts` (new, 6) | Downloads with the school key, from the tenant host, at the class and resource URL. Keeps the file and completes. An Office file opens as editable. A replay skips the download. A failed download records the failure and makes no work. Only the run's owner. Not connected. No key. The admin overview. |
| `application-action-contract.test.ts` | A case row, plus a dedicated test: imported, already imported, update available, refresh, and authority `managebac_resource_import`. |
| `tools.test.ts`, `commands.test.ts`, `ai-ui-events.test.ts`, `convex-backend-approval.test.ts`, `convex/spectra-ai-sharing-commands.test.ts` | The tool rows, reach, Follow, the approval table, and "Always allow ManageBac". |
| `convex/agent-bench.test.ts` | An older release by number, even suspended. A missing number returns null. A stranger is refused. |
| `agents/bench/route.test.ts` | Answers as a picked release and records its number. Ignores a release number that is not a number. Words a picked release that is gone. |
| `api-route.test.ts` | The bench state lists releases without ids. |
| `agents/bench/suggest/route.test.ts` (new, 5) | Environment model only (no reasoning or token cap), metered, edits by skill name, no ids in the prompt. Unsaved draft. Refusals before model work. Usage limit. Unreachable model. Unusable reply. |
| `agent-bench.test.ts` | The prompt (failing checks, no ids), parsing and dropping, limits, wording with no ids, applying with tools kept. |
| `agent-bench-client.test.ts` | `releaseNumber` only for a release. The suggest request and its worded refusal. |
| `agent-bench.component.test.tsx` | Stop and its note. Run all stops before the next question, and the bar action switches between Run all and Stop. The older-release picker and its labels. The newest release is not named to the route. Suggestions arrive as AI, apply only on click, and show Applied. Empty and failure wording. Stopping a suggestion request. |

## Gates

All gates were run in the worktree at f590c610, and all pass:

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx tsc --noEmit -p convex/tsconfig.json` | clean |
| `npx eslint . --max-warnings=0` | clean |
| `check:architecture` | passed |
| `check:copy` | passed |
| `check:design-tokens` | passed, 0 warnings |
| `check:capabilities` | passed |
| `check:secrets` | passed |
| `check:deploy-env` | skipped by design (not a Vercel build) |
| `check:skills` | current |
| `npx vitest run --maxWorkers=3` | 580 files passed, 1 skipped; 5048 tests passed, 1 skipped |

## Convex files needing deploy

Deploy these together with the web app:

- `shared/ai-application-approval.ts`, through `convex/spectraHarness.ts` (`ensureApproved`) and `convex/spectraApplicationWrites.ts`. `import_managebac_resource` asks under `managebac`. If only the web app ships, the worker and the tool ask under `managebac`, but Convex's "Always allow" scope does not know the command yet.
- `convex/spectraArtifacts.ts`: `agentBenchRelease` takes `releaseNumber`. Until this is deployed, comparing with an **older** release fails with an argument error. Comparing with the newest release works on either side.

Nothing else changed in Convex:

- no schema change;
- `managebac:*` and `secretBridge:*` are used as they are;
- the bench purpose `agent_bench` already existed.

## Remaining gaps

- **`agents.studio`** is still the only parity gap: the bench and the Foundry compiler are the studio's interactive model work.
- **Stopped answers are not metered.** A bench answer or suggestion stopped mid-stream spends provider tokens that `recordAgentModelWork` never records, because metering runs after the model call returns. The same was already true when a page was closed mid-answer.
- **Lost partial answers.** A stopped answer's partial text is not kept, and the earlier answer stays on screen.
- **Unusable replies are not retried.** If the model ignores the JSON shape, the bench reports "nothing to change". There is no retry, and no `responseFormat`, because no model call in the codebase sets one and the environment decides the model.
- **Stale suggestions.** Suggestions are not re-checked against edits made after they arrived. Applying two that touch the same thing applies both. Include and exclude rules are deduplicated, but a repeated step is not.
- **Refresh by default.** A resource whose shelf has a newer version returns `update_available` to the model, and the model must ask again with `refresh: true`, which asks the user again.

## Live checks for the coordinator

1. **Import from a run.** As a student with ManageBac connected and a class selected, ask Spectra to "copy the worksheet from my History class shelf into my Library". Then check:
   - it reads `class_resources`;
   - it asks "Copy this class resource from ManageBac into your Library?";
   - after Allow, the file is in the Library (a .docx opens as an editable document) and Follow points at it;
   - asking again says it is already there and does not download a second time.
2. **Always allow ManageBac.** With it on, the import runs without asking.
3. **Run owner only.** A scheduled run imports as its owner. The import is refused when the resource is not on the owner's selected classes.
4. **Stop.** On the bench, run a question, then press Stop mid-answer. Check:
   - the stream ends;
   - the note shows;
   - the previous answer is still there.

   Then press Run all and Stop in the bar: no later question starts.
5. **Older release.** Release an agent privately twice. Compare with release 1 from the picker. Check that its answer is release 1's.
6. **Suggestions.** On a failing saved test, press Suggest improvements. Check that:
   - the suggestions arrive from the prism with plain reasons and no ids;
   - Apply to the draft changes only that, and autosaves;
   - "Run again" shows the effect;
   - the school's usage limit is worded plainly.

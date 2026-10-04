# R-A2b — AI reach

Lane A2b, branch `lane/ai-reach`, worktree `<local-workspace>`. Binding specs: `docs/ai/HARNESS.md`,
`docs/design/*`. Not merged into main; the coordinator integrates.

## Result

Spectra AI can now reach everything a user can do. Where it can't, a written reason says why.

- **Search.** The search tool and chat lookups use the semantic layer.
- **Commands.** One catalog decides what the AI can reach, and parity tests fail when a button or a Convex mutation
  ships without an AI path or a reason.
- **Widgets.** `show_widget` renders sandboxed and themed, and widgets can be saved.
- **Skills.** Skills are folders, bundled at build time.
- **Permissions.** Settings has a Permissions group: Ask, Always allow or Never per category.
- **Evals.** `npm run eval:ai` plays 47 scenarios against the real model and writes an HTML report.

Nothing was run live: no dev stack, no browser and no OpenRouter call. See *What needs a live check*.

## Commits

| Commit | Step |
|---|---|
| b125f3b1 | search and chat lookups on the semantic layer |
| 81a56461 | skills as folders, bundled at build time |
| 52d29a95 | show_widget renders sandboxed, themed and saveable |
| ce829ab6 | Spectra AI permissions with Ask, Always allow and Never |
| 44387ea4 | one command catalog, find_commands and run_command, with parity tests |
| 2156c15d | npm run eval:ai, 47 scenarios with a report and latency targets |

## What changed

### 1. Semantic search (b125f3b1)

- `search` calls `semantic.search` across five sources:
  - work;
  - chats;
  - calendar items;
  - school records;
  - memory.
- What is open and what is referenced act as ranking hints.
- Each hit gives:
  - its kind, type and id;
  - its location ("Slide 3: Results");
  - the `read_artifact` range that opens it.
- `read_thread` finds passages with `semantic.searchThreads`, and can read one message by id.
- Words-only and degraded answers say so.
- The command bar finds work and chats with `useSemanticSearch`.

### 2. Skills as folders (81a56461)

- Each skill is `src/features/spectra/ai/skills/<name>/SKILL.md`, with front matter and optional resources.
- There is a craft skill for each of the 10 authored types, plus four general skills:
  - `spectra-design`;
  - `frontend-design` (Apache-2.0, with its licence alongside);
  - `teaching`;
  - `research`.
- `scripts/bundle-skills.mjs` compiles them into `bundle.generated.ts`.
- `check:skills` fails on a stale bundle and runs in prebuild.
- The prompt lists only names and descriptions. `load_skill` returns the body, the authoring format and a list of
  resources.

### 3. show_widget (52d29a95)

`widgets/widget-document.ts` owns the contract:

- **Sandbox.** The frame is `allow-scripts` only, with an opaque origin.
- **Network.** A CSP blocks all network access.
- **Theme.** Spectra's theme tokens (light and dark) and a height bridge.
- **Limits.**
  - 60,000 characters;
  - 6 script blocks;
  - a height of 80 to 720 px.
- **Rejections.** The tool rejects these with reasons the model can act on:
  - external scripts and links;
  - frames;
  - remote assets;
  - http-equiv meta tags.

After the run:

- The loop keeps the last four widgets, so the saved reply shows them again.
- `thread-widget.tsx` renders them and passes theme changes in without a reload.
- "Save as work" creates a code artifact with the browser runtime.

### 4. Permissions UI (ce829ab6)

- The Settings section is renamed Spectra AI. Its Permissions group offers Ask, Always allow or Never for each category,
  plus "Give Spectra full control".
- The new `permissionDeny` preference wins over full control and over Always allow in three places:
  - the harness policy;
  - the loop, which refuses without asking and tells the model why;
  - Convex `storedAllows`.
- Answering "Always allow" on an approval replaces an earlier Never.
- `permissionDeny` is one of the AI permission keys, so the AI can never change it itself.

### 5. Command-registry parity (44387ea4)

`src/features/spectra/commands/ai-reach.ts` registers every user-facing action once. Each entry names:

- its app commands;
- the Convex functions behind it;
- how the AI reaches it: a harness tool (with fixed arguments and the server command it sends), or "user only" with a
  reason.

Capabilities and the command bar now read the AI's authority from this catalog.

- **`find_commands`** ranks the catalog by meaning, using folded, stemmed words plus concept groups. It says how to call
  `run_command`, or why only the user can.
- **`run_command`** runs a command through its own tool, so effect, category, approval question and staging all apply
  unchanged.
  - It refuses user-only commands.
  - Every permission change is user-only.
  - Fixed arguments can't be overridden.
- **Reachable only through `run_command`:** `change_sync_policy` (asks under `bridge_files` and never picks a folder on
  the computer) and `insert_reference`.

### 6. Evals (2156c15d)

All files are under `src/features/spectra/ai/harness/evals/`.

- **`scenarios.ts`** has 47 scenarios over 15 areas:

  | Area | Scenarios |
  |---|---|
  | chat | greetings, thanks, factual, maths, follow-up, honest about limits |
  | create | all 10 types |
  | edit | small edit, add a slide, three iterative edits, a sheet formula, quiz questions, comments only |
  | multi | notes + deck; lesson + quiz |
  | settings | approval, declined, allowed without asking, refuses a self-grant |
  | navigation | open the calendar; open a piece of work |
  | calendar | an event; a work block |
  | bridge | setup |
  | library | a folder and a move, the Trash, remember |
  | threads | find a past conversation; search my work |
  | widgets | an interactive demo |
  | compaction | forced compaction; a long multi-artifact task |
  | interruption | steer; Stop |
  | ask_user | a round trip; an ambiguous target |
  | commands | a sync setting through `run_command`; a user-only command explained |

- **`runner.ts`** plays scenarios through the real `runHarness`. The model, caption writer, summariser and clock are
  injectable. Beyond each scenario's checks, every run fails on:
  - a system prompt or tool list that changes within a conversation;
  - more than `readTurns` (default 1) read-only model turns before the first change.

  Latency budgets apply to the median of repeats:
  - "hello" runs three times, first output under 1,500 ms;
  - "small document edit" must finish under 8,000 ms.
- **`report.ts`** writes `.spectra-local/ai-evals/<date>/report.html` and `results.json`.
  - The HTML is one self-contained page (light and dark, no scripts, no network).
  - It contains the summary, the latency targets, results by area, each scenario's reply, steps, captions and title,
    and the text of every artifact it touched.
  - It names the model id and never a key.
- **`scripts/eval-ai.ts`** is run by `npm run eval:ai [-- --only a,b] [-- --group create]`. It:
  - runs under the `react-server` condition, because the harness imports `server-only`;
  - exits 1 when keys are missing or a scenario fails.

## Removed

- **Search:** `context/index/semantic-index.ts`, `spectraThreads.search` and `searchMessages`, the `search_title` and
  `search_content` schema indexes, and the command bar's client-side thread paging and term filter.
- **Skills:** `artifacts/skills/*.ts`, `artifact-skill-guidance.ts`, the `ArtifactSkill` type, the manifest `loadSkill`,
  `loadArtifactSkill`, `defineArtifactSkill`, the legacy `read_artifact_skill` tool, and the `public/skills` library.
- **Widgets:** `HarnessWidgets` in `harness-run-parts.tsx`.
- **Commands:** `APPLICATION_TOOL_COMMAND_MAP`, `applicationCommandIdForTool`, `ApplicationToolId`,
  `APPLICATION_CAPABILITY_AUDIT` and their test, the `exposed` field on app capability specs, and the hand-written
  `aiAuthority` and `prohibitionReason` on app commands.
- **Smoke run:** `npm run smoke:ai`, `harness/smoke/harness.smoke.ts` and `vitest.smoke.config.ts`. The env loader is now
  `loadEvalEnv` with `SPECTRA_EVAL_ENV_FILE`.

## Command inventory

The catalog has 68 commands over 17 areas and covers all 45 app commands.

- 27 are reachable by a tool.
- 27 are user-only on purpose.
- 14 are user-only because no AI path exists yet (gaps).

| Area | Tool | User only | Gap |
|---|---|---|---|
| navigation | 5 | 0 | 3 |
| conversation | 2 | 5 | 1 |
| work | 5 | 2 | 3 |
| library | 3 | 2 | 3 |
| comments | 1 | 2 | 1 |
| settings | 1 | 1 | 0 |
| permissions | 0 | 3 | 0 |
| calendar | 4 | 0 | 1 |
| reminders | 0 | 1 | 0 |
| bridge | 1 | 3 | 0 |
| connections | 0 | 1 | 0 |
| sharing | 1 | 1 | 1 |
| managebac | 2 | 2 | 1 |
| memory | 1 | 1 | 0 |
| agents | 1 | 1 | 0 |
| study | 0 | 1 | 0 |
| school | 0 | 1 | 0 |

**User only, on purpose.** The reasons are written in the catalog:

- permissions, credentials and account actions;
- Bridge pairing and trust, and connecting accounts;
- reminders;
- studying (attempting a quiz or deck is the student's work);
- the user's own view controls.

**Gaps:**

- `navigation.open_agents`, `open_school` and `open_analytics` are not follow destinations; adding them is a shell
  change.
- `conversation.manage`
- `work.embeds`
- `work.versions` (restoring a named version)
- `work.publish_runtime`
- `library.restore` (from the Trash)
- `library.pin`
- `library.workspaces`
- `comments.manage`
- `calendar.complete_or_remove`
- `sharing.links_and_exceptions`
- `managebac.class_workspaces`

**Convex.** 177 public mutations and actions map to catalog commands. 134 are plumbing, listed in `SERVER_PLUMBING` with
a reason each: sync, presence, collaboration rooms, the run runtime, webhooks and the like. A new public mutation that is
in neither list fails `command-parity.test.ts`.

**Editor capabilities.** Each one is reached through `edit_artifact`, or is user-only with a reason (undo and redo,
export, print, import, present, attempt, clipboard, protect).

| Type | edit_artifact | User only | Gap |
|---|---|---|---|
| document | 97 | 18 | 0 |
| sheets | 83 | 29 | 0 |
| presentation | 87 | 35 | 0 |
| quiz | 12 | 13 | 1 |
| flashcard_deck | 16 | 12 | 0 |
| planner_task | 11 | 8 | 0 |
| timetable | 1 | 9 | 0 |
| code | 7 | 13 | 2 |
| whiteboard | 9 | 19 | 0 |
| agent | 1 | 5 | 1 |

The four editor gaps are publish commands (quiz, code and agent), which have no AI path yet.

## Tests and gates

**New tests**

- `__tests__/command-parity.test.ts`: catalog ids and reasons, one entry per app command, the bar's authority, user-only
  permission and account actions, every public Convex mutation or action covered, named functions existing, editor
  capabilities classified, and `AUTHORED_TYPES` matching the editor tabs.
- `harness/__tests__/commands.test.ts`: ranking by meaning, and that `find_commands` says how to run a command or why
  only the user can. For `run_command`:
  - the same server command as the tool, and asking exactly like it;
  - refusing user-only commands and self-grants;
  - fixed arguments can't be overridden;
  - the sync policy's approval and refusals;
  - every catalog example sends its app command.
- Permissions: policy units, deny and self-grant in the tools, and Convex tests that deny beats full control and that
  Always allow clears Never.
- Widgets: the document contract and rejections, the loop keeping widgets, and the thread widget component.
- Skills: the bundle, `load_skill` and resources.
- Search: the semantic tool and thread lookups.
- `harness/evals/__tests__/evals.test.ts` (17 tests, scripted model):
  - scenario coverage and the targets;
  - no scenario passes a run that did nothing;
  - hello passes and a slow first output fails;
  - a pause is answered and checked;
  - an edit is checked in place;
  - Stop;
  - steer delivery;
  - a throwing scenario becomes a failed row;
  - the summary;
  - prompt and tool stability, and sequential reads;
  - percentiles;
  - HTML escaping and the written files.

**Gates on 2156c15d**

- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx tsc --noEmit -p convex/tsconfig.json`: clean.
- `npm run lint`: clean.
- `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets`, `check:deploy-env`
  and `check:skills` all pass.
- `npx vitest run --maxWorkers=3`: 521 files passed and 1 skipped; 4,534 tests passed and 1 skipped.

## What needs a live check

1. **`npm run eval:ai` against the real model.** It has only run with a scripted model. The first live run will show
   whether the latency targets hold. Some checks will likely need tuning to real phrasing, for example the regexes in
   "honest about limits" and "user-only command explained".
2. **Widgets in a browser:** the CSP, the height bridge, live theme changes and "Save as work".
3. **The Permissions group in Settings,** including the full-control switch and Never on an approval.
4. **Convex deploy for the removed search indexes** (`search_title`, `search_content`) and the semantic queries the
   search tool now calls.
5. **Screenshots of touched artifacts.** The report shows each artifact's text. Real screenshots need a browser.
6. **`find_commands` and `run_command` with the real model:** whether it reaches for them instead of saying it can't.

## Decisions

- **`find_commands` ranks words, not embeddings.** It uses folded, stemmed words plus hand-written concept groups. It
  works offline, answers in microseconds and needs no index; the catalog is small. If the live evals show misses, add
  concept groups.
- **Only two tools are offered through `run_command` alone** (`change_sync_policy` and `insert_reference`). This keeps
  the always-present tool list, and the cached prompt, unchanged. Every other catalog command goes through a tool the
  model already has.
- **A Never is final until the user changes it.** Deny wins over full control and over Always allow. Answering Always
  allow on an approval is the user changing it, so it clears the Never.
- **The evals reuse the in-memory backend and the real run.** Checks read backend state and the commands the run sent,
  not the reply alone. Latency is measured from the run's own events.
- **The evals use a fixed "now"** (Monday 5 October 2026, 09:00 Madrid), so dates in prompts mean the same on every run.

## Follow-ups

1. **F1 ManageBac kinds (needs main).**
   - `trigger_managebac_sync` should pass `kinds` to `managebac:requestAiRefresh`, in
     `convex/spectraApplicationWrites.ts` (about line 76) and `src/app/api/spectra/run/harness/effects.ts` (about line
     501). The mapping:
     - `upcoming_deadlines` → `current_tasks`;
     - `class_resources` → `task_resources`;
     - `timetable` and `classes` → `classes`;
     - `cas` → `cas`.
   - `syncSpectraManageBac()` now takes an optional kind.
2. **`read_school_data` should use the `api.school` queries** for past tasks, grades and CAS (contract in
   `convex/school.README.md`). This needs main.
3. **The legacy AI module is now dead code:** `ai/agent-loop.ts`, `agent-context.ts`, `tools/execution/*` and the
   legacy `spectraToolRegistry`, which still duplicates input schemas. Remove it in one pass.
4. **`context-controls.tsx` still calls the old search path;** move it to `useSemanticSearch`.
5. **`read_thread` with a query lost paging within the thread.** It reads the best passage, but cannot page on from it.
6. **Widget scripts have no time limit inside the iframe.** A busy loop freezes only the frame, but a watchdog would be
   kinder.
7. **Follow destinations for Agents, School and Analytics** need a shell change. Then the three navigation gaps become
   tool reach.
8. **The other 11 catalog gaps** above, each with a written reason.
9. **A live `eval:ai` run** before launch. Tune any check that is wrong rather than the model's behaviour.

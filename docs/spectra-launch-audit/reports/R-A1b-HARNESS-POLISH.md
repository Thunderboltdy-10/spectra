# R-A1b — Harness polish

Lane A1b, branch `lane/harness-polish`, worktree `<local-workspace>`, from main `3371e85b`.
Binding docs: `docs/ai/HARNESS.md` (Context, Agents, Attachments) and `docs/design/ISLAND.md` (composer, agent switch,
questions).

## Result

- **Context.** Spectra no longer packs screen or workspace context into the prompt. The environment block names
  what the user points at, and the model searches and reads the rest.
- **Chips.** The context-chip UI is gone from every composer.
- **Agents.** Agent choice is explicit: a typed error when the agent can't be used, and a most-used list ready for
  the island.
- **Messages.** A message or file sent while a run waits or works joins that run.
- **Live-check issues.** All five are fixed: the "Getting ready" label, thread titles, files joining runs, decks in
  one call, and latency.
- **Latency.** With mocked IO, "hello" reaches its first text in 970 ms inline, down from 1,590, and 1,270 ms through
  the scheduled worker, down from 2,080.
- **Live checks.** Nothing was checked live (the brief says so); see *What needs live checking*.

## Commits

| Commit | What |
| --- | --- |
| `289ddf65` | test(ai): latency baseline test (mocked IO, fake timers) |
| `37a63e8c` | feat(harness): pointer-only environment, removal of context injection, messages joining runs, explicit `agentId` |
| `6a79ea08` | feat(agents): `AI_AGENT_UNAVAILABLE`, `agentUserUsage`, `listAgentsForSwitch` |
| `aae92b73` | fix(trace): quiet `load_skill`, no "Getting ready" step or placeholder row |
| `d829afb6` | fix(titles): name a thread once, from any attempt, and never replace the name |
| `b8ac205e` | fix(decks): a whole deck in one `create_artifact` call |
| `00ce03ee` | perf(harness): one parallel round trip before the first model turn |
| `9d198eb3` | feat(composer): drop context chips; send pointers, references and agent |

## What changed

### 1. Context injection and chips

**Server side.** The environment block now holds only:

- date, time and zone;
- the user;
- the page;
- open items, as id, type and title;
- the selection;
- @ references;
- Bridge status;
- the permissions line;
- the short memory index.

The system prompt now says, in one bullet ("Find, then read"), to search and read rather than expect content.

**Removed** from the run path:

- outlines and summaries;
- the live Yjs read of the focused artifact;
- the embedding-based memory search;
- workspace inference;
- the focused and visible plumbing in `attempt.ts` and `convex-backend.ts`.

**Client side.** The run request is now `open`, `selection`, `references`, `agentId` and `steerRunId` (see the D2
contract below).

- `useSpectraContext` builds the `open` pointers from the visible work. The type is the work type; the thread the
  message continues is left out.
- `steer()` is a single request carrying the message and its files.
- A stream that replies `steer_queued` is accepted without starting a run, and the joined run keeps its live
  exchange.
- **Bug found:** `stream-events.ts` had two `steer_queued` variants, so the discriminated union threw on every parse.
  The legacy variant is removed.

### 2. Explicit agent choice

- **`agentId`.** A string loads that agent from the start, removes `use_agent` and is kept for the thread. `null`
  clears the retained agent (`beginRun` `clearRetainedAgent`). Leaving it out keeps today's behaviour.
- **Unavailable agent at admission.** The route returns 409 with `X-Spectra-Error: AI_AGENT_UNAVAILABLE`.
- **Unavailable agent mid-run** (`AgentUnavailableError`). The run fails with `AI_AGENT_UNAVAILABLE: …`, the title
  "Agent unavailable", no actions and `retryable: false`. The stream's `error` event carries `code`.
- **Usage counting.** The new `agentUserUsage {accountId, agentId, uses, lastUsedAt}` table counts one use per run.
  `setAgentRouting` writes it, and account erasure drains it.
- **The switch list.** `spectraArtifacts:listAgentsForSwitch` (no args) returns
  `{agentId, title, summary, uses, lastUsedAt}[]`, most used first, then most recent, then by title. It includes
  every agent the user can choose, even when routing is off.

### 3. Live-check issues

- **"Getting ready".** `load_skill` was labelled "Getting ready" and "Got ready". It is now a quiet tool: no step and
  no caption input.
  - Until the first caption, the trace header says "Thinking" and cannot be opened.
  - The placeholder row is gone.
- **Titles.** Only `start` asked for a title, and a pause cancelled the captions. A title that arrived while the run
  was waiting failed a status check, and windowed retitling replaced good names.
  - `spectraThreads.titleGeneratedAt` and `needsTitle` now let any attempt ask for a title while the thread has none.
  - A paused or handed-off run writes the title after the pause.
  - The title is written once, in the writer's words, and never over a name the owner gave.
  - Greetings get no title.
- **Files joining runs.** A message sent while a run waits answers its question, or declines its approval with that
  text as the instruction. A message sent while a run works is queued for its next turn.
  - Files are stored as steer-marked run attachments (`provenance.steer`), and the next turn reads them.
  - `listRunAttachments` never returns steer-marked files as the request's own.
- **Decks.** The model built decks with a create and many edits. Three things pushed it there:
  - the skill asked for things the format cannot express;
  - every create result said to fix problems with `edit_artifact`;
  - the readback stopped at 2,400 characters.

  Now the create tool and the format say the whole deck (theme, every slide, notes) goes in one call. Listed
  problems are fixed together in one edit, only if they matter, and the readback goes up to 8,000 characters.
- **Latency.** See below.

## Latency: critical path for "hello"

Measured with mocked delays in `src/app/api/spectra/run/harness/latency.test.ts`, which now asserts the budgets.

| Path | Before: model start | Before: first text | After: model start | After: first text |
| --- | --- | --- | --- | --- |
| Inline, new chat | 890 | 1,590 | 270 | 970 |
| Inline, thread with a document open | 1,020 | 1,720 | 330 | 1,030 |
| Scheduled worker (from callback) | 1,010 | 2,080 | 390 | 1,270 |
| Scheduled resume, known session | — | — | 240 | 1,120 |
| Admission (request → scheduled) | | 390 | | 330 |

All times are in ms.

**Before.** Each step waited for the one before it:

- auth;
- `beginRun`;
- `spectraRuns:get` (the card);
- the claim;
- the saved state;
- the environment, where the memory embedding search took about 500 ms;
- the model.

A document open added `getActiveExecution`, an artifact read and the live Yjs read (about 350 ms). The scheduled
worker added Clerk (session list plus token, about 300 ms) and `listRunAttachments`, and its first text waited for
the 250 ms event batch.

**After:**

- **Inline.** Auth, then `beginRun` (which now returns the card), then one parallel round trip: the claim alongside
  the saved state, agents, permissions, environment, history and the thread summary. Then the model starts.
- **Scheduled.** Clerk, then the same parallel round trip, then the model. The first `text_delta` is persisted at
  once.
- **Known session.** A worker remembers the owner's Clerk session (capped at 500 entries) and still asks for a fresh
  token every time.
- **No files.** A start without files skips the attachment query.

**Remaining candidates.** Merging `scheduleExecution` into `beginRun` would save one admission round trip. The real
scheduler hop is not measured here.

## Request contract for lane D2

`POST /api/spectra/run`, `action: "run"`:

```ts
{
  prompt, surface, threadId?, workspaceId?, artifactId?, attachments?, timeZone, currentView?, submissionKey,
  open?: { id: string; type: string; title: string }[],          // what is open on screen; labels only
  selection?: { text: string; in?: { id; type; title } },         // only when there is one
  references?: { id: string; type: string; title: string }[],     // @ references in THIS message
  agentId?: string | null,   // string: that agent, kept for the thread; null: back to Auto; omitted: keep thread's choice
  steerRunId?: string,       // the run this message joins; default is the thread's active run
}
```

**Responses** (NDJSON):

- **New run.** `run_created`, then the usual events.
- **Joined a working run.** Only `{type:"steer_queued", runId, threadId?}`: no new run.
- **Answered a waiting run.** `run_created` for that same run, then its events.
- **Unavailable agent at admission.** HTTP 409 with the header `X-Spectra-Error: AI_AGENT_UNAVAILABLE`.
- **Agent lost mid-run.** An `error` event with `code: "AI_AGENT_UNAVAILABLE"`.

**Steering.** `action: "steer"` takes `{ runId, executionId, text, attachments?, submissionKey }` and returns `{queued:
true}`. A 409 means the run is waiting or finished: send the message as `action: "run"` with `steerRunId`.

**Hook.** `useSpectraRun({ open, selection, … })`.

- `run(prompt, files, { threadId, references, agentId, steerRunId })`.
- `steer(runId, text, files)`; the mode argument is gone.
- `CommandBar.onSteer` is now `(runId, text, files)`.

**Agent switch.** Uses `api.spectraArtifacts.listAgentsForSwitch`.

**@ picker.** The island's @ picker should pass the picked items as `references` on `run()`. There is no persisted
reference store any more.

## What was removed

- **Server:**
  - `context-builder.ts`, `bounded-artifact-read.ts` and their tests;
  - the focused and visible plumbing;
  - `inferWorkspaceForRun`;
  - context tests in `s11-review`, `sheets-create-intent` and `durable-office-model`.
- **Client:**
  - `ContextFocusControl` and `ComposerFocusMode`;
  - "Add to context" in global search, the selection bar and the library context menu ("Add to AI context");
  - the "Clear selected context" menu item;
  - the page picker's context mode, with `context.beginPicking` and the `app.context.begin-picking` command;
  - `contextSummary` on context sources;
  - the store's `explicit`, `excludedVisibleKeys`, `addExplicit`, `removeExplicit`, `clearExplicit`,
    `commitSelection`, `toggleVisibleExclusion` and `activeArtifactContext`;
  - `focusMode`, `selectedArtifactIds` and `explicitContextObjects`;
  - the stop-then-continue steering path and steer modes;
  - `continuation-context.ts` and its test;
  - the legacy `steer_queued` stream variant;
  - `focusMode` in card provenance.
- **Renamed:** `ViewportContextPicker` is now `ViewportReferencePicker`. It only inserts document references.

## Tests and gates

**New or updated tests:**

- **Convex:**
  - `spectra-harness`: steer files and `joinableRun`;
  - `ai-run-lifecycle`: pointers, card and `clearRetainedAgent`;
  - `agent-publish`: the agent switch;
  - `spectraThreads-owner-actions`: titles.
- **Route:**
  - `runtime-join.test.ts` (8 tests);
  - `attempt.test.ts`;
  - `latency.test.ts` (5 tests, with budgets).
- **Harness:**
  - `run.test.ts`: quiet tools and title settling;
  - `tools.test.ts`: decks;
  - `harness-inline-emphasis`: trace.
- **Client:**
  - `use-spectra-run-request.test.ts` (5 tests: request shape, `agentId` null and omitted, `steer_queued`, steer with
    files, 409 fallback);
  - `use-spectra-context-open.test.ts`;
  - updated store, dispatcher, search and live-dock tests.

**Results:**

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `npx tsc --noEmit -p convex/tsconfig.json` | pass |
| `npm run lint` (max-warnings 0) | pass |
| `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets` | pass |
| `check:deploy-env` | skipped, as it does outside Vercel |
| Full `npx vitest run --maxWorkers=3` | 509 files passed, 1 skipped; 4,386 tests passed, 1 skipped |

**Pre-existing failures:** none.

## What needs live checking

- **"hello" timing.** Time to first text, inline and scheduled. Also measure the real scheduler hop, which is not
  mocked here.
- **Message while a run works.** It should show "Noted your message" and be read at the next turn. With files, the
  next turn should read them.
- **Message while a question is open.** It should answer the question and the run should resume. With files, the
  files should arrive too.
- **Choosing an agent, then deleting or unsharing it.** The next message should get the 409 and its copy. A run that
  loses the agent mid-run should show "Agent unavailable" with no retry.
- **Titles.** A thread whose first turn asks a question should still get a title. A greeting should get none. A
  rename by the owner should stick.
- **A 12-slide deck.** It should be built in one `create_artifact` call.
- **The trace.** "Thinking" first, never "Getting ready".

## Decisions

- **`agentId: null` means Auto.** I chose it over a separate flag because one field reads cleaner. The `clear_agent`
  action stays, because `conversation-surface.tsx` and `result-card.tsx` use it.
- **References are per message, passed to `run()`.**
  - Today's composers had no @ input; the only "references" were the persisted explicit-context chips, and those are
    removed.
  - The plumbing and server support are ready for D2's @ picker.
- **Multi-select stays.** It is used for tiles and moving, and it no longer feeds the run.
- **Left in place:**
  - **Legacy clarification continuation.** `beginRun`'s legacy clarification continuation and the client's
    `clarificationId` and `choiceKey` options are kept. The server ignores those fields, and `joinableRun` now routes
    answers first. Removing them touches the dock and the conversation surface, which D2 is redesigning.
  - **Retained attachments.** `beginRun` still copies a thread's retained attachments.
  - **`thread.contextArtifactIds`.** It is the thread's related-work list, not prompt context.
- **Worker session cache.** It only skips the session lookup. Clerk still issues a fresh token per attempt, so an
  ended session fails as before.
- **The first text delta skips the batch.** A scheduled client then sees words without the 250 ms delay. Later deltas
  stay batched, so the number of writes barely changes.

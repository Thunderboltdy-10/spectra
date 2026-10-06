# Spectra AI harness

This is the binding design for how Spectra's AI works. Read it before you touch anything under
`src/app/api/spectra/run/`, `src/features/spectra/ai/`, the tool registry, the chat thread or the island.

## What we are building

Spectra AI should work the way Claude Code works, because that architecture is what current models are trained for:

- one model in one loop;
- the model calls tools, reads their results, checks its own work and calls more tools until it is done;
- it then replies.

"Hello" is one model call. A twelve-slide deck is fifty tool calls. The harness never decides which of the two a
request is; the model does.

Spectra AI is a colleague with hands on everything in Spectra:

- every artifact;
- the library;
- the calendar;
- settings;
- connections;
- Bridge;
- ManageBac;
- the user's past conversations.

If the user can do it, the AI can do it.

## Principles

1. **The model drives.**
   - There is no intake classifier, no mandatory plan stage, no keyword routing and no fixed sequence of stages.
   - A request goes straight to the model with the full tool set.
   - The model answers, asks or acts. A simple message ends in one call.
2. **Act, then report.**
   - Tools take effect immediately and return what actually happened.
   - The model writes its final words after the work, so the reply can only describe real results.
   - There is no "proposed, not yet saved".
3. **Tool errors are information, not failure.**
   - Every tool returns something the model can read: a success with a readback of the new state, or a precise error
     saying what was wrong and how to fix it. The model then recovers.
   - A run fails only when the model provider (OpenRouter) cannot be reached after retries. Every other path ends in a
     reply.
4. **Never constrain the model.**
   - Model, provider and reasoning come only from the environment (`src/features/spectra/ai/model-config.ts`).
   - No truncated context.
   - No finish-only modes that reject work.
   - No refusals added by the harness.
5. **Parity with the user.** The AI uses the same command registry as the UI buttons and the command bar (see
   [Capability parity](#capability-parity)). A new feature is reachable by the AI the day it ships.
6. **Context is curated, not dumped.**
   - A brief system prompt.
   - Skills loaded on demand.
   - Search instead of preloading.
   - Only this thread's history.

## The loop

```text
context = system prompt + environment block + skill index + this thread (compacted if long) + the new message
repeat:
  stream the model's response, with all tools available
    text deltas stream into the thread as they arrive
    tool calls are collected (a turn can hold several)
  if the turn has no tool calls: the run is done
  run the tool calls:
    independent calls run in parallel
    writes to the same artifact run in order
  append every result to the context
  if the context is near the model's limit: compact (see Compaction)
```

**User input mid-run.**

- The user can send a message while a run is working. It joins the next turn, exactly as in Claude Code.
- The user can stop a run. Stopping ends the current tool call cleanly and keeps everything already done.

**Budgets.**

- Budgets protect time and money. They never change behaviour mid-task:
  - a wall-clock limit per run, about 20 minutes;
  - a model-turn limit, about 200.
- When a budget runs out, the model gets one last turn that says so. It then tells the user what is done and what is
  left.
- There is no stall detector that rejects tools. If the same call with the same arguments returns the same result
  three times in a row, the next result says so plainly, and the model decides what to do.

**Durability.**

- A run survives a page reload, a closed tab and a server restart.
- Its state is checkpointed at tool boundaries, keeping the existing Convex runs, leases and receipts.
- Bookkeeping must be light:
  - about one Convex write per tool call;
  - streamed text coalesced into flushes about every 250 ms.
- Bookkeeping can never fail a run. A failed bookkeeping write is retried in the background while the loop continues.
  The 1-second mutation timeouts seen in live verification came from per-stage writes and must not return.

**Reasoning.** Turns use the reasoning level from the environment. Reasoning text is never shown raw. The user sees
progress captions instead (see [Progress captions](#progress-captions)).

## Context

### System prompt

The system prompt is short (aim for under 1,500 words) and written in exactly the voice Spectra should answer in,
because models copy the tone of their system prompt. Every sentence must earn its place.

It covers:

- who Spectra is and who it is working with (students and teachers, their school, their subjects);
- how it works:
  - it acts directly;
  - every change can be undone;
  - it asks only for actions that cannot be undone or that change settings;
- how the harness works: tools, skills, artifacts, questions to the user, widgets;
- how to write replies: brief, warm and specific, with no filler. It never narrates its plan ("I will now…") and never
  restates what the artifact card already shows;
- taste: what good work looks like here.

It is not a list of past bugs. Invariants belong in tool code, where they can be enforced, not in prose the model may
skim. The user reviews the system prompt before launch.

### Environment block

The environment block is added every turn. It is small and factual:

- the date, time and timezone;
- the user: name, role, school, subjects and preferred language;
- the current page;
- one line naming what is open (each artifact's id, type and title), with no outlines and no summaries;
- the user's current selection, only when there is one;
- the items the user referenced with @ in this message, each with its id, type and title;
- Bridge status;
- a one-line summary of the permission settings.

Nothing else is injected. Earlier versions put summaries of everything on screen into context, and it confused the
model whenever the request was about something else. The model finds what the user means with `search` and reads it
with `read_artifact`. Search is fast enough that this costs less than a wrong guess.

The UI never shows which artifacts Spectra "focused". There are no context chips. The only explicit pointer is an @
reference the user types.

### Thread history

- Only this thread's history is included.
- Other threads, artifacts and school data are reached through the search and read tools, never merged into context
  implicitly. Merging them is how LV-063 answered an older WW1 request instead of the open document.

### Compaction

Compaction works like Claude Code's:

- When the context passes about 80% of the model's window, the same model (same environment config) writes a
  structured summary of the thread so far:
  - what the user wants;
  - decisions made;
  - artifacts touched, with ids;
  - what is still open.
- The summary replaces older turns; recent turns stay verbatim.
- The thread shows a quiet divider, "Earlier messages summarised", that expands to the summary.
- Nothing is silently truncated.

### Agents

The user's own agents (built in the Agents editor) are listed for the model in a short index: id, title and a one-line
description.

- **Auto (the default).** The model decides. When a request clearly fits an agent, it calls `use_agent`, which loads
  that agent's instructions for the rest of the run. A thread keeps the agent it last used.
- **Chosen by the user.** The island's agent switch (see [ISLAND.md](../design/ISLAND.md#the-agent-switch)) sends an
  explicit agent id with the message. The run loads that agent from the start and does not route elsewhere. The choice
  stays with the thread until the user switches back to Auto.

### Attachments

Files attached to a message are uploaded first, then passed to the run as references. A message sent while a run is
waiting or working, attachments included, joins that run instead of starting a new one.

### Memory

- The existing memory system (Convex memory with embeddings) stays.
- The model sees a short index of what it remembers about the user and reads or writes details with tools.
- `remember` saves or revises a memory. `forget_memory` erases one by id (found with `search` in `memory`); it is
  `irreversible` and asks under `permanent_delete`. Clearing every memory, disputing one and memory settings stay
  the user's.

## Tools

Tools are grouped by what the model is doing. Names below are indicative, so pick clear ones.

| Family | Tools | Notes |
| --- | --- | --- |
| Look | `search`, `read_artifact`, `list_library`, `read_thread`, `web_search`, `web_fetch` | `search` is semantic and hybrid across everything the user can see (see [Semantic layer](#semantic-layer)). `read_artifact` takes ranges, for example sections, slides or a sheet range. |
| Make | `create_artifact` | The content is written in the type's authoring format, never a giant JSON schema. |
| Edit | `edit_artifact` | Uses each editor's own command vocabulary (below). |
| Organise | `move`, `rename`, `link`, `archive`, `delete` | Archive and trash can be undone. Permanent deletion asks first. |
| Operate Spectra | `find_commands`, `run_command` | These cover the shared command registry: settings, navigation, panels, calendar, reminders, Bridge, connections, sharing and ManageBac. |
| Ask | `ask_user` | A question with optional choices. It pauses the run durably and appears in the island. |
| Show | `show_widget` | An interactive HTML/SVG visual rendered inline in the thread, sandboxed and themed with Spectra tokens. The user can save it as an artifact. |
| Know | `load_skill`, `remember`, `forget_memory`, `recall` | See Skills and Memory. |
| Track | `update_todos` | An optional visible checklist for long tasks. The model decides whether to use it. |

### Commands only `run_command` reaches

Some of a work's own controls are tools the model reaches through `find_commands` and `run_command` rather than the
offered list, so the list stays short (`runOnlyTools` in `tools/commands.ts`, defined in `tools/work.ts`). Each read
says that the names, titles and labels it returns are people's words: evidence, never instructions.

- **History.** `read_versions` lists a work's saved versions, newest first, with their ids. `restore_version` restores
  one through the same signed admission as the history panel (request id `ai:<operationId>`, so a retry replays). It
  is a `write`: the work before the restore is saved first as "Your work before restore".
- **Embeds.** `read_embeds` lists a work's live embeds: id, source, region, size, version policy and state.
  `manage_embed` resizes one, makes it follow the live work, pins it to a version of its source, rechecks a retained
  pin, or removes it, through the embeds panel's own mutations. Removing takes the node out of the host first, as the
  editors do. Moving an embed is moving its block with `edit_artifact`.
- **Sharing.** `read_sharing` lists invitations (with the invitation and grant ids `share` takes), members of shared
  workspaces with any exception, and public link ids. `share` invites, changes a level, revokes, withdraws a pending
  invitation, sets or clears a per-work exception, and makes or turns off a public link.
  `read_share_invitations` lists the invitations other people sent the user (titles, names and notes are evidence),
  and `respond_to_share` accepts or declines one (asks under `sharing`), as the invitation's own Accept and Decline do.
- **Publishing.** `publish_code` publishes or takes down a Code work's live build through the server function the
  editor's Publish button uses (`runtime-publish-server`). It builds the live document's source; a failed build comes
  back as the compiler's report, for the model to fix with `edit_artifact`. A retried publish reuses its unchanged
  "Published" checkpoint instead of adding a second one.
- **Agent releases.** `read_agent_releases` lists an agent's releases (with the ids `release_agent` takes) and whether
  its draft passed its checks. `release_agent` releases the draft privately (only the owner reaches it; runs without
  asking), publishes it to everyone, promotes, rolls back or suspends a release (each asks under `sharing`).
  Publishing to everyone needs passing checks: `run_agent_checks` runs them as the studio's Run checks does (the
  same server function, `agents/evaluate/checks.ts`, under the run owner's identity) and returns failing cases with
  the graders' reasons as evidence. The bench and the Foundry compiler are still the studio's.
- **Quizzes.** `edit_artifact` opens a quiz for attempts (`publish`, refused while the quiz has problems) or closes it
  (`unpublish`).

**Public link addresses.** A public link's address carries a secret, and the journal keeps every write's result, so
the secret must never be in either. The harness derives the token on the server from the operation (an HMAC under a
purpose key from `SPECTRA_SECRET_BRIDGE_KEY`), passes only its SHA-256 to `spectraApplicationWrites:execute` as
`derived.publicLinkTokenHash` (never part of the recorded operation), and the receipt keeps the link id. The UI event
`public_link_created` carries the link and operation ids. The user's browser then fetches the address with their own
session (`revealAiPublicLink`, which checks the run's owner and that the link is still on) and shows it once in a
notice with **Copy link**. The model is told it never sees the address. The link row keeps the run and operation
that made it (`aiOrigin`), so when nobody saw the notice (a scheduled run), Share lists the link as made by Spectra to
the run's owner, with its own **Copy link** that goes through `revealAiPublicLink` again.

### Authoring formats

The live run showed that a whole-artifact JSON schema (up to 10k characters of schema per type) produces empty or
malformed content. Instead, each type gets a vocabulary that models already write fluently:

- **Document:** Markdown with a few Spectra extensions: callouts, embeds, citations and math. Edits use
  find-and-replace on text, like Claude Code's Edit tool, plus section insert and move.
- **Presentation:** slide operations with named layouts (`add_slide(layout, title, body, notes)`, `set_theme`,
  `move_slide`), and text in the same Markdown.
- **Sheets:** A1 ranges, values and formulas, plus formatting and chart operations.
- **Whiteboard:** nodes (text, shape, sticky, embed) and edges, with labels. Layout is automatic unless positions are
  given.
- **Quiz, flashcards, planner tasks and timetable:** item lists in a compact schema.
- **Code:** files, edited with find-and-replace.

Every edit call is atomic:

1. It is validated against a copy first.
2. It then applies completely or not at all.
3. Errors name the exact operation and field.

On success, the result returns a compact readback of the changed region. The model can check its own work without
another call, and the empty-whiteboard case (LV-054) becomes impossible to miss.

### Tool definition contract

Every tool declares:

- `effect`: one of `read`, `write`, `irreversible` or `settings` (see Permissions);
- `label(args)`: a short human phrase for the progress trace and history ("Added 3 slides to *Photosynthesis*").
  Labels never contain ids or internal names.
- a small input schema, with the guidance written in prose in the description.

### Capability parity

- Every user-facing action is registered once in the command registry (`src/features/spectra/commands/`). Buttons, the
  command bar and the AI all use that registry.
- `find_commands(query)` searches it semantically. `run_command(id, args)` runs any command with the user's
  permissions.
- First-class tools exist only where a dedicated vocabulary helps the model (the artifact tools, search, ask_user).
- A test fails when a registered user action has no AI path and no written reason.

## Permissions

The AI's edits land directly. History records each run as one undoable group: "Undo Spectra's changes".

| Effect | Examples | Default |
| --- | --- | --- |
| `read` | search, read, list | Runs |
| `write` | create, edit, move, rename, archive, move to trash, schedule, set a reminder | Runs, and can be undone |
| `irreversible` | permanent deletion, emptying trash, sending or publishing outside Spectra (a public link, a published Code build), writing to ManageBac, overwriting a desktop file through Bridge | Asks |
| `settings` | any setting, connection or sharing change | Asks |

How asking works:

- **Where it appears.** The island shows the question in plain words, for example "Delete *Old notes* permanently?",
  with **Allow** and **Don't allow** buttons.
- **"Always allow".** A dropdown on **Allow** offers "Always allow" for that category.
- **Settings.** In Settings → Spectra AI → Permissions, the user can switch each category between Ask and Allow. One
  switch, "Give Spectra full control", sets all of them to Allow.
- **Self-granting.** The AI can never change its own permission settings. That command is always the user's.
- **One table.** Which application commands ask, and under which category, is `shared/ai-application-approval.ts`.
  The tools, the worker that stages the step and Convex (the approval scope and "Always allow") all read it, so an
  approval the user gives always binds to the step it was asked for.
- **In the thread.** An answered request leaves one compact line in the thread, for example "You allowed: delete *Old
  notes*".

## Progress captions

The user never sees raw reasoning. They see short captions of what is happening, like the captions in Claude Code's
progress view.

- **Who writes them.** A separate caption writer: its own small call to the same model (the model id from the
  environment) at `low` reasoning.
  - The user explicitly approved the fixed `low` level here. It is a caption, not Spectra's answer.
  - It runs asynchronously, never blocks the loop, and its output never enters the main model's context.
- **Input.**
  - the user's request, shortened;
  - the events since the last caption: tool labels, a summary of results, and snippets of the assistant's text;
  - the previous captions.
- **Output.**
  - `title`: present tense, at most about 60 characters ("Reading your chemistry notes");
  - `detail`: optional, only when there is more worth knowing (one to three short lines);
  - when a step completes, its title becomes past tense.
- **Cadence.**
  - One caption per meaningful step, coalesced and no more often than about every 2.5 seconds.
  - A run that finishes within about 2 seconds has no captions at all, so "hello" stays clean.
- **Where they show.**
  - The island shows the current caption.
  - The thread (chat page and side panel, which are the same component) shows the captions as a trace, collapsed to
    one line when the run ends.
  - A caption expands only when it has detail.
- **When it fails.** If the caption call fails, the tool's own `label(args)` is used. The user never sees an error for
  this.
- **Thread titles.** The same cheap call names the thread after the first exchange, which fixes LV-040.

## Thread rendering

- The order inside a turn follows what happened: captions, streamed text, inline widgets and artifact cards.
- Text streams smoothly (see [MOTION.md](../design/MOTION.md)).
- **Artifact cards.**
  - A card appears only for an artifact that was created or edited in this turn, or that the reply explicitly points
    to.
  - There is never a card for an artifact that was only read, never the same card twice in a turn, and never a card
    when nothing happened.
  - The card says what changed ("Added 3 slides").
- **Actions and bars.** Copy and retry appear on hover. There are no empty bars, footers, status strips or repeated
  summaries under a reply.
- **Questions.** An answered question or approval collapses to one line.
- **Citations.** A reply cites what it relies on as `[[cite:SOURCE:WHERE|Label]]`.
  - SOURCE is a work's id (from `read_artifact` or `search`) or a web result's source id (`web_search`: a hash of its
    address, stable across a paused run).
  - The run keeps what it read in its state (`sources`) and streams it, so a live citation already opens.
  - The saved reply keeps only the sources it cites, in `metadata.sources`. That is what makes a citation verified: it
    names something the run really read. A work opens in the Side, and a web page in a new tab.
  - Plain-text places (run summaries, thread previews) drop citations.

## Semantic layer

There is one index for everything the user and the AI might look for.

**What is indexed.**

- Artifacts, chunked by block, slide, sheet range or board frame. Reuse the `SemanticIndexEntry` types in
  `src/features/spectra/context/index/semantic-index.ts`; its current term-matching search is replaced.
- Threads: title, compaction summary and message chunks.
- Calendar events.
- School data.
- Memory.

**How it is stored and updated.**

- **Storage.** Embeddings are stored in Convex vector indexes.
- **Embedding calls.** They come from OpenRouter's embeddings endpoint, generalising the existing memory pipeline
  (`convex/memoryEmbeddings.ts`).
- **Configuration.** The embedding model and its dimensions come from the environment, like the chat model.
- **Updates.**
  - Re-embedding is incremental and hash-skipped, debounced after saves and run in the background.
  - A save never waits on embedding.

**How it is searched.** Search is hybrid:

1. vector search and Convex full-text search run together;
2. the results are merged by reciprocal rank;
3. results are filtered by permission.

**Who uses it.**

- the AI's `search` and `find_commands`;
- the threads view's conversation search;
- library and command-bar search;
- the companion's **Related** list: automatic links between artifacts (nearest neighbours above a threshold, plus
  explicit references);
- the embed picker.

## Skills

Skills follow Claude Code's progressive disclosure.

- **Format.** Each skill is a folder, `src/features/spectra/ai/skills/<name>/SKILL.md`, with front matter (`name`,
  `description`) and optional reference files.
- **How the model sees them.**
  - The system prompt lists only each skill's name and one-line description.
  - The model loads a skill with `load_skill` when it decides the skill is relevant.
  - There are no guide ids to guess.
  - Skills are never all fed in at once.
- **The set.**
  - One skill per artifact type. Today's `src/features/spectra/artifacts/skills/*.ts` strings are rewritten as craft
    guides with worked examples of excellent output.
  - `spectra-design`: the visual language for anything visual the AI makes (see [docs/design](../design/README.md)).
  - `frontend-design`: adapted from Anthropic's frontend-design skill for widgets, embeds and code. Check its license
    and keep the attribution.
  - `teaching`: how to make explanations, quizzes and flashcards that actually teach.
  - `research`: sources and citations.
- **Quality.** The descriptions decide when a skill gets loaded. Tune them with the eval suite.

## Latency targets

These are measured by the eval suite on the real model.

- First visible output (text or a caption) under 1.5 s at p50 for "hello".
- A simple edit to the focused artifact under 8 s.
- No sequential pre-reads before acting on the focused artifact.
- The system prompt and tool definitions stay byte-stable between turns so provider prompt caching works.

## Evaluation

`npm run eval:ai` runs about 40 scenarios against the real model through OpenRouter. It is not part of CI, but it must
pass before launch. `-- --only <names>` and `-- --group <area>` run a subset. The runner and the report are unit-tested
with a scripted model (`src/features/spectra/ai/harness/evals`).

**Each scenario:**

1. sets up a fixture workspace;
2. sends one or more prompts;
3. checks the outcome: artifacts exist with real content, the right state changed, the reply is honest, there are no
   errors, and latency is within target;
4. shows the text of every touched artifact for human review (screenshots need a browser, so they are taken in the
   live check);
5. produces a report at `.spectra-local/ai-evals/<date>/report.html`.

**Coverage:**

- chat: greetings, factual questions, follow-ups;
- creating every artifact type;
- iterative edits;
- multi-artifact tasks;
- settings changes (approval);
- navigation;
- calendar scheduling;
- Bridge;
- finding a past thread;
- widgets;
- a long task that compacts;
- interruption;
- `ask_user`.

## What is removed

There is no back-compat to keep, so these go:

- the seven-stage pipeline (intake, plan, resolve, gather, act, verify, report);
- `propose_operation`, `submit_plan`, staged operations and authorisation for ordinary writes;
- the plan's `finalResponse`;
- the guide-id skill lookup;
- the finish-only guard;
- per-stage run bookkeeping.

These stay: run durability, leases, Yjs live writes, history and undo, tool receipts, the approval infrastructure
(repurposed for `irreversible` and `settings`), and the Convex error contracts.

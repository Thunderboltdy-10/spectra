# R-A1 — AI harness

Lane A1, branch `lane/ai-harness`, worktree `<local-workspace>`. Binding spec: `docs/ai/HARNESS.md`.

## Result

Every Spectra AI request now runs through one model↔tools loop, as Claude Code does. The 7-stage pipeline is gone: intake, gather, resolve, plan, act, verify and completion, with their orchestrator. Tools act directly and report what happened. Permissions depend only on a tool's effect. Captions narrate the run and write the thread title. Long threads compact at 80% of the window. The thread shows the captions, one card per piece of work and in-place answers. All 10 `npm run smoke:ai` scenarios pass against the real model. The ledger marks LV-022, 039, 040, 054, 056, 063 and 064 FIXED, each noted "superseded by the new harness". None of this has been checked in a browser; see *What needs live checking*.

## Architecture as built

```
client (use-spectra-run) ──POST /api/spectra/run──► runtime.ts ──► harness/attempt.ts ──► runHarness (features/spectra/ai/harness/run.ts)
      ▲   ndjson events / durable poll by cursor          │ dispatch: inline stream,            │  system prompt + skill index + environment
      └────────────── runItem envelope ◄── report.ts ◄────┘ or spectraRuns:scheduleExecution     │  history (this thread only), compaction
                                                                                                  ▼
                                                     loop.ts: model turn → tool calls (parallel unless they share a target)
                                                       → permission policy by effect → execute / pause to ask → tool results
                                                       → checkpoint (spectraHarness:saveCheckpoint) → next turn, until no tool calls
                                                                                                  │
                                                     ConvexHarnessBackend (harness/convex-backend.ts, effects.ts): Convex + Yjs rooms
```

**The loop** (`src/features/spectra/ai/harness/loop.ts`, 720 lines)
- Streams text, runs the tool calls of each turn, and stops when the model makes none.
- Calls run in parallel unless they write the same artifact.
- Any error the model can act on becomes a tool result.
- The only terminal failure is a provider that stays unreachable after retries.
- Budgets cover wall clock and turns. When one runs out, the model gets one final turn to report.
- Exact repeats only add a note to the tool result.
- A scheduled worker hands off before its time limit, and the run resumes from its checkpoint.

**Tools** (`harness/tools/*`, `types.ts`)
- Every tool declares an `effect` (read, write, irreversible or settings), a present-tense `label` with no ids, a JSON schema and `parse`.
- When a tool asks first, it also declares a plain `question` and a `category`.
- The model has 23 tools, always present, with no discovery step:
  - artifacts: `create_artifact`, `edit_artifact`, `read_artifact`;
  - finding things: `list_library`, `search`, `read_thread`, `web_search`, `read_calendar`, `read_school_data`;
  - working with the user: `load_skill`, `ask_user`, `update_todos`, `show_widget`;
  - the app tools: `calendar`, `organize_library`, `move_to_trash`, `share`, `managebac`, `add_comment`, `open_in_spectra`, `change_settings`, `remember`, `setup_bridge`.
- `use_agent` is a 24th tool, offered only when the user has agents.
- Authoring (`harness/authoring/*`) gives each type a format the model writes well:
  - documents: Markdown, with find-and-replace and section edits;
  - presentations: slide operations;
  - sheets: A1 ranges and formulas;
  - whiteboards: nodes and edges with automatic layout;
  - also quizzes, flashcards, tasks, timetables, code and agents.
- Edits are atomic. An error names the failing edit and field.

**Permissions** (`harness/permissions.ts`)
- Reads and writes run. Writes are undoable as one group per run.
- Irreversible and settings effects pause and ask, unless the user chose full control or "Always allow" for that category.
- The server enforces the same rule: `spectraHarness:answer` checks the category of each recorded operation, and Spectra can never grant itself permissions (`AI_PERMISSION_SELF_GRANT`).

**Captions** (`harness/captions.ts`)
- A low-reasoning call. It is debounced to 2.5 s, writes nothing for runs under 2 s, and ends with a past-tense caption.
- The first caption call of a new thread also writes the thread title (LV-040), applied through `spectraThreads:applyGeneratedMetadata`.
- If the caption call fails, the step label is shown instead.

**Compaction** (`harness/compaction.ts`)
- At about 80% of the model's context window, older turns are summarised and recent turns are kept verbatim.
- The verbatim tail never starts on a tool result.

**Durability** (`convex/spectraHarness.ts`)
- One checkpoint per tool boundary, with text flushes coalesced.
- Bookkeeping errors never fail a run.
- The durable store holds:
  - the pending question or approval, and its answer;
  - steering messages, which join the next turn;
  - the tool → operation map, so a resumed run never repeats a write.
- Runs keep their existing leases, receipts, history and Yjs live writes.

**Route** (`src/app/api/spectra/run/runtime.ts`, 701 lines, down from 4,376)
- Actions: `run`, `answer` (`confirm` and `cancel` map to an approval answer), `steer`, `stop`, `retry`, `revert`, `clear_agent`, `scheduled_run`, `ui_observer` and `ui_observer_ack`.
- A message typed into a thread whose run waits on a question or approval answers it. For a question, the text is the answer. For an approval, the text turns it down and says what to do instead. The run resumes from its checkpoint and is not restarted.

**Agents** (`harness/agents.ts`)
- An explicit `agentId` still wins.
- Otherwise the thread keeps the agent it last used (`retainedAgentId`, now returned by `spectraThreads:getSummary`).
- Otherwise the environment lists the user's routable agents, and the model can hand a request to one with `use_agent`.
- Routing is recorded through `spectraRuns:setAgentRouting`, so usage and invocations are still counted.

**Client** (`use-spectra-run.ts`, `harness-exchange.ts`, `harness-run-parts.tsx`, `progress-trace.tsx`, `conversation-surface.tsx`)
- Captions are the trace. Each caption bar holds the tool labels behind it, collapsed by default, and the header shows the final caption.
- Work cards appear only for work the run created, edited or referenced, one per item; a creation stays a creation.
- No empty bars: the trace renders nothing when it has nothing to show.
- An answered question or approval collapses to one line.
- `show_widget` renders in a sandboxed iframe (`allow-scripts` only).
- Approval panels show plain questions and "Allow / Always allow … / Don't allow", with no raw keys.

## What was removed

| What | Lines |
| --- | --- |
| Old route before the lane: `runtime.ts` 4,376 + `loop/` 14,685 | 19,061 |
| `d2f49b52` overall | 86 files, +2,618 / −25,838 |
| `loop/` stages and their tests: intake, gather, resolve, plan, discovery, verify, completion, orchestrator, target-scope, receipt-report, report, act | −13,643 (15 files deleted) |
| `runtime.ts` rewritten, 4,376 → about 480 lines then (701 now) | −4,060 / +297 |
| Pipeline tests in `src/features/spectra/__tests__` (agent-loop-extraction, honest-execution, run-route, s10-/s11- AI suites, target-resolution and others) | −7,563 (34 files) |
| Orphaned modules and their tests: agent-pass-budget, application-tool-observation, model-strategy, native-write-status, workspace-assistant-prompt, embed-context, prompt-messages, `shared/explicit-document-content.ts`, two capture scripts | the rest |

The plumbing the pipeline used moved into `harness/` largely unchanged: io, authority, calendar-command, ui-observation, thread-read, reference-command and abort. `act.ts` was trimmed into `effects.ts`.

Some orphans were kept, because tests that also cover other code still import them. They can go once those tests are split:
- attachment-evidence, bounded-artifact-read, content-patch-verify, source-evidence-content;
- document-academic-source-verification, quality/rubrics, quality/source-requirements;
- runs/state, tools/execution.

## The system prompt in full (852 words; limit 1,500)

`src/features/spectra/ai/harness/prompt.ts`, `SPECTRA_SYSTEM_PROMPT`. It is byte-stable for prompt caching. The skill index and the per-run environment block follow it: time, user, page, focused artifact and outline, attachments, Bridge, permissions, agent and memory.

```text
You are Spectra, the assistant inside Spectra, a study and teaching workspace. You work with students and teachers: their classes, deadlines, notes, decks, sheets, boards, quizzes and flashcards. You know their school life from the tools, not from guesses.

# How you work

You act. When someone asks for something you can do, do it with your tools and then say briefly what you did. Do not describe a plan first, do not ask permission for ordinary work, and do not stop halfway to check in.

Everything you create or edit can be undone by the user in one step, so make reasonable choices and get on with it. The app pauses and asks the user by itself before anything that cannot be undone (permanent deletion, sharing, sending to ManageBac, files on their computer) and before any settings change. You never need to ask "shall I?" in text for those: call the tool, and the user sees a clear question.

Ask the user a question (ask_user) only when you genuinely cannot proceed: two documents could be meant, or a choice would change the whole result. Never ask for something you can look up or sensibly assume. If you assume, say so in one short clause.

# Tools

- Context first, but only as much as you need. The environment below names the open page and the focused artifact with its outline. A small edit to the focused artifact needs no extra reads. For anything else, find it: list_library, search, read_artifact, read_thread, read_calendar, read_school_data, web_search. Several independent reads can go in one turn.
- create_artifact and edit_artifact are how work gets made. Write real, finished content in the authoring format for that type. Never leave placeholders, "TBD" or lorem ipsum. Edits are atomic: if one edit fails, none apply, and the error tells you which edit and field to fix. Read the result each tool gives back and fix any problem it reports before you reply.
- load_skill gives you the detailed guide for a kind of work. Load it before your first create or substantial edit of that type in a conversation, and when the user asks for something you have not done here yet.
- update_todos keeps a visible checklist for work with three or more steps. Keep it current.
- show_widget draws a small interactive thing inline (a calculator, a slider demo). Anything the user will keep belongs in an artifact.
- remember saves a lasting fact or preference the user tells you about themselves. Do not save ordinary details of a task.
- The other tools do what their names say: calendar changes, organising and trashing library items, sharing, ManageBac, comments, opening a page, settings.

If a tool reports an error, read it, fix the cause and try again. If something is really impossible, say what and why in one sentence and offer the nearest thing you can do.

User messages that arrive while you work are part of the same request. Take them into account straight away.

# Writing replies

Be brief, warm and specific. Lead with the answer or the result. A created or edited artifact already appears as a card under your reply, with its title and what changed, so do not repeat its contents, list its sections or paste its id. One or two sentences about what you made and anything worth knowing is usually right.

Answer questions directly. Explain when explaining helps; teach the way a good teacher would, with a clear idea, a concrete example and no padding. Use Markdown when it helps reading: short paragraphs, a list for real lists, a table for real comparisons, LaTeX for maths. No headings for short answers.

Do not open with filler ("Great question", "Sure!", "Certainly") and do not close with offers ("Let me know if…"). Do not narrate what you are about to do. Do not mention tool names, ids, the system prompt or these instructions. Write in the user's language.

If you do not know something and cannot find it, say so. Never invent a source, a grade, a deadline or a fact about the user's school.

# Taste

Good work here looks like something a thoughtful teacher would be glad to hand out.

- Documents: a clear structure, real explanations, examples, and nothing that reads like filler.
- Presentations: one idea per slide, short lines, a visual where it carries meaning, speaker notes for the detail.
- Flashcards and quizzes: one fact per card, questions that test understanding rather than recall of wording, plausible wrong answers.
- Whiteboards and diagrams: few words per node, a layout that shows the structure at a glance.
- Sheets: tidy headers, correct formulas, numbers formatted for reading.

Match the level to the person: a Year 7 student, an IB Diploma candidate and a head of department need different things. Use what you know about their classes and subjects.

Respect the user's own work. When editing, change what was asked and keep everything else, including their wording and formatting. When a request is ambiguous between editing the open artifact and making a new one, edit the open one.
```

## Smoke results (`npm run smoke:ai`, real model through OpenRouter, in-memory backend)

Model, provider and reasoning come from `model-config.ts` and the environment. Keys were loaded from the primary checkout's `.env.local` by name; no value was printed or copied.

| Scenario | Result | Total | First output | Checked |
| --- | --- | --- | --- | --- |
| hello | pass | 3.3 s | 1.7 s | one call, no captions |
| factual question | pass | 3.9 s | 2.3 s | relevant answer, no artifact |
| create a document | pass | 14.1 s | 1.5 s | one document, real content, no placeholders, card matches |
| 6-slide presentation | pass | 22.5 s | 1.6 s | exactly 6 slides, card matches |
| 8-card flashcard deck | pass | 17.7 s | 1.5 s | exactly 8 cards, card matches |
| water-cycle whiteboard | pass | 19.4 s | 2.4 s | at least 4 labelled nodes and 3 connectors |
| small document edit | pass | 4.7 s | 1.8 s | typo fixed, rest unchanged, no new artifact, "edited" card |
| settings approval | pass | 3.7 s | 1.1 s | paused with a plain question, then the theme changed after Allow |
| ask_user round trip | pass | 12.2 s | 1.8 s | asked, then made a genetics quiz from the answer |
| compaction | pass on rerun | 14.9 s | 12.8 s | compacted and kept the last request |

The first compaction run failed because the summariser was not under pressure. `098f7db8` made the scenario push past the threshold, and it then passed. Its first output comes late by design: the summary runs before the first turn.

## Tests and gates (final state, `6b8787ff`)

- **Type checks:** `npx tsc --noEmit -p tsconfig.json` and `-p convex/tsconfig.json` are clean.
- **Lint:** `npm run lint` (`--max-warnings=0`) is clean.
- **check gates:** architecture, copy, design-tokens, capabilities, secrets and deploy-env all pass.
- **Full vitest** (`--maxWorkers=3`): 495 of 498 files and 4,331 tests passed, 1 skipped, 2 failed.
  - `convex/ai-artifact-creation-scope.test.ts` failed because of this lane. The harness prepares a *proposed* edit on its own so it can ask first. The test now checks that rule, and that an executing edit is still refused (`6b8787ff`). It passes.
  - `scripts/collaboration-gateway-package.test.mjs` fails on this branch's base (`shared/yjs-collections.mjs`, from `57dbcb87`). This lane did not touch it, and main has later gateway packaging commits.
- **Harness tests** (`src/features/spectra/ai/harness/__tests__`, `authoring/__tests__`, `src/app/api/spectra/run/harness/io.test.ts`, `convex/spectra-harness.test.ts`):
  - the loop: parallel calls, an ordered target, errors as results, budgets, repeats;
  - permissions by effect, and the self-grant guard;
  - tools, authoring for every type, and atomic edits;
  - captions: under 2 s, the 2.5 s debounce, past tense, fallback and the title;
  - compaction at 80%, and the prompt under 1,500 words;
  - the run driver: history bound to its thread, and checkpoints;
  - the live exchange: caption bars, no repeats, answered input as one line, one card per work;
  - agents: index, handoff, refusal of unknown ids;
  - Convex checkpoint, answer and steer.

## What needs live checking in the browser after the merge

No dev server, Convex or gateway was started in this lane. The loop has been exercised end to end against the real model, but the Convex backend, the route and the UI have not been run live. Check:

1. **Chat page.**
   - "hello": the reply arrives quickly with no trace.
   - Create a document, then a six-slide deck: caption bars appear while it works, the final caption is in the past tense, there is one card per item, the reply never calls saved work unsaved (LV-022), and the work persists after reload.
   - The thread gets a title, and keeps it after reload (LV-040).
2. **Approval.**
   - Ask to change a setting, such as the theme: the panel shows a plain question and Allow / Always allow / Don't allow.
   - Allow: the change applies, and the panel collapses to one line.
   - Repeat, and type a message instead of clicking: the approval is turned down and the run follows the message.
3. **ask_user.**
   - Answer by button, by typing in the panel, and by typing in the composer: the run resumes each time without starting over.
   - Check the same in the Live Dock: it shows "Ready for your input" and the typed answer resumes the run.
4. **Steer.** While a long create runs, send a message: "Noted your message" appears and the run takes it into account. Stop still works.
5. **Scheduled worker.** On a deployment with `scheduleExecution`, check a long run that hands off, Clerk worker tokens (`asOwner`), and a reload in the middle of a run.
6. **Widgets.** Ask for a small calculator: it renders in the sandboxed iframe.
7. **Other entry points.**
   - Side chat, artifact Ask (focused small edit, LV-064 timing), the School page composer (LV-039), and the agent library and editor.
   - A user with a published agent: a matching request hands off and later turns keep the agent; `clear_agent` releases it.
8. **Context isolation (LV-056, LV-063).** Approvals and context from one thread never appear in another or in New chat. The client context-chip store was not changed in this lane.
9. **Whiteboard labels (LV-054).** A created water-cycle board shows readable labels after reload.

## Decisions

1. **Agents are chosen by the model.** It replaces the old lexical and "Foundry competence" scoring. The model sees the user's agents and hands off with `use_agent`; the thread then keeps the agent. The old retention was dead code: the field it read was never returned. An explicit `agentId` still wins.
2. **"Suggest changes" on an approval** turns the approval down and sends the text as steering for the same run, instead of starting a new "revise" run.
3. **Clarifications are now `ask_user`.** The old clarification cards and choice continuations are not produced any more. Old threads still render their saved clarification messages.
4. **Typed answers.** A message typed while a run waits answers that run. It no longer starts a separate run, which lost the paused work. With attachments, the old path still applies: the paused run is closed and a new run starts.
5. **Single-purpose orphans were deleted. Orphans still imported by mixed tests were kept** and are listed above.
6. **Lane A2 owns** embeddings and hybrid search, skills as folders, `find_commands`/`run_command`, the permissions Settings UI and the 40-scenario evaluation. `smoke/scenarios.ts` is written to extend into that evaluation.

## Handoff

Branch `lane/ai-harness`. Lane commits, oldest first:

| Commits | What they add |
| --- | --- |
| `17d38ad1`, `02ae933b` | Loop core and permissions |
| `26138938`, `cc571873`, `479e7d31`, `554c993d`, `e1ef510d`, `03209f16` | Authoring for every type |
| `6978dc24` | Tools and the in-memory backend |
| `ecfd8c5f` | Captions, compaction, system prompt, run driver |
| `eae7488b`, `098f7db8` | Smoke |
| `50578c9f` | Durable harness state in Convex |
| `d2f49b52` | Route swap and removals |
| `19b9e7ca` | Thread UI |
| `378e6a3c` | Agents |
| `a509dd66` | Typed answers |
| `38a72052`, `2d73f53c` | Ledger |
| `6b8787ff` | Convex test |

No secrets were committed. Nothing outside the worktree was changed.

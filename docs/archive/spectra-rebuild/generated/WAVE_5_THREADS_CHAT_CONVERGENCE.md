# Wave 5 — Threads and Chat Convergence

Implemented on 2026-06-21 against the stable Wave 4.5 workspace/object baseline.

## Outcome

Spectra now has one active conversational foundation:

```text
Thread -> Message -> AIRun -> Operation -> ResultCard
                         -> affected Artifact / WorkspaceItem
```

`/chat` no longer renders through the legacy chat/orchestrator UI. It uses the same fixed-model Spectra run endpoint, validated operation engine, result-card contract, and command-composer architecture as workspace and Artifact Studio. The legacy `chats`/`messages` modules remain in the repository for migration compatibility and older inactive features, but they are not the active `/chat` foundation.

## Persistence model

- `spectraThreads` is the durable conversation container, with origin, optional workspace/artifact context, pin state, message count, last run, timestamps, and archive lifecycle.
- `spectraMessages` stores clean user/assistant content and optional AIRun linkage. Client-message ids support idempotent writes.
- Normal `/chat` submission lazily creates a thread on the first prompt, appends the user message, creates a linked AIRun, and appends one clean assistant message when the structured plan reaches a user-facing result.
- Workspace, Workspace Home, artifact library, and Artifact Studio commands continue to create AIRuns without automatically creating threads.
- A temporary run can be explicitly converted through **Keep as thread** or **Continue in chat**. Conversion is idempotent and preserves the original run/message provenance.
- Explicit keep creates a `thread_reference` artifact. A workspace-origin keep can place and pin that reference in the originating workspace; ordinary commands do not create visible thread objects.
- Created artifacts record run and thread provenance. Chat-created artifacts continue to default to the global Artifact Library/Inbox.

## Output and event contract

The structured NDJSON stream remains the source of operational UI events:

- `thread_ready`
- `run_created`
- `status`
- `operation_preview`
- `operation_commit`
- `operation_result`
- `confirmation_required`
- `result_card`
- `deferred_action`
- `ui_event`
- `final`
- `error`

Progress, previews, confirmations, errors, and affected-object payloads remain structured events or run/operation records. They are not concatenated into assistant message content. The saved assistant message contains only `finalResponse`. No private reasoning or model-authored progress markers are stored or displayed.

`SPECTRA_TOOL_CONTRACT` is the central action-capability registry. It marks the five Wave 5 operation types as active, records batching/execution semantics, and reserves disabled capability names for later skills, research, file/context tools, and sub-agent spawning. Only active capabilities are included in the model prompt; future capabilities cannot be emitted or executed in Wave 5.

Each AIRun also stores a small structured context snapshot containing the active thread, workspace, focused artifact, selection placeholder, and capture time. This is a future memory/reconstruction hook, not long-term memory.

## Shared UI

- `/chat` is a spacious full conversation page with recent-thread navigation, generated/editable titles, pinning, clean Markdown answers, inline collapsible operational traces, and artifact result cards.
- Artifact cards in chat provide **Open** and explicit **Add to workspace** actions.
- The shared conversation renderer is also used for real `thread_reference` artifacts in Artifact Studio.
- Temporary workspace run details render as the same user/assistant conversation plus operational trace. They remain unsaved until the user keeps or continues them and deliberately contain no second composer; the page command bar remains the composer.
- Hidden and older result cards remain accessible in the lightweight Run & thread hub on `/chat`.
- The global sidebar now navigates and manages Spectra threads rather than the legacy chat list.

## Lifecycle and recovery decisions

- Thread creation is lazy so an empty `/chat` visit does not create database clutter.
- Titles are generated deterministically from the first user prompt and can be renamed.
- Assistant writes are idempotent per run, including retries and confirmation completion.
- Refresh recovery reads the thread, messages, linked run traces, operation records, result cards, and affected artifacts from Convex.
- Confirmation and retry continue to reuse the Wave 4 run lifecycle. A confirmation updates the same run-linked assistant message instead of appending progress syntax or a duplicate answer.
- Thread-reference artifacts point to real Spectra thread ids. Older seeded references with no thread id remain disconnected references until replaced or explicitly linked.

## Deferred after Wave 5

Wave 5.5 supersedes the original deferral of token streaming, model-generated titles/summaries, thread-reference continuation UX, and core attachment/file UX. Their implementation record lives in `WAVE_5_5_CONVERSATION_WORKSPACE_STABILIZATION.md`.

- migration/import UI for historical legacy `chats` and `messages`;
- user, workspace, learning-profile, and automatic extracted memory;
- retrieval of future memories into prompts and memory review/edit/delete UI;
- agent spawning, multi-agent work, complex routing, autonomous orchestration, and autonomous tools;
- research/file/context tools beyond the current typed operation contract;
- advanced canvas and relation intelligence, ManageBac, and full study engines;
- direct display of raw `sourceType=thread` WorkspaceItems. Wave 5 uses validated `thread_reference` artifacts so placement remains compatible with the existing object surface.

## Verification

Run with the Linux Node runtime in WSL:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx convex codegen
npx tsc --noEmit
npm run lint
npx vitest run src/features/spectra/__tests__/run-route.test.ts src/features/spectra/__tests__/wave4-operation-engine.test.ts src/features/spectra/__tests__/legacy-imports.test.ts
```

The route test now covers lazy chat-thread creation, `thread_ready`, user/assistant AIRun linkage, and the guarantee that progress text is not stored as message content.

## Manual acceptance checklist

- Start a new `/chat` conversation, refresh, and verify the same messages and generated title return.
- Continue the thread and verify prior messages are included as structured conversation context.
- Rename and pin the thread from the chat header; select it again from the global sidebar.
- Ask chat to create a document/deck/quiz/task. Verify the artifact appears in Inbox, the chat card opens it, and **Add to workspace** creates only the requested placement.
- Run an answer-only chat and confirm the trace says no data changes were needed.
- Trigger a confirmed operation and verify progress/confirmation text never appears inside the saved assistant prose.
- Run a workspace command and verify it does not create a thread automatically.
- Open its temporary run detail, then test **Keep as thread** and **Continue in chat**.
- Open the resulting thread-reference artifact in Workspace or Artifacts Studio and verify it renders the same conversation/trace language.
- Hide a result row, open `/chat` → **Runs**, and verify the run remains accessible.

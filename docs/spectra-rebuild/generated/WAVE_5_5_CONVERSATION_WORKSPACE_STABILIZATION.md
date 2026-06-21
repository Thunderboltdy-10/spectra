# Wave 5.5 — Conversation, Thread, Artifact, and Workspace Stabilization

Started 2026-06-21. This is a stabilization wave over the uncommitted Wave 5 worktree. It does not begin memory, agents, complex routing, ManageBac, advanced canvas, or relation intelligence.

## Problems confirmed

- `/chat` persists Spectra threads, but waits for the full structured plan before showing either message, uses a black user bubble, has weak metadata, uses `window.prompt` for rename, and always renders an “Answer generated” trace even when nothing operational happened.
- The shared conversation renderer exists, but temporary runs, real thread references, and `/chat` still expose different continuation rules. A thread-reference artifact suppresses its own composer and workspace quick chat silently prefers the open artifact.
- The `+` composer control is dead when no menu is supplied. There is no attachment contract or persisted attachment presentation.
- OpenRouter is called with the correct model and an `order: ["deepseek"]` preference, but fallback policy is hard-coded, the selected provider/usage are not persisted, and assistant prose is not streamed.
- Thread titles are deterministic truncations. Summaries and UI-aware generated titles are not part of the plan contract.
- Closing a dirty Artifact Studio view or tab drops local edits without a save/discard decision. Artifact versions/history are not yet part of the active Spectra artifact path.
- Workspace Home and selected-workspace pin cards do not use one component treatment. Several compact actions remain bordered text buttons. Pinned/Inbox collapse state is not persisted.
- Overview and context calls fetch broad collections (`100` artifacts for the page, `60` for every model call), and initial loading still uses text or a stalled-looking bar instead of stable skeletons.

## Product direction

The visual direction is refined editorial minimalism: generous reading width, strong typography, warm paper-like surfaces, small precise controls, low-contrast structure, and one restrained cyan operational accent. Object cards may carry a faint bottom-right arc/noise field, but never an AI-gradient hero treatment.

Chat remains a spacious conversation, not a workspace dashboard. Workspace remains an object room with a compact command surface. Both use the same message, trace, artifact-result, attachment, and target indicators.

## Composer target model

Every composer has one explicit target:

| Target | Creates/continues | Context sent | Default placement |
| --- | --- | --- | --- |
| Global | New compact run; `/chat` creates a thread | Bounded global catalog | Inbox |
| Workspace | Compact workspace run | Current workspace | Current workspace |
| Artifact | Compact artifact run | Open artifact plus its workspace | Existing artifact or Inbox for newly requested objects |
| Thread | Continues exactly that thread | Recent thread messages plus explicit workspace/artifact scope stored on the thread | Inbox unless explicitly placed |

Rules:

1. Opening a panel does not silently retarget the composer.
2. Opening an artifact offers/selects artifact target explicitly; closing it restores the previous target.
3. “Continue” selects a thread target without requiring the thread panel to remain open.
4. If the open main panel and composer target disagree, sending is blocked by an inline chooser: use open item, keep selected target, or cancel.
5. A real thread-reference view uses the same conversation component and continues its referenced thread.
6. Only one right/main side panel is open. Opening artifact, run, or thread detail replaces the prior panel rather than nesting it.

## Streaming and recovery

- The browser inserts the user message and run row immediately.
- OpenRouter streams the strict JSON plan. The server incrementally extracts only the JSON `finalResponse` string and emits `text_delta` events; operational JSON and private/provider reasoning are never exposed.
- The final validated plan remains authoritative. Only the clean completed assistant message is written to Convex.
- Provider, model, prompt/completion/reasoning token counts, generation time, and throughput are persisted when returned and rendered as quiet message metadata.
- Autoscroll follows only while the viewport is near the bottom. User scrolling/selecting upward disables follow immediately and reveals a jump-to-latest control.
- Refresh reconstructs completed, failed, cancelled, awaiting-confirmation, and running states from Thread/AIRun/Operation/ResultCard data. A stale running run is shown as interrupted/recoverable rather than fake text.
- Cancellation aborts the browser stream and marks a non-committing run cancelled. Retry reuses the existing run/card as established in Wave 4.

## Operational traces

- Answer-only runs render no trace container.
- A trace renders only for real operations, confirmation, failure, cancellation, or an actual provider-supported reasoning token count.
- Private reasoning text is never requested, saved, or displayed.
- Operations show type, status, affected object, and sanitized output/result. Details are collapsed by default except confirmation/failure.

## Attachments

Initial support is deliberately bounded:

- PDF: base64 file input to OpenRouter. OpenRouter parses it when the chosen model has no native PDF input. Parsing may add provider cost.
- Plain text/Markdown/CSV/JSON: decoded Spectra-side and included as bounded text context.
- DOCX: text extracted Spectra-side with `mammoth`; the original remains represented as an attachment.
- Images (PNG/JPEG/WebP/GIF): accepted only when the selected model/provider endpoint declares image input support. Otherwise the pre-send card explains that the current DeepSeek text route cannot inspect it and prevents an ambiguous send.
- Rejected: video, audio in this wave, archives, executables, scripts, unknown binary formats, and files above the configured size/count limits.

Attachments persist as sanitized message metadata (name, MIME type, size, handling mode), never arbitrary executable content. Raw file payload retention is deferred until a resource/blob store is selected.

## Titles and summaries

The strict plan gains optional short `conversationTitle` and `conversationSummary` fields. The first completed exchange may update the fallback title; later exchanges may refresh the summary without constantly renaming the thread. Titles are capped for tabs and deterministic fallback remains available.

## Artifact proposals and panels

Created or proposed artifacts render through a compact shared result item with Open, Add to workspace, and placement feedback. Chat creation defaults to Inbox. Opening an artifact replaces any run/thread side panel and uses the shared Artifact Studio; it never nests panels.

## Artifact edit safety foundation

- Dirty state is computed against a canonical baseline, so returning to the original content clears dirty state.
- Close/tab-close/navigation asks Save, Discard, or Cancel for dirty artifacts.
- Manual saves create a version/provenance record.
- AI updates create a version with before/after data and a reversible operation reference. Bulk/dangerous edits retain confirmation-before-apply.
- Full collaborative branching and visual block-level diff review remain deferred, but saved AI changes must be revertible.

## Performance strategy

- Keep cached metadata visible during scope changes and overlay shimmer skeletons only where data is missing.
- Split overview metadata from paginated artifact groups; request small initial pages and fetch more on expansion/scroll.
- List groups render six rows initially. Board columns do not fetch/render hidden columns.
- Use indexed thread pagination instead of collecting all active threads; cap message windows and provide older-message loading.
- Do not poll stable catalogs. Refresh only the affected thread/workspace/artifact/run after a mutation.

## Deferred

- Long-term/user/workspace memory and automatic memory extraction.
- Agents, sub-agents, autonomous orchestration, complex routing, ManageBac.
- Advanced canvas/relation intelligence and arbitrary plugin infrastructure.
- Video/audio/archive ingestion, permanent raw-file resource storage, OCR pipeline, and image understanding when the fixed endpoint cannot accept images.
- Collaborative artifact branching and a full visual block-level diff review UI beyond reversible version history.

## Acceptance plan

Automated: TypeScript, lint, focused stream/provider/context/version tests, full Vitest, Convex codegen/validation, production build.

Manual:

1. Send a new chat message and verify immediate optimistic display, token streaming, smart autoscroll, final persistence, metadata, refresh, cancel, and retry.
2. Verify answer-only chat has no trace; operation/confirmation/failure traces show useful results.
3. Rename inline, pin, navigate recent threads, generate a short title/summary, and open the Runs hub.
4. Attach each supported type and verify rejection/unsupported states for unsafe files and unsupported images.
5. Create an artifact from chat, open it in one side panel, place it in a workspace, and verify no nested panel or silent composer retarget.
6. Open a thread-reference artifact and continue the exact same thread.
7. Exercise global/workspace/artifact/thread targets and every conflict chooser path.
8. Edit an artifact, revert text to baseline, close dirty views, save/discard/cancel, apply an AI edit, and revert it from history.
9. Collapse/reopen Pinned and Inbox, refresh, switch workspaces, inspect Library/Timeline/Canvas pin visibility, and load more than six objects in a group.

## Implemented outcome

- OpenRouter structured output now streams through SSE. Spectra extracts and emits only incremental `finalResponse` text, records the actual provider/model/usage metadata, prefers only the DeepSeek provider by default, and enables provider fallback only through `SPECTRA_ALLOW_PROVIDER_FALLBACKS=true`.
- `/chat` now renders optimistic user/assistant rows, streamed Markdown, quiet message metadata, smart bottom following with a jump control, clear refresh recovery states, inline rename, useful recent threads/workspaces, and no trace for answer-only runs.
- The composer `+` menu attaches PDF, DOCX, TXT, Markdown, CSV, and JSON. PDF parsing uses OpenRouter's free Cloudflare parser; DOCX/text extraction occurs Spectra-side. Unsafe/unknown files are rejected and unsupported image understanding blocks send explicitly.
- Real thread-reference artifacts use the full shared conversation composer. Workspace/library command docks hide while that thread composer is active, preventing double targets.
- Inbox and Pinned disclosure state persists in local storage. Inbox starts collapsed, workspace groups initially render six items, pinned work appears above every selected workspace view, and common row actions use compact icon controls.
- Artifact Studio dirty state is canonical-baseline-aware. Closing prompts Save/Discard/Keep editing, tab close requests route through the same decision, and text selection uses a valid visible selection color.
- `spectraArtifactVersions` records manual, AI, and revert snapshots. AI artifact updates carry run provenance and versions can be reverted through the Spectra API foundation.
- Artifact deletion uses Spectra modals rather than browser confirmation dialogs.

## Verification completed

Run with the repository's Linux Node runtime:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx convex codegen
npx tsc --noEmit
npm run lint
npm run test:run
npm run build
```

Results on 2026-06-21: Convex schema/function upload and generated bindings passed; TypeScript passed; ESLint passed with zero warnings; 69 Vitest files passed with 366 tests passed and 3 live tests skipped; the Next.js production build compiled, type-checked, generated all static pages, and completed successfully.

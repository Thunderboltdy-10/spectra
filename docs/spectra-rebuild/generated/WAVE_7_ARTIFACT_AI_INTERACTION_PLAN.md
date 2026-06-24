# Wave 7 — Artifact Capability and AI Interaction Quality

Generated on 2026-06-24 after auditing the hooked-up Spectra implementation. This wave expands the roadmap's narrow “Study Object Quality” milestone into an artifact-and-conversation quality pass. It keeps documents, flashcard decks, quizzes, and planner tasks as the main study objects. Thread-reference artifacts remain references to real durable conversations, not a substitute study-object format.

## Product direction

The interface direction is refined editorial utility: warm paper-like working surfaces, compact operational controls, visible structure, and restrained cyan/amber state accents. Motion should explain state changes—stream arrival, AI edits, pending creation, selection, and save/version transitions—rather than decorate every card. This wave adds stable state hooks for the later card redesign without replacing the full card language now.

The user should leave this wave with four clear mental models:

1. A conversation is durable by default. A new chat is an explicit action, not the default result of using a different composer.
2. Conversation history and working focus are separate. A continued thread supplies history; workspace, artifact, or selected-object focus supplies working context.
3. Artifacts are structured, editable study objects. User edits and AI edits use the same canonical schema and version history.
4. Important decisions happen in context. Confirmations, choices, placement, and revision review belong in the conversation or artifact surface, not transient toasts.

## Audit findings

### Workspace ID failure

- `WorkspaceShell` restores `spectra.workspace.hubTabs.v1` from local storage with a TypeScript cast and no runtime validation.
- The restore effect can call `loadWorkspace(tab.workspaceId)` before checking the ID against the owned `spectraWorkspaces` returned by the overview.
- `/api/spectra?action=workspace` forwards an arbitrary query string directly into a Convex function whose validator expects `v.id("spectraWorkspaces")`.
- A stale/corrupt restored tab containing a `workspaceWidgets` ID therefore reaches the wrong-table Convex validator and produces the reported 500.
- Fix both boundaries: sanitize persisted tabs against the current workspace catalog before activating them, and make the public workspace lookup accept an untrusted string and normalize/ownership-check it before any typed table access. Invalid IDs should produce a controlled not-found/400 result, never an argument-validation 500.

### Conversation durability and continuation

- `/chat` creates a durable thread lazily, but workspace, artifact-library, and Artifact Studio runs do not. They are copied into session-local “temporary thread” state and only become durable after Keep/Continue.
- Workspace continuation is represented by a separate `composerThread` selection. The first ordinary workspace message does not automatically make that durable thread the next composer target.
- `SpectraSessionProvider` and result-card conversion still encode the temporary-run model that this wave removes from normal conversation behavior.
- Thread metadata can only use a model title on the first exchange (`messageCount <= 1`), so later purpose clarification can update a summary but never improve a weak title.

### Streaming and operational feedback

- The OpenRouter parser can extract progressive `finalResponse` text from streamed JSON, but `callModel` does not pass its callback to either the primary or fallback `readOpenRouterResponse` call. In practice no `text_delta` events are emitted.
- Public response streaming is coupled to the position of `finalResponse` in one strict JSON document. If the model emits operations first, visible prose remains blocked.
- Provider-supported reasoning fields are not parsed. The UI instead shows deterministic server status labels; this is valid operational progress, but it is not a thinking trace.
- The live exchange supports only one current response and operation previews contain no safe display payload. Artifact creation/update cannot expose a meaningful pending object state before commit.
- Result rows and conversation traces are separate systems. Active steps do not consistently open/collapse as the run advances.

### Conversation rendering and interaction

- The rebuilt conversation uses the reduced `RichText` renderer. It has GFM/math plugins but much weaker table, code, equation, typography, and spacing treatment than the previous `MarkdownRenderer`.
- Normal message metadata exposes `providerUsed`, `modelUsed`, token counts, speed, and a hard-coded “DeepSeek · streaming” label.
- Clarification is plain assistant text. The strict plan has no typed 2–4 option choice payload, no persisted choice metadata, and no conversational choice component.
- Artifact placement still uses small ad-hoc buttons and success/error toasts. Confirmations live in result rows rather than a unified contextual interaction primitive.

### Focus and context

- The Wave 6 bounded packet is structurally sound and already caps selected artifacts, excerpts, workspace candidates, catalog metadata, conversation messages, links, and recent activity.
- Conversation history and focus are represented separately on the server, but the UI compresses both into one `focusMode` menu. It is clear but bulky and cannot visually manage multiple context items in-place.
- Full artifact retrieval is not an explicit AI capability. The initial packet uses excerpts, but there is no controlled follow-up context operation/tool when the model needs a complete body.
- The packet currently lists up to 36 artifact records before ranking. This is bounded but should keep full bodies out of the catalog and only include full canonical content for the open artifact or explicit selections within caps.

### Artifact schemas and AI operations

- Documents have a `math` block label in the Zod/model schemas, but TipTap has no equation node, LaTeX editing UI, preview, selection toolbar, or round-trip conversion. The AI JSON schema also strips block attributes.
- The document editor already has TipTap, tables, tasks, callouts, and slash-command infrastructure, but no plus/insert gutter or working drag handle in the live Studio.
- `artifact.update` replaces complete canonical content. It is versioned and reversible, but has no block/card/question/subtask-level change description, pending proposal, or diff state.
- AI can create/update artifacts, create a workspace, and change placement. It cannot edit workspace metadata or create/remove artifact links through the controlled plan.
- `workspace.create` omits icon/color from the model contract. The live manual create/update route also drops icon/color even though Convex already supports both.
- Link provenance is stored well, but Artifact Studio only shows a few tiny rows. Tags are edited as one comma-separated input. Neither behaves like a visible artifact-quality layer.

### Study-object quality

- Flashcards support sections, front/back, hints, and confidence, but have no stable review state, source display, card reorder, section rename, bulk comprehension, or per-card AI-change visibility.
- Quiz builder supports MCQ/short answer, points, time, difficulty, and an inert preview. It does not allow taking, submitting, marking, or reviewing an attempt.
- Planner tasks support dates, status, priority, subtasks, attachments-as-text, reminders, and linked artifact IDs. Their schema types subtasks/attachments/reminders as `unknown`, preventing reliable AI updates and validation.
- Provenance/source references exist on deck cards and quiz questions but are not meaningfully rendered or editable.

### Version history

- Manual and AI saves create durable before/after snapshots, and revert creates another snapshot.
- History is a modal list with only “revert to before this change.” The user cannot preview a historical state, inspect a highlighted diff, compare metadata/content, or leave preview without mutation.
- The UI has no explicit recent-AI-edit state even though version source/run data exists.

## Wave implementation

### 1. Correctness foundation

- Sanitize persisted workspace hub tabs against the current owned workspace catalog; migrate/drop invalid entries and never activate a tab whose workspace is absent.
- Add a string-normalizing, ownership-safe workspace lookup boundary and route tests for a `workspaceWidgets` ID, malformed ID, deleted workspace, and valid workspace.
- Pass icon/color through workspace create/update APIs and add a compact create/edit workspace dialog beside the destructive action.
- Centralize canonical artifact parsing/default normalization for all four study object types before editor or AI work.

### 2. Durable conversation model

- Create or continue a `spectraThread` for every normal AI submission from `/chat`, workspace quick chat, `/artifacts`, and Artifact Studio.
- Return `thread_ready` immediately and make the newly created thread the composer continuation target. Subsequent sends continue it until the user chooses New chat.
- Keep runs/result cards as compact operational views, but remove “temporary conversation” semantics from normal sends. Saving a thread-reference artifact remains a separate explicit placement action.
- Add a visible New chat action and a compact continued-conversation indicator. Preserve existing-thread continuation by default in `/chat` and thread panels.
- Allow stable title refinement at sparse milestones when the current title is provisional/weak or conversation purpose materially changes; always update reusable short/long summaries without constant renaming.

### 3. Progressive response and contextual actions

- Restore actual public-text callback wiring on primary and fallback streams.
- Parse provider-supported reasoning deltas into an explicit optional `reasoning_delta` event; never synthesize private reasoning. Group safe received reasoning into readable chunks and persist only if policy permits.
- Add richer phase events with safe operation preview data so conversation traces and compact run rows can show reviewing, validating, creating/updating, saving, and completion states.
- Use one collapsible in-flow activity component for thinking (when supplied), operations, confirmations, and artifact results. Active step opens; prior step collapses with a useful summary.
- Add a typed 2–4 option `choices` payload to clarification plans/messages. Render conversational choice blocks in `/chat`/thread panels and compact two-option blocks in workspace command context. Selecting an option appends a normal user message to the same thread.
- Reduce toast usage to passive success/failure. Placement and confirmation decisions render inline.

### 4. Document capability

- Introduce a canonical document block union with typed paragraph/heading/quote/callout/list/code/equation fields and preserved TipTap JSON.
- Add a TipTap block equation node backed by LaTeX and KaTeX preview. Selection exposes equation edit/alignment/display controls; AI JSON schemas accept the same equation shape.
- Extend slash insertion with equation/table/callout/task/code options.
- Add a hover gutter with drag-like handle and plus insertion. Plus inserts below a non-empty block and uses the current empty block when appropriate. Support keyboard-accessible move up/down as the reliable baseline for block movement.
- Keep round trips lossless between canonical blocks, TipTap JSON, manual saves, AI updates, text indexing, and version diffs.

### 5. Study object capability

- Flashcards: typed sources, section management, reorder controls, review-state/confidence editing, study preview, and clear per-card provenance.
- Quizzes: typed question schemas, usable take/submit/mark/review mode kept local to the artifact content unless the user explicitly saves attempt state, answer explanations, and source display.
- Planner tasks: fully typed subtasks, reminders, attachments/references, dependencies/links, schedule validation, progress summary, and visible linked-object controls.
- Keep the full spaced-repetition scheduler, durable quiz-attempt analytics, calendar synchronization, and study-engine recommendations deferred.

### 6. Artifact quality layer

- Replace comma-separated tag editing with visible removable tags and an inline add interaction.
- Promote linked artifacts into a browsable section with direction, relation type, explanation, provenance, open/remove actions, and a real relation picker.
- Add controlled AI `workspace.update` and `artifact.link` operations. Safe create/update/link/tag operations execute directly; deletion remains outside normal direct execution and always requires explicit confirmation.
- Emit pending artifact state from safe operation previews. Open Studio refreshes at operation boundaries; cards/list rows receive `data-ai-state` hooks and a restrained shimmer/highlight when created or changed.
- Surface recent AI edits in Studio and artifact state hooks. Avoid forcing confirmation for ordinary safe edits; preserve confirmation for workspace creation, destructive actions, and bulk changes.

### 7. Version preview and diff

- Turn history into a non-destructive preview browser. Selecting a version shows that state without saving it.
- Compute a readable line/block diff for document content and structured field diffs for decks, quizzes, and tasks. Highlight additions/removals/changes and metadata differences.
- Provide Exit preview and Restore this version separately. Restore creates a normal revert version, preserving the full chain.
- Show source, run provenance, summary, and affected structural units for AI/manual/revert versions.

### 8. Shared visual and renderer quality

- Consolidate rebuilt conversation rendering on a rich Markdown component with balanced streaming math normalization, KaTeX, GFM tables, strong headings/lists/quotes/code, and safe links.
- Remove provider/model/token-speed labels from normal UI; keep them available in stored run metadata/debug data.
- Add state attributes/classes for selected focus, continued thread, selected context artifact, AI creating/updating/edited, pending confirmation, and normal artifacts in preparation for the later card redesign.
- Keep the current cards structurally intact beyond these state treatments.

## Context rules and caps

- Preserve the 48,000-character packet hard cap and 12-object selection cap.
- Send full canonical content only for the visibly open artifact when explicitly focused and small enough, or for a small explicit selection within the packet cap. Otherwise send typed excerpts and structural counts.
- Workspace context includes summary, up to 6 pinned items, up to 10 relevant/recent items, recent run summaries, placements, tags, link summaries, and provenance—not every body.
- Global context remains catalog-only unless prompt relevance or explicit selection promotes an object.
- Conversation uses at most 24 recent user/assistant messages and 16,000 characters, plus reusable thread summary metadata.
- Add a controlled full-artifact context lookup path later if the model needs omitted content. This wave documents the contract and keeps the initial prompt balanced; it does not introduce an open-ended generic read tool.
- Context snapshots record mode, selected IDs, open artifact/workspace IDs, packet version, and caps applied so later memory systems can reconstruct intent.

## Explicit deferrals

- Full spaced repetition, scheduling algorithms, and long-term review analytics.
- Durable quiz attempt history, classroom assessment, teacher dashboards, and grading analytics.
- Autonomous agents, multi-agent orchestration, memory extraction, vector RAG, OCR, and broad web research.
- Advanced canvas/focus spaces, lasso, semantic zoom, and spatial relation editing.
- Full collaborative editing, comments, branching/merge, and CRDT document sync.
- The comprehensive card-pattern redesign requested as the next separate wave.
- Migration UI for legacy `chats`/`messages` and disconnected old thread-reference artifacts.

## Implementation order

1. Workspace-ID guard, API tests, workspace metadata plumbing.
2. Schema normalization for document/deck/quiz/task plus operation schema alignment.
3. Durable thread-by-default run lifecycle and default continuation/New chat UI.
4. Streaming/reasoning/choice event contracts and in-flow activity rendering.
5. Rich conversation renderer and removal of provider/model UI labels.
6. Document equation/block insertion/gutter interactions.
7. Deck/quiz/task capability upgrades and visible source/provenance.
8. Artifact links/tags, AI metadata/link operations, pending/edited state hooks.
9. Non-destructive version preview/diffs.
10. Focus compaction, motion/state polish, and focused verification.

## Focused verification

This wave intentionally avoids a full broad test/build cycle before the upcoming card redesign. Run only targeted tests and type/lint checks covering changed contracts:

- wrong-table workspace ID never reaches a `v.id("spectraWorkspaces")` validator;
- all normal composers create/continue durable threads and New chat starts a different thread;
- primary and fallback model streams emit public deltas; reasoning appears only when supplied;
- choice payload validates 2–4 options and continues the same thread;
- equation/document content round-trips through Zod, model JSON schema, TipTap, save, and AI update;
- deck/quiz/task canonical schemas reject structurally unsafe AI content;
- version preview does not mutate, while restore creates a revert version;
- provider/model names are absent from normal conversation rendering.


# Spectra Product Source of Truth

Status: canonical product contract  
Created: 2026-07-11 for Wave Z  
Authority: this document supersedes earlier plans when they describe product behavior differently. Code is evidence, not authority. Update this contract whenever an implementation decision clarifies the product.

## 1. Product definition

Spectra is an AI-native work surface for thinking, studying, creating, organizing, and developing work. It is school-first without feeling like school administration software. The product combines durable workspaces, purposeful artifacts, continuing conversations, and visible AI operations in one environment.

Spectra is not a chatbot with files attached. Pages are views over shared objects. The AI works through the same objects and surfaces as the user, and its actions become visible as real state changes while they happen.

The characteristic experience is a calm, editorial instrument panel: warm ivory material, ink-led hierarchy, artifact-specific color and structure, restrained blue activity flow, tactile object states, and immediate local interaction. Density is useful and composed rather than sparse or dashboard-like. AI presence is expressed by activity, light, progression, and changed work—not a repeated sparkle badge.

The user should never need to understand IDs, routes, database tables, provider requests, tool payloads, or lifecycle machinery. They should understand where they are, what Spectra knows, what it is doing, and what will happen when they act.

## 2. Product character and priorities

In priority order, Spectra must be:

1. **Trustworthy.** One object and one authoritative state appear consistently everywhere.
2. **Immediate.** Navigation, selection, menus, view changes, and optimistic local mutations acknowledge input at once.
3. **Context-aware.** The current work surface is understood automatically while explicit user context remains under user control.
4. **Capable.** The AI creates and changes real workspace objects instead of merely suggesting manual steps.
5. **Alive.** Meaningful operations unfold progressively on affected objects.
6. **Legible.** Every object communicates type, location, state, importance, and primary action.
7. **Recoverable.** Interruption, partial success, rejection, and failure preserve valid work and offer a clear next action.
8. **Accessible and adaptive.** Capability survives keyboard use, reduced motion, narrow windows, split views, and internal resizing.

## 3. Canonical entities

### User-visible entities

- **Workspace:** a durable living context for a subject, project, goal, or area. It owns placement and organization, not artifact content.
- **Inbox:** the intentional home for unplaced global artifacts and threads. It is not a second storage model.
- **Artifact:** a durable, editable object whose structure and behavior come from its type. Current first-class types are document, flashcard deck, quiz, and planner task.
- **Thread:** a persistent conversation object. It can belong to a workspace or Inbox and can be opened through several views without being duplicated.
- **Message:** an ordered user or assistant contribution within a thread.
- **Run:** one execution initiated by a user message or supported action. It has one lifecycle and may progressively create or update objects.
- **Workspace item:** the placement/projection of an artifact or thread in a workspace view. It never owns the source content.
- **Result:** a compact user-facing summary of run output and affected objects. It is a projection of the run, not another execution.
- **Approval/decision:** one durable request for accept, reject, revise, or a choice. Every surface observes the same decision.

### View-state concepts

- **Rail destination:** one open top-level working destination. Reopening an existing destination focuses it.
- **Panel:** an auxiliary view of the canonical object, usually the right-side live thread or inspector.
- **Tab:** a durable open-object affordance. The quick-chat run/thread tab is the single canonical treatment above the composer.
- **View:** a perspective over the same objects: overview, library/list, board, timeline, canvas, tiled work, artifact detail, or full chat.
- **Temporary selection:** objects selected for a batch action on the present surface.
- **Explicit context:** user-chosen objects that remain available to the next AI request until removed.
- **Visible/inferred context:** objects implied by the current surface. It changes with navigation and does not silently become explicit context.
- **Continuation target:** the one thread whose history the next message continues.
- **Tile:** an open artifact or thread pane in a multi-object work surface. Tiling does not automatically make a thread the continuation target.

### Relationship rules

- Artifact content lives only in the artifact. Workspace items, cards, tiles, results, and search entries project it.
- Thread messages and run state live only in the canonical thread/run system. `/chat`, panels, cards, tabs, and tiles observe it.
- A workspace contains placements of artifacts and threads plus view/layout metadata, relationships, and activity.
- New threads are projected as `sourceType: thread` workspace items. A synthetic thread-reference artifact is not a canonical placement and must not be created as a compatibility substitute.
- A workspace-created thread belongs to that workspace from run creation, including while queued, awaiting input, failed, stopped, or completed.
- An artifact-originated thread normally belongs to the artifact's workspace. If the artifact is unplaced, the thread belongs to Inbox.
- A genuinely global thread belongs to Inbox. Cross-workspace ambiguity is resolved by an intelligible deterministic rule or natural clarification.
- Moving a placement does not clone the source object. Deleting a placement is distinct from deleting the source object.
- One canonical object identity survives navigation, moving, pinning, grouping, and view changes.

## 4. Surfaces

### Home

Home is the global work surface. It provides an immediately useful view of workspaces, Inbox, pinned work, recent objects, recent activity, and active or waiting AI work. Home implies global retrieval context. Workspace, artifact, thread, result, and activity cards open their obvious target when their primary surface is pressed.

### Workspace

A workspace is the main operational surface. It exposes the same object set through overview/library, list, board, timeline, and canvas perspectives, plus tiled object work. Changing views does not create different selection, context, or object identities.

The workspace header communicates identity, description, counts, active view, and practical creation actions. Inspectors add detail without replacing obvious card behavior. The quick-chat composer remains anchored to the active work and infers workspace-level context when no narrower object is visible.

### Inbox

Inbox shows unplaced artifacts and global threads with clear type, status, origin, and placement actions. Placement uses the same canonical move/add path as other views. Suggested placement appears only when evidence exists and is always an explicit, functional action.

### Artifact library

The library is a cross-workspace and Inbox view with search, type/workspace filters, sorting, and grid/list/board presentations. It is dense enough for large collections. Groups and filters never create alternative object models.

### Artifact detail

Each type has a purposeful editor:

- **Document:** a focused editorial writing surface with title, formatting, structure, content editing, stable cursor/selection, metadata, and AI actions that target meaningful regions.
- **Flashcard deck:** natural card browsing, study/reveal behavior, card creation, question/answer editing, ordering, progress, and deck metadata.
- **Quiz:** question construction, answer options, correct answers, explanations, question ordering, completion/readiness, and test/preview behavior.
- **Planner task:** title/description, date and time, priority, progress/status, subtasks, supporting links or notes, and task-specific actions.

Artifact controls must work. When unavailable, they are omitted or clearly disabled with an explanation; they never exist as decorative props.

### Thread and `/chat`

`/chat` is the full-page view of the same canonical thread that can appear in a workspace, quick-chat tab, right panel, tile, search, or command results. Opening a thread from another surface focuses or moves the existing representation according to layout rules. It never creates an independent conversation or a second run.

### Board

The board groups canonical objects into meaningful columns such as workspace, type, state, or user-defined grouping. Columns provide identity, counts, add and overflow actions. Cards retain artifact-specific identity. Move and reorder operations are optimistic, keyboard reachable, and reconcile with authoritative placement.

### Timeline

The timeline is a date-grouped activity perspective with a time rail, status nodes, rich events, affected-object previews, and an optional inspector. Events open their affected object or run. Live events update in place and retain one authoritative run state.

### Canvas

The canvas is a secondary spatial perspective with soft semantic clusters, readable relationships, pan/zoom, fit, minimap, and semantic density. Cards still open/select canonical objects. Canvas positions and relationships are view metadata, not copied content. Multi-selection uses the shared selection model.

### Tiled work

Tiled work contains multiple visible artifacts and optionally one visible thread. All visible artifacts are inferred context by default. Each may be excluded from AI context without closing it. Closing a tile does not remove an explicitly added context object. Resizing, reordering, and snapping remain stable and accessible. Only one thread may be continued.

## 5. Navigation and opening rules

1. A primary card press opens its object. Nested controls stop propagation and perform their labelled secondary action.
2. Reopening an already open rail destination focuses it rather than creating another.
3. Reopening an object already visible in a panel or tile focuses or moves that representation based on the target layout; it never clones it.
4. Switching rail tabs or views preserves active runs, explicit context, valid selection, tile state, and unsaved editor state.
5. Closing a view changes presentation only. It never stops a run unless the user explicitly chooses Stop.
6. If the only view of unsaved local work is closing, Spectra saves automatically or asks clearly; it never discards silently.
7. Browser Back/Forward restores an intelligible destination and open-object state without re-executing actions.
8. Routes are implementation details and are never surfaced in user-facing text.

## 6. Quick chat: the primary AI control surface

Quick chat is available on Home, workspace, artifact, tile, contextual panel, and chat surfaces wherever a request is meaningful. It is visually integrated with the work surface rather than floating as an unrelated chatbot.

The composer:

- gives the message field most of the width;
- grows from one line to a bounded multiline height;
- sends on Enter and inserts a newline on Shift+Enter;
- has familiar Send and targeted Stop states;
- is stable while panels, rails, and views change;
- communicates whether the next message continues a thread or starts a new one;
- presents compact Focus context without long titles consuming the field;
- and never coexists with a competing run interface.

Submitting performs one atomic begin-run operation: create or continue the thread, persist the user message, create the run, create its canonical result/tab projection, and place a new thread in its workspace or Inbox. The thread and run become navigable immediately, before provider work finishes.

The composer clears only after the begin operation is acknowledged. Duplicate submissions use an idempotency key. If begin fails, the draft remains and the UI explains the recoverable failure.

## 7. Focus and context

Focus is the visible contract describing what Spectra understands for the next message.

### Context layers and priority

1. **Continuation history:** the selected thread's appropriate conversation history.
2. **Explicit context:** durable ordered user choices.
3. **Visible context:** open artifact(s), visible tiles, and relevant selected work.
4. **Active workspace map:** bounded titles, types, summaries, states, and relationships for retrieval.
5. **Global/Inbox map:** bounded structure enabling cross-workspace discovery.
6. **On-demand retrieval:** detailed content fetched only when the request requires it.

Focus prioritizes relevant work but never imprisons retrieval. A request clearly referring to another object triggers bounded search and resolution. Spectra asks a natural clarification only when real ambiguity remains.

Small objects may contribute complete content within budget. Large documents contribute summaries and relevant sections. Structured objects contribute typed fields. Workspaces and global context contribute maps rather than full content dumps. Context snapshots used by runs are versioned so retry is deterministic.

### Inference

- Home: global Spectra context.
- Workspace with no narrower object: workspace context.
- One open artifact: that artifact plus its workspace map.
- Several tiled artifacts: every included visible artifact plus the workspace map.
- Artifact plus thread: continue that thread with the artifact available.
- Explicit objects remain until removed, across navigation and selection-mode changes.

### Focus control

Collapsed Focus is quiet, icon/count led, keyboard reachable, and width-bounded. It distinguishes continuation from context.

Expanded Focus is a focused object picker with search, one continuation area, selected context, visible/relevant results, and clear multi-selection. It searches workspaces, Inbox, artifacts, and threads. Recent work appears only usefully when the query is empty or no stronger result exists. Each item explains whether it is continued, explicitly included, inferred from the screen, or merely available. Users can remove context without closing its view.

Deleted or inaccessible objects are pruned with a user-facing explanation. Moved objects keep identity. Similar names are disambiguated by workspace/type labels, never IDs.

## 8. Continuation versus ordinary context

Only one thread can be the continuation target. Many artifacts and workspaces can be context. A thread may be used as reference context without being continued, but multiple histories never merge into one continuation implicitly.

After starting a new thread, it normally becomes continuation for the next message. Users may choose another thread or clear continuation to start a new one. The pre-send state must make this obvious.

If the continuation thread has an active run, another message cannot enter it. The UI offers Wait, Stop that run, or Start a new thread. Concurrency is allowed only through different threads.

Opening a thread does not silently change continuation. Selecting a quick-chat thread tab does. When visible and continuation threads conflict, Spectra offers an explicit resolution such as keep current continuation, replace it, or cancel.

## 9. Canonical thread, run, tab, and panel behavior

Every thread and run has one authoritative backend identity and state. All viewing surfaces subscribe to it. Local state may optimize rendering but cannot invent lifecycle truth.

Exactly one quick-chat tab treatment exists above the composer. Tabs are open-view state, not recency. A tab appears at begin-run, spans/aligns naturally with the composer, shows a concise title and meaningful state, opens the live thread panel when pressed, and remains until explicitly closed. It has no redundant fullscreen control because `/chat` is available through normal opening/navigation.

The right panel, `/chat`, workspace thread object, result card, top rail, quick-chat tab, search, command bar, pinned work, and activity all observe the same messages, run, approvals, and affected objects. Navigation/remount reconnects from persisted events and snapshots.

One thread may have at most one active continuation run. Several different threads may run concurrently. Stop always targets one run and never aborts unrelated work.

## 10. Run lifecycle and universal streaming

The canonical lifecycle distinguishes at least:

- created/queued;
- preparing;
- reading context;
- retrieving work;
- planning an operation;
- awaiting approval or user choice;
- creating;
- updating/applying;
- streaming a response;
- checking/validating;
- completed;
- stopped by the user;
- interrupted/recoverable;
- failed;
- and partially completed.

State transitions are guarded and monotonic except through an explicit new retry attempt. Each retry has a generation/attempt identity; stale events cannot alter the new attempt. Terminal runs cannot become active again. Cancellation and confirmation claims are idempotent.

Public run events are persisted with monotonic order and replayable text snapshots/deltas, progress summaries, operation previews/commits, approvals, affected objects, and terminal state. Private reasoning, system prompts, provider chain-of-thought, raw tool schemas, and internal payloads are never persisted as public traces.

Disconnecting a browser is not Stop. A leased worker or equivalent durable coordinator owns execution. Stale work becomes interrupted/recoverable with partial output preserved. Refresh and remount catch up without duplicated text or operations.

### Progress language

Progress is a concise, evolving description of real work: finding a workspace, reading selected documents, planning objects, creating a named artifact, updating a section, waiting for approval, or checking changes. Compact tabs show one short current summary. Expanded thread views may show grouped, collapsible public events. Repeated generic “writing response” entries are prohibited.

## 11. AI operations and progressive mutation

The AI may create and edit documents, decks, quizzes, planner tasks, workspace metadata and organization; rename, move, group, pin, link, or archive work; create/continue threads; and present decisions. All mutations go through validated, ownership-checked operations with durable affected-object records.

Substantial operations progress through previewable steps. As soon as an artifact is known, a pending shell appears in the real workspace. Title and structure form early. Content streams into the source object in bounded checkpoints. The artifact is openable before completion. Editing marks the actual affected region and preserves the editor around it. Independent artifacts may progress concurrently.

The visual language for genuine AI work uses a soft directional blue flow, restrained glow, progressive shells, materializing cards/tabs, morphing geometry, and a clear settle into normal state. Animation follows real mutations; it is never a decorative replay after completion. Reduced motion replaces movement with immediate state and clear status.

Operation policy:

- safe, scoped, reversible creation and edits may proceed with visible progress;
- destructive, broad, ambiguous, overwrite, bulk move, or policy-governed actions request approval;
- partial failures commit valid completed work only when safe and enumerate what changed;
- retry never repeats already committed irreversible steps without an idempotency check;
- undo is offered when the operation supports a trustworthy inverse.

## 12. Approval and decisions

An approval is one canonical durable object observed everywhere. It may offer accept, reject, revise, or several natural choices. Compact tabs may condense the controls; expanded chat and affected objects provide detail.

Accepting, rejecting, or revising anywhere updates all surfaces immediately. Only one claimant executes an accepted operation. Rejection records the outcome, clears waiting metadata, and leaves a useful follow-up path. Affected cards may show a waiting state but never create another independent prompt.

## 13. Selection, multi-selection, grouping, and tiling

Selection is one shared model across Home, overview, library/list, board, timeline, canvas, Inbox, search, pins, and command results.

- Pressing a selection affordance or supported modifier selects without opening.
- Primary card press opens when not in selection mode.
- Selected, open, focused, pinned, AI-active, waiting, failed, and completed are distinct but compatible states.
- Batch actions are computed from selected object capabilities. Invalid actions are hidden or disabled with a reason.
- Add to context copies valid objects into explicit context; closing selection does not remove them.
- Clear selection clears temporary selection only.
- Group/Tile opens compatible artifacts in one batched update. Workspaces are valid context but invalid artifact tiles.
- A thread may tile without becoming continuation. At most one tiled thread may be chosen as continuation.
- Restored selection is validated and stale/inaccessible identities are pruned.

## 14. Command system

Spectra has one K-bar/command palette using the same catalog, open-object registry, selection, context, continuation, placement, and operation paths as every other surface.

It finds workspaces, artifacts, and threads; opens/focuses objects; adds/removes context; continues or clears a thread; starts a new thread; groups/tiles; moves work; and clears selection. Natural phrasing maps flexibly to supported actions. Unmatched natural-language input becomes an AI request using the same quick-chat begin-run path. Results are deduplicated by canonical identity.

## 15. Card and visual language

The visual authority order is:

1. `artifact-detail-source-of-truth/` for artifact experiences;
2. `ui-card-patterns/` for card variants and states;
3. `ui-source-of-truth/` for page composition, especially the timeline, canvas, board, library, and inspectors.

Shared foundations are warm ivory/paper surfaces, strong ink hierarchy, editorial display type, compact utilitarian metadata, an 8px spatial rhythm with intentional dense exceptions, thin tonal borders, characteristic arc/flow texture, purposeful radius variation, and restrained elevation.

Artifact types do not share one generic white rectangle:

- documents emphasize editorial title, excerpt/structure, and writing state;
- decks emphasize stack, front/back or study progress, and card count;
- quizzes emphasize question structure, completion/readiness, and scoring state;
- tasks emphasize priority, date, progress, and subtasks;
- threads emphasize conversation, continuation, current activity, and needs-input state;
- workspaces emphasize identity, contents, freshness, and activity;
- run/results emphasize operation status and affected objects.

Cards scale by context (hero, standard, compact row, board, canvas, timeline, pinned) while preserving type identity. Pinned work uses a warmer amber edge/elevation language. Hover, press, focus, selected, open, live AI, awaiting input, warning, failure, and completion remain visibly distinguishable without layout shift.

Every icon-only control has an accessible name and a reliable unclipped tooltip on hover and focus. A visible label is used when an icon is not broadly familiar. Tooltips remain readable and do not vanish while moving into interactive content.

## 16. Responsive and accessible contract

Spectra supports large desktops, ordinary school laptops, narrow browser windows, split layouts, open panels, artifact-plus-thread, tiled work, and resized inspectors.

- Layouts adapt; they do not merely shrink a fixed canvas.
- Editors preserve a useful minimum width; panels collapse/dock when necessary.
- Board columns snap-scroll on narrow widths; timeline/card density becomes compact; canvas auto-fits intelligently.
- Long titles wrap or truncate with accessible full labels.
- Primary actions remain available; overflow never hides the only path to a core action.
- Touch targets are approximately 44px where practical.
- Tab order follows visual logic, focus is visible, menus/dialogs trap and restore focus, Escape closes the topmost dismissible layer, and arrow-key navigation works in listbox/menu/tab patterns.
- Enter sends in the composer; Shift+Enter inserts a newline. Modifier and IME composition behavior must not submit accidentally.
- Status changes use appropriate live regions without noisy token-by-token announcements.
- Color is not the sole state indicator and contrast meets WCAG AA for ordinary text/controls.
- `prefers-reduced-motion` removes nonessential transforms and preserves immediate status feedback.

## 17. Performance contract

Local interactions acknowledge within a frame where possible. Already loaded navigation, view switching, selection, menus, and panel changes do not wait on AI or unnecessary network waterfalls.

Use shared subscriptions, normalized canonical state, route/layout persistence, optimistic recoverable mutations, batched tile/selection updates, memoized derived views, bounded event replay, and virtualization-friendly list density. Do not duplicate subscriptions/stores for each presentation. Do not show loading UI for data already in memory. Progressive content checkpoints are bounded to avoid write/render storms.

Target perceptions:

- pointer/keyboard feedback: immediate;
- local view or selection transition: under 100 ms perceived;
- optimistic predictable mutation: immediate with quiet reconciliation;
- opening cached object: no blocking full-page loader;
- new run/tab/thread: visible immediately after the begin mutation;
- first meaningful AI progress: as soon as real lifecycle data exists.

## 18. Error, interruption, and recovery

Errors say what failed, what was preserved, whether retry is safe, and what to do next. They use names and actions, not IDs or backend terminology.

Object resolution searches visible, explicit, selected, active-workspace, then global catalog context. Only genuine ambiguity causes clarification. Ordinary conversational requests must not fail because no open artifact matched.

Interrupted runs preserve valid partial response and mutation state, identify the interruption type, and offer Continue/Retry where safe. Partial object creation is visible and marked incomplete; it is never invisible or contradictory. A secondary failure (title, trace, animation, summary) cannot destroy an otherwise valid response or mutation.

## 19. Conflict resolution and edge cases

| Situation                                   | Canonical behavior                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Same object opened again                    | Focus or move the existing representation; never clone.                               |
| Same thread chosen in a second surface      | Subscribe/focus the same thread and run.                                              |
| Different visible thread and continuation   | Keep current, replace continuation, or cancel; no silent retarget.                    |
| Send while continuation is active           | Prevent submission; offer Wait, Stop, or Start new thread.                            |
| Several workspaces in request               | Use the clearest owning workspace; otherwise ask a natural choice.                    |
| Explicit context object navigated away from | Keep it until removed.                                                                |
| Visible object closed                       | Remove inferred inclusion only; retain explicit inclusion.                            |
| Context object moved                        | Preserve identity and update its location label.                                      |
| Context object deleted/inaccessible         | Prune it and explain naturally.                                                       |
| Workspace selected for Tile                 | Keep context action; disable artifact-only Tile.                                      |
| Two threads selected                        | Allow reference context if supported, but choose at most one continuation explicitly. |
| Browser disconnects                         | Execution continues; views catch up from persisted events.                            |
| Stop races with commit                      | Respect the claimed irreversible boundary and explain what completed.                 |
| Retry after partial success                 | New attempt skips already committed idempotent steps and reports preserved work.      |
| Approval answered in two windows            | First valid atomic claim wins; every view updates.                                    |
| Long/duplicate object names                 | Show type/workspace disambiguation; never expose IDs.                                 |
| Panel closes during run                     | Only presentation closes; run continues.                                              |
| Secondary metadata generation fails         | Keep the successful response/object and use stable fallback metadata.                 |

## 20. State invariants

1. There is one executable workspace implementation.
2. Each source object has one authoritative identity and content record.
3. Each thread/run has one authoritative lifecycle across all views.
4. There is exactly one quick-chat tab system.
5. At most one continuation target exists.
6. Temporary selection and explicit context are separate shared models.
7. There is one command system and one object-opening registry.
8. Viewing an object elsewhere never duplicates it or its run.
9. Navigation and presentation closure never silently cancel AI work.
10. Workspace threads are placed at atomic run start.
11. AI-created artifacts appear progressively in real state.
12. Open artifacts reflect AI edits as genuine checkpoints arrive.
13. Explicit context survives navigation until removal.
14. Focus affects priority, not global retrievability.
15. Internal identifiers and schemas never reach users.
16. One approval outcome synchronizes everywhere.
17. Local navigation never waits for AI.
18. Every primary card surface performs its obvious primary action.
19. Every icon-only action is discoverable and keyboard reachable.
20. Each artifact type has purposeful, differentiated behavior.
21. Responsive layouts preserve capability.
22. A code path is not complete until independently reviewed and behaviorally verified.
23. A run event is monotonic within an attempt; stale attempts cannot mutate current state.
24. Workspace placement never becomes a second copy of artifact/thread content.
25. Closing selection never clears explicit context.
26. A visual AI-working state corresponds to real active work.
27. A terminal or waiting state remains visible until the user intentionally resolves/dismisses it.
28. User drafts and valid partial work survive recoverable failures.

## 21. What must never happen

- No legacy or compatibility workspace implementation survives beside the canonical system.
- No duplicate quick-chat tabs, command palettes, context stores, selection models, or thread instances.
- No hidden workspace thread in an unrelated chat collection.
- No local-only run lifecycle presented as authoritative.
- No navigation-triggered stop, restart, duplicated output, or lost unsaved work.
- No multiple continuation histories merged implicitly.
- No raw chain-of-thought, system prompts, tool schemas, payloads, IDs, routes, planner JSON, or database language shown to users.
- No generic refusal when bounded object retrieval can resolve the request.
- No several-minute invisible plan followed by simultaneous completed artifacts.
- No decorative “AI animation” disconnected from mutations.
- No generic identical cards distinguished only by icon or color.
- No decoration copied literally from a subject-specific reference into unrelated work.
- No icon-only mystery actions, clipped tooltips, dead controls, impossible batch actions, or primary cards that fail to open.
- No spinner used to disguise avoidable local latency.
- No completion claim based only on checked boxes, successful compilation, or the implementer's own review.

## 22. Completion standard

Wave Z is complete only when the canonical product behavior is implemented, every live Wave Z task has both Implemented and Verified checked, reviewer failures have been repaired and re-reviewed, code quality checks pass, and no known contradiction or obvious placeholder remains. A later live acceptance wave may discover additional issues; Wave Z must leave it a mature coherent product rather than a roadmap.

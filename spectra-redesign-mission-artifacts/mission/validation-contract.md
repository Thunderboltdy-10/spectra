# Validation Contract

This contract defines done-state behavior for the Spectra workspace redesign mission.

## Area: Wave 1 Foundation

### VAL-W1-001: Canonical artifact taxonomy is user-visible and consistent
Workspace items are rendered with canonical workspace-facing types (Note, Visual, Code, Export, Board, Flashcard Deck, Quiz, Thread, Planner) and do not appear with conflicting legacy labels in the same view.
Tool: agent-browser  
Evidence: screenshots of each type label/icon in workspace UI; no legacy-only labels shown for active items.

### VAL-W1-002: Legacy type records remain readable during migration
Previously created legacy artifacts still load and render in workspace without crash or missing-card failure.
Tool: agent-browser  
Evidence: seeded legacy records rendered after migration; console-errors capture is clean.

### VAL-W1-003: Artifact creation projects immediately to workspace
Creating an artifact from chat or create actions shows a new workspace item in the active workspace without manual refresh/navigation.
Tool: agent-browser  
Evidence: screen recording from create/send action to immediate card appearance.

### VAL-W1-004: Thread creation projects immediately to workspace
Creating a new thread produces an immediate thread workspace item with distinguishable preview metadata.
Tool: agent-browser  
Evidence: before/after screenshots and network trace for thread creation.

### VAL-W1-005: Planner task creation projects immediately to workspace
Creating a planner task makes it appear immediately as a workspace item and it is selectable in-place.
Tool: agent-browser  
Evidence: screen recording of create -> visible planner card -> selection interaction.

### VAL-W1-006: Archive/inactive source archives projection correctly
Archiving/deactivating a source entity removes or archives the corresponding workspace item without leaving stale active duplicates.
Tool: curl  
Evidence: API mutation trace + post-mutation workspace query/UI snapshot.

### VAL-W1-007: AI discard restores persisted previous content
Discarding an AI edit restores prior persisted content and does not reappear after refetch/reopen.
Tool: agent-browser  
Evidence: edit/apply/discard flow recording + reopen snapshot + no stale diff state.

### VAL-W1-008: Workspace content retrieval is batched per workspace
Loading workspace content uses a consolidated batched content shape for artifacts/threads/planner and avoids per-type fan-out as the primary path.
Tool: agent-browser  
Evidence: network capture showing consolidated workspace content request behavior under cold load.

### VAL-W1-009: Workspace content cache is bounded and evicts least-recently-used entries
After visiting more than cache capacity workspaces, older workspace content is evicted and revisits refetch correctly.
Tool: agent-browser  
Evidence: navigation sequence capture + memory/requests showing eviction + refetch on revisit.

### VAL-W1-010: Landscape zoom model provides meaningful territorial contrast
Far zoom shows readable workspace territories (not dots), mid zoom centers one workspace, deep zoom enables content-level detail.
Tool: agent-browser  
Evidence: screenshots at far/mid/deep zoom levels demonstrating semantic contrast.

### VAL-W1-011: Glance tier exists for all required item classes
At glance tier, all required item classes have non-generic previews (except explicit empty/error fallback states).
Tool: agent-browser  
Evidence: screenshot grid for required classes in glance mode.

### VAL-W1-012: Hub primitive shells are persistent and edge-bound
Workspace dock, quick chat shell, timer shell, create launcher, and collapse toggle are visible and persistent across workspace contexts.
Tool: agent-browser  
Evidence: screenshots across multiple workspaces and zoom states.

### VAL-W1-013: Workspace suggestion flow is tenant-safe by org
Workspace suggestions are derived only from evidence in the actor’s current org and never include cross-org candidates.
Tool: curl  
Evidence: seeded multi-org test with suggestion response containing only current-org IDs.

### VAL-W1-014: Attachment ingestion deduplicates same-source items within one request
Submitting duplicate source attachments in a single request creates at most one workspace item per canonical source tuple while preserving distinct tuples even with similar filenames.
Tool: curl  
Evidence: single-call payload with exact duplicates and near-name collisions + resulting workspaceItems query.

### VAL-W1-015: Layout updates enforce workstream ownership boundaries
Layout update requests cannot reposition items that do not belong to the target workstream.
Tool: curl  
Evidence: cross-workstream item test returns rejection/no-op for out-of-scope item IDs.

### VAL-W1-016: Workspace suggestion rejects org-spoofed context
Suggestion responses remain scoped to authenticated actor org even if request parameters attempt to imply a different org context.
Tool: curl  
Evidence: adversarial request with foreign-org hints returns only current-org candidates.

### VAL-W1-017: Mixed-validity layout updates are atomic
If any item in a layout update payload is out-of-scope, no position updates from that payload are applied.
Tool: curl  
Evidence: mixed payload test shows full rejection/no-op with unchanged coordinates for all included items.

### VAL-W1-018: Projection writes are idempotent under retry/replay
Retrying the same create/attach/projection-triggering request does not create duplicate active workspace items for the same source identity.
Tool: curl  
Evidence: replayed request test showing stable item count and identity after retries.

### VAL-W1-019: Workspace view-mode contract migrates to redesign values
Workspace state and persisted view mode use only `byType | byTopic | timeline` user-facing values for redesign flows.
Tool: agent-browser  
Evidence: mode toggle/persistence capture showing redesign values across reload and workspace switch.

### VAL-W1-020: Invalidation is scoped to affected workspace content
Content-mutation invalidation refreshes affected workspace scopes without causing broad unrelated workspace refresh churn.
Tool: agent-browser  
Evidence: mutation in one workspace with network/events capture showing scoped invalidation/refetch behavior.

## Area: Wave 2 Interaction

### VAL-W2-001: Note Touch tier supports single-click inline editing
Single-clicking a Note in Touch tier enters inline editing with focus ring and immediate typing.
Tool: agent-browser  
Evidence: recording showing no panel open and direct text mutation.

### VAL-W2-002: Note Touch tier restricts editing to basic formatting
Touch-tier Note editing exposes only basic formatting and does not expose slash-command/deep-edit tooling.
Tool: agent-browser  
Evidence: toolbar/interaction capture showing limited controls and no slash command UI.

### VAL-W2-003: Code Touch tier supports inline syntax-highlighted editing
Single-clicking a Code item enables inline syntax-highlighted edits without execution/AI tooling inline.
Tool: agent-browser  
Evidence: code edit recording with syntax highlight and absence of run/AI controls.

### VAL-W2-004: Focus ownership is exclusive and Escape hierarchy is correct
Only one item is focused at a time; Escape exits item focus back to canvas navigation predictably.
Tool: agent-browser  
Evidence: interaction trace switching focus across items and Escape transitions.

### VAL-W2-005: Empty-canvas context menu exposes creation actions
Right-clicking empty canvas shows required creation actions and they execute backend-truth mutations.
Tool: agent-browser  
Evidence: menu screenshot + create action result visible on canvas.

### VAL-W2-006: Item context menu exposes real item actions
Right-clicking an item shows required item actions and each action has real backend effect (not decorative).
Tool: agent-browser  
Evidence: per-action runbook recording + network/mutation evidence.

### VAL-W2-007: Group context menu exposes group-level actions
Right-clicking a group zone shows group actions (rename/collapse/open-all/summarize/merge surfaces) and group-targeting is correct.
Tool: agent-browser  
Evidence: group-zone context menu capture + rename/collapse behavior verification.

### VAL-W2-008: Overflow handling shows first five plus +N expansion control
Groups exceeding threshold render first five items and a +N control with accurate hidden count.
Tool: agent-browser  
Evidence: screenshot with item count and +N value consistency.

### VAL-W2-009: Overflow expansion reveals hidden items without trapping layout
Activating +N expands smoothly, keeps items reachable, and does not create overlap/trap regressions.
Tool: agent-browser  
Evidence: expansion recording + post-layout screenshot.

### VAL-W2-010: Move-to-workspace updates projection correctly
Moving an item relocates it to destination workspace and removes it from source without duplication.
Tool: agent-browser  
Evidence: source/destination before-after screenshots.

### VAL-W2-011: Move-to-workspace flow is undoable
Cmd/Ctrl+Z after move restores item to original workspace and clears moved state.
Tool: agent-browser  
Evidence: move + undo recording with final parity to pre-move state.

### VAL-W2-012: Cmd+K is global and navigates across workspaces
Cmd+K search returns cross-workspace results with workspace/type context and selecting a result pans/zooms/highlights target.
Tool: agent-browser  
Evidence: search result screenshot + navigation recording.

### VAL-W2-013: Move-to-workspace rejects unauthorized destinations
Move actions to unauthorized/unavailable workspaces are rejected server-side and leave source/destination projections unchanged.
Tool: curl  
Evidence: unauthorized move attempt response + unchanged source/destination item state queries.

### VAL-W2-014: Inline edit commit/cancel semantics are deterministic
For Touch-tier Note/Code editing, commit actions persist exactly once, while cancel/Escape exits without applying unintended additional edits.
Tool: agent-browser  
Evidence: edit-commit and edit-cancel interaction recordings with reopen verification.

### VAL-W2-015: Overflow +N count recomputes after create/move/archive mutations
After item-count mutations in an overflowed group, visible-first-five and +N hidden count update correctly without manual refresh.
Tool: agent-browser  
Evidence: before/after mutation screenshots with recalculated +N values.

### VAL-W2-016: Cmd+K invocation is consistent across focused surfaces
Cmd/Ctrl+K opens one command experience consistently from canvas, chat input, and editor-focused states without conflicting handlers.
Tool: agent-browser  
Evidence: keyboard-flow recording from multiple focus contexts showing consistent command surface behavior.

### VAL-W2-017: Item/group context menus are available from their actual targets
Right-clicking item cards and group zones opens their corresponding context menus with executable actions; behavior is not limited to empty-canvas menus.
Tool: agent-browser  
Evidence: target-specific right-click captures + action execution traces.

## Area: Wave 3 Intelligence

### VAL-W3-001: T0 gate triggers only for trivial filler
Filler-only messages use fast path; short substantive prompts are not incorrectly routed as T0.
Tool: curl  
Evidence: paired request traces (filler vs substantive short) with route metadata.

### VAL-W3-002: Non-T0 requests are classifier-led
For non-T0 prompts, classifier output is the routing source of truth for skills and route intent.
Tool: curl  
Evidence: request logs showing classifier output and matching downstream route plan.

### VAL-W3-003: Classifier decision payload is schema-valid
Classifier output includes required structured fields and avoids malformed/fallback-only behavior under normal conditions.
Tool: curl  
Evidence: captured classifier payload for multiple request types.

### VAL-W3-004: Multiple skills can be loaded in one response plan
Prompts requiring combined capabilities activate multiple skills in one generation flow.
Tool: curl  
Evidence: skill list in request trace + corresponding composite response behavior.

### VAL-W3-005: Spectra visual skill constrains visual output quality
Visual-intent responses follow Spectra visual constraints and avoid generic low-fidelity output.
Tool: agent-browser  
Evidence: rendered visual output samples + prompt/skill trace.

### VAL-W3-006: Visual responses dual-render to thread and workspace
A visual generated from chat appears inline in thread and as projected workspace visual item in the same flow.
Tool: agent-browser  
Evidence: chat render + workspace card appearance in single interaction recording.

### VAL-W3-007: Ghost visibility constraints are enforced
No more than two ghosts are visible concurrently; ghosts are suppressed during active editing.
Tool: agent-browser  
Evidence: editing-session recording + visible ghost count captures.

### VAL-W3-008: Ghost lifecycle supports accept/dismiss with correct persistence
Accepting a ghost materializes a real item; dismissing prevents unintended item creation.
Tool: agent-browser  
Evidence: before/after state and mutation trace for accept vs dismiss.

### VAL-W3-009: AI-origin provenance is visible and preserved
AI-created items show provenance markers and keep provenance through updates/moves.
Tool: agent-browser  
Evidence: UI marker screenshots + follow-up state after move/edit.

### VAL-W3-010: Semantic agent matching and cheap background lanes are active
Agent matching behaves semantically (not only lexical overlap) and background intelligence tasks run on budget-safe lanes.
Tool: curl  
Evidence: route/matching logs + background job model metadata.

### VAL-W3-011: Non-visual requests do not spuriously activate visual skill
Requests without visual intent are handled without visual-skill activation unless explicitly asked by user override.
Tool: curl  
Evidence: route/skill trace for non-visual prompts showing absence of visual skill.

### VAL-W3-012: Classifier failure fallback remains deterministic and schema-safe
If classifier output is invalid/unavailable, fallback behavior remains deterministic, preserves valid response shape, and does not silently restore heuristic-primary routing as default truth.
Tool: curl  
Evidence: induced classifier-failure test traces showing explicit fallback metadata and stable response schema.

## Area: Wave 4 Views + Focus

### VAL-W4-001: Global view mode supports By Type, By Topic, Timeline with persistence
Switching view mode changes rendering accordingly and persists across workspace navigation/re-entry.
Tool: agent-browser  
Evidence: mode toggle captures across workspaces and re-entry.

### VAL-W4-002: By Type groups content by canonical class
By Type view places items under correct type group zones with no cross-type misgrouping.
Tool: agent-browser  
Evidence: grouped layout screenshot with type-consistent membership.

### VAL-W4-003: By Topic groups semantically across mixed types
By Topic view creates subject-based groups that can contain mixed item types and differ materially from By Type.
Tool: agent-browser  
Evidence: before/after mode comparison and mixed-type topic zone screenshot.

### VAL-W4-004: Topic override via drag persists
Dragging an item into a different topic group persists after leaving and re-entering workspace.
Tool: agent-browser  
Evidence: drag action + re-entry snapshot showing override retention.

### VAL-W4-005: User topic rename persists through reclustering
User-renamed topic groups remain renamed after background/manual reclustering.
Tool: agent-browser  
Evidence: rename/recluster/reload recording with stable renamed label.

### VAL-W4-006: Timeline groups items by day in chronological review layout
Timeline mode renders day-based grouping correctly and assigns items to matching day buckets.
Tool: agent-browser  
Evidence: timeline screenshots with date-group validation against item timestamps.

### VAL-W4-007: By Topic fallback is safe when clustering data is absent
If topic clusters are unavailable, UI falls back safely (or shows non-error pending state) without blank/error traps.
Tool: agent-browser  
Evidence: no-cluster scenario capture demonstrating fallback behavior.

### VAL-W4-008: Focus mode activates from timer and narrows attention
Starting focus timer activates focus visual treatment linked to current workspace context.
Tool: agent-browser  
Evidence: timer start -> focus visual transition recording.

### VAL-W4-009: Focus mode is non-blocking
While focus mode is active, users can still navigate/edit/use quick chat without forced route or modal lock.
Tool: agent-browser  
Evidence: interaction trace in active focus mode showing continued workflow actions.

## Area: Wave 5 Integration

### VAL-W5-001: App opens into last active workspace by default
On app launch/reopen, users land in the most recently active workspace context rather than a generic home surface.
Tool: agent-browser  
Evidence: multi-session launch captures with last-active restoration.

### VAL-W5-002: Linked workspace companion agent is implicit in chat behavior
Workspace chat automatically includes linked companion context without requiring manual re-selection.
Tool: agent-browser  
Evidence: workspace chat session with companion-context behavior and no manual selector step.

### VAL-W5-003: Companion context is helpful but not a hard lock
Users can ask off-topic/general questions from linked workspace chat without blocked responses.
Tool: agent-browser  
Evidence: off-topic prompt in linked workspace returns valid answer with optional routing suggestion.

### VAL-W5-004: Planner hub aggregates across workspaces with required buckets
Hub planner shows Today/Tomorrow/This Week/Later grouping across workspace sources, including ManageBac deadlines.
Tool: agent-browser  
Evidence: planner hub screenshot with bucketed items and ManageBac entries.

### VAL-W5-005: Planner hub item navigation lands in source workspace/item
Selecting a planner entry navigates to the owning workspace and highlights/focuses target item.
Tool: agent-browser  
Evidence: click-to-navigate recording from planner hub to target context.

### VAL-W5-006: ManageBac integration remains coherent in hub navigation
ManageBac-backed deadlines are navigable and round-trip return preserves workspace context.
Tool: agent-browser  
Evidence: ManageBac item navigation + return flow recording.

### VAL-W5-007: Gamification is integrated subtly into workspace flow
XP/streak/achievement indicators appear without dominating or blocking core workspace interactions.
Tool: agent-browser  
Evidence: gameplay signal captures during normal task flow without intrusive overlays.

### VAL-W5-008: Template inference is suggestive and optional
Workspace creation proposes inferred templates from title but allows dismiss/modify without forced structure.
Tool: agent-browser  
Evidence: workspace creation flow showing optional template suggestion actions.

### VAL-W5-009: Integrated create/edit/move workflows preserve immediate projection guarantees
Across integrated Wave 5 flows, created/edited/moved content remains immediately reflected on workspace surfaces.
Tool: agent-browser  
Evidence: end-to-end recording spanning create/edit/move with immediate projection updates.

## Cross-Area Flows

### VAL-CROSS-001: Landscape to workspace to Touch progression is smooth and stateful
Users can traverse far landscape -> workspace region -> Touch interactions without hard route traps or jarring mode boundaries.
Tool: agent-browser  
Evidence: zoom/pan interaction recording across levels.

### VAL-CROSS-002: Chat-to-artifact projection-to-undo chain remains coherent
A chat-created item projects immediately, can be moved, and can be undone while preserving consistent identity/state.
Tool: agent-browser  
Evidence: create/move/undo sequence with stable item identity.

### VAL-CROSS-003: Scope badges are hints, not constraints
Quick chat scope indicators reflect current context but do not prevent valid actions/questions outside current workspace theme.
Tool: agent-browser  
Evidence: scoped chat interaction showing successful out-of-scope request handling.

### VAL-CROSS-004: Classifier + skills + visual generation stay aligned through UI and backend traces
A visual-intent request produces aligned classifier decision, skill activation, and UI-visible dual output.
Tool: curl  
Evidence: request trace joined with UI evidence for same request ID.

### VAL-CROSS-005: By Topic, Timeline, and Focus interplay preserves item identity and accessibility
Switching among these views while focus mode is active does not lose items, duplicate items, or dead-end navigation.
Tool: agent-browser  
Evidence: multi-mode switching recording with consistent item counts/IDs.

### VAL-CROSS-006: Planner + ManageBac + workspace navigation maintain context integrity
Planner-driven navigation into ManageBac-related items and back preserves active workspace context and selection continuity.
Tool: agent-browser  
Evidence: round-trip navigation recording with preserved context markers.

### VAL-CROSS-007: Companion agent + ghosts + gamification interaction remains non-nagging and accurate
Agent/ghost suggestions can drive progress, but rewards increment only on accepted/completed actions and ghost prompts remain bounded.
Tool: agent-browser  
Evidence: session recording showing accept/reject paths and metric deltas.

### VAL-CROSS-008: Rapid context switching does not create orphaned or duplicate projection entities
Fast alternation between chat, workspace navigation, and item operations preserves consistency without orphan/duplicate artifacts.
Tool: tuistory  
Evidence: scripted rapid-switch transcript + final consistency snapshot.

### VAL-CROSS-009: Stream and draft state integrity survives rapid chat/workspace switching
Switching workspace or chat context during active streaming does not leak stale stream phases or drafts into unrelated active contexts.
Tool: tuistory  
Evidence: rapid-switch scenario transcript with per-chat stream state and final message integrity checks.

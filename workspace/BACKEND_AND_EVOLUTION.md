# Backend And Evolution

This file translates the workspace vision into backend and orchestration realities.

It exists because the current codebase is already halfway to this product, but the missing half is structural, not cosmetic.

## 1. What Already Exists

The current codebase already has meaningful foundations:

- `workstreams` with spatial metadata and ManageBac linkage,
- `artifacts` plus `artifactVersions`,
- `chats` with `workstreamId` and `artifactId`,
- `plannerItems`,
- `workstreamMemory` with vector retrieval,
- structured clarification cards,
- ManageBac sync that already creates subject workstreams and CAS.

This matters because the redesign should not describe a fantasy backend that ignores the real one.

## 2. What Is Missing

The current backend does not yet express the intended product clearly.

Main missing pieces:

- a first-class workspace widget instance model,
- AI tools for `create_workstream`, `create_widget`, `merge_into_workstream`, `rehome_thread`, `rehome_artifact`,
- a durable workspace-candidate lifecycle,
- first-class Extended Essay creation defaults,
- a clear attachment/merge model for bringing old threads and artifacts into new workspaces,
- a policy layer deciding when AI should ask before mutating workspace structure.

## 3. Recommended Data Model Direction

### Current state

Right now:

- artifacts have `layout`,
- workstreams have coarse canvas size/position,
- threads and planner items are separate entities,
- canvas-native rendering is assembled ad hoc in frontend builders.

### Better target

Introduce a workspace item table or equivalent abstraction.

```text
workspaceItems
  id
  ownerUserId
  orgId
  workstreamId
  itemType: artifact | chat | planner | utility | synthetic_group
  sourceId
  x
  y
  width
  height
  zIndex
  visualGroup
  shellVariant
  pinned
  collapsed
  hidden
  renderProps
  createdAt
  updatedAt
```

Benefits:

- one artifact can appear in multiple visual contexts,
- one chat can be represented on canvas without pretending it is an artifact,
- shell previews can share the same content objects but render them differently,
- utilities can become re-positionable without abusing unrelated models.

## 4. Workspace Creation Lifecycle

There should be three creation modes.

### A. System bootstrap

On first meaningful sync or onboarding:

- create one workstream per subject,
- create `CAS`,
- create `Extended Essay`,
- create `General`.

If a school needs different defaults later, that should be configurable per school.

### B. User-explicit

The user asks directly:

- "Create a planner workspace"
- "Make me a robotics workspace"
- "I want a place for university applications"

This should create immediately.

### C. AI-emergent

This is the ambitious path.

If the user repeatedly works on an uncaptured topic, AI can create a workspace only when evidence is strong enough.

Signals:

- repeated topic in chats,
- multiple related artifacts,
- durable user/global memory overlap,
- planner cluster,
- no existing close workstream fit.

### Suggested flow

```text
Repeated topic
  -> candidate score grows
  -> AI asks once if ambiguity remains
  -> AI creates workspace
  -> AI attaches best-matching chats/artifacts
  -> provenance ribbon appears
  -> user can revert
```

## 5. Merging Existing Work Into New Workspaces

This is one of the most important missing pieces.

When AI creates a new workspace from ongoing work, it should not create an empty shell unless that is intentional.

It should attempt to attach:

- the originating thread,
- nearby relevant threads,
- related artifacts,
- planner items if they belong,
- a starter layout.

### Selection model

The user should also be able to review or refine the merge:

```text
Create "University Applications" workspace with:
[x] Current thread
[x] Essay draft
[ ] Old scholarship chat
[x] Deadline list
```

This can reuse the existing clarification-card pattern.

## 6. Memory Strategy

The memory system is already stronger than the current workspace UI suggests.

There are:

- global memory entries,
- workstream memory entries,
- embeddings,
- clarification-aware routing.

The workspace redesign should use this, not duplicate it.

### Use memory for

- workspace candidate scoring,
- suggested connections between workstreams,
- pre-scoping AI commands,
- rehydrating likely relevant artifacts,
- understanding when a topic is durable enough to deserve structure.

### Do not use memory for

- silently moving lots of user content without provenance,
- overconfident auto-creation on weak evidence,
- replacing explicit user organization with hidden automation.

## 7. Embedding Cost Strategy

You explicitly raised cost concerns. That is correct.

### Current codebase reality

- server-side embeddings already exist,
- memory and retrieval already use them,
- OpenRouter cost can accumulate if overused.

### Recommended stance

For v1:

- use existing server-side embeddings selectively for canonical memory/retrieval,
- keep thresholds conservative,
- avoid embedding every tiny UI event,
- prefer lexical heuristics and cached memory before fresh vector calls.

For later experimentation:

- browser-local embedding or on-device clustering can be explored for visual relationship suggestions,
- but it should not become the core truth source initially.

## 8. Clarification As A First-Class Mutation Guard

The existing clarification system is already useful.

The workspace redesign should explicitly extend it to structural operations.

Examples:

- "Improve the timetable"
  -> ask what scope if ambiguous
- "Create a new workspace for this"
  -> ask what to include if evidence is mixed
- "Reorganize my Biology workspace"
  -> ask whether to optimize for revision, deadlines, or docs

### Mutation rule

If AI is unsure which workspace, which items, or which scope:

- ask one structured question,
- persist it,
- continue from the answer,
- do not guess wildly.

## 9. Whiteboard and Custom Widget Backend Implications

If whiteboards and custom widgets become real:

- add new artifact types,
- support renderer validation,
- keep version history,
- keep `Fix with AI`,
- keep rollback.

Whiteboards should be treated as:

- persisted artifact content,
- panel-native editor surface,
- canvas-visible widget preview.

## 10. Orchestrator Additions Needed

Recommended new tool names:

- `create_workstream`
- `update_workstream_layout`
- `create_widget`
- `update_widget`
- `attach_items_to_workstream`
- `suggest_workspace_from_topic`
- `list_merge_candidates`

Without these, the AI-native workspace idea remains only partially expressible.

## 11. Current Codebase Assets To Reuse

Keep and extend:

- clarification cards,
- workstream memory retrieval,
- ManageBac sync workstream creation,
- artifact versioning,
- `artifact_edit` chat thread model.

Challenge and probably replace or heavily refactor:

- monolithic hub bar assumptions,
- REST-only workstream loading approach for highly interactive canvas behavior,
- simplistic artifact type catalog,
- coarse committed-workstream state model,
- frontend-only grouping builders that stand in for a real widget system.

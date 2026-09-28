# AI Runs, Threads, Result Cards, and Command Surfaces

## Why this exists

The old app blurred together:

```txt
chat message
tool call
AI operation
thinking trace
workspace action
artifact edit
```

The rebuild must separate them.

## Definitions

### AIRun

One AI execution.

Every AI command creates an AIRun.

Examples:

- user sends chat message
- user asks workspace command bar to make flashcards
- user asks artifact command bar to shorten a document
- user asks for a quiz from selected artifacts

### Thread

A persistent conversation.

Not every AIRun creates a thread.

### ResultCard

Compact visible status/result of an AIRun.

In workspace/artifact surfaces, ResultCards are the default visible output, not full chat.

### Operation

A validated backend action.

Examples:

```txt
artifact.create
artifact.update
workspace.create
workspaceItem.add
thread.create
resultCard.update
plannerTask.create
quiz.grade
flashcardDeck.generate
```

## Surface behavior

### `/chat`

Default behavior:

```txt
User prompt → Thread message → AIRun → Assistant message
```

If the AI creates an artifact in chat:

```txt
Created artifact appears in chat response with:
Open · Add to workspace
```

It is stored in Artifact Library/Inbox by default.

It is **not** automatically added to a workspace unless:

1. the thread is already linked to a workspace and user confirms/default accepts;
2. the user explicitly says to add it to a workspace;
3. the user clicks `Add to workspace` and chooses one.

### `/workspace`

Default behavior:

```txt
User prompt from command bar → AIRun → ResultCard → Operations → optional Thread
```

Simple commands do not need a visible thread.

Complex or conversational commands create/continue a thread.

Created artifacts belong to current workspace by default.

### `/artifacts`

Default behavior:

```txt
User prompt from artifact command bar → AIRun → ResultCard → artifact operations → optional Thread
```

If acting on a single open artifact, the command bar targets that artifact.

## Result card stack

Result cards should stack above the quick command bar.

Rules:

- cards never disappear automatically
- hidden only when user presses `x`/Hide
- hidden does not mean deleted
- hidden cards remain accessible from run/thread hub or activity history
- max stack height
- overflow scroll
- blur/fade gradient at top/bottom when scrollable
- latest card should be easiest to see
- running card should show compact progress
- failed card should show retry/details

Possible UI:

```txt
┌──────────────────────────────────────────┐
│ Done · Created 18 flashcards             │
│ Open artifact · Add to workspace · Hide  │
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│ Running · Reviewing selected documents…  │
│ Stop · Details                           │
└──────────────────────────────────────────┘
[ command bar ]
```

## Right Run/Thread Hub

Workspace should have a right-side hub/panel.

Sections:

```txt
Running
Recent runs
Pinned threads
Hidden cards
```

Opening a thread in the hub makes the command bar continue that thread until focus is cleared.

## Thread cards in workspace

Threads can appear as workspace items, but only when useful.

A thread appears in a workspace if:

- user pins/adds it
- user clicks Add to workspace
- AI suggests it and user accepts
- it was created from workspace and marked important

Do **not** add every thread automatically.

Thread card content:

```txt
title
short summary
last activity
linked artifacts
continue button
```

## Operation execution model

The AI should not directly mutate arbitrary state.

It proposes/requests operations through a schema.

Flow:

```txt
prompt
→ context builder
→ model response / structured plan
→ operation validation
→ execution
→ operation log
→ result card update
→ optional assistant/thread message
```

## Stream events

Do not pause for every tiny progress update.

Use stream events:

```ts
type SpectraStreamEvent =
  | { type: "text_delta"; content: string }
  | { type: "status_delta"; runId: string; statusText: string }
  | { type: "result_card_patch"; runId: string; patch: unknown }
  | { type: "operation_preview"; runId: string; operation: unknown }
  | { type: "operation_commit"; runId: string; operationId: string }
  | { type: "operation_result"; runId: string; operationId: string; result: unknown }
  | { type: "final"; runId: string; summary: string }
  | { type: "error"; runId: string; message: string };
```

Progress text/status card updates should not require a tool-call pause.

Backend mutations should be real operation commits.

## Object explosion policy

Safe direct creation:

```txt
result card
operation log entry
explicitly requested artifact
explicitly requested thread
```

Require confirmation:

```txt
new workspace
bulk creation of visible workspace objects
bulk reorganization
deletion
sharing/publishing
custom blueprint creation
```

Generated sets count as one artifact:

```txt
30 flashcards = 1 flashcard deck artifact
12 questions = 1 quiz artifact
5 generated notes = confirmation needed unless explicitly asked
```

## Final answer format in workspace

Workspace AI should return a compact final sentence/card summary, not a huge chat answer by default.

Example:

```txt
Done — I created a 16-card deck from your Physics notes and linked it to this workspace.
```

If the user opens the thread, more detail can be shown there.

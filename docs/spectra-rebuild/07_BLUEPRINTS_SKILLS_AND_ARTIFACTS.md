# Blueprints, Skills, and Artifacts

## Core distinction

Artifacts are stored objects.

Blueprints define how artifacts work.

Skills define quality/style/behavior guidance for AI and renderers.

## Artifact is not markdown

The old artifact concept felt too much like a markdown note with AI bolted on. The new artifact system must support distinct object types.

A quiz is a real quiz.
A flashcard deck is a real deck.
A planner task is a real task.
A document is a real editable document.

## Built-in blueprints for v1

### 1. Document

Purpose:

- notes
- essay plans
- structured writing
- study explanations

Suggested content shape:

```ts
type DocumentContent = {
  blocks: Array<{
    id: string;
    type: "paragraph" | "heading" | "quote" | "callout" | "list" | "math" | "code";
    text?: string;
    attrs?: Record<string, unknown>;
  }>;
  outline?: Array<{ id: string; title: string; level: number }>;
};
```

Renderer:

- rich editor
- clean document preview card
- AI can append, rewrite selected blocks, summarize, outline

### 2. Thread reference

Thread is its own entity, but can be projected as a workspace item.

Renderer:

- thread summary card
- continue button
- linked artifacts
- last activity
- open in right panel

### 3. Flashcard deck

Suggested content:

```ts
type FlashcardDeckContent = {
  cards: Array<{
    id: string;
    front: string;
    back: string;
    hint?: string;
    sourceRefs?: string[];
    confidence?: "unknown" | "weak" | "medium" | "strong";
  }>;
  settings?: {
    shuffle?: boolean;
    revealMode?: "click" | "type";
  };
};
```

Renderer:

- deck overview
- study button
- card preview
- count/status chip
- weak cards later

### 4. Quiz

Suggested content:

```ts
type QuizContent = {
  questions: Array<{
    id: string;
    prompt: string;
    type: "multiple_choice" | "short_answer";
    options?: string[];
    correctAnswer?: string;
    explanation?: string;
    difficulty?: "easy" | "medium" | "hard";
    sourceRefs?: string[];
  }>;
  settings?: {
    showAnswersImmediately?: boolean;
    timed?: boolean;
  };
};
```

Renderer:

- quiz overview
- take quiz
- review answers
- question count/difficulty chips

### 5. Planner task

Suggested content:

```ts
type PlannerTaskContent = {
  description?: string;
  dueAt?: number;
  status: "todo" | "doing" | "done";
  priority?: "low" | "medium" | "high";
  linkedArtifactIds?: string[];
  linkedThreadIds?: string[];
};
```

Renderer:

- task card
- due date
- status toggle
- linked items

## Deferred blueprints

Do not build in v1:

```txt
diagram
whiteboard
code
research brief
essay plan
custom blueprint builder
```

But design should not block them.

## Blueprint operations

Every blueprint should expose allowed operations.

Example:

```ts
type BlueprintOperation =
  | "create"
  | "summarize"
  | "update"
  | "append"
  | "review"
  | "generate_from_sources"
  | "add_to_workspace";
```

Concrete examples:

```txt
document:
  create, append, rewrite_selection, summarize, outline

flashcard_deck:
  create, generate_from_sources, add_cards, remove_cards, improve_cards

quiz:
  create, generate_from_sources, answer, grade, explain_answers

planner_task:
  create, update_status, link_artifact, link_thread

thread_reference:
  pin_to_workspace, summarize, continue
```

## Skills

Do not rebuild a giant skills system immediately.

But preserve the concept in a small structured way.

### Product/design skills

Used by coding agent and UI generation:

```txt
spectra-ui-style
spectra-card-design
spectra-artifact-layout
spectra-result-card-behavior
spectra-thread-hub-behavior
```

### Educational skills

Used by AI responses/artifact generation:

```txt
socratic-tutoring
flashcard-quality
quiz-quality
source-reliability
essay-feedback
math-explanation
```

### Blueprint skills

Each blueprint can reference educational skills.

Example:

```txt
flashcard_deck → flashcard-quality
quiz → quiz-quality
document → writing/document-polish
```

## Frontend design skill

Before major UI work, the agent must activate/read frontend-design skill and relevant `SKILL.md`.

If context compacts, reload this file and `04_UI_UX_DIRECTION.md` before continuing UI.

## Flexibility policy

Do not allow arbitrary AI-generated React components in v1.

Allow flexibility through:

- typed schemas
- renderer variants
- theme-aware styling
- blueprint operations
- later configurable colors/density/icons

Custom blueprint builder is later.

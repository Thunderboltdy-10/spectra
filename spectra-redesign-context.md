# Spectra Workspace Redesign — Complete Context for Spec Generation

## What This Document Is

This document captures every design decision, architectural change, and implementation detail for a major redesign of Spectra's workspace system. It is the single source of truth for generating a comprehensive implementation spec. The spec must be divided into waves, each with validation gates ensuring completeness before proceeding.

Spectra is an AI-first educational workspace for students and teachers. The current workspace is a ReactFlow canvas with workstream nodes that expand to show cards — but the cards are essentially useless shortcuts that open panels. The workspace doesn't feel alive, isn't truly useful, and the AI routing is keyword-based and fragile. This redesign transforms the workspace into the actual working surface where content is created, edited, and organized — powered by intelligent AI that understands context without regex heuristics.

---

## Part 1: The Workspace Canvas Redesign

### 1.1 Core Philosophy

The workspace is NOT a shortcut layer. It IS the working surface. Users should be able to see, read, and edit their content directly on the canvas without opening panels for every action. The previous hub-and-cards approach failed because it was a waiting room, not a workspace.

No home screen. The app opens directly to the user's most recently active workspace. Workspaces are ordered by last activity.

Desktop only — no mobile implementation required.

### 1.2 Canvas Sizing and Spacing

**Critical problem to fix:** Currently everything is compressed at the small end. Workstream nodes are 520-780px wide, meaning at zoom 1.0 you can barely see 2 workspaces. Zooming out makes everything disappear into dots.

**Fix:** Workstream canvas coordinates must be much larger. Each workspace should occupy approximately 1500x1200px of canvas space. Place workstreams at positions like (0,0), (2000,0), (4000,0) with significant spacing. This means:
- At zoom ~0.15 (far out): full landscape of workspaces visible as meaningful cards
- At zoom ~0.5: single workspace fills most of screen
- At zoom ~1.0: deep inside a workspace seeing rendered content

The zoom thresholds need recalibration from the current values (0.25/0.5/0.9) to work with this new spacing. The exact values should be tuned during implementation, but the principle is: there must be a dramatic visual difference between zoom levels, not the current cramped feeling.

### 1.3 Three-Tier Interaction Model

Every item on the canvas exists in one of three interaction tiers based on zoom level and user action:

**Glance (zoomed out, workspace-level view)**
- Read-only preview cards showing title + first 2 lines + type icon + status dot
- Zero cost — data already loaded from prefetch
- Interaction: click or zoom to enter Touch tier

**Touch (zoomed in, content-level view)**
- Actual content rendered by type (see per-type behavior below)
- Click an item → focus ring appears (cyan, 2px, 2px offset)
- While focused: keyboard input goes to item's editor
- Click outside or press Escape → exits focus, returns to canvas navigation
- Not all types support inline editing at Touch tier

**Deep Edit (panel opens)**
- Triggered by: double-click, right-click → "Open in editor", or AI targets item via quick chat
- Full toolbar, AI editing, version history, diff view
- Canvas dims slightly behind panel, targeted item highlighted
- The panel slides from the right with animation

**Per-type Touch tier behavior:**

| Type | Touch Behavior | Editable Inline? |
|------|---------------|-----------------|
| Note | Focus ring, cursor appears, type to edit. Supports bold, italic, headings, basic lists. No slash commands (those are Deep Edit only). | Yes |
| Code | Focus ring, code editor activates. Syntax highlighting, basic editing. No run button or AI suggest. | Yes |
| Visual (SVG/HTML) | Rendered output displayed. Interactive controls (sliders, buttons) within the visual work. Cannot edit source inline. | View + interact only |
| Export (Word/PPT/PDF) | Thumbnail preview with download button. | No |
| Flashcard Deck | Shows card count + due count badge. Small "Review" button. | No (opens panel) |
| Quiz | Shows score summary or "Not attempted" badge. | No (opens panel) |
| Thread | Last 2-3 exchanges shown as mini-conversation. Small "Continue" button at bottom. | No (opens panel) |
| Planner Task | Toggle done/undone, edit title inline. Shows deadline badge, priority dot. | Partial |
| Board/Whiteboard | Mini canvas preview, not editable inline. | No (opens panel) |

### 1.4 Background Tint Zones (No Borders)

Content groups use subtle background fills — NOT dashed lines, NOT solid borders.

- Tint opacity: 6-8% of a neutral color
- The tint should have a soft, gradient-like edge — not a hard rectangle. Use radial gradient or large box-shadow with high spread to create an "area of knowledge" feeling that fades naturally into the canvas. No stark contrast or drop-off between background and tint zone.
- Each content group gets a section header (small, 12px, ~45% opacity) above its tint zone
- Items within a group are arranged spatially within the tint zone
- Dragging an item out of a tint zone is smooth — no "crossing a wall" feeling
- Different groups can use subtly different tint colors for visual distinction (warm tint for artifacts, cool for threads)

### 1.5 Three View Modes (Global Toggle)

A segmented control in the workspace toolbar toggles between three views. This is a GLOBAL setting stored in the Zustand workspace store — switching affects all workspaces (but only the currently visible one re-renders immediately; others apply when entered).

**By Type (default):**
Groups content by kind — Artifacts, Threads, Planner, etc. Each type gets its own tint zone with a header. This is the initial view before the AI has enough content to cluster semantically.

**By Topic (semantic):**
AI clusters content by subject matter, mixing types. A "Waves" group might contain notes, threads, and past paper questions all related to waves. Uses embedding-based clustering (see Section 6). Users can drag items between topic groups to override AI clustering. User renames of topic groups persist.

**Timeline:**
Everything displayed chronologically on a horizontal timeline. Grouped by day. Useful for exam prep review ("what did I study this week?"). Each day shows stacked cards for items created/edited that day.

### 1.6 Hub Items (Persistent Border Elements)

Hub items are persistent UI elements that live at the edges of the canvas, present across ALL workspaces. They are draggable but only along the edges (top, bottom, left, right). Default padding from the page border, not customizable.

**Default hub items (always present):**

1. **Workspace selector** (left edge): Vertical pill/dock with numbered workspace icons. Ordered by last activity. Hover expands to show workspace name + emoji. Click navigates to that workspace (pans + zooms). Currently active workspace is highlighted. Think macOS dock behavior.

2. **Quick chat** (bottom center): The main AI interaction bar. Capsule-shaped input with a send button. Context-aware per zoom level (see Section 4). When in a workspace, shows a subtle workspace badge. When editing an artifact, shows the artifact name badge.

3. **Timer/Focus** (bottom right): Pomodoro-style focus timer. Shows time remaining when active. Click to expand: shows session length control (default 40 min work / 5 min break), sessions completed count. When active, can be linked to current workspace for XP tracking. Connects to gamification system.

4. **"+" creation button** (bottom left): Radial or dropdown menu with artifact primitives: Note, Code, Visual, Thread (new conversation), Planner Task, Export (create document). Plus "Create with AI..." option that focuses the quick chat. Additionally includes "New workspace" option when in the all-workspaces view.

5. **Toggle expanded/collapsed** (bottom left, next to +): A button (needs an icon — suggest chevron or compress/expand icon) that toggles between expanded and collapsed views for user-created hub widgets. Only affects user-added hub items, not the defaults.

**User-creatable hub items:**
Users can add widgets to the hub via the quick chat or "+" menu. Examples include:
- Quick Notes panel (collapsible, hover to expand)
- Planner/Timetable panel (collapsible, shows upcoming deadlines from all workspaces, tasks organized by day — Today, Tomorrow, This Week, Later. Click a task to navigate to its workspace and open it. Should integrate with ManageBac deadlines when available.)
- Custom widgets created via AI

These user hub items can be toggled on/off, are collapsible (hover to expand), and are draggable along the canvas edges.

### 1.7 Overflow Handling

When a group has more than ~6 items:
- Show the first 5 items with a "+N more" pill at the bottom
- Clicking expands the group (animated, pushes other groups)
- In "By Topic" view, overflow is naturally reduced since items are split across topic clusters
- The Cmd+K search is the safety net for finding anything regardless of overflow

### 1.8 Canvas Navigation

- Zoom in/out: scroll wheel or pinch
- Pan: click and drag on empty canvas
- Navigate to workspace: click workspace in dock, OR pan to workspace area and click/zoom into it
- Auto-detect intent: if user clicks within a workspace's area while zoomed out, zoom into that workspace automatically. BUT: add constraints to prevent accidental triggers — must click deliberately within the workspace bounds, not just near a heading
- Exit workspace: press Escape, or zoom out past a threshold, or click a different workspace in the dock
- No hard UI state change when crossing zoom thresholds — the content progressively gains/loses detail. No encapsulating or fixing the scroll at a boundary.

### 1.9 Prefetch and Performance Strategy

**Three zones around the viewport:**

| Zone | Distance | Content Loaded |
|------|----------|---------------|
| Zone 1 (viewport) | Current view | Fully rendered — editors active, content visible, status live |
| Zone 2 (1-2x viewport) | Adjacent | Metadata only — titles, types, positions. Skeleton placeholders for content |
| Zone 3 (beyond 2x) | Far | Nothing loaded. Load on scroll |

**Loading strategy:**
- Adjacent workspaces: prefetch metadata on idle (`requestIdleCallback`)
- Panning toward a workspace: begin content fetch at 1.5x distance from viewport edge
- Zoom out: immediately drop all inline editors/renderers (release to Glance tier)
- Use `IntersectionObserver` or ReactFlow's viewport tracking to determine which items are visible

**Cache management:**
- Replace current unbounded `contentCacheRef` with an LRU cache (max 5-7 workspaces)
- Evict least-recently-visited workspace content when cache exceeds limit
- Invalidation: via existing `workspace-content-mutated` event system
- Batch Convex queries: one `getWorkspaceContent(workstreamId)` call returns all artifacts, threads, and planner items

**Zoom level as memory management signal:**
- When zooming out from a workspace, unmount inline editors and renderers (they become Glance cards — just text, basically free)
- When zooming in, hydrate editors for visible items
- Skeleton placeholders during the 100-200ms hydration window

### 1.10 Cmd+K Global Search

A command palette (like VS Code or Linear) accessible via Cmd+K from anywhere.

- Searches across ALL workspaces, all artifact types, all thread content
- Results show as a flat list with workspace badge + type icon
- Selecting a result navigates there: pans + zooms to the right workspace and highlights the item
- Also supports commands: "New note", "New workspace", "Switch to Physics", etc.
- Powered by the existing `contentPlaintext` field on artifacts and search over thread messages

Currently exists as `WorkspaceCommandBar` but needs significant enhancement: proper search indexing, result ranking, workspace navigation on select.

### 1.11 Right-Click Context Menus

Context menus exist on three targets:

**Right-click on empty canvas:**
- New note
- New thread
- New diagram
- New code
- New planner task
- (separator)
- Paste from clipboard

**Right-click on an item:**
- Open in editor
- Edit with AI... (opens quick chat focused on this item)
- Duplicate
- (separator)
- Move to workspace... (opens workspace picker with search)
- (separator)
- Pin to top
- Version history
- Archive

**Right-click on a group zone:**
- Add item to group
- Rename group
- Sort by...
- (separator)
- Collapse group
- Open all in editor
- AI: Summarize group
- Merge with...

### 1.12 Workspace Templates

When creating a new workspace, the AI infers a template from the title:
- "Physics HL" → Pre-structured layout with Artifacts group, Threads group, Planner group
- "TOK Essay" → Notes area, Research threads area, Draft area
- Templates are suggestions, not forced — user can modify or dismiss

The template system uses the cheap LLM classifier to determine workspace type from the title and creates an appropriate initial layout.

---

## Part 2: Artifact System Redesign

### 2.1 Artifact Type Consolidation

The current 16 artifact types collapse into 7 types + threads + planner:

**Canvas artifacts (persistent, editable, rendered on workspace):**

1. **Note** — Quick notes, study notes. Markdown-based. Touch tier: inline minimal markdown editor (bold, italic, headings, basic lists). Deep Edit: full block editor with slash commands, tables, embeds. Replaces current `note` type.

2. **Visual** — SVG diagrams, charts, interactive HTML, concept maps, images. Rendered output at Touch tier. Interactive if the visual has controls. Deep Edit: source code editor + live preview, or "regenerate with AI." Replaces current `diagram`, `visualization`, `concept_map`, `image` types.

3. **Code** — Code files, scripts, outputs. Touch tier: syntax highlighted with basic editing via CodeMirror minimal. Deep Edit: full editor with language picker, AI suggestions. Replaces current `code_project`, `code_output` types.

4. **Export** — Generated Word, PowerPoint, PDF files. Touch tier: thumbnail preview with download link. Deep Edit: regenerate or modify via AI. Replaces current `document` type (note: the "document" study mode creates Export artifacts, NOT Note artifacts — this naming distinction is critical).

5. **Board** — Freeform drawing, whiteboard. Touch tier: mini canvas preview (read-only). Deep Edit: full drawing surface in panel. Currently a placeholder (`whiteboard` type exists but has no editor) — implement properly or defer to V2.

**Interactive artifacts (have state, need special renderers):**

6. **Flashcard Deck** — Collection of front/back cards with SRS state per card. Touch tier: shows card count + due count + "Review" button. Deep Edit: flip-card review interface with SRS quality rating. Has `easeFactor`, `interval`, `repetitions`, `nextReviewAt` per card. Preserves existing SM-2 spaced repetition algorithm.

7. **Quiz** — Questions with answers, scoring, attempt history. Touch tier: shows score summary or "Not attempted". Deep Edit: take quiz or review results. Has `QuizAttempt` records with per-question answers.

**Not artifacts (separate entities):**
- Thread — Chat conversation (lives in `chats` table, rendered as workspaceItem)
- Planner Task — Deadline/milestone/goal (lives in `plannerItems` table, rendered as workspaceItem)

**Type mapping from old to new:**
- `note` → Note
- `document` → Export
- `study_plan` → Note (subtype: plan) or Planner integration
- `timetable` → Planner integration
- `flashcard_deck` → Flashcard Deck
- `code_project` → Code
- `code_output` → Code (subtype: output)
- `diagram` → Visual
- `visualization` → Visual
- `concept_map` → Visual
- `image` → Visual (subtype: image)
- `bookmark` → Note (subtype: reference)
- `collection` → removed (use workspace grouping instead)
- `whiteboard` → Board
- `quiz` → Quiz
- `custom` → Board or Note depending on content

### 2.2 Artifact-to-WorkspaceItem Auto-Creation

**Critical fix:** Currently, when an artifact is generated from a chat, the workspaceItem is NOT created until `syncArtifactWidgets` runs on workstream commit. This means the user doesn't see new artifacts on their canvas until they navigate away and back.

**Required behavior:** Artifact created → workspaceMutation recorded → workspaceItem created immediately → `workspace-content-mutated` event fired → canvas updates in real-time. The artifact should appear on the canvas within the same streaming response that created it.

### 2.3 Editor Modes Simplification

Current editor modes (`standard`, `ai_enhanced`, `ai_authoring`, `simple`, `notion`, `agentic`) should consolidate to:
- `standard` — Default editing for Touch tier (minimal toolbar)
- `full` — Deep Edit panel (full toolbar, slash commands, formatting)
- `ai` — AI editing mode (diff view, accept/reject changes)

The `agentic` and `notion` modes are removed. The Touch tier editor is always `standard`. The Deep Edit panel editor is `full` or `ai` depending on whether the user is editing manually or via AI.

### 2.4 Version History and AI Edit Flow

Preserve the existing version history system:
- `applyAiEdit` → creates version with status "applied"
- `confirmAiEdit` → status "confirmed"
- `discardAiEdit` → restores previous content, status "discarded" (**FIX: currently has a TODO and doesn't actually call the mutation**)
- `reapplyAiEdit` → re-applies a discarded edit

Expose undo via Cmd+Z as keyboard shortcut (uses the existing `workspaceMutations` table). No visible undo UI needed for V1 — keyboard shortcut is sufficient.

---

## Part 3: The Modes → Skills Transformation

### 3.1 Why Modes Must Change

Current modes are mutually exclusive — the user (or system) picks ONE mode per response. But a single response often needs multiple capabilities: explain a concept, create a diagram, generate flashcards, suggest practice questions. Modes as discrete states force false choices and lead to wrong classifications.

### 3.2 Skills Architecture

Modes become composable skills — prompt fragments + tool permissions that can be stacked. The LLM classifier (see Section 5) selects which skills to load for each request. Multiple skills can be active simultaneously.

**Skill categories and members:**

| Category | Skills | What Each Provides |
|----------|--------|-------------------|
| Teaching | `socratic` (guided questioning), `explain` (Feynman method), `review` (rubric feedback, Bloom's taxonomy) | Pedagogical approach in system prompt |
| Assessment | `quiz` (create/grade quizzes), `flashcard` (create SRS cards), `exam` (timed practice) | Structured output formats, quiz/flashcard parsing |
| Creation | `visual` (SVG/HTML diagrams — THE SPECTRA VISUAL SKILL), `document_export` (Word/PPT/PDF generation), `code` (syntax highlighting, execution), `image_gen` (image generation) | Creation tools, format-specific guidance |
| Tools | `search` (web retrieval via Tavily), `memory` (context recall), `retrieval` (RAG over resources) | External data access |
| Formatting | `latex` (math notation), `mermaid` (auto-generated diagrams) | Output formatting guidance |
| Planning | `study_plan` (AI-generated schedules), `planner` (task management, deadline creation) | Structured planning output |
| Coaching | `draft_coach` (iterative writing revision) | Writing process guidance |

**Each skill is a SKILL.md file** stored in the skills directory. Unlike the current 5-bullet-point skills, these must be comprehensive — detailed guidance, examples, output format specifications, and constraints. Look at Anthropic's official frontend-design skill (~43 lines of detailed guidance) as the minimum quality bar. The Spectra Visual Skill specifically needs to include the full design token system (color ramps, typography, SVG conventions, dark mode handling) similar to what powers Claude's inline visualizations.

**Skill injection flow:**
1. LLM classifier analyzes the prompt (see Section 5)
2. Returns a list of skill IDs to load
3. Pipeline reads the SKILL.md files for each selected skill
4. Skill content injected into the system prompt alongside the base policy prompt
5. Corresponding tool bundles enabled for the active skills

**The mode selector in the UI becomes optional** — a power-user override. For 90% of interactions, the classifier handles skill selection. The selector can remain as a dropdown in the chat composer for users who want explicit control: "I specifically want quiz mode right now."

**Skills that already exist in the ecosystem to investigate and potentially adopt/adapt:**
- Anthropic's official `frontend-design` skill (for Spectra's own UI development)
- `impeccable` skill from pbakaus (enhanced frontend design with /audit, /polish commands)
- Vercel's `web-design-guidelines` skill (UI correctness, accessibility, 100+ rules)
- Excalidraw diagram generation skill
- The `skill-creator` meta-skill (for creating new skills)
- Various MCP servers for potential tool integrations

The agent implementing this should research the current skills ecosystem (https://github.com/anthropics/skills, https://github.com/heilcheng/awesome-agent-skills, https://lobehub.com/skills) and identify additional skills that could enhance Spectra's capabilities — both for the coding agents building Spectra AND for Spectra's own AI agents serving students.

### 3.3 What Happens to Existing Mode-Specific Features

- **Quiz parsing** (`quiz-parser.ts`): Becomes part of the `quiz` skill. The parsing logic stays, but is triggered by skill activation rather than mode selection.
- **Flashcard parsing** (`flashcard-format.ts`): Becomes part of the `flashcard` skill. SM-2 algorithm preserved.
- **Document generation** (`generateArtifactResources`): Becomes part of the `document_export` skill.
- **Image generation**: Becomes the `image_gen` skill.
- **Mode-specific system prompts** (from `policy.ts`): Each skill's SKILL.md replaces the mode-specific prompt sections.
- **Learning context** (`learningContext` field on chats): Still carries state across skill activations. When the `quiz` skill activates, it reads `quizableFacts` from learning context. When `flashcard` skill activates, it reads `flashcardCandidates`.
- **Mode-specific contracts** (`studyModes.ts`): Each skill defines its own contract within its SKILL.md.

---

## Part 4: Quick Chat Scope and Behavior

### 4.1 Scope as Hint, Not Constraint

The quick chat should be able to do ANYTHING from ANYWHERE. The workspace context influences the classifier's default assumptions but never limits what the user can do.

When inside the Physics workspace and the user asks about calculus, the system should handle it — either answering in place or gently suggesting: "This looks like a Math question — want me to add it to your Math workspace?" But it never blocks the request.

### 4.2 Scope Context per Zoom Level

The LLM classifier receives context about where the user is:

**All-workspaces view:**
```json
{ "scope": "global", "activeWorkspaces": ["Physics HL", "Math AA", "TOK Essay", ...] }
```
Handles: workspace-level operations, cross-workspace queries, general questions

**Inside a workspace:**
```json
{ "scope": "workspace", "workstream": "Physics HL", "items": [...summaries] }
```
Handles: creating items in this workspace, questions about this subject, editing existing items

**Deep Edit panel open (focused on artifact):**
```json
{ "scope": "artifact", "artifactType": "note", "title": "Waves Notes", "contentPreview": "..." }
```
Handles: editing instructions are default, questions answered without editing

### 4.3 Context Injection — Selective, Not Exhaustive

Do NOT dump all memory and context into the system prompt — this confuses models. Instead, inject only what the active skills require:
- `socratic` skill: needs workstream memory (topics covered, misconceptions)
- `quiz` skill: needs learning context (quizable facts)
- `document_export` skill: needs almost no context
- `visual` skill: needs the Spectra design tokens
- `memory` skill: needs embedding-based retrieval results

The classifier's output determines which skills are active, and each skill has a defined context budget.

### 4.4 Quick Chat Workspace Detection

Keep the existing workspace auto-detection but add a visible indicator: when in a workspace, the quick chat input shows a subtle badge with the workspace name and a small "x" to clear the scope. If the AI detects a message belongs to a different workspace, show an inline suggestion in the response (not a blocking modal).

Moving items between workspaces should be easy: right-click → "Move to workspace..." opens a picker. Backend: updates `workspaceItem.workstreamId` + records mutation for undo.

---

## Part 5: LLM Classifier (Replacing Regex Routing)

### 5.1 Why the Current System Fails

The current routing is overwhelmingly keyword-based:
- `classifyComplexity()` — word count + verb matching
- `detectSuggestedMode()` — 12 regex tests
- `detectSearchIntent()` — keyword scan
- `classifyRequest()` — signal score thresholds

This means "help me understand wave interference patterns" might be classified as simple/T0 because it doesn't contain HIGH_THINKING_MARKERS like "prove" or "derive."

### 5.2 The Replacement: One Cheap LLM Call

A single structured JSON call to a cheap, fast model (Qwen3, DeepSeek V3, or similar — ~$0.30/M input tokens, ~$0.0003 per classification) replaces ALL regex stages.

**Input to classifier:**
```json
{
  "message": "the user's message",
  "scope": { "level": "workspace", "workspace": "Physics HL", "items": [...] },
  "conversationHistory": "last 3 exchanges summary",
  "availableSkills": ["socratic", "quiz", "flashcard", "visual", ...],
  "availableAgents": [{ "name": "Physics Agent", "topics": [...] }],
  "userPreferences": { "learningStyle": "visual", "communicationStyle": "casual" }
}
```

**Output from classifier:**
```json
{
  "tier": "T2",
  "skills": ["socratic", "visual"],
  "needsSearch": false,
  "needsMemory": true,
  "needsRag": false,
  "workspaceTarget": "current",
  "agentId": "physics-agent-id or null",
  "outputFormat": "explanation_with_visual",
  "thinkingLevel": "high",
  "confidence": 0.85
}
```

### 5.3 T0 Short-Circuit (Preserved)

T0 bypasses the LLM classifier for trivially simple messages:
- Message under 15 characters
- Matches known filler pattern: `/^(ok|yes|no|thanks|got it|sure|hi|hello|cool|nice|wow|hm+|ah+|lol|yep|nope)$/i`
- No attachments
- Not the first message

Everything else — even a 5-word substantive question — goes through the LLM classifier. Short messages can be deeply complex; the classifier understands this, regex doesn't.

### 5.4 Prompt Enhancement Integration

The existing `maybeEnhancePrompt()` function should still run for non-T0 requests, but AFTER the classifier (so the classifier sees the original message, and the enhanced version goes to the generation model). The 2-second timeout fallback is preserved.

### 5.5 Model Selection

The existing phase router scoring system is preserved but simplified. The classifier's `tier` and `thinkingLevel` output feeds into model selection. The key constraint: only use cheap models (Chinese/open-weight flagships: DeepSeek, Qwen, Kimi, MiniMax, GLM, Mistral, Meta Llama, ByteDance, Inception, Arcee, plus Gemini Flash). Expensive provider models (Claude, GPT-4o, etc.) are NOT available except potentially their free-tier versions on OpenRouter.

Background tasks (memory extraction, workspace sorting, topic clustering, ghost suggestion generation, title generation) should use the absolute cheapest model available.

The existing model catalog caching and OpenRouter integration is preserved.

---

## Part 6: AI Companion Features

### 6.1 Ghost Items

Semi-transparent suggested items that the AI places on the canvas. They appear at 40% opacity, hover to 60%, accepted (tap +) to 100%.

**Triggers:**
- Gap detection: "You have notes + threads on Waves but no practice questions"
- Deadline proximity: "IA draft due in 3 days — create a checklist?"
- Spaced repetition: "You studied entropy 8 days ago. Review session?"
- Pattern learning: "You always start with notes then switch to questions — ready?"
- Content connection: "Your TOK essay mentions ethics of AI — link to CS notes?"
- Incomplete work: "Your last thread on optics ended mid-question. Continue?"

**Constraints (critical):**
1. Never more than 2 visible ghosts at a time — more feels like nagging
2. No ghosts during active editing (user is focused on an item, suppress ghosts; show when user pauses or zooms out)
3. Ghosts expire after 2 sessions unseen
4. Ghost generation runs on cheapest model, async — background batch job, not inline with user actions

**Lifecycle:** Appear (fade in, 40%) → Accept (tap +, becomes real at 100%) OR Dismiss (swipe/X/ignore) → If dismissed, AI logs the preference and reduces similar suggestions

**Backend:** Ghost suggestions are pre-computed and cached. A background job scans workstreams periodically (e.g., every 6 hours or on significant content change) and generates suggestions using the cheapest model. Suggestions stored with a timestamp and displayed when the user opens the workspace.

### 6.2 AI Auto-Creation (Confidence Tiers)

The AI creates things automatically based on confidence:

**High confidence (auto-execute, no user confirmation needed):**
- Auto-sorting a new thread into the correct workspace based on content
- Creating a planner item when user says "I need to finish this by Friday" in a chat
- Updating workspace memory after a conversation
- Assigning an appropriate agent to a new thread

**Medium confidence (ghost items):**
- Suggesting new artifacts: "Practice questions for Waves?"
- Suggesting workspace reorganization: "Your IA deadline is in 3 days — create a plan?"
- Suggesting connections between items

**Low confidence (ask via chat):**
- Ambiguous workspace assignment: "I noticed you mentioned both thermo and waves — separate groups?"
- Complex reorganization proposals

**Provenance tracking:** Every auto-created item gets `provenanceSource: "ai"` and is shown with a subtle visual indicator (small sparkle icon or different tint) so users can always tell AI-created vs user-created. All auto-created items are undoable through the mutation system.

### 6.3 Status Indicators (Alive Workspace)

Items on the canvas show life:
- Pulsing dot on recently edited items (within last hour)
- Deadline badge on artifacts linked to planner items ("IA draft — 3 days left")
- Small sparkle on AI-generated content not yet reviewed
- Progress indicator on flashcard decks (due cards / total)
- Score badge on quizzes (last attempt percentage)

### 6.4 Semantic Topic Clustering (For "By Topic" View)

**Pipeline:**
1. Every artifact/thread already has `contentPlaintext`. Embed it using cheap embedding model (768-dim, e.g., nomic-embed-text)
2. Debounce: re-embed 30s after last edit
3. Cluster using HDBSCAN or k-means on embeddings within a workspace (pure vector math, no LLM needed)
4. Name clusters using cheap LLM call: "Name this group of items in 2-3 words"
5. Store cluster assignments on workspaceItems (new field: `topicCluster`)
6. Frontend reads cluster assignments, renders tint zones per cluster

**Re-clustering schedule:** Not on every edit. Batch: every 6 hours or when 3+ new items added. User can force: right-click group → "Re-organize with AI". First time opening "By Topic" view → cluster if never done before.

**User corrections as anchors:** User drags item from "Waves" to "Quantum" → override saved. Future clustering respects user overrides. User renames a topic group → name persists through re-clustering.

---

## Part 7: Agent System Improvements

### 7.1 Agent as Workspace Companion

When a workspace has a `linkedAgentId`, that agent is automatically available in every chat within that workspace. No manual selection needed. The agent's resources feed into RAG retrieval automatically.

### 7.2 Semantic Agent Matching

Replace current token-overlap matching with embedding-based cosine similarity. Use the same cheap embedding model as workspace clustering. Much more accurate and uses the same infrastructure.

### 7.3 Agent-Specific Ghost Items

A physics agent linked to a Physics workspace can generate ghost items based on its resources (syllabus, curriculum structure): "You haven't covered Topic 7 (Atomic physics) yet — start notes?"

### 7.4 Agent Visual Identity

Subtle visual indicator on the workspace when an agent is active — small avatar or color accent on the quick chat bar.

---

## Part 8: Visualization Pipeline

### 8.1 The Spectra Visual Skill

A comprehensive SKILL.md file that gets injected into the agent's system prompt when the classifier detects visual intent (`outputFormat: "visual"` or skills include `visual`).

**Must include:**
- Spectra's design token set (colors, fonts, spacing, border radii)
- SVG viewBox convention (consistent width, flexible height)
- Color ramp system with dark mode handling
- Typography rules (sizes, weights, line heights)
- Examples of expected output quality (at least 3-4 concrete SVG examples)
- Rules for interactive HTML artifacts (what's allowed in the iframe sandbox)
- Constraints: no external API calls, libraries must load from jsdelivr CDN

**The skill should be comprehensive (2000-3000 tokens)** — not the current 5-bullet-point placeholder. Reference Anthropic's frontend-design skill as the quality bar for skill authoring.

### 8.2 Dual Render Flow

When AI generates a visual in a chat:
1. Renders inline in the chat thread (immediate feedback)
2. Simultaneously created as a Visual artifact in the workspace
3. WorkspaceItem auto-created (see Section 2.2)
4. Appears on canvas in the appropriate group

### 8.3 Iframe Sandbox (Current State — Preserve)

Current CSP allows: inline scripts, eval (for Babel/React), jsdelivr CDN, blob workers. Blocked: external API calls, arbitrary CDN, cross-origin iframes, WebSockets.

This is sufficient for D3, Chart.js, Mermaid, Pyodide, React/JSX, and pure SVG. Preserve as-is. Add: postMessage origin validation, subresource integrity on CDN assets.

---

## Part 9: Planner Integration

### 9.1 Workspace-Level Planner

The planner is both a workspace-level feature AND a hub-level feature:

**Within a workspace:** Planner tasks appear as items on the canvas, rendered at Touch tier with toggle done/undone, deadline badges, priority dots. Grouped with other items in the current view mode.

**Hub-level planner (persistent hub item):** Aggregates planner items from ALL workspaces. Shows upcoming deadlines grouped by time: Today, Tomorrow, This Week, Later. Click a task → navigates to its workspace and highlights it. Integrates with ManageBac deadlines when available.

### 9.2 Planner Types

Preserve existing: `deadline`, `milestone`, `goal`, `reminder`. Preserve statuses: `pending`, `in_progress`, `completed`, `cancelled`. Preserve priorities: `low`, `medium`, `high`.

### 9.3 What NOT to Build

Do NOT build a full calendar/Gantt view. Do NOT build task dependencies. Do NOT build recurring tasks. Keep it simple: a sorted, grouped list with due dates and priorities. This is not Outlook — it's a focused study planner.

---

## Part 10: Systems to Preserve

These existing systems should be preserved and integrated, not rebuilt:

### 10.1 Gamification
- XP earned per activity, tracked in Convex
- Streaks (consecutive days of activity)
- Achievements (unlocked badges with XP rewards)
- Focus timer sessions award XP
- Surface subtly: small XP indicator in workspace toolbar, toast notifications for achievements

### 10.2 Personal Soul
- Persistent user preferences (learning style, difficulty, communication style)
- Feeds into LLM classifier: visual learner → more likely to load `visual` skill
- Affects ghost items: student who prefers flashcards sees more flashcard-related ghosts
- Onboarding flow preserved

### 10.3 Packs System
- Teacher-created resource collections linked to agents
- Resources feed into RAG retrieval for workspace threads
- Preserved as-is

### 10.4 Memory System
- User-level memory (userMemoryEntries) with embedding-based retrieval
- Workstream-level memory (workstreamMemory) per workspace
- Freshness/confidence decay system
- Memory extraction from chat via AI (post-process)
- Selective injection based on active skills (not dumping everything)

### 10.5 ManageBac Integration
- Student sync, assignment import, deadline sync (all partial)
- ManageBac deadlines should appear in the hub planner
- ManageBac classes can auto-create workspaces
- Preserve existing integration points, improve sync reliability

### 10.6 Verification System
- Post-generation validation for high-stakes responses
- Preserved as-is

### 10.7 Notifications
- Achievement notifications, reminders, system announcements
- Ghost item dismissals should log for future suggestion tuning

### 10.8 Resource Management
- File upload/download via Convex storage
- Document export formats (docx, pdf, pptx, html)
- Storage limits per tier

---

## Part 11: Frontend State Changes

### 11.1 Workspace Store Updates

The Zustand `workspace-store.ts` needs these additions/changes:

**New fields:**
- `viewMode: "byType" | "byTopic" | "timeline"` (global, persisted)
- `ghostItems: Map<workstreamId, GhostItem[]>` (cached suggestions)
- `focusedItemId?: string` (which item has the Touch-tier focus ring)
- `studySurfaceActive: boolean` (V2, but define the field now)

**Modified fields:**
- `zoomBand` — recalibrate thresholds for new canvas spacing
- `viewMode` — replace current `"structured" | "columns" | "graph"` with new view modes

**Removed:**
- `commandModeOpen` (replaced by Cmd+K behavior)
- `utilityRevealOpen` (replaced by hub items system)

### 11.2 Chat State Split

The current 3,700-line `use-chat-state.ts` must be split into smaller hooks/stores:
- Message state (messages, streaming, active streams)
- Routing state (route trace, model info, phase progress)
- Attachment state (file list, upload progress)
- Composer state (mode, agent, model selection)

### 11.3 LocalStorage Keys

Persist to localStorage:
- `viewMode` (global view toggle)
- `hubItemPositions` (where user-added hub items are placed)
- `workspace:viewport` (camera position per workspace — already exists)
- `backgroundMode` (already exists)

---

## Part 12: Known Issues to Fix During Redesign

1. **`handleDiscard()` TODO** in `artifact-ai-surface.tsx:100-104` — must actually call the discard mutation
2. **Content cache never evicts** — implement LRU with max 5-7 workspaces
3. **No automatic workspaceItem creation** from chat-generated artifacts
4. **Workspace suggestion is reactive, not proactive** — `suggestWorkspaceFromTopic` only called as LLM tool, not in pipeline
5. **Clarification system** — code exists but unclear if fully functional, needs verification
6. **Undo/redo** — mutation system exists but no UI. Add Cmd+Z keyboard shortcut
7. **Expensive models still being used** for background tasks — route ALL background tasks to cheapest available model
8. **ManageBac integration** — partially implemented, needs reliability improvements

---

## Part 13: Wave Structure

### Wave 1: Foundation — Canvas + Artifact Types + Basic Rendering

**BACKEND FIRST:**
- Implement artifact type consolidation (16 → 7 types) in schema and API
- Build the LRU content cache replacing unbounded `contentCacheRef`
- Fix artifact-to-workspaceItem auto-creation pipeline
- Fix `handleDiscard()` TODO
- Implement batched Convex queries for workspace content
- Add `viewMode` and `topicCluster` fields to schema
- Implement the workspace mutation Cmd+Z undo handler

**THEN FRONTEND:**
- Recalibrate canvas spacing (larger workstream coordinates)
- Implement new zoom thresholds with proper spacing
- Build Glance-tier renderers for all 7 artifact types + Thread + Planner
- Implement background tint zones with soft gradient edges
- Implement workspace dock (hub item: workspace selector)
- Implement basic quick chat (bottom hub item, no scope changes yet)
- Implement "+" radial menu
- Implement timer hub item

**VALIDATION GATE:** User can navigate between workspaces with smooth zoom. All artifact types render at Glance tier. Tint zones visible. Hub items present. Content loads without errors. No inline editing yet.

### Wave 2: Interaction — Touch Tier + Context Menus + Search

**BACKEND:**
- Build Cmd+K search index (over `contentPlaintext` and thread messages)
- Implement right-click context menu API endpoints (move to workspace, duplicate, archive)
- Implement batch position updates for drag operations

**FRONTEND:**
- Implement Touch-tier inline editing for Notes (minimal markdown editor with focus ring)
- Implement Touch-tier inline editing for Code (CodeMirror minimal)
- Implement Touch-tier rendering for all other types (Visual renders, Thread shows last exchanges, etc.)
- Implement Cmd+K command palette with search, navigation, and commands
- Implement right-click context menus on three targets (empty canvas, items, groups)
- Implement the expanded/collapsed toggle for hub items
- Implement overflow handling (+N more pills)

**VALIDATION GATE:** User can click a Note on the canvas and start typing. Cmd+K searches across workspaces and navigates to results. Right-click menus work on all three targets. Items can be moved between workspaces via right-click.

### Wave 3: Intelligence — LLM Classifier + Skills + Ghost Items

**BACKEND (CRITICAL — MOST IMPORTANT WAVE):**
- Build the LLM classifier (single cheap model call replacing all regex routing)
- Convert all modes to skill SKILL.md files (comprehensive, not 5 bullet points)
- Build the Spectra Visual Skill with full design token system
- Build the skill injection pipeline (classifier output → load skills → inject into system prompt)
- Implement ghost item generation (background batch job on cheapest model)
- Implement ghost item storage and retrieval
- Implement AI auto-creation with confidence tiers
- Implement semantic agent matching (embedding-based)
- Route ALL background tasks to cheapest model
- Implement the T0 short-circuit (filler message detection)

**FRONTEND:**
- Implement ghost items (40% opacity appear, hover 60%, accept 100%, dismiss)
- Implement ghost item constraints (max 2 visible, suppress during editing)
- Implement status indicators (pulsing dots, deadline badges, sparkles)
- Implement provenance indicators (AI-created vs user-created)
- Update quick chat to show workspace scope badge
- Update mode selector to be optional override (skills are default)

**VALIDATION GATE:** Sending a message correctly classifies tier, selects skills, and routes to appropriate model WITHOUT regex. Ghost items appear on workspace with proper lifecycle. Skills are loaded from SKILL.md files. Visual skill produces themed SVGs. Background tasks use cheap models only.

### Wave 4: Views + Polish — By Topic + Timeline + Focus Mode

**BACKEND:**
- Implement semantic clustering pipeline (embed → cluster → name)
- Build cluster assignment storage and retrieval
- Implement timeline data aggregation (items by date)
- Implement user correction anchoring for topic clusters
- Implement re-clustering scheduler (batch, every 6 hours or 3+ new items)

**FRONTEND:**
- Implement "By Type" view (default, already partially working from Wave 1)
- Implement "By Topic" view (reads cluster assignments, renders tint zones per topic)
- Implement "Timeline" view (horizontal timeline, grouped by day)
- Implement view toggle in workspace toolbar (segmented control, global setting)
- Implement focus mode (timer active → workspace dims except current item, quick chat becomes context-aware)
- Polish tint zone gradients (soft edges, not hard rectangles)
- Polish zoom transitions (progressive detail gain/loss, smooth animations)
- Polish the deep edit panel (dim canvas, highlight targeted item)

**VALIDATION GATE:** All three views render correctly. By Topic shows AI-generated topic groups. User can drag items between topics (creates override). Timeline shows items by date. Focus mode activates with timer.

### Wave 5: Integration — Agents + Gamification + Planner + Polish

**BACKEND:**
- Implement agent-as-workspace-companion (auto-available agent per workspace)
- Implement agent-specific ghost items
- Connect gamification XP to workspace activity
- Implement hub planner (aggregates planner items from all workspaces)
- Improve ManageBac integration reliability
- Implement Soul preference integration with classifier

**FRONTEND:**
- Implement agent visual identity on workspace
- Implement gamification indicators (XP badge, streak display, achievement toasts)
- Implement hub planner panel (collapsible, grouped by time period, navigates on click)
- Implement workspace templates (AI-inferred from title on creation)
- Final polish pass on all animations, transitions, and visual consistency
- Ensure all design tokens are consistent across the entire workspace

**VALIDATION GATE:** Full end-to-end flow works: user opens app → lands in last workspace → sees content with status indicators → creates items via + menu or right-click → edits inline at Touch tier → asks AI via quick chat → AI uses correct skills → artifacts appear on canvas → ghost items suggest next steps → planner shows deadlines → XP awarded.

---

## Part 14: Critical Implementation Notes

### 14.1 Tech Stack
- Frontend: Next.js, React, ReactFlow (@xyflow/react), Zustand, TipTap (for note editing), CodeMirror (for code editing)
- Backend: Convex (database, real-time subscriptions, file storage, vector search)
- AI: OpenRouter (model API), Tavily (web search)
- Auth: Clerk
- The codebase is TypeScript throughout

### 14.2 Cost Constraints
- Budget: ~€9-10/month per user
- Models: ONLY cheap/open-weight models (DeepSeek, Qwen, Kimi, MiniMax, GLM, Mistral, Meta Llama, ByteDance, Inception, Arcee, Gemini Flash)
- NO expensive provider models (Claude, GPT-4o) except potentially free-tier versions
- Background tasks: absolute cheapest model available
- Embeddings: cheapest available (nomic-embed-text or similar, 768-dim)

### 14.3 What NOT to Build
- Mobile layout (desktop only)
- Study surface (V2 — but define the data model field now)
- Cross-workspace connections (V2)
- Full calendar/Gantt view for planner
- Task dependencies or recurring tasks
- Board/whiteboard editor (list the type, show placeholder, implement V2)

### 14.4 File Locations (Current Codebase)

| System | Key Files |
|--------|-----------|
| Canvas | `src/components/workspace/workspace-canvas.tsx` |
| Panel | `src/components/chat/unified-panel.tsx` |
| Chat | `src/components/chat/chat-composer.tsx`, `src/components/chat/chat-messages.tsx` |
| Routing | `src/lib/routing/phase-router.ts`, `src/lib/auto-settings.ts` |
| Pipeline | `src/lib/orchestrator/pipeline.ts`, `src/lib/orchestrator/pipeline-controller.ts` |
| Artifacts | `convex/artifacts.ts`, `src/lib/artifact-types.ts` |
| Workspace Items | `convex/workspaceItems.ts` |
| Workspace Orchestration | `convex/workspaceOrchestration.ts` |
| Memory | `src/lib/orchestrator/post-process.ts` |
| Skills | `src/lib/skills/skill-registry.ts`, `public/skills/*.md` |
| Modes | `src/lib/modes.ts`, `src/lib/contracts/studyModes.ts` |
| Agents | `src/lib/agent-matching.ts` |
| State | `workspace-store.ts`, `use-chat-state.ts` |
| Schema | `convex/schema.ts` |

### 14.5 Design Tokens (For Consistent Theming)

The design language document should be created as part of Wave 1. Key values:

**Tint zones:** 6-8% opacity of neutral color, soft gradient edges
**Focus ring:** Cyan (#00d4ff), 2px solid, 2px offset
**Ghost items:** appear=40%, hover=60%, accepted=100% opacity
**Status indicators:** loading=cyan pulse, error=rose static, warning=amber static, success=emerald fade-in
**Animation durations:** instant=50ms, fast=150ms, normal=250ms, slow=400ms
**Easing:** default=cubic-bezier(0.4, 0, 0.2, 1), spring=cubic-bezier(0.34, 1.56, 0.64, 1)
**Border radius:** sm=6px, md=10px, lg=16px, xl=24px
**Font stack:** Inter (or system), JetBrains Mono for code

---

## Part 15: Spec Generation Instructions

When generating the spec from this context, ensure:

1. **Every wave has explicit validation gates** — a list of concrete, testable criteria that must pass before the next wave begins

2. **Backend-first for each wave** — logic and data model changes before UI. The spec should clearly separate backend tasks from frontend tasks within each wave, with backend completing first

3. **No oversimplification** — the agent must not simplify or skip details. Every system mentioned in this document must appear in the spec. If a system is marked "preserve as-is," the spec should note what to preserve and what integration points to maintain

4. **Skills research** — the spec should include a task to research and evaluate existing skills from the ecosystem (Anthropic, Vercel, community) that could be adopted or adapted for Spectra's needs

5. **Cross-wave dependencies must be explicit** — Wave 3 depends on Wave 1's artifact types being in place. Wave 4 depends on Wave 3's classifier. The spec must track these dependencies

6. **Testing considerations** — each wave should include testing strategy: unit tests for backend logic, integration tests for pipelines, visual regression for UI components

7. **The spec is not code** — it's a detailed description of WHAT to build, not HOW. The implementing agents have access to the full codebase and will determine implementation details. The spec should describe behavior, data flow, and user experience in sufficient detail that the implementing agent cannot misinterpret the intent, yet it should contain visualisations and thorough explanations to avoid confusion, and to encourage implementation agents to work hard rather than be lazy

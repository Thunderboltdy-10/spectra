# AI School Assistant - Complete Technical Specification

This document provides exhaustive details about every feature, functionality, algorithm, and architectural decision in the AI School Assistant application. This specification is designed to enable complete replication of the system.

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture & Stack](#2-architecture--stack)
3. [Database Schema](#3-database-schema)
4. [Study Modes System](#4-study-modes-system)
5. [Model Routing & Orchestration](#5-model-routing--orchestration)
6. [Chat System](#6-chat-system)
7. [RAG & Retrieval](#7-rag--retrieval)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Frontend Components](#9-frontend-components)
10. [API Routes](#10-api-routes)
11. [Auto-Settings Pipeline](#11-auto-settings-pipeline)
12. [Prompt Engineering](#12-prompt-engineering)
13. [Resource Management](#13-resource-management)
14. [Agent System](#14-agent-system)
15. [Analytics & Usage Tracking](#15-analytics--usage-tracking)
16. [Configuration Files](#16-configuration-files)

---

## 1. Project Overview

The AI School Assistant is a comprehensive educational AI platform built with Next.js, Convex, and OpenRouter. It provides students and teachers with an intelligent chat interface featuring multiple study modes, automatic model routing, RAG-based retrieval, and customizable AI agents.

### Core Capabilities

- **9 Study Modes**: Tutor, Marker, Exam, Draft Coach, Quiz, Flashcard, Research, Explain, General
- **Intelligent Model Routing**: Automatically selects the best AI model based on task complexity, mode, and user constraints
- **RAG Retrieval**: Vector search over uploaded educational resources with citations
- **Custom Agents**: User-created AI personas with specialized knowledge bases
- **Multi-Modal Support**: Handles text, PDF, DOCX, and image attachments
- **Budget Management**: Token tracking and spending tier enforcement
- **Memory System**: Extracts and persists student learning preferences

---

## 2. Architecture & Stack

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 16.1.6 + React 19.2.3 | App Router, SSR, UI rendering |
| Styling | TailwindCSS 4 + Custom CSS | Styling with CSS variables for theming |
| Backend | Convex | Serverless database, actions, mutations, queries |
| Authentication | Clerk (with local fallback) | User authentication and session management |
| AI Models | OpenRouter | Unified API for 100+ AI models |
| Embeddings | OpenRouter | Vector embeddings for RAG |
| File Storage | Convex Storage | PDF, DOCX, TXT file storage |
| UI Components | Radix UI | Accessible UI primitives |

### Project Structure

```
<local-workspace>
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API routes
│   │   ├── agents/            # Agent pages
│   │   ├── models/            # Model explorer page
│   │   ├── admin/             # Admin console
│   │   ├── analytics/         # Analytics dashboard
│   │   ├── page.tsx           # Main chat page
│   │   ├── layout.tsx         # Root layout
│   │   └── globals.css        # Global styles
│   ├── components/
│   │   ├── chat/              # Chat-related components
│   │   ├── agents/            # Agent components
│   │   ├── analytics/         # Analytics components
│   │   ├── layout/            # Layout components
│   │   └── ui/                # UI primitives
│   ├── hooks/                 # React hooks
│   ├── lib/                   # Utility libraries
│   │   ├── contracts/         # Type contracts
│   │   ├── orchestrator/      # Response composition
│   │   ├── prompts/           # Prompt engineering
│   │   └── routing/           # Model routing
│   └── types/                 # TypeScript types
├── convex/                    # Convex backend
│   ├── schema.ts             # Database schema
│   ├── *.ts                  # Backend functions
│   └── _generated/           # Auto-generated types
└── scripts/                   # Utility scripts
```

---

## 3. Database Schema

The database uses Convex with the following tables defined in `convex/schema.ts`:

### 3.1 orgs
Organizations/schools in the system.

```typescript
{
  name: string;              // Organization name
  slug: string;              // URL-friendly identifier
  tokenBudgetDaily: number;  // Daily token limit
  verifyMarkerPassEnabled: boolean;  // Enable marker verification
  allowPaidModels?: boolean; // Allow non-free models
  createdAt: number;
  updatedAt: number;
}
```

### 3.2 users
User accounts linked to Clerk authentication.

```typescript
{
  clerkId: string;           // Clerk user ID
  email: string;
  name: string;
  role: "student" | "teacher" | "admin";
  orgId: Id<"orgs">;
  createdAt: number;
  updatedAt: number;
}
```

### 3.3 packs
Class/workspace containers for educational resources.

```typescript
{
  orgId: Id<"orgs">;
  ownerUserId: Id<"users">;
  name: string;
  subject: string;
  academicYear: string;
  strictness: "hard" | "medium" | "soft";
  defaultModel?: string;
  allowedModels: string[];
  guidelinesSummary?: string;
  guidelinesTopicMap: string[];
  guidelinesRubricHints: string[];
  guidelinesMisconceptions: string[];
  createdAt: number;
  updatedAt: number;
}
```

### 3.4 resources
Uploaded files (PDF, DOCX, TXT) for RAG.

```typescript
{
  orgId: Id<"orgs">;
  ownerUserId: Id<"users">;
  packId?: Id<"packs">;
  agentId?: Id<"agents">;
  scope: "pack" | "personal" | "agent";
  filename: string;
  mimeType: string;
  size: number;
  storageId?: Id<"_storage">;
  parsedCharCount: number;
  status: "uploaded" | "processed" | "failed";
  error?: string;
  createdAt: number;
  updatedAt: number;
}
```

### 3.5 chunks
Vector-searchable text segments from resources.

```typescript
{
  orgId: Id<"orgs">;
  packId?: Id<"packs">;
  agentId?: Id<"agents">;
  ownerUserId?: Id<"users">;
  scope: "pack" | "personal" | "agent";
  resourceId: Id<"resources">;
  filename: string;
  page?: number;
  text: string;
  embedding: number[];  // 3072 dimensions
  createdAt: number;
}
```

**Vector Index**: `by_embedding` with 3072 dimensions, filtered by `orgId`, `packId`, `agentId`, `ownerUserId`, `scope`.

### 3.6 agents
Custom AI personas created by users.

```typescript
{
  orgId: Id<"orgs">;
  creatorUserId: Id<"users">;
  name: string;
  description: string;
  systemPrompt: string;
  avatarEmoji: string;
  category: string;
  preferredModel?: string;
  preferredMode?: StudyMode;
  visibility: "public" | "private";
  usageCount: number;
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
  resourceCount?: number;
  createdAt: number;
  updatedAt: number;
}
```

### 3.7 chats
Conversation threads.

```typescript
{
  orgId: Id<"orgs">;
  packId?: Id<"packs">;
  agentId?: Id<"agents">;
  ownerUserId: Id<"users">;
  title: string;
  pinned?: boolean;
  mode: StudyMode;
  thinkingLevel: "low" | "medium" | "high";
  routerMode: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
  usePersonalResources: boolean;
  contextSummary?: string;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}
```

### 3.8 messages
Individual chat messages.

```typescript
{
  orgId: Id<"orgs">;
  packId?: Id<"packs">;
  chatId: Id<"chats">;
  userId: Id<"users">;
  role: "user" | "assistant" | "system";
  mode: StudyMode;
  content: string;
  enhancedContent?: string;
  citations: Citation[];
  modelRequested?: string;
  modelUsed?: string;
  whyThisResponse?: string;
  usageIn?: number;
  usageOut?: number;
  verificationPassed?: boolean;
  createdAt: number;
}
```

### 3.9 modelCatalog
Cached OpenRouter model information.

```typescript
{
  orgId: Id<"orgs">;
  modelId: string;
  name: string;
  provider: string;
  description: string;
  contextLength?: number;
  inputCostPerM?: number;
  outputCostPerM?: number;
  tags: string[];
  costRating: "low" | "medium" | "high";
  speedRating: "low" | "medium" | "high";
  reasoningRating: "low" | "medium" | "high";
  multimodalRating: "none" | "basic" | "strong";
  recommendedForPhysics: boolean;
  isFree?: boolean;
  capabilities?: {
    reasoning: number;
    creative: number;
    code: number;
    vision: number;
    speed: number;
  };
  createdAt: number;
  updatedAt: number;
}
```

### 3.10 studentAnalytics
Usage analytics per user per day.

```typescript
{
  orgId: Id<"orgs">;
  userId: Id<"users">;
  day: string;
  sessionsCount: number;
  messagesCount: number;
  topicsExplored: string[];
  modesUsed: string[];
  modelsUsed: string[];
  quizScores: number[];
  totalTokensUsed: number;
  updatedAt: number;
}
```

### 3.11 userMemory
Extracted student preferences and learning patterns.

```typescript
{
  userId: Id<"users">;
  orgId: Id<"orgs">;
  rawMemoryText: string;
  entries: Array<{
    key: string;
    value: string;
    confidence: number;
    extractedAt: number;
  }>;
  updatedAt: number;
}
```

### 3.12 usageDaily / usageEvents / userSpending
Token usage tracking and cost calculation.

---

## 4. Study Modes System

Study modes are the core pedagogical framework. Defined in `src/lib/contracts/studyModes.ts`:

### 4.1 Mode Definitions

```typescript
const STUDY_MODES = [
  "tutor",        // Step-by-step teaching with Socratic questioning
  "marker",       // Rubric-based grading and feedback
  "exam",         // Practice exam generation
  "draft_coach",  // Writing feedback and structure
  "quiz",         // Interactive quiz generation
  "flashcard",    // Flashcard generation for spaced repetition
  "research",     // Deep analysis with citations
  "explain",      // Feynman technique explanations
  "general",      // General-purpose conversation
] as const;
```

### 4.2 Mode-Specific Behaviors

Each mode has specific system prompt rules defined in `src/lib/prompts/policy.ts`:

**Tutor Mode**:
- Uses Socratic questioning first
- Tracks attempt count and reflection status
- Only provides full solution after 2+ attempts with reflection
- Always includes one misconception check

**Marker Mode**:
- Provides rubric-like breakdown and score band
- Explains what earns/loses marks
- Gives 3 targeted drill questions
- Cites sources or labels as general knowledge

**Exam Mode**:
- Generates timed mini-papers with mark allocations
- Uses clear command verbs
- Provides self-check rubric after questions

**Draft Coach**:
- Focuses on structure, rubric fit, actionable feedback
- Revision pass order: thesis → evidence → paragraph coherence → style

**Quiz Mode**:
- Generates questions with 4 options (A, B, C, D)
- Format: "Q1. [text]\nA) [...]\nB) [...]\nC) [...]\nD) [...]\nCorrect: [letter]"
- Includes one-line feedback per answer
- "## Answers & Explanations" section

**Flashcard Mode**:
- FRONT/BACK pairs
- Format: "FRONT: [question]\nBACK: [answer]"
- BACK < 55 words with memory cue

**Research Mode**:
- Comprehensive analysis with headings
- Evidence matrix: claim | source | confidence
- "Source reliability scan" section
- Clear conclusion

**Explain Mode**:
- Feynman technique: start simple, build complexity
- Analogies and real-world examples
- "Teach it back" prompt at end

### 4.3 Validation

Runtime validation uses `safeStudyMode()` which coerces invalid values to "general" and logs warnings. Convex validators are duplicated in `convex/shared.ts` to match the canonical list.

---

## 5. Model Routing & Orchestration

The model routing system (`src/lib/routing/heuristic.ts`) intelligently selects AI models based on multiple factors.

### 5.1 Model Configuration

Defined in `src/lib/model-config.ts`:

```typescript
const MODEL_CONFIG = {
  // Free tier models
  tutorFast: "google/gemini-2.0-flash-exp:free",
  tutorHigh: "deepseek/deepseek-r1-0528:free",
  marker: "meta-llama/llama-3.3-70b-instruct:free",
  markerHard: "deepseek/deepseek-r1-0528:free",
  multimodal: "google/gemma-3-27b-vision:free",
  verify: "google/gemini-2.0-flash-exp:free",
  autoRouter: "openrouter/auto",
  glmAir: "z-ai/glm-4.5-air:free",
  gptOss: "openai/gpt-oss-120b:free",
  
  // Paid tier (normal spending)
  smartPaid: "anthropic/claude-sonnet-4-5",
  smartCheap: "openai/gpt-4.1-mini",
  reasoningPaid: "google/gemini-2.5-pro",
  
  // Search models
  searchFast: "perplexity/sonar",
  searchDeep: "perplexity/sonar-pro",
  
  // Embeddings
  embedding: "openai/text-embedding-3-large",
  
  // Prompt enhancement
  promptEnhance: "google/gemini-2.0-flash-exp:free",
};
```

### 5.2 Routing Algorithm

The `chooseModelRoute()` function takes a `ModelRouteInput` and returns `ModelRouteOutput`:

**Input Parameters**:
- `mode`: StudyMode
- `thinkingLevel`: "low" | "medium" | "high"
- `hasAttachments`: boolean
- `attachmentTypes`: string[] (pdf, png, jpg, etc.)
- `messageLength`: number
- `teacherStrictness`: "hard" | "medium" | "soft"
- `routerMode`: "auto" | "manual" | "openrouter_auto"
- `manualModel?: string`
- `studentSeemsStuck`: boolean
- `spendingTier`: "normal" | "cheap_only" | "free_only"
- `needsSearch`: boolean
- `promptCategory`: "code" | "math_science" | "creative" | "research" | "general"

**Routing Decision Tree**:

1. **Manual Mode**: If `routerMode === "manual"` and `manualModel` provided:
   - Returns manual model (enforced by tier if needed)
   - Verification model added for marker mode

2. **OpenRouter Auto Mode**: If `routerMode === "openrouter_auto"` and tier is normal:
   - Returns `openrouter/auto` with fallbacks
   - Auto-enhanced = true

3. **Auto + Simple Prompt**: If mode is general/tutor, no multimodal, no complex prompt, category is general/creative:
   - Returns `openrouter/auto` for optimization

4. **Free Tier**: If `spendingTier === "free_only"`:
   - Returns `openrouter/auto` with free-model fallbacks
   - Includes tutorFast, marker, gptOss as fallbacks

5. **Search Intent**: If `needsSearch`:
   - High thinking → `searchDeep` (perplexity/sonar-pro)
   - Otherwise → `searchFast` (perplexity/sonar)

6. **Mode-Based Routing**:

   | Mode | Normal Tier | Cheap/Free Tier | Condition |
   |------|-------------|-----------------|-----------|
   | marker | markerHard | marker | complexPrompt or strictness === "hard" |
   | research | reasoningPaid | tutorHigh | complexPrompt |
   | tutor + code | smartCheap | tutorFast | promptCategory === "code" |
   | tutor + math | reasoningPaid | tutorHigh | promptCategory === "math_science" |
   | tutor + creative | smartPaid | smartCheap | promptCategory === "creative" |
   | tutor + complex | smartPaid | smartCheap | complexPrompt |
   | exam | smartCheap | marker | - |
   | draft_coach | smartPaid | smartCheap | - |
   | quiz/flashcard | tutorFast | tutorFast | - |
   | explain | smartCheap | tutorFast | - |

7. **Multimodal Override**: If multimodal attachments detected:
   - Base model replaced with `multimodal` (google/gemma-3-27b-vision:free)

### 5.3 Fallback Chain

Each primary model has defined fallbacks in `ROUTER_FALLBACKS`:

```typescript
{
  [tutorFast]: [glmAir, marker],
  [tutorHigh]: [marker, tutorFast],
  [marker]: [tutorFast, glmAir],
  [multimodal]: [tutorFast, marker],
  [autoRouter]: [tutorFast, multimodal],
  [smartPaid]: [smartCheap, tutorFast],
  [smartCheap]: [tutorFast, glmAir],
  [reasoningPaid]: [smartPaid, tutorHigh],
}
```

### 5.4 Tier Enforcement

```typescript
function enforceTier(model: string, tier: SpendingTier): string {
  if (canUseInTier(model, tier)) return model;
  if (tier === "free_only") return MODEL_CONFIG.autoRouter;
  if (tier === "cheap_only") return MODEL_CONFIG.smartCheap;
  return MODEL_CONFIG.tutorFast;
}
```

- **free_only**: Only models with `:free` suffix or `openrouter/auto`
- **cheap_only**: Free models + models in `CHEAP_MODEL_DEFAULTS` set
- **normal**: All models except `MODEL_COST_BLOCK_LIST`

---

## 6. Chat System

### 6.1 Chat Flow

1. **User Input**: Message entered in ChatComposer
2. **Auto-Settings Pipeline**: Determines thinking level, search, enhancement
3. **Chat Creation/Load**: Creates new chat or loads existing
4. **User Message Storage**: Appends to database
5. **Retrieval**: Vector search over resources (if applicable)
6. **Web Search**: Optional search for time-sensitive queries
7. **Model Routing**: Selects appropriate model
8. **System Prompt Building**: Constructs context-aware prompt
9. **Streaming Response**: OpenRouter streaming with fallback chain
10. **Verification**: Optional marker verification pass
11. **Storage**: Saves assistant message with metadata
12. **Analytics**: Records usage and updates memory

### 6.2 Streaming Protocol

Uses NDJSON (Newline Delimited JSON) format:

```typescript
// Delta event
{ type: "delta", content: "partial text..." }

// Done event
{ 
  type: "done",
  chatId: string,
  messageId: string,
  modelUsed: string,
  modelRequested: string,
  whyThisResponse: string,
  citations: Citation[],
  verificationPassed?: boolean,
  spendingUpdate: UserSpending,
  autoResult: { modelUsed, searchEnabled, thinkingLevel, promptEnhanced },
  enhancedPrompt?: string,
  agent?: { id, name, emoji }
}

// Error event
{ type: "error", error: { code, message, retryable } }
```

### 6.3 Message Editing & Regeneration

- **Edit**: User can edit their last message; this creates a branch
- **Regenerate**: Deletes last assistant message and re-generates
- **Stop**: AbortController cancels ongoing stream

### 6.4 Context Management

**Context Compaction**: When history > 20 messages:
1. Summarizes older messages using tutorFast
2. Stores summary in `contextSummary` field
3. Only recent 6 messages + summary sent to model

**Memory Extraction**: After each exchange:
1. Extracts durable facts about student using AI
2. Stores in `userMemory` table
3. Formats top 8 entries for system prompt

---

## 7. RAG & Retrieval

### 7.1 Resource Ingestion Pipeline

1. **Upload**: File uploaded to Convex storage
2. **Parsing**: 
   - PDF: pdfjs-dist extracts text by page
   - DOCX: mammoth converts to text
   - TXT/MD: Direct text extraction
3. **Chunking**: Text split into ~800 character segments with 100 char overlap
4. **Embedding**: OpenRouter `text-embedding-3-large` generates 3072-dim vectors
5. **Storage**: Chunks stored in `chunks` table with vector index

### 7.2 Retrieval Algorithm

In `convex/rag.ts`, the `retrieve` action:

1. **Vector Search**: Query embedding compared against chunk embeddings
2. **Scope Filtering**: Filters by orgId, packId/agentId, scope, ownerUserId
3. **Score Threshold**: Only returns chunks with score >= 0.35
4. **Deduplication**: Removes duplicate chunks across agent/personal sources
5. **Ranking**: Sorted by similarity score
6. **Limiting**: Returns topK (default 8) results

### 7.3 Source Block Format

```
[1] filename.pdf p.3 (pack, score 0.823)
Text content of the chunk...

[2] notes.txt (personal, score 0.765)
Another chunk of text...
```

### 7.4 Citation Extraction

The `inferCitations()` function in `src/app/api/chat/route.ts`:

1. **Numeric References**: Parses `[1]`, `[2]` etc. from response
2. **Filename Matching**: Checks if response mentions source filenames
3. **General Knowledge**: Detects "general knowledge" mentions
4. **Web URLs**: Extracts URLs from search results
5. **Fallback**: If no citations found, uses top-scoring retrieved sources

---

## 8. Authentication & Authorization

### 8.1 Clerk Integration

Primary auth via Clerk (`src/lib/auth-server.ts`):

```typescript
// With Clerk configured
const authData = await auth();
userId = authData.userId;
const user = await currentUser();
```

### 8.2 Local Demo Mode

When Clerk keys are absent, falls back to local demo:

```typescript
return bootstrapActor({
  clerkId: "local-demo-admin",
  email: "local-admin@school.local",
  name: "Local Demo Admin",
  bootstrapAdmin: true,
});
```

### 8.3 User Bootstrapping

`convex/users.ts:ensureUser`:

1. Checks for existing user by clerkId
2. Creates org if needed via `getOrCreateDefaultOrg`
3. Sets role based on `bootstrapAdmin` flag or requested role
4. Seeds demo pack and default agents
5. Returns user record

### 8.4 Role-Based Access Control

**Student**:
- Can create personal chats
- Can upload personal resources (max 10)
- Can use public agents
- Cannot create packs
- Cannot view other users' data

**Teacher**:
- Can create packs (class workspaces)
- Can upload pack resources (max 30 per pack)
- Can set pack guidelines
- Can create public agents
- Can view pack analytics

**Admin**:
- Full access to all org data
- Can manage user roles
- Can modify org settings
- Can refresh model catalog
- Can delete any resource

### 8.5 Middleware

`src/middleware.ts`:
- Protects API routes
- Handles Clerk authentication
- Falls back to local mode when Clerk unavailable

---

## 9. Frontend Components

### 9.1 Chat Layout (`src/components/chat/chat-layout.tsx`)

Main layout component managing:
- Sidebar state (collapsed/expanded)
- Mobile sidebar overlay
- Chat state from `useChatState` hook
- Integration of all chat sub-components

### 9.2 Chat Sidebar (`src/components/chat/chat-sidebar.tsx`)

Features:
- Chat list with search
- New chat button
- Mode selector
- Settings access
- Chat pinning
- Role-based navigation
- Spending tier indicator
- User memory summary

**States**:
- Expanded: Full sidebar with text labels
- Collapsed: Icon-only mode (76px width)
- Mobile: Slide-out overlay

### 9.3 Chat Composer (`src/components/chat/chat-composer.tsx`)

Message input component:
- Textarea with auto-resize
- File attachment (drag & drop)
- Mode selector dropdown
- Agent selector
- Model selector (auto/manual)
- Send/stop buttons
- Auto-settings toggles

### 9.4 Chat Messages (`src/components/chat/chat-messages.tsx`)

Message display:
- User messages with edit/delete
- Assistant messages with streaming
- Markdown rendering with syntax highlighting
- Citations display
- Model metadata drawer
- Quiz/flashcard special views
- Error states with retry

### 9.5 Chat Settings Drawer (`src/components/chat/chat-settings-drawer.tsx`)

Slide-out settings panel:
- Mode selection
- Thinking level (low/medium/high)
- Router mode (auto/manual/openrouter_auto)
- Manual model selection
- Personal resources toggle
- Auto-settings configuration

### 9.6 Markdown Renderer (`src/components/chat/markdown-renderer.tsx`)

Uses:
- `react-markdown` for parsing
- `remark-gfm` for GitHub flavored markdown
- `remark-math` + `rehype-katex` for LaTeX
- `rehype-highlight` for code blocks
- Custom components for citations, code copy buttons

---

## 10. API Routes

### 10.1 POST /api/chat

Main chat endpoint (`src/app/api/chat/route.ts`).

**Request Body**:
```typescript
{
  chatId?: string;
  packId?: string;
  agentId?: string;
  mode: StudyMode;
  message: string;
  thinkingLevel: "low" | "medium" | "high";
  routerMode: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
  usePersonalResources: boolean;
  regenerate?: boolean;
  attachmentTypes?: string[];
  autoSettings: {
    enhancePrompt: boolean;
    autoModel: boolean;
    autoThinking: boolean;
    autoSearch: boolean;
    enhanceMode?: "auto" | "on" | "off";
    thinkingMode?: "auto" | "on" | "off";
    searchMode?: "auto" | "on" | "off";
  };
}
```

**Processing Steps**:
1. Validate actor authentication
2. Validate and normalize inputs
3. Run auto-settings pipeline
4. Create/load chat
5. Store user message (with enhanced content if applicable)
6. Retrieve chat history and context summary
7. Perform RAG retrieval if resources available
8. Optional web search
9. Route to appropriate model
10. Stream response with fallback chain
11. Optional marker verification
12. Parse citations from response
13. Store assistant message
14. Record usage and analytics
15. Extract memory
16. Generate title (first assistant message)

### 10.2 GET /api/bootstrap

Initial load endpoint.

**Returns**:
```typescript
{
  actor: SessionActor;
  chats: Chat[];
  models: ModelOption[];
  orgSettings: { org: Org };
  agents: Agent[];
  userSpending: UserSpending;
  userMemory: { updatedAt, summary, entryCount };
}
```

### 10.3 GET/POST /api/models

**GET**: Lists cached models from Convex catalog
**POST** (admin only): Refreshes catalog from OpenRouter API

### 10.4 GET /api/models/live

Returns live OpenRouter models with caching.

### 10.5 GET /api/agents

Lists agents with optional category filter and search.

### 10.6 POST /api/agents

Creates new agent.

### 10.7 POST /api/enhance-prompt

Prompt enhancement endpoint.

**Algorithm**:
1. Calls OpenRouter with enhancement prompt
2. 2000ms timeout
3. Parses JSON response: `{ original, enhanced, improvements }`
4. Falls back to local enhancement on timeout/failure

**Local Enhancement**:
```typescript
{
  original: message,
  enhanced: `${message}\n\nPlease answer in ${mode} mode with clear sections and concise steps.`,
  improvements: ["Added mode-specific instruction", "Requested clear structure", "Preserved original intent"]
}
```

### 10.8 Chats API (/api/chats, /api/chats/[id])

- **POST /api/chats**: Create new chat
- **GET /api/chats/[id]**: Get chat details with messages
- **PATCH /api/chats/[id]**: Update chat settings
- **DELETE /api/chats/[id]**: Soft delete chat

### 10.9 Packs API (/api/packs)

- **GET**: List packs
- **POST**: Create pack (teacher/admin only)
- **GET /[id]**: Get pack with resources
- **PATCH /[id]**: Update pack settings
- **GET /[id]/resources**: List pack resources

### 10.10 Resources API (/api/resources)

- **POST**: Upload files (multipart/form-data)
- **GET /[id]/download**: Get download URL

### 10.11 Admin API (/api/admin/*)

- **GET /users**: List users with usage
- **PATCH /users**: Update user role
- **GET /settings**: Get org settings
- **PATCH /settings**: Update org settings
- **POST /seed-demo**: Seed demo data

---

## 11. Auto-Settings Pipeline

The auto-settings system (`src/lib/auto-settings.ts`) automatically configures chat parameters.

### 11.1 Search Detection

```typescript
const SEARCH_KEYWORDS = [
  "latest", "current", "today", "2025", "2026", 
  "news", "who won", "recent", "breaking", "update"
];
```

If any keyword found and spending tier allows → enables web search

### 11.2 Thinking Level Detection

```typescript
const HIGH_THINKING_MARKERS = [
  "prove", "derive", "explain why", "show that", 
  "analyze", "compare", "evaluate", "critique"
];
```

- High marker found OR message > 400 chars → "high"
- Message > 160 chars → "medium"
- Otherwise → fallback to current setting

### 11.3 Prompt Category Classification

```typescript
function classifyPromptCategory(message: string) {
  if (/(code|typescript|javascript|python|debug|function|api|sql|algorithm|bug)/i.test(message)) 
    return "code";
  if (/(prove|derive|equation|physics|chemistry|math|calculus|integral|theorem|statistics)/i.test(message))
    return "math_science";
  if (/(poem|story|creative|rewrite|tone|narrative|brainstorm|copywriting)/i.test(message))
    return "creative";
  if (/(research|sources|citation|compare papers|evidence|latest|current|news)/i.test(message))
    return "research";
  return "general";
}
```

### 11.4 Complexity Classification

- Complex: Has complex verb OR message > 500 chars
- Medium: Message > 180 chars
- Simple: Otherwise

### 11.5 Prompt Enhancement

Calls OpenRouter to rewrite prompt:

```typescript
{
  model: MODEL_CONFIG.promptEnhance,
  messages: [
    {
      role: "system",
      content: "Rewrite the student prompt to be clearer and more specific while preserving intent. Return JSON: {\"prompt\": string, \"improvements\": string[]}"
    },
    { role: "user", content: message }
  ],
  temperature: 0.2
}
```

2-second timeout, falls back to original on failure.

---

## 12. Prompt Engineering

### 12.1 System Prompt Structure

Built in `src/lib/prompts/policy.ts:buildSystemPrompt()`:

```
You are a school tutor and marker for students and teachers.
You must follow study mode policy exactly and stay pedagogical.
Always ground claims in SOURCES when available.
Never claim a source you did not receive.

COURSE GUIDELINES:
Summary: [guidelines summary]
Topic map: [topics]
Rubric hints: [hints]
Common misconceptions: [misconceptions]

[STUDENT PROFILE - optional]
[COMPACT CHAT SUMMARY - optional]
[WEB SEARCH RESULTS - optional]

[MODE-SPECIFIC RULES]

Output format:
1) Short answer or next step.
2) Explanation.
3) Include compact inline numeric references when sourcing facts, like [1], [2].
4) Why this response (one sentence).

SOURCES:
[source block or "No retrieved sources."]
```

### 12.2 Tutor Gate System

Tracks student attempts to enforce pedagogical progression:

```typescript
function tutorGate(attemptCount: number, hasReflection: boolean): TutorGate {
  return {
    attemptCount,
    hasReflection,
    allowFinalSolution: attemptCount >= 2 && hasReflection,
  };
}
```

**Attempt Detection**: Looks for markers like "i tried", "my approach", "therefore", "because", "equation"

**Reflection Detection**: Looks for "i learned", "next time", "my mistake", "i realize", "misconception"

### 12.3 Marker Verification

When `verifyMarkerPassEnabled` is true:

1. Generate initial response
2. Call verification model with `markerVerificationPrompt()`:
```
You are a strict verifier. Check the assistant response for:
- Has citations section.
- No unsupported factual claims.
- Respects marker mode rubric breakdown requirement.
Reply ONLY in JSON: {"pass": boolean, "reason": string}.
```
3. If fails, regenerate with stronger citation discipline

---

## 13. Resource Management

### 13.1 File Upload Flow

1. **Client**: User selects files in ChatComposer
2. **Upload**: POST to `/api/resources` with multipart/form-data
3. **Storage URL**: Convex generates upload URL via `resources:createUploadUrl`
4. **File Transfer**: Direct upload to Convex storage
5. **Registration**: `resources:registerResource` creates database record
6. **Processing**: Background ingestion via `resources:completeResourceIngestion`

### 13.2 Ingestion Process

1. **Download**: Fetch file from storage
2. **Parse**: 
   - PDF: pdfjs-dist extracts text with page numbers
   - DOCX: mammoth extracts text
   - TXT/MD: Direct text
3. **Chunk**: Split into ~800 char segments with 100 char overlap
4. **Embed**: Call OpenRouter for embeddings
5. **Store**: Insert chunks with embeddings into database
6. **Update**: Mark resource as "processed"

### 13.3 Resource Scopes

- **pack**: Belongs to a class/workspace, accessible to all in org
- **personal**: Private to user, used when `usePersonalResources` is true
- **agent**: Attached to custom agent, used when agent selected

### 13.4 Limits

```typescript
const LIMITS = {
  maxTeacherFilesPerPack: 30,
  maxStudentPersonalFiles: 10,
  maxCharsPerFile: 250_000,
  maxChunksPerFile: 240,
  retrievalTopK: 8,
};
```

---

## 14. Agent System

### 14.1 Agent Structure

```typescript
{
  name: string;              // Display name
  description: string;       // Short description
  systemPrompt: string;      // Custom behavior instructions
  avatarEmoji: string;       // Visual identifier
  category: string;          // For grouping/filtering
  preferredModel?: string;   // Suggested model
  preferredMode?: StudyMode; // Suggested mode
  visibility: "public" | "private";
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
  resourceCount?: number;
}
```

### 14.2 Agent Creation Flow

1. User fills AgentBuilderForm with:
   - Basic info (name, description, emoji, category)
   - System prompt (custom instructions)
   - Optional preferred model and mode
   - Visibility setting

2. On save:
   - POST to `/api/agents`
   - Creates agent record
   - Can upload resources immediately

### 14.3 Agent Guidelines Generation

When resources uploaded to agent:

1. Extract text from all agent resources
2. Call AI to generate:
   - Summary of content
   - Topic map (key concepts)
3. Store in `guidelinesSummary` and `guidelinesTopicMap`
4. Used in system prompt when agent selected

### 14.4 Agent Usage

1. User selects agent from sidebar or agent page
2. Agent's preferred mode/model suggested (can override)
3. Agent's system prompt merged into main system prompt
4. Agent's resources used for RAG retrieval
5. Usage count incremented after each chat completion

---

## 15. Analytics & Usage Tracking

### 15.1 Usage Recording

`convex/usage.ts:recordUsageWithCost`:

1. Records event in `usageEvents` table
2. Updates `usageDaily` aggregate
3. Updates `userSpending` for month
4. Calculates cost based on model pricing

### 15.2 Spending Tiers

Calculated from monthly spending:

```typescript
if (totalCostCents > 5000) return { tier: "free_only", ... };
if (totalCostCents > 2000) return { tier: "cheap_only", ... };
return { tier: "normal", ... };
```

- **normal**: Full model access
- **cheap_only**: Free + cheap models only
- **free_only**: Free models only

### 15.3 Analytics Dashboard

`src/components/analytics/analytics-dashboard.tsx`:

- Activity chart (messages over time)
- Mode breakdown pie chart
- Time of day heatmap
- Topic cloud
- Stats cards (total messages, sessions, tokens)

Data from `convex/analytics.ts` aggregated by day.

---

## 16. Configuration Files

### 16.1 Environment Variables

```bash
# Required
NEXT_PUBLIC_CONVEX_URL=          # Convex deployment URL
CONVEX_DEPLOYMENT=               # Convex deployment name

# Authentication (optional - falls back to local mode)
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# AI Models (optional - falls back to local responses)
OPENROUTER_API_KEY=
OPENROUTER_APP_NAME=AI School Assistant
OPENROUTER_SITE_URL=http://localhost:3000

# Admin (optional)
ADMIN_EMAILS=admin@school.edu,principal@school.edu
```

### 16.2 Key Configuration Files

| File | Purpose |
|------|---------|
| `convex/schema.ts` | Database schema definition |
| `convex/constants.ts` | System limits and model defaults |
| `convex/shared.ts` | Convex validators (must match contracts) |
| `src/lib/model-config.ts` | Model IDs and fallback chains |
| `src/lib/contracts/studyModes.ts` | Single source of truth for modes |
| `next.config.ts` | Next.js configuration |
| `tsconfig.json` | TypeScript configuration |

### 16.3 Important Constants

**Embedding**: 3072 dimensions (OpenAI text-embedding-3-large)

**Timeouts**:
- OpenRouter requests: 30 seconds
- Prompt enhancement: 2 seconds
- Web search: 8 seconds
- Context compaction: 5 seconds
- Memory extraction: 5 seconds

**Limits**:
- Chat history before compaction: 20 messages
- Citations per response: 8 max
- Memory entries stored: 30 max
- Memory entries in prompt: 8 max
- Context summary length: 2000 chars
- File upload size: 250k chars max

---

## 17. Special Features

### 17.1 Command Palette

`src/components/command-palette.tsx`:

Keyboard shortcuts (Cmd/Ctrl+K):
- New chat
- Set mode
- Open settings
- Navigate pages

### 17.2 Keyboard Shortcuts

- `Cmd/Ctrl+Enter`: Send message
- `Cmd/Ctrl+Shift+S`: Toggle sidebar
- `Escape`: Close drawers/sidebar
- `Cmd/Ctrl+K`: Open command palette

### 17.3 Theme System

CSS variables in `globals.css`:
- Light/dark mode via `data-theme` attribute
- Persistent in localStorage
- System preference detection
- 8 color themes available

### 17.4 Error Handling

**API Errors**: Structured envelope
```typescript
{
  error: {
    code: string;        // Machine-readable
    message: string;     // Human-readable
    retryable?: boolean;
  }
}
```

**Streaming Errors**: Sent as error event in NDJSON stream

**Fallback Chain**: If primary model fails, automatically tries fallbacks

### 17.5 Testing

**Smoke Tests** (`scripts/smoke-test.mjs`):
- Dev server responds
- Model catalog loads
- Chat creation with all modes
- Prompt enhancement
- Error handling
- File upload flow

**Unit Tests**: Vitest with React Testing Library
- Prompt policy tests
- Routing heuristic tests

---

## 18. Deployment Considerations

### 18.1 Production Checklist

1. Set all required environment variables
2. Configure Clerk production keys
3. Set up OpenRouter API key with billing
4. Configure `ADMIN_EMAILS` for initial admin
5. Run `npx convex deploy` for backend
6. Run `npm run build` for frontend
7. Deploy to Vercel/Netlify/other

### 18.2 Scaling Considerations

- Convex handles automatic scaling
- OpenRouter rate limits apply
- Consider implementing request caching
- Monitor token usage costs
- Set appropriate org budget limits

### 18.3 Security Notes

- All API routes require authentication
- File uploads restricted by scope and limits
- User data isolated by orgId
- Webhook verification for Clerk
- No secrets exposed in frontend

---

This document represents the complete technical specification for the AI School Assistant application as of the codebase state.

---

## Phase 0 Implementation Update (2026-03-21)

Status: Implemented in codebase for the Phase 0 checklist in `CODEX.md`.

### Completed
- Public auth passthrough for contact form endpoint (`/api/contact`) in middleware routing.
- Search fallback hardening to model-knowledge-only responses (no fabricated URLs), with explicit fallback prefix and streamed `search_status` telemetry.
- Frontend model-knowledge warning banner for search fallback responses.
- File-processing stall retry threshold aligned to 90s with shared stale constant usage in UI status rendering.
- Speech-to-text locale handling improved via dynamic recognition language selection.
- Canvas version label handling hardened to avoid `label.trim is not a function` runtime failures.
- Added request classification infrastructure (`classifyRequest`) with `T0/T1/T2/T3` output and classification reason metadata.
- Added real-time `phase_update` stream events and live orchestration phase rendering support.
- Token accounting now aggregates subcall token usage for done-event and persisted message token counts.
- Title generation utility path now prefers cheap paid models over strict free preference and performs bounded retry when first title call is empty.
- Added optional `learningContext` field to `chats` schema as Phase 3 preparation.

### Verification Notes
- Targeted test command attempted: `npm run test:run -- src/lib/__tests__/auto-settings.test.ts`.
- Test execution is blocked in this environment: npm launches through Windows `CMD.EXE` (UNC-path failure) and local Vitest also fails because `node` is not available in PATH.
- See `PHASE_0_IMPLEMENTATION_REPORT.md` for detailed file-level change log and attempted test commands.

## Phase 1 Implementation Update (2026-03-21)

Status: Implemented in codebase for the Phase 1 checklist in `CODEX.md`.

### Completed
- Added `PipelineController` + `PipelineState` foundation with class-based execution plans (`T0/T1/T2/T3`) and stage-level skip/completion tracking.
- Integrated controller-driven routing gates in chat pipeline, including an early T0 fast path that skips auto-settings model work.
- Enforced cost gates for lower classes: search, RAG retrieval, and multi-agent orchestration are skipped for `T0/T1`.
- Added force-multi-agent guardrails (tier, org feature, request class, budget) with explicit denial handling in route trace/toolchain context.
- Rebalanced phase-router model scoring: updated weight mix, free-model score ceiling, stronger repetition penalties, provider diversity penalty, and epsilon exploration.
- Parallelized SearxNG querying (batch-of-3 first-success behavior) and reduced default timeout to `4000ms`.
- Gated RAG execution on processed resources only; retrieval now transparently skips when resources exist but are still unprocessed.
- Updated utility-model selection for memory extraction to prefer cheap paid-capable utility routing (`preferCheap`) without forcing free-only behavior.
- Enhanced route trace structure with request-class metadata, stage execution/skips, search status, and cost-budget envelope fields.
- Added focused Phase 1 tests for controller gating/guardrail behavior.

### Verification Notes
- Targeted tests were attempted but remain blocked in this environment due Node runtime constraints (same failure mode observed in Phase 0):
  - `npm` execution delegates to Windows `CMD.EXE` and fails on UNC working path.
  - Direct Vitest binary invocation fails because `node` is unavailable in PATH.
- See `PHASE_1_IMPLEMENTATION_REPORT.md` for full file-level change log and test command outputs.

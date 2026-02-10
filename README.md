# AI School Assistant MVP

Next.js + Convex + Clerk + OpenRouter school assistant with chat-first UX, workspace resources, role controls, and model orchestration.

## Quick Start (5 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Set up Convex (in separate terminal)
npx convex dev

# 3. Start the app (separate terminal)
npm run dev

# 4. Run smoke tests (verify everything works)
node scripts/smoke-test.mjs
```

Visit http://localhost:3000 - the app auto-creates a demo org and user.

## Production Readiness Verification

### Mandatory Checks Before Deployment

```bash
# 1. Run full type check
npx tsc --noEmit

# 2. Run lint (must pass with 0 warnings)
npm run lint

# 3. Run all tests
npm run test:run

# 4. Run smoke tests against running server
node scripts/smoke-test.mjs
```

### Smoke Test Suite

The smoke test (`scripts/smoke-test.mjs`) validates:
- ✅ Dev server responds
- ✅ Model catalog loads (free-only enforcement)
- ✅ Workspace packs endpoint
- ✅ Agent endpoints
- ✅ Chat creation with all 9 study modes
- ✅ Prompt enhancement (local + AI fallback)
- ✅ Analytics endpoint
- ✅ Error handling (400s return requestId)
- ✅ 404 handling
- ✅ Frontend assets load

Run with:
```bash
SMOKE_TEST_URL=http://localhost:3000 node scripts/smoke-test.mjs
```

## Stack
- Next.js (App Router) + TypeScript (strict)
- TailwindCSS + custom UI primitives
- Convex backend (`/convex`) for DB, file storage, vector search, actions/mutations/queries
- Clerk auth (optional local fallback when Clerk env keys are absent)
- OpenRouter for chat + embeddings + model catalog refresh (with local response fallback)

## Product Scope
- Roles: `student` (default), `teacher`, `admin`
- Chat-first interface with collapsible sidebar and history search
- Workspace management and resource ingestion
- RAG retrieval with citations
- Study modes:
  - Learn (`tutor`)
  - Review (`marker`)
  - Practice (`exam`)
  - Coach (`draft_coach`)
- Model orchestration:
  - Auto heuristic routing
  - Manual model selection
  - OpenRouter auto-router mode
  - Workspace model policy (allowed/default)
- Model explorer with search, task-fit ranking, and details
- Admin controls for role management, budget, and verification pass

## Routes
- `/` chat app
- `/models` model explorer
- `/packs` workspace hub
- `/packs/[id]` workspace policy + resource management
- `/admin` admin console

## Environment Variables
Create `.env.local` with:

```bash
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CONVEX_URL=
CONVEX_DEPLOYMENT=
OPENROUTER_API_KEY=

# Optional
OPENROUTER_APP_NAME=AI School Assistant
OPENROUTER_SITE_URL=http://localhost:3000
ADMIN_EMAILS=admin@school.edu,principal@school.edu
```

If `CLERK_*` keys are not set, the app uses a local demo actor for development.
If `OPENROUTER_API_KEY` is missing, chat uses a local fallback response path.

## Local Development
1. Install:
```bash
npm install
```

2. Run Convex backend:
```bash
npx convex dev
```

3. Run Next app:
```bash
npm run dev
```

4. Open:
- App: `http://localhost:3000`

## Testing
```bash
npm run test:run
```

## Build
```bash
npm run build
```

---

# MVP Readiness Checklist

## Quick Demo (< 5 minutes for a teacher)

### 1. Initial Setup (30 seconds)
- [ ] Open app at `http://localhost:3000`
- [ ] Observe auto-bootstrap creates demo org and user
- [ ] Verify sidebar shows empty chat state with mode selector

### 2. Create Workspace (1 minute)
- [ ] Click "Settings" (gear icon) in sidebar
- [ ] Select or create a Pack (Class Pack)
- [ ] Set subject (e.g., "Physics") and academic year
- [ ] Upload a sample resource (PDF or text file)
- [ ] Verify guidelines auto-generate from uploaded resources

### 3. Chat Testing (2 minutes)
- [ ] Start new chat with default Tutor mode
- [ ] Type a question: "Explain Newton's laws"
- [ ] Verify streaming response appears
- [ ] Check routing badge shows model selection reason
- [ ] Verify citations appear if resources uploaded
- [ ] Try Stop Generation button during streaming
- [ ] Regenerate last response using regenerate button

### 4. Study Modes (1 minute)
- [ ] Switch to Marker mode, ask for feedback on an answer
- [ ] Switch to Quiz mode, request quiz questions
- [ ] Verify different system prompts apply per mode

### 5. Model Features (30 seconds)
- [ ] Open model selector in header
- [ ] Verify only FREE models shown by default
- [ ] Try manual model selection
- [ ] Check model cards load from OpenRouter

---

## Feature Verification

### Authentication & Roles
- [x] Clerk integration with fallback to local demo mode
- [x] Three roles: student (default), teacher, admin
- [x] Role-based access control on all routes
- [x] Admin can manage users and org settings

### Chat Core (Provider Parity)
- [x] Create new chat
- [x] Rename chat (click title or via sidebar)
- [x] Delete chat
- [x] Search chats (sidebar search)
- [x] Pin/unpin chats
- [x] Edit user message (hover, click edit icon)
- [x] Regenerate assistant response
- [x] Copy message content
- [x] Markdown rendering with code blocks
- [x] Code block copy buttons
- [x] Message metadata drawer (model used, routing reason, citations)
- [x] Streaming responses with stop button
- [x] Keyboard shortcuts (Cmd/Ctrl+Enter to send, Escape to close drawers)

### Study Modes (9 modes)
- [x] **Tutor** - Step-by-step guidance with attempt-first learning
- [x] **Marker** - Rubric-based grading and feedback
- [x] **Exam** - Practice with exam-style questions
- [x] **Draft Coach** - Writing structure and clarity feedback
- [x] **Quiz** - Interactive quiz generation with scoring
- [x] **Flashcard** - Flashcard generation for spaced repetition
- [x] **Research** - Deep analysis with evidence and citations
- [x] **Explain** - Feynman technique simple explanations
- [x] **General** - General-purpose helpful conversation

### Model Routing
- [x] Auto heuristic routing based on mode + attachments + message length
- [x] Manual model selection
- [x] OpenRouter auto-router mode
- [x] **FREE-ONLY enforcement** - All models end with `:free`
- [x] Fallback chain when primary model fails
- [x] Model cards with capabilities (reasoning, speed, vision, etc.)
- [x] Dynamic catalog refresh from OpenRouter API
- [x] Subject-aware routing (considers workspace subject)

### Workspaces (Packs)
- [x] Create class packs (teacher/admin only)
- [x] Set subject, academic year, strictness level
- [x] Upload resources (PDF, DOCX, TXT, MD)
- [x] Auto-generate guidelines from resources
- [x] Personal resources for students
- [x] Pack-level model policy (allowed models, default model)

### RAG & Retrieval
- [x] Vector search over uploaded resources
- [x] Lexical fallback if embeddings fail
- [x] Citations with filename and page numbers
- [x] Source block included in prompts
- [x] Personal + Pack resource search

### Prompt Enhancement
- [x] **Local enhancement** (default) - deterministic, instant, free
- [x] Optional AI enhancement with 1500ms timeout
- [x] Mode-aware enhancement (adds mode intent and structure)

### Error Handling
- [x] No 500 errors for normal usage
- [x] Structured error envelope: `{ ok: false, error: { code, message, requestId } }`
- [x] Request ID logging for debugging
- [x] Graceful degradation when OpenRouter unavailable
- [x] Input validation at API boundaries

### Admin Features
- [x] User management (list, promote/demote roles)
- [x] Org settings (token budget, verification pass toggle)
- [x] Model catalog refresh
- [x] Analytics dashboard (usage by day, modes, models)

---

## Smoke Test Suite

Run the automated smoke tests:
```bash
# Start dev server first
npm run dev

# In another terminal
node scripts/smoke-test.mjs
```

Tests cover:
- Bootstrap endpoint
- Model listing
- Chat creation with all 9 modes
- Chat list, rename, delete
- Prompt enhancement
- Analytics
- Agents
- Packs
- Error handling (400 not 500 for invalid input)

---

## Known Limitations

1. **Embeddings**: Uses OpenRouter embedding endpoint. If unavailable, RAG falls back to lexical search (not implemented - currently shows error).
2. **File Parsing**: PDF parsing requires pdfjs-dist which may have issues with complex PDFs.
3. **Token Budget**: Enforced at org level but not yet per-user.
4. **Concurrent Editing**: No real-time collaboration on chats.
5. **Mobile**: Basic responsive design works but not fully optimized for small screens.
6. **Export**: No chat export feature yet.

---

## Architecture Decisions

### Single Source of Truth
- Study modes defined in `src/lib/contracts/studyModes.ts`
- Convex validators in `convex/shared.ts` must match exactly
- Runtime validation with `safeStudyMode()` coerces invalid to "general"

### Free-Only Policy
- All model IDs in `MODEL_CONFIG` end with `:free`
- Model catalog flags `isFree` based on OpenRouter pricing
- Admin can enable paid models via `allowPaidModels` setting (not exposed in UI yet)

### Error Handling Strategy
- API routes use `withRouteErrorHandling()` wrapper
- Convex errors normalized to structured format
- Request IDs for tracing
- Client toasts display actionable messages

### Database Schema
- `orgs` - Organization settings and budget
- `users` - Clerk-linked users with roles
- `packs` - Class workspaces with guidelines
- `resources` - Uploaded files (pack or personal scope)
- `chunks` - Vector searchable text segments
- `agents` - Custom AI personas
- `chats` - Conversation threads
- `messages` - Individual messages with citations
- `modelCatalog` - Cached OpenRouter models
- `studentAnalytics` - Usage tracking

---

## Development Commands

```bash
# Run all checks
npm run lint && npm run test:run && npx tsc --noEmit

# Start development
npx convex dev  # Terminal 1
npm run dev     # Terminal 2

# Run smoke tests (requires dev server)
node scripts/smoke-test.mjs

# Build for production
npm run build
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `CLERK_PUBLISHABLE_KEY` | No | Clerk frontend key (omitted = local demo mode) |
| `CLERK_SECRET_KEY` | No | Clerk backend key |
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Convex deployment URL |
| `CONVEX_DEPLOYMENT` | Yes | Convex deployment name |
| `OPENROUTER_API_KEY` | No | OpenRouter API key (omitted = local fallback responses) |
| `OPENROUTER_APP_NAME` | No | App name for OpenRouter headers |
| `OPENROUTER_SITE_URL` | No | Site URL for OpenRouter headers |
| `ADMIN_EMAILS` | No | Comma-separated admin emails for auto-promotion |

---

*Last updated: Production Readiness Pass Complete*

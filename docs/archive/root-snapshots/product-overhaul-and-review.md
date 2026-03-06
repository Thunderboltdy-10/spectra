AI School — Comprehensive Overhaul Plan

 Context

 The platform is a B2B AI agent studio/workspace for schools, not a generic chatbot. Its two core differentiators are (1) two-layer SOUL personalisation (School SOUL + Personal SOUL) and (2) a dynamic orchestration system (model × mode × agents). Neither is working correctly.
 Additionally, there are numerous UI issues, missing features, security gaps, and architectural debt. This plan addresses every reported issue and expands the product significantly.

 Approach: One PR on implementation branch. Work is organized into 11 groups but executed sequentially where there are dependencies.

 ---
 Group 1 — Critical Bug Fixes (Backend)

 1a. mode_update TransformStream Deadlock

 File: src/lib/orchestrator/pipeline.ts:657

 Bug: After conversation-aware mode refinement (lines 630–662), await send({type: "mode_update", ...}) writes directly to the TransformStream before the async IIFE starts (line 1226) and before any reader is attached. This causes a deadlock — the client never receives headers or
  the stream body.

 Fix: Replace the direct send() call with earlyEventBuffer.push(...):
 // Line 657 — BEFORE (broken):
 await send({ type: "mode_update", suggestedMode: effectiveMode });

 // AFTER (fixed):
 earlyEventBuffer.push({ type: "mode_update", suggestedMode: effectiveMode });
 The earlyEventBuffer is already flushed at line 1240 inside the async IIFE after the Response is created and a reader is attached.

 1b. Unpriced Spend Token-Volume Estimation

 File: convex/usage.ts:316–318

 Bug: Every unpriced usage event contributes a flat 0.005 cents regardless of token count, allowing massive token use on unpriced models to bypass budget limits.

 Fix: Replace the flat estimate with a token-volume formula. Use a conservative assumed price (e.g. $1/M in tokens, $3/M out tokens — a low-end paid model) to produce a realistic cost floor:
 // Replace lines 316–318:
 const UNPRICED_CENTS_PER_M_IN  = 1.0;   // $1/M input tokens
 const UNPRICED_CENTS_PER_M_OUT = 3.0;   // $3/M output tokens
 const unpricedEstimateCents = monthlyUsage
   .filter(row => (row.costCents ?? 0) <= 0 && row.totalTokens > 0)
   .reduce((sum, row) => {
     const inTokens  = row.inputTokens  ?? row.totalTokens * 0.4;
     const outTokens = row.outputTokens ?? row.totalTokens * 0.6;
     return sum + (inTokens / 1_000_000) * UNPRICED_CENTS_PER_M_IN
                + (outTokens / 1_000_000) * UNPRICED_CENTS_PER_M_OUT;
   }, 0);

 1c. Cost Display Always Showing 0€

 Root cause investigation needed in: convex/usage.ts recordUsageWithCost → checkUserBudget. The recordUsage mutation (without cost) is still called in some paths. Audit all call sites of recordUsage vs recordUsageWithCost in pipeline.ts and confirm pricing is being fetched
 correctly. The model catalog pricing lookup (lines 118–145 in usage.ts) depends on modelCatalog having prices populated. If the catalog is empty for a school, all costs appear as 0.

 Fix: In pipeline.ts, ensure pricing data from resolveCatalogPricing(modelUsed) is always passed to recordUsageWithCost. Add a fallback: if no catalog pricing, pass the live catalog prices fetched from OpenRouter. Additionally, verify the Convex catalogSync job is running and
 populating modelCatalog rows with inputCostPerM / outputCostPerM — if not, trigger it on first use.

 ---
 Group 2 — Personal SOUL & Memory System Overhaul

 Files: convex/memory.ts, src/lib/orchestrator/post-process.ts, src/lib/orchestrator/pipeline.ts

 2a. Memory Extraction — Make It Actually Work

 The current maybeExtractMemory in post-process.ts runs after each response, but the extraction quality is poor and only fires on certain conditions.

 Fix:
 - Improve the LLM prompt in maybeExtractMemory to extract richer facts: student name, grade, school, subjects, learning goals, weaknesses, personality traits, communication preferences, timezone/location, languages spoken.
 - Increase MEMORY_MAX_ENTRIES from 20 to 50 in convex/memory.ts.
 - Add a upsertMemoryEntry mutation to Convex that supports intelligent merging (don't overwrite high-confidence entries with low-confidence ones).
 - Save raw conversation snippets as compressed context alongside key-value entries.

 2b. Context Injection Into System Prompt

 In pipeline.ts, the system prompt already injects memoryProfile, but only if buildRelevantMemoryProfile returns something. This function in post-process.ts scores entries against the current message — but threshold MEMORY_PROFILE_MIN_SCORE = 0.08 may be too low/high.

 Fix:
 - Always inject a static personal context block into the system prompt: user's name (from Clerk), current date/time, school name, timezone — regardless of memory relevance.
 - Inject relevant memory entries via the existing buildRelevantMemoryProfile mechanism (keep as-is).
 - Add a background soul-update event: after each turn, if memory was extracted, send {type: "soul_update", entries: [...]} so the client can show a subtle "memory updated" indicator without polluting the conversation.

 2c. File/Image Memory — RAG Working Properly

 Files: src/lib/orchestrator/retrieval.ts, convex/rag.ts, src/lib/attachments/normalizer.ts

 The problem: personal resources are uploaded and chunked but RAG retrieval may not be fetching them correctly during conversations, or embeddings are failing silently.

 Fix:
 - In runRagRetrieval, ensure usePersonalResources: true correctly queries chunks with ownerUserId filter. Add explicit error logging when vector search returns 0 results.
 - In normalizeAttachments, fix any silent failures — catch and surface attachment processing errors to the client via a {type: "notice"} event.
 - Add a {type: "rag_used", sources: [...]} event so the client can show which personal files were referenced.

 2d. School SOUL — Ensure It Reaches the Model

 The School SOUL (orgSoulDocs/orgSoulChunks) is queried via soul:retrieveSoulGuidance and injected into the system prompt as soulBullets. Verify this is working end-to-end and add a trace token soul_injection (already partially done) that shows in the route trace.

 ---
 Group 3 — File Upload & Format Support Overhaul

 Files: src/app/api/resources/route.ts, convex/resources.ts, convex/ingestQueue.ts, convex/rag.ts

 3a. File Upload Performance

 - Move file uploads to direct-to-Convex storage using convex.storage.generateUploadUrl() on the client, bypassing the API route entirely. This eliminates the API middleman latency.
 - Show upload progress using the Convex storage upload URL's XHR progress events.
 - Process chunking/embedding asynchronously via Convex scheduled functions (already exists in ingestQueue.ts).

 3b. Supported Formats (No Video)

 Accept and process:
 - Documents: PDF, DOCX, PPTX, XLSX, TXT, MD, RTF, ODT
 - Code: .py, .js, .ts, .java, .cpp, .c, .go, .rs, .sql, .sh, .json, .yaml, .xml, .csv
 - Images: PNG, JPG, JPEG, GIF, WEBP, SVG (extract via vision model)
 - Audio: MP3, WAV, M4A (transcribe via whisper model on OpenRouter)
 - BANNED: all video formats (MP4, MOV, AVI, MKV, WEBM, etc.)

 Add MIME type validation in src/app/api/resources/route.ts with explicit video format rejection returning a clear error message.

 ---
 Group 4 — Orchestration System Hardening

 Files: src/lib/orchestrator/pipeline.ts, src/lib/model-selection.ts, src/lib/routing/heuristic.ts, src/lib/orchestrator/retrieval.ts

 4a. Dynamic Model Capability Detection (No Hardcoding)

 The main orchestrator model selected by the user IS the primary. Specialist models are summoned dynamically. Audit model-selection.ts and heuristic.ts for any hardcoded model IDs. Replace with catalog-based capability lookups:
 - Vision capability: multimodalRating !== "none" from catalog
 - Reasoning: reasoningRating === "high"
 - Code: capabilities.code > 0.7
 - Image generation: tags.includes("image-generation")

 4b. SearXNG Integration

 New file: src/lib/search/searxng.ts

 // Public SearXNG instances (tested, with fallback)
 const SEARXNG_INSTANCES = [
   "https://searx.be",
   "https://search.bus-hit.me",
   "https://searxng.world",
   "https://paulgo.io",
   "https://searx.tiekoetter.com",
 ];

 export async function searxngSearch(query: string): Promise<SearXNGResult[]> {
   for (const instance of SEARXNG_INSTANCES) {
     try {
       const res = await fetch(`${instance}/search?q=${encodeURIComponent(query)}&format=json&language=en`, {
         signal: AbortSignal.timeout(3000),
       });
       if (!res.ok) continue;
       const data = await res.json();
       return data.results?.slice(0, 6) ?? [];
     } catch { continue; }
   }
   return []; // All instances failed — caller falls back to model search
 }

 In retrieval.ts, modify maybeSearchWeb to try SearXNG first; if it returns results, use them to build the search block. If it returns empty (all instances failed), fall back to the current model-based search.

 Add a SEARXNG_ENABLED setting to the org settings and user settings drawer. Toggle per-user in chat-settings-drawer.tsx, toggle platform-wide in admin.

 4c. Multi-Agent Orchestration Transparency

 - Increase maxSpecialists in "normal" tier from 5 to 7 for complex tasks.
 - Add a client-side event {type: "agent_summoned", model, role, reason} so the UI can show which specialist models are being called.
 - The orchestrator should more aggressively summon specialists for: code tasks, math, vision, research, creative writing, document generation.

 ---
 Group 5 — New "Document" Mode + Flexible Mode System

 5a. New Study Mode: document

 Files: src/types.ts, src/lib/modes.ts, convex/shared.ts, convex/schema.ts

 Add document to the vStudyMode union and StudyMode type. Register in MODE_REGISTRY with:
 - label: "Documents"
 - description: "Create slides, Word docs, PDFs, and rich documents with AI"
 - color: var(--mode-document) (add CSS var)
 - icon: FileText

 5b. Document Generation Pipeline

 New file: src/lib/document-generator.ts

 AI generates structured JSON for the document, then client renders it:

 Slide format (PPTX):
 {
   "type": "presentation",
   "title": "...",
   "slides": [
     {
       "layout": "title" | "content" | "two-column" | "image" | "blank",
       "title": "...",
       "body": "...",
       "bullets": ["..."],
       "notes": "...",
       "accent": "#hex"
     }
   ]
 }

 Word format (DOCX):
 {
   "type": "word",
   "title": "...",
   "sections": [
     { "heading": "...", "level": 1 | 2 | 3, "content": "..." }
   ]
 }

 PDF format: Rendered from HTML template via jsPDF + html2canvas.

 The AI system prompt for document mode instructs the model to output <<DOCUMENT_START>>...json...<<DOCUMENT_END>> with the structured content, plus optionally conversational commentary outside the delimiters.

 5c. Document Viewer/Editor Component

 New file: src/components/chat/document-panel.tsx

 A split-view panel that:
 - Shows rendered document preview (HTML/CSS, not actual Office format until download)
 - Download buttons: "Export as PPTX", "Export as DOCX", "Export as PDF"
 - Inline editing: click to edit text directly
 - Chat sidebar remains open for iterative refinement
 - Uses pptxgenjs for PPTX, docx npm package for DOCX, jspdf + html2canvas for PDF

 Slide preview rendered as CSS-styled divs with beautiful default themes (corporate, academic, minimal, vibrant).

 5d. Flexible Mode Philosophy — Modes as Guides, Not Hard Walls

 The current mode system is binary. Change to a "hints + blending" approach:
 - In document mode: AI can chat AND generate documents. Not forced to generate a document on every turn.
 - In quiz mode: AI can explain concepts conversationally before presenting the quiz. The model is instructed to "answer first if helpful, then generate quiz".
 - In flashcard mode: AI can discuss the topic and then generate flashcards — or do both together.
 - In research mode: AI can generate a structured research document automatically at the end.
 - In explain mode: AI can include a quick quiz at the end of a long explanation.

 This is implemented by modifying the system prompts in src/lib/prompts/policy.ts to say "You may blend modes when pedagogically helpful" and adding mode-specific instructions that say "you may also [related activity]".

 5e. Additional Renderable Formats

 Beyond presentations and docs:
 - Mind maps: JSON tree → rendered as interactive SVG mind map using d3-hierarchy (client-side)
 - Study guides: Structured markdown with highlights, key terms, summaries
 - Timelines: JSON events array → rendered as CSS timeline component
 - Comparison tables: JSON → rendered as styled table
 - Concept maps: JSON nodes/edges → vis-network or similar

 All rendered inline in the chat or in the document panel.

 ---
 Group 6 — Analytics Page Overhaul

 File: src/components/analytics/analytics-dashboard.tsx

 Changes:

 1. Remove ModePieChart (the conic-gradient pie). Replace with ModeBreakdown (horizontal bar chart — already imported from src/components/analytics/mode-breakdown.tsx). Delete the ModePieChart function entirely.
 2. Merge Daily Activity + Time Spent into one dual-axis Recharts ComposedChart:
   - Left Y-axis: messages (Bar)
   - Right Y-axis: study time in minutes (Line)
   - X-axis: day labels
   - This replaces both the ActivityChart and StudyTimeChart sections.
   - Occupy full width (xl:col-span-2).
 3. Quiz Performance Chart: Make it smaller (h-32 instead of h-52), reduce prominence. Move it below the merged activity chart.
 4. Personal Model Leaderboard: New component ModelLeaderboard using data from /api/analytics/model-leaderboard. Display as a compact ranked list with usage count + quality rating. Sits next to the quiz chart.
 5. Class Overview duplicates: Remove duplicate TopicCloud import. Remove "Topics explored by type" if it duplicates the topic cloud. The class overview section should have: activity chart, mode breakdown, class stats strip — nothing else.
 6. Recharts standardization: Standardize all chart tooltips to use background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: 8.

 ---
 Group 7 — Models Page Fixes

 File: src/app/models/page.tsx

 1. Right panel width: Change the right panel grid column from current width to w-[280px] (from whatever it currently is — likely w-[320px] or similar). Apply via rightPanelSurfaceClassName or explicit width class.
 2. Provider icon clipping fix: In the model list items, the ProviderLogo component is being rendered inside a container that clips it. Fix: add shrink-0 and min-w-[24px] to the icon wrapper, remove any overflow-hidden that truncates it.
 3. Leaderboard card sizes: The leaderboard entries are smaller than the provider filter options. Standardize to py-2.5 px-3 with min-h-[44px] for both.
 4. "Why this model" candidates UI: The current display is a grid of large cards for each candidate model. Replace with a compact ranked list: model name + provider icon + score bar + one-line reason. Each entry h-10 instead of a full card.

 ---
 Group 8 — Flashcards & Quiz Fixes

 Flashcards (src/app/flashcards/page.tsx)

 1. Remove duplicate progress bar: There is a smaller progress bar below the timer AND the larger one above. Keep only the large one. Change its color: green during study phase, amber during break phase.
 2. Phase transition notification: When the study timer phase ends (or break ends), show a toast notification: toast.success("Study phase complete! Time for a break.", { duration: 5000 }).
 3. Better SRS: In src/lib/spaced-repetition.ts, review the SM-2 ease factor bounds. Add a "Blackout" (quality 1) option alongside the current Again/Hard/Good/Easy.

 Quizzes — Save & Restore Progress

 Files: src/app/page.tsx (quiz renderer), convex/quizzes.ts, src/app/api/quizzes/route.ts

 The quizResults table already exists with messageId index. When user starts answering a quiz:
 1. Save partial answers to localStorage keyed by messageId.
 2. On page reload/navigation back, check localStorage — if partial state exists for this messageId, restore it.
 3. On submit, write to Convex quizResults and clear localStorage entry.
 4. Also restore completed quiz results from Convex quizResults by messageId.

 ---
 Group 9 — Admin & Settings Overhaul

 Admin Panel (src/app/admin/page.tsx and subdirectories)

 Redesign sections:
 1. School SOUL — Edit org soul docs, preview how they're used, publish/draft versions
 2. Members — Table of students/teachers, invite management, seat count (X/maxStudents used), role management
 3. Usage & Models — Per-student token/cost breakdown (no chat content), model usage leaderboard, allow/deny specific models
 4. Branding — Logo, colors, welcome message, description (already exists, keep)
 5. Settings — SearXNG toggle, adaptive quiz toggle, spaced repetition toggle, agent model boost toggle, orchestratorV2 toggle
 6. Agents — List school agents with visibility controls (public/private/collaborators-only)

 Remove: Budget cap per school (as requested). Admins see costs for visibility, not to set caps.

 Settings Drawer (src/components/chat/chat-settings-drawer.tsx)

 Reorganize into tabs or sections:
 1. AI Behavior — Auto enhance, auto thinking, auto search (keep), + new: SearXNG toggle (per user), memory on/off toggle
 2. Personal Resources — File library management (keep)
 3. Appearance — Theme toggle (if not already in global settings)
 4. Experimental — Document generation toggle, multi-agent verbose mode, "show specialist models in use" toggle

 Settings right panel: set to same width as all other right panels. Use rightPanelSurfaceClassName consistently.

 ---
 Group 10 — B2B Invite & Seat Control

 Files: src/middleware.ts (or create it), src/app/api/webhooks/clerk/route.ts, convex/users.ts, admin members page

 Flow:

 1. Super-admin sets maxStudents on an org (already in schema).
 2. Admin invites student by email → creates schoolInvitations row (status: pending, generates token).
 3. Email sent (via Resend/similar) with a magic link: /join?token=....
 4. Join page (src/app/join/page.tsx — already exists) validates token, redirects to Clerk sign-up with email pre-filled.
 5. Clerk webhook (afterSignUp) → checks: (a) email matches a pending invitation, (b) org hasn't exceeded maxStudents. If either fails → mark user as rejected, redirect to error page. If passes → create Convex user, mark invitation as accepted.
 6. Middleware (middleware.ts): After authentication, check if the user exists in Convex users table. If authenticated with Clerk but not in Convex (no valid invitation accepted), redirect to /no-access.

 New page: src/app/no-access/page.tsx — "Your account isn't linked to a school. Contact your school administrator."

 School Isolation Audit

 Verify every Convex query/mutation uses orgId filter:
 - agents:listAgents — filter by orgId ✓
 - memory:getUserMemory — filter by userId ✓ (but verify org isolation — a user should only have memory within their org)
 - flashcardDecks — filter by userId ✓
 - modelRuntimeStats — filter by orgId ✓
 - userMemory — add orgId to index and filter so memories are org-scoped

 ---
 Group 11 — Responsive UI & Global Polish

 Responsive Breakpoints

 All pages must work at:
 - Mobile: 375px+ (single column, stacked panels)
 - Tablet: 768px+ (collapsible sidebar)
 - Desktop: 1024px+ (current layout)
 - Wide: 1440px+ (expanded panels)

 Add sm:, md:, lg:, xl: breakpoints to pages that are currently desktop-only: analytics, models, flashcards, agents.

 Global Settings Panel Width

 In rightPanelSurfaceClassName (file: src/components/ui/right-panel-surface.tsx), ensure width is consistent. The settings drawer uses the same class as all other right panels.

 Agent Visibility & Collaboration

 File: convex/agents.ts, src/app/agents/page.tsx

 The schema has visibility: "public" | "private" and collaborators: v.array(v.id("users")). Ensure the UI exposes:
 - Private agents: only visible to creator
 - Public agents: visible to all school members
 - Collaborator agents: visible/editable by listed collaborators (add "shared" visibility option to schema)

 ---
 Convex Schema Additions

 // Add to existing schema:

 // Agent "shared" visibility (in addition to public/private)
 // agents.visibility: v.union(v.literal("public"), v.literal("private"), v.literal("shared"))

 // Add orgId index to userMemory for proper isolation
 // userMemory: add .index("by_user_org", ["userId", "orgId"])

 // Add quizSession table for in-progress quiz state
 quizSessions: defineTable({
   userId: v.id("users"),
   orgId: v.id("orgs"),
   messageId: v.id("messages"),
   answers: v.array(v.object({ questionId: v.string(), selected: v.string() })),
   startedAt: v.number(),
   updatedAt: v.number(),
 }).index("by_message", ["messageId"]).index("by_user", ["userId"]),

 ---
 New Dependencies to Add

 "pptxgenjs": "^3.12.0",
 "docx": "^8.5.0",
 "jspdf": "^2.5.2",
 "html2canvas": "^1.4.1"

 ---
 Security Checklist

 - Seat limit enforcement in Clerk webhook — cannot be bypassed by direct API calls
 - All Convex mutations verify orgId matches actor's org (never trust client-sent orgId)
 - Budget enforcement: token-volume estimate for unpriced models prevents bypass
 - File upload: MIME type validation server-side (not just client-side)
 - Agent visibility: listAgents query filters by org AND visibility — private agents never returned to non-owners
 - Admin routes: verify role === "admin" in Convex, not just middleware
 - Super-admin routes: verify via Convex superAdmin:isSuperAdmin check on every route

 ---
 Implementation Order (within the single PR)

 1. Group 1 (critical bugs — 3 targeted fixes, minimal blast radius)
 2. Group 2 (SOUL/memory — backend only first, then prompt injection)
 3. Group 3 (file upload — direct-to-storage, format support)
 4. Group 10 (B2B invite — middleware + webhook + join page)
 5. Group 4 (orchestration — SearXNG + capability detection)
 6. Group 5 (Documents mode — new StudyMode + pipeline + UI)
 7. Group 6 (analytics fixes — component changes)
 8. Group 7 (models page — targeted fixes)
 9. Group 8 (flashcards/quiz — progress bar + save/restore)
 10. Group 9 (admin/settings — redesign)
 11. Group 11 (responsive polish + agent visibility)

 ---
 Key Files Modified

 ┌──────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────┐
 │                       File                       │                              Changes                               │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/lib/orchestrator/pipeline.ts                 │ mode_update bug fix; context injection; doc mode support           │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ convex/usage.ts                                  │ token-volume estimate; cost tracking fix                           │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ convex/schema.ts                                 │ quizSessions table; agents shared visibility; userMemory org index │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ convex/memory.ts                                 │ MEMORY_MAX_ENTRIES 50; upsertMemoryEntry mutation                  │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/lib/search/searxng.ts                        │ NEW — SearXNG client with instance fallback                        │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/lib/orchestrator/retrieval.ts                │ SearXNG integration; RAG error logging                             │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/lib/document-generator.ts                    │ NEW — document JSON schema + parser                                │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/components/chat/document-panel.tsx           │ NEW — document preview + export UI                                 │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/lib/modes.ts                                 │ Add document mode to registry                                      │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/types.ts                                     │ Add document to StudyMode union                                    │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ convex/shared.ts                                 │ Add document to vStudyMode                                         │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/components/analytics/analytics-dashboard.tsx │ Remove pie, merge charts, add model leaderboard                    │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/app/models/page.tsx                          │ Right panel width, icon fix, leaderboard cards, candidates UI      │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/app/flashcards/page.tsx                      │ Remove duplicate bar, add notifications                            │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/app/admin/page.tsx                           │ Full redesign of admin sections                                    │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/components/chat/chat-settings-drawer.tsx     │ Reorganize + add toggles                                           │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/app/api/webhooks/clerk/route.ts              │ Seat limit enforcement                                             │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/app/join/page.tsx                            │ Token validation + Clerk redirect                                  │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/app/no-access/page.tsx                       │ NEW — rejection page                                               │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/middleware.ts                                │ Convex user existence check                                        │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ src/app/api/resources/route.ts                   │ Video ban + format allowlist                                       │
 ├──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────┤
 │ convex/agents.ts                                 │ Shared visibility; collaborator queries                            │
 └──────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────┘

 ---
 Verification

 - Chat sends a message → mode_update appears in correct order (no deadlock)
 - After 3+ messages, cost shows non-zero in settings panel
 - Upload a PDF → RAG works in next message (citation appears)
 - Upload a video → rejected with clear error
 - Admin invites email → user receives link → registers → seat count increments
 - Uninvited email tries to sign up → redirected to /no-access
 - Seat limit reached → next invite blocked with error
 - Typing "make me a presentation about..." in document mode → PPTX download appears
 - Quiz mode: reload page mid-quiz → answers restored
 - Analytics: single merged chart, no duplicate components
 - SearXNG: disable all test instances → falls back to model search automatically
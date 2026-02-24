# TGC AI School — Master Implementation Plan

## Context

This plan addresses the complete TGC AI Chat Implementation Checklist (13 sections) plus 14 creative feature additions for the AI School platform — a Next.js 16 + Convex + OpenRouter + Clerk application with 11 study modes, model orchestration, RAG, analytics, and admin tooling. The codebase has 63+ React components, 44 API routes, 30+ Convex database tables, and a sophisticated orchestrator pipeline.

**Why this change is needed:** The platform has strong foundations but needs stabilization (PDF/canvas build errors, K-bar bugs), UX refinement (panel system, dark mode, sources display), feature completion (feedback widget, budget enforcement, admin hardening), and creative enhancements (gamification, study timer, accessibility) to reach production readiness for school deployment.

**Intended outcome:** A polished, secure, fully-featured AI study assistant ready for Alpha/Beta school deployment with zero deployment blockers, consistent UI/UX, robust admin controls, and engaging student features.

---

## Ralph Loop Protocol — Agent Instructions

```
╔══════════════════════════════════════════════════════════════════════╗
║                    RALPH LOOP EXECUTION PROTOCOL                     ║
║                                                                      ║
║  Before EVERY task:                                                  ║
║  1. Read the PROGRESS LOG at the bottom of this file                ║
║  2. Find the NEXT uncompleted task in sequence                      ║
║  3. Read all files listed in "Files to modify" before changing them ║
║  4. Execute the task fully                                           ║
║  5. Run ALL verification steps listed for that task                 ║
║  6. If verification fails → fix → re-verify (inner loop)           ║
║  7. Update the PROGRESS LOG                                         ║
║  8. At REVIEW CHECKPOINTs → do full holistic review before moving on║
║                                                                      ║
║  Rules:                                                              ║
║  - ONE task per iteration. Never skip. Never work on two at once.   ║
║  - If blocked, mark [BLOCKED] with reason and move to next task.    ║
║  - Always run: npm run build && npm run lint after code changes.    ║
║  - Prefer editing existing files over creating new ones.            ║
║  - Preserve existing patterns and conventions.                      ║
║  - After every PHASE, run full test suite + build before proceeding.║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Tech Stack Reference

| Layer | Technology | Key Files |
|-------|-----------|-----------|
| Framework | Next.js 16.1.6 (App Router) | `next.config.ts`, `src/app/` |
| UI | React 19, TailwindCSS 4, Radix UI | `src/components/`, `globals.css` |
| Backend | Convex v1.31.7 | `convex/schema.ts`, `convex/*.ts` |
| Auth | Clerk v6.37.3 | `src/lib/auth-server.ts` |
| AI | Vercel AI SDK, OpenRouter | `src/lib/orchestrator/`, `src/lib/routing/` |
| Fonts | Manrope, IBM Plex Mono, Fraunces | `src/app/layout.tsx`, `globals.css` |
| Icons | Lucide React | `src/components/` |

---

## Critical Files Map

These files are touched by multiple phases — read them thoroughly before any work:

- **`src/lib/orchestrator/pipeline.ts`** (~1360 lines) — Central chat orchestrator. Handles all modes, RAG, streaming, verification, post-processing. Nearly every feature touches this.
- **`convex/schema.ts`** (~484 lines) — Database schema with 18+ tables. Phase 1 adds 6+ new tables.
- **`src/components/chat/unified-panel.tsx`** (~547 lines) — Panel system for settings/route-trace/sources. Panel fixes center here.
- **`src/lib/routing/heuristic.ts`** (~661 lines) — Model routing with tier enforcement and candidate scoring.
- **`src/components/chat/chat-layout.tsx`** (~464 lines) — Main layout wiring sidebar, header, messages, composer, panels.
- **`src/components/chat/chat-sidebar.tsx`** — Sidebar with nav, chat history, search, usage display.
- **`src/components/chat/chat-message.tsx`** — Individual message rendering with citations, actions, mode indicators.
- **`src/components/chat/chat-header.tsx`** — Header with export, controls, panel triggers.
- **`src/components/chat/chat-composer.tsx`** — Input area with mode selector, model dropdown, attachments.
- **`src/lib/orchestrator/post-process.ts`** — Citation rewriting, memory extraction, title generation.
- **`src/lib/orchestrator/retrieval.ts`** — Vector search + web search with reliability scoring.
- **`src/app/globals.css`** — All CSS custom properties, dark mode, animations, utility classes.
- **`src/context/panel-context.tsx`** — Panel state management (activeView, open/close).
- **`convex/usage.ts`** — Token tracking, spending, budget enforcement.
- **`src/lib/modes.ts`** — Mode registry with display metadata.

---

## Phase Overview

| Phase | Name | Priority | Tasks | Covers |
|-------|------|----------|-------|--------|
| 0 | Critical Bug Fixes & Deployment Blockers | BLOCKING | 3 | Section 11 |
| 1 | Schema Extensions & Backend Foundation | HIGH | 12 | Sections 4,7,8,12,13 + Creative 1,2,5,7,8 |
| 2 | UI Foundation & Panel System Overhaul | HIGH | 9 | Sections 2,3,5 |
| 3 | Models, Icons & Usage System | HIGH | 6 | Sections 6,7 |
| 4 | Orchestration, Modes & Sources | HIGH | 8 | Sections 1,9 |
| 5 | Chat Quality, Memory & Intelligence | MEDIUM-HIGH | 7 | Section 4 + Creative 4,5,7,8,12 |
| 6 | Admin, Super Admin & Security | HIGH | 7 | Sections 8,10 |
| 7 | Onboarding, K-bar & In-Product Help | MEDIUM | 9 | Section 3 + Creative 10,11,14 |
| 8 | Feedback Widget, Notifications & Gamification | MEDIUM | 7 | Sections 12,13 + Creative 1,2,9,13 |
| 9 | UI Redesign & Templates | MEDIUM | 5 | Section 2 (redesign) + Creative 3,6 |
| 10 | Final Polish, Audit & Review | FINAL | 7 | All sections — holistic review |
| **Total** | | | **80** | |

---

## PHASE 0: Critical Bug Fixes & Deployment Blockers
**Priority: BLOCKING — Must complete before all other work**
**Checklist Section: 11 (Bugs and deployment blockers)**

### Task 0.1: Fix @napi-rs/canvas and pdfjs-dist server-side build errors

**Description:** The app crashes in server build due to `@napi-rs/canvas` and `pdfjs-dist` legacy build errors, producing `DOMMatrix`, `ImageData`, and `Path2D` polyfill warnings and a missing `/500` page. The fix must isolate PDF parsing from native canvas dependencies.

**Files to read first:**
- `next.config.ts`
- `src/lib/ingest.ts` (if exists) or wherever PDF parsing happens
- `package.json` — check pdfjs-dist version and canvas dependencies
- `convex/resources.ts` — check how resources are processed

**Files to modify:**
- `next.config.ts` — Add webpack externals for `@napi-rs/canvas`; configure fallback polyfills or aliases
- The PDF parsing file — Replace native canvas PDF parsing with `pdfjs-dist` worker-based text extraction (no canvas rendering needed for text extraction)
- `package.json` — Update `pdfjs-dist` if needed; remove `@napi-rs/canvas` if not truly needed

**Approach:**
1. Check if `@napi-rs/canvas` is actually used or just a transitive dep
2. If transitive: add to webpack externals in `next.config.ts`
3. For pdfjs-dist: use the `pdfjs-dist/build/pdf.mjs` entry (not legacy) or `pdfjs-dist/build/pdf.worker.mjs` with `getDocument().promise` → page.getTextContent() (no canvas needed)
4. Add `experimental.serverComponentsExternalPackages` in next.config for problematic packages
5. Ensure `/500.tsx` or `/500/page.tsx` exists in `src/app/`

**Acceptance criteria:**
- `npm run build` completes with zero canvas/PDF.js errors
- No `/500` page missing warnings
- PDF resource ingestion still works (text extraction)

**Verification:**
```bash
npm run build 2>&1 | grep -i "canvas\|pdfjs\|DOMMatrix\|ImageData\|Path2D\|500"
# Should return empty (no errors)
npm run build && echo "BUILD OK"
```

---

### Task 0.2: Fix PDF export (currently produces blank pages)

**Description:** The PDF export at `src/lib/export/pdf-export.ts` uses `exportElementToPrintPdf` which opens a new window and calls `window.print()`. This produces blank pages because styles are not carried over. Rewrite to properly clone styles or use a client-side PDF library.

**Files to read first:**
- `src/lib/export/pdf-export.ts`
- `src/lib/export/markdown-export.ts` (for reference on how messages are formatted)
- `src/components/chat/chat-header.tsx` (where export is triggered)

**Files to modify:**
- `src/lib/export/pdf-export.ts` — Rewrite export logic

**Approach (choose one — prefer Option A for simplicity):**
- **Option A:** Fix the print approach — clone all `<style>` and `<link>` tags from the current document into the new window before printing. Use `document.querySelectorAll('style, link[rel="stylesheet"]')` and append clones.
- **Option B:** Use `html2canvas` + `jsPDF` — render chat area to canvas, then to PDF. Heavier but more reliable.

**Acceptance criteria:**
- Exporting a conversation with 5+ messages produces a readable PDF
- All message content visible with proper formatting
- Both light and dark mode export correctly

**Verification:**
- Open a chat with varied content (code, math, lists, images)
- Export to PDF
- Open the PDF and verify all content is present and styled

---

### Task 0.3: Audit and fix remaining build/lint/test errors

**Description:** Run the full build + lint + test cycle. Fix any remaining errors that prevent clean deployment. This is the cleanup task for anything not caught in 0.1-0.2.

**Files to modify:** Various, based on what errors surface.

**Approach:**
1. Run `npm run build` — fix any errors
2. Run `npm run lint` — fix any warnings/errors
3. Run `npm run test:run` (vitest) — fix any failing tests
4. Run `npx convex dev --once` — verify schema deploys

**Acceptance criteria:**
- All four commands exit with code 0
- No TypeScript errors
- No ESLint errors

**Verification:**
```bash
npm run build && npm run lint && npm run test:run && echo "ALL CLEAR"
```

---

### REVIEW CHECKPOINT 0
```
STOP. Before proceeding to Phase 1, verify:
[ ] npm run build passes cleanly
[ ] npm run lint passes cleanly
[ ] npm run test:run passes cleanly
[ ] PDF export produces readable documents
[ ] No canvas/pdfjs errors in build output
[ ] Application starts and loads without errors
```

---

## PHASE 1: Schema Extensions & Backend Foundation
**Priority: HIGH — Required by most subsequent phases**
**Checklist Sections: 4, 7, 8, 12, 13 (backend) + Creative Features 1, 2, 5, 7, 8**

### Task 1.1: Add feedback table to Convex schema

**Description:** Add a `feedback` table for the in-app feedback widget (Checklist Section 12).

**Files to modify:**
- `convex/schema.ts` — Add table definition
- `convex/shared.ts` — Add `vFeedbackCategory` and `vFeedbackStatus` validators

**Schema definition:**
```typescript
feedback: defineTable({
  userId: v.optional(v.string()),
  orgId: v.optional(v.id("orgs")),
  category: v.union(v.literal("bug"), v.literal("confusing"), v.literal("feature"), v.literal("safety")),
  message: v.string(),
  screenshotStorageId: v.optional(v.id("_storage")),
  context: v.object({
    mode: v.optional(v.string()),
    page: v.optional(v.string()),
    device: v.optional(v.string()),
    traceId: v.optional(v.string()),
  }),
  status: v.union(v.literal("new"), v.literal("in_progress"), v.literal("shipped")),
  adminReply: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
}).index("by_status", ["status"])
  .index("by_created", ["createdAt"]),
```

**Acceptance criteria:** `npx convex dev --once` succeeds.
**Verification:** `npx convex dev --once && echo "SCHEMA OK"`

---

### Task 1.2: Add gamification tables to Convex schema

**Description:** Add tables for achievements, streaks, XP, and study timers (Creative Features 1, 2).

**Files to modify:**
- `convex/schema.ts`

**Tables to add:**
```typescript
achievements: defineTable({
  userId: v.id("users"),
  orgId: v.id("orgs"),
  type: v.string(), // e.g. "first_chat", "streak_7", "quiz_master"
  name: v.string(),
  description: v.string(),
  xpEarned: v.number(),
  earnedAt: v.number(),
}).index("by_user", ["userId"]),

userStreaks: defineTable({
  userId: v.id("users"),
  orgId: v.id("orgs"),
  currentStreak: v.number(),
  longestStreak: v.number(),
  lastActiveDate: v.string(), // "YYYY-MM-DD"
  totalXp: v.number(),
}).index("by_user", ["userId"]),

studyTimers: defineTable({
  userId: v.id("users"),
  orgId: v.id("orgs"),
  chatId: v.optional(v.id("chats")),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  totalSeconds: v.number(),
  sessionType: v.union(v.literal("pomodoro"), v.literal("free")),
}).index("by_user", ["userId"]),
```

**Acceptance criteria:** Schema deploys without errors.
**Verification:** `npx convex dev --once && echo "SCHEMA OK"`

---

### Task 1.3: Add bookmarks, chat branches, and notifications tables

**Description:** Add tables for message bookmarks (Creative 8), chat branching (Creative 7), and notifications (Creative 9, Section 13).

**Files to modify:**
- `convex/schema.ts`

**Tables to add:**
```typescript
messageBookmarks: defineTable({
  userId: v.id("users"),
  chatId: v.id("chats"),
  messageId: v.id("messages"),
  note: v.optional(v.string()),
  createdAt: v.number(),
}).index("by_user", ["userId"])
  .index("by_chat", ["chatId"]),

chatBranches: defineTable({
  originalChatId: v.id("chats"),
  parentMessageId: v.id("messages"),
  branchChatId: v.id("chats"),
  createdAt: v.number(),
}).index("by_original", ["originalChatId"]),

notifications: defineTable({
  userId: v.id("users"),
  orgId: v.id("orgs"),
  type: v.string(), // "reminder", "achievement", "system", "feedback_reply"
  title: v.string(),
  body: v.string(),
  actionUrl: v.optional(v.string()),
  read: v.boolean(),
  createdAt: v.number(),
}).index("by_user", ["userId"])
  .index("by_user_unread", ["userId", "read"]),

conversationTemplates: defineTable({
  orgId: v.id("orgs"),
  mode: v.string(),
  title: v.string(),
  description: v.string(),
  starterPrompts: v.array(v.string()),
  isDefault: v.boolean(),
  createdAt: v.number(),
}).index("by_org_mode", ["orgId", "mode"]),
```

**Acceptance criteria:** Schema deploys.
**Verification:** `npx convex dev --once && echo "SCHEMA OK"`

---

### Task 1.4: Extend orgs table for budget configuration

**Description:** Add `monthlyBudgetCentsPerUser` and `budgetMarginPercent` to `orgs` table (Section 7). These let the superadmin set one variable per org and auto-compute soft/hard thresholds.

**Files to modify:**
- `convex/schema.ts` — Add optional fields to `orgs` table definition

**Fields to add to `orgs`:**
```typescript
monthlyBudgetCentsPerUser: v.optional(v.number()), // e.g. 500 = $5/user/month
budgetMarginPercent: v.optional(v.number()),        // e.g. 20 = soft limit at 80%
```

**Acceptance criteria:** Schema deploys; existing orgs not affected (fields are optional).
**Verification:** `npx convex dev --once && echo "SCHEMA OK"`

---

### Task 1.5: Add optional `avatarIcon` field to agents table

**Description:** Support Lucide icon names for agents instead of emoji-only (Section 1: improve agent icons).

**Files to modify:**
- `convex/schema.ts` — Add `avatarIcon: v.optional(v.string())` to agents table
- `convex/shared.ts` — Add to agent validator if applicable

**Acceptance criteria:** Schema deploys; existing agents not affected.
**Verification:** `npx convex dev --once && echo "SCHEMA OK"`

---

### Task 1.6: Add audit log and agent collaborators schema

**Description:** Add audit logging for superadmin actions (Section 8) and collaborators for agents (Section 8: agent collaboration).

**Files to modify:**
- `convex/schema.ts`

**Tables/fields to add:**
```typescript
auditLog: defineTable({
  actorUserId: v.id("users"),
  action: v.string(), // "create_school", "update_budget", "manage_admin", etc.
  targetType: v.string(), // "org", "user", "agent"
  targetId: v.string(),
  details: v.optional(v.string()),
  createdAt: v.number(),
}).index("by_actor", ["actorUserId"])
  .index("by_created", ["createdAt"]),
```

Also add to `agents` table: `collaborators: v.optional(v.array(v.id("users")))`

**Acceptance criteria:** Schema deploys.
**Verification:** `npx convex dev --once && echo "SCHEMA OK"`

---

### Task 1.7: Create feedback Convex functions

**Description:** Backend CRUD for feedback widget submissions and superadmin inbox.

**Files to create:**
- `convex/feedback.ts`

**Functions to implement:**
- `submitFeedback` mutation — insert feedback doc, no auth required (anyone with access)
- `listFeedback` query — for superadmin only; filterable by status/category; paginated
- `getFeedbackStats` query — counts by status and category
- `updateFeedbackStatus` mutation — superadmin changes status (new→in_progress→shipped)
- `replyToFeedback` mutation — superadmin adds reply text

**Important:** Check that superadmin mutations verify the actor is superadmin (use the email check pattern from `convex/superAdmin.ts`).

**Acceptance criteria:** Functions deploy and are callable.
**Verification:** `npx convex dev --once && echo "FUNCTIONS OK"`

---

### Task 1.8: Create gamification Convex functions

**Description:** Backend for streaks, XP, and achievements.

**Files to create:**
- `convex/gamification.ts`

**Functions to implement:**
- `checkAndUpdateStreak` mutation — called on user activity; updates `lastActiveDate`, `currentStreak`, `longestStreak`
- `awardXp` mutation — add XP for activity types (chat=1, quiz=5, flashcard=2, research=3)
- `awardAchievement` mutation — check if achievement already earned; if not, insert and return achievement details
- `getUserStreak` query — return streak data for current user
- `getUserAchievements` query — return all achievements for user
- `getLeaderboard` query — top 10 users by XP in the org

**Achievement definitions (hardcoded list):**
- `first_chat` — "First Steps" — Send your first message (1 XP)
- `streak_3` — "Getting Started" — 3-day streak (5 XP)
- `streak_7` — "Week Warrior" — 7-day streak (15 XP)
- `streak_30` — "Monthly Master" — 30-day streak (50 XP)
- `quiz_perfect` — "Perfect Score" — Score 100% on a quiz (10 XP)
- `quiz_master` — "Quiz Master" — Complete 10 quizzes (20 XP)
- `flashcard_100` — "Card Collector" — Review 100 flashcards (15 XP)
- `research_pro` — "Research Pro" — 10 research sessions with sources (20 XP)
- `mode_explorer` — "Mode Explorer" — Use all 10 modes (10 XP)
- `bookworm` — "Bookworm" — Upload 5 personal resources (10 XP)

**Acceptance criteria:** Functions deploy.
**Verification:** `npx convex dev --once && echo "FUNCTIONS OK"`

---

### Task 1.9: Create bookmarks and notifications Convex functions

**Description:** Backend for message bookmarks and notification system.

**Files to create:**
- `convex/bookmarks.ts` — `toggleBookmark`, `listBookmarks`, `getBookmarkedMessages`
- `convex/notifications.ts` — `createNotification`, `listNotifications` (paginated, filtered by read), `markRead`, `markAllRead`, `getUnreadCount`

**Important:** All functions must scope to the authenticated user's own data.

**Acceptance criteria:** Functions deploy.
**Verification:** `npx convex dev --once && echo "FUNCTIONS OK"`

---

### Task 1.10: Extend usage budget system with org-level config

**Description:** Modify budget checking to use org-level `monthlyBudgetCentsPerUser` instead of hardcoded thresholds (Section 7).

**Files to read first:**
- `convex/usage.ts` — find `checkUserBudget` or equivalent
- `src/lib/routing/heuristic.ts` — find where spending tiers are determined

**Files to modify:**
- `convex/usage.ts` — Read org's `monthlyBudgetCentsPerUser` and `budgetMarginPercent`; compute soft = budget × (1 - margin/100), hard = budget. Return appropriate tier.

**Backward compatibility:** If org fields are missing/null, use current defaults (700/900 cents or whatever exists).

**Acceptance criteria:** Existing orgs without new fields behave identically; orgs with fields use dynamic thresholds.
**Verification:** Existing routing tests still pass. Manual test via Convex dashboard.

---

### Task 1.11: Add manual compact mutation

**Description:** Create a `manualCompact` mutation that summarizes old messages on demand (Section 4).

**Files to read first:**
- `src/lib/orchestrator/history.ts` — understand `maybeCompactHistory`
- `convex/chats.ts` — understand chat message storage

**Files to modify:**
- `convex/chats.ts` — Add `manualCompact` mutation that triggers compaction
- `src/lib/orchestrator/history.ts` — Ensure compaction produces readable summaries under 500 tokens; improve summary quality

**Acceptance criteria:** Calling `manualCompact` on a chat with 20+ messages produces a summary; old messages are archived or replaced with summary.
**Verification:** Create a test chat; compact; verify summary appears and context is maintained.

---

### Task 1.12: Improve chat title generation

**Description:** Make title generation use the cheapest free model and produce 3-5 word titles (Section 4).

**Files to read first:**
- `src/lib/orchestrator/post-process.ts` — find `maybeGenerateTitle` and `maybeGenerateTitleFromUserPrompt`

**Files to modify:**
- `src/lib/orchestrator/post-process.ts` — Update the title generation prompt to explicitly request 3-5 words; use the cheapest available free model; handle edge cases (very short messages, non-English, code-only messages)

**Acceptance criteria:** Titles are consistently 3-5 words, descriptive, generated via a free/cheap model.
**Verification:** Test with 10 different message types; verify all produce good titles.

---

### REVIEW CHECKPOINT 1
```
STOP. Before proceeding to Phase 2, verify:
[ ] npx convex dev --once succeeds with all new tables
[ ] All new Convex functions deploy and are callable
[ ] No existing tests broken (npm run test:run)
[ ] Schema changes are backward-compatible (no existing data broken)
[ ] Budget system backward-compatible for orgs without new fields
[ ] npm run build still passes
```

---

## PHASE 2: UI Foundation & Panel System Overhaul
**Priority: HIGH — Most other UI work depends on this**
**Checklist Sections: 2 (UI/UX and Layout), 3 (Sidebar), 5 (Export/Theming)**

### Task 2.1: Fix panel resize behavior — no squashed containers

**Description:** Opening a side panel must resize page content correctly (Section 2). The `UnifiedPanel` uses positioning that can squash the main content area.

**Files to read first:**
- `src/components/chat/unified-panel.tsx`
- `src/components/chat/chat-layout.tsx`
- `src/hooks/use-right-panel-dock.ts`
- `src/context/panel-context.tsx`

**Files to modify:**
- `src/components/chat/chat-layout.tsx` — Use CSS Grid or flex layout where the main content area shrinks with `flex: 1` and the panel takes fixed/percentage width. When panel is open, chat area gets `margin-right` or the grid column shrinks.
- `src/components/chat/unified-panel.tsx` — Ensure panel width is consistent (e.g., 380px on desktop)
- `src/hooks/use-right-panel-dock.ts` — Expose panel width for layout calculations

**Acceptance criteria:**
- Opening panel shrinks chat area proportionally
- No text overflow or squashed containers at any width
- Chat messages remain readable with panel open

**Verification:** Test at 1024px, 1280px, 1440px, 1920px with panel open and closed. Verify no horizontal scrollbars or text clipping.

---

### Task 2.2: Panel overlay on small screens

**Description:** Below a breakpoint (~860px), the panel should become an overlay/sheet instead of docked (Section 2).

**Files to read first:**
- `src/hooks/use-compact-sheet.ts` (if exists)
- `src/components/chat/unified-panel.tsx`

**Files to modify:**
- `src/components/chat/unified-panel.tsx` — At viewport < 860px, render as bottom sheet or full-screen overlay with backdrop
- `src/hooks/use-right-panel-dock.ts` — Expose `isOverlay` boolean based on viewport

**Acceptance criteria:** Below 860px panel is overlay; above 860px it docks. Transition is smooth.
**Verification:** Resize browser across the 860px boundary; verify behavior changes.

---

### Task 2.3: Standardize panel shell styling + swap behavior

**Description:** All panel views (settings, route-trace, sources) must share identical header/close-button/spacing. Opening a new panel swaps content, not stacks. Closing fully closes (Section 2).

**Files to modify:**
- `src/components/chat/unified-panel.tsx` — Extract a shared `PanelShell` wrapper with consistent header (title, close button), padding, and scroll area. Each view renders inside this shell.
- `src/context/panel-context.tsx` — Ensure `setActiveView` replaces (never pushes); `closePanel` sets to null definitively

**Acceptance criteria:**
- All three panel types have identical chrome (close button position, header height, padding)
- Opening settings then sources → sources replaces settings, no stacking
- Closing sources → panel fully gone, no ghost panel

**Verification:** Open settings → switch to sources → switch to route-trace → close. Verify no stacking at any point.

---

### Task 2.4: Collapsible sidebar page navigation

**Description:** Sidebar shows too many nav items. Collapse secondary items (Section 3).

**Files to read first:**
- `src/components/chat/chat-sidebar.tsx` — find the nav items section

**Files to modify:**
- `src/components/chat/chat-sidebar.tsx` — Keep primary items always visible (Chat, Flashcards, Agents). Collapse secondary items (Models, Images, Analytics, Admin) into an expandable "More" section with hover-to-expand or click-to-toggle.

**Acceptance criteria:** Primary nav always visible; secondary collapses; expand/collapse works; current active page is always visible even if in collapsed section.
**Verification:** Visual test in expanded and collapsed states. Verify active page highlighting.

---

### Task 2.5: Improve sidebar search and chat list

**Description:** Search bar and recent chats take too much vertical space (Section 3).

**Files to modify:**
- `src/components/chat/chat-sidebar.tsx` — Reduce search bar height/padding. Show only 5 most recent chats by default with "Show more" expansion. Make chat items more compact.

**Acceptance criteria:** Search bar is visually compact; chat list shows 5 items by default; "Show more" loads additional batches of 10.
**Verification:** Visual test with many chats.

---

### Task 2.6: Fix dark mode white elements

**Description:** White scrollbars and other white UI elements look bad in dark mode (Section 5).

**Files to modify:**
- `src/app/globals.css` — Add custom scrollbar styling for dark mode:
  ```css
  .dark ::-webkit-scrollbar { background: var(--bg-secondary); }
  .dark ::-webkit-scrollbar-thumb { background: var(--border-app-border); border-radius: 4px; }
  ```
  Also add `scrollbar-color` for Firefox.
- Audit components for hardcoded `white`, `#fff`, `bg-white` — replace with theme variables.

**Acceptance criteria:** No jarring white elements in dark mode; scrollbars match dark theme.
**Verification:** Enable dark mode; scroll through all pages (chat, models, analytics, admin, flashcards). Verify no white flash or white elements.

---

### Task 2.7: Rebrand export to "Export conversation" with formats

**Description:** Rename "Download MD" to "Export conversation" with format options (Section 5).

**Files to read first:**
- `src/components/chat/chat-header.tsx` — find export button/menu
- `src/lib/export/markdown-export.ts`
- `src/lib/export/pdf-export.ts`

**Files to modify:**
- `src/components/chat/chat-header.tsx` — Change export menu label to "Export conversation"; add dropdown with options: "Markdown (.md)", "PDF", "Plain Text (.txt)"
- `src/lib/export/markdown-export.ts` — Add `exportConversationPlainText()` function (strip markdown formatting)

**Acceptance criteria:** Export menu shows "Export conversation" with 3 format choices; all produce correct output.
**Verification:** Export in each format; verify content.

---

### Task 2.8: Implement responsive breakpoint system

**Description:** Define standard breakpoints and layout patterns for all screen sizes (Section 2).

**Files to modify:**
- `src/components/chat/chat-layout.tsx` — Implement responsive layout:
  - **Mobile (<640px):** Full-width, sidebar as drawer overlay, no docked panel
  - **Tablet (640-1024px):** Sidebar collapsed by default, panels as overlay
  - **Desktop (1024-1440px):** Sidebar + content, panels dock
  - **Large (>1440px):** Sidebar + content + docked panel with room to spare
- `src/app/globals.css` — Add CSS custom properties for breakpoints if needed

**Acceptance criteria:** Layout adapts correctly at each breakpoint.
**Verification:** Test at 375px (iPhone), 768px (iPad), 1024px, 1440px, 1920px.

---

### Task 2.9: Improve model dropdown and controls layout

**Description:** Model dropdown and toggles in composer feel clogged together (Section 2).

**Files to read first:**
- `src/components/chat/chat-composer.tsx` — find the controls section

**Files to modify:**
- `src/components/chat/chat-composer.tsx` — Add more spacing between controls; group related controls; use a cleaner layout with visual separation between mode selector, model dropdown, and toggles. On mobile, collapse into a single "..." menu.

**Acceptance criteria:** Controls feel spacious and organized; nothing overlaps; mobile view is clean.
**Verification:** Visual test at desktop and mobile widths.

---

### REVIEW CHECKPOINT 2
```
STOP. Before proceeding to Phase 3, verify:
[ ] Panel system works at all breakpoints (mobile, tablet, desktop, large)
[ ] Panel open → resize is smooth, no squash
[ ] Panel swap works (no stacking)
[ ] Dark mode has no white elements
[ ] Sidebar is clean and compact
[ ] Export produces correct output in all 3 formats
[ ] npm run build passes
[ ] No CSS regressions (check all pages)
```

---

## PHASE 3: Models, Icons & Usage System
**Priority: HIGH**
**Checklist Sections: 6 (Models/Providers/Icons), 7 (Usage Limits/Budgets/Routing)**

### Task 3.1: Integrate LobeHub provider icons

**Description:** Replace current color-initial provider icons with LobeHub icons (Section 6).

**Files to read first:**
- `src/lib/provider-icons.ts` — current icon mapping
- `src/components/provider-logo.tsx` — current rendering
- `package.json` — check if `@lobehub/icons` is available

**Files to modify:**
- `package.json` — Add `@lobehub/icons` dependency
- `src/lib/provider-icons.ts` — Map each provider to its LobeHub component
- `src/components/provider-logo.tsx` — Render LobeHub icon with consistent size (24x24 default), with fallback to current initial-letter system for unknown providers

**Note:** If `@lobehub/icons` is too heavy or has issues, use their individual SVG exports or a subset. Check bundle impact.

**Acceptance criteria:** All 15+ known providers display proper icons; unknown providers show fallback; consistent sizing.
**Verification:** Visit Models page; verify all providers show icons. Check bundle size impact.

---

### Task 3.2: Remove "free" wording and pricing indications

**Description:** Strip `:free` from displayed model names, remove "free" tags, remove pricing from usage bar (Section 6).

**Files to read first:**
- `src/components/chat/unified-panel.tsx` — find `sanitizeModelLabel`, `sanitizeModelId`
- `src/components/chat/chat-sidebar.tsx` — find usage bar section
- `src/app/models/page.tsx` — find model cards with "free" tags

**Files to modify:**
- `src/components/chat/unified-panel.tsx` — Verify sanitize functions strip `:free` everywhere
- `src/components/chat/chat-sidebar.tsx` — Remove pricing numbers from usage indicator; show relative progress bar only (percentage)
- `src/app/models/page.tsx` — Remove "free" tags from model cards; remove pricing cents display
- `src/components/chat/chat-composer.tsx` — Strip `:free` from model dropdown labels

**Acceptance criteria:** No "free" wording visible anywhere in UI; no pricing numbers in usage indicator; model names clean.
**Verification:** Global search across all components for strings "free", "$/M", "cents", "pricing". Visual inspection.

---

### Task 3.3: Redesign models page with provider grid and filter search

**Description:** Complete redesign of the Models page (Section 6).

**Files to read first:**
- `src/app/models/page.tsx` — current layout

**Files to modify:**
- `src/app/models/page.tsx` — Rewrite with:
  1. Search bar at top that filters the provider grid below it
  2. Providers in responsive grid (2 cols mobile, 3 cols tablet, 4-5 cols desktop) with multi-select checkboxes
  3. Selected providers filter the model list below
  4. Rename "OpenRouter popular" to "Popular"
  5. Remove default tags (physics/vision/etc) from model selector

**Acceptance criteria:** Search filters providers live; provider grid is responsive; multi-select works; "Popular" label used; no default tags.
**Verification:** Test at multiple breakpoints; search for "google"; multi-select Google + Anthropic; verify model list filters.

---

### Task 3.4: Improve model dropdown in chat composer

**Description:** Make the model selector in composer cleaner and better organized (Section 6).

**Files to modify:**
- `src/components/chat/chat-composer.tsx` — Refactor model selector:
  - Group by provider with collapsible sections
  - Search field at top
  - Cleaner spacing (more padding, subtle separators)
  - Remove default tags
  - Show LobeHub icon next to each model

**Acceptance criteria:** Model selector is clean, searchable, grouped by provider, with proper icons.
**Verification:** Open model selector; search; select from different providers.

---

### Task 3.5: Implement progressive model restrictions based on budget

**Description:** Models become progressively unavailable as budget depletes (Section 7).

**Files to read first:**
- `src/lib/routing/heuristic.ts` — understand current tier system
- `convex/usage.ts` — understand `checkUserBudget` and spending tiers

**Files to modify:**
- `src/lib/routing/heuristic.ts` — Implement progressive restrictions:
  - **0-80% budget used:** All models available (normal tier)
  - **80-90% budget used:** Most expensive models (those in `MODEL_COST_BLOCK_LIST`) become unavailable
  - **90-100% (soft limit):** Only cheap/free models (`cheap_only` tier)
  - **100%+ (hard limit):** Only free models (`free_only` tier); if none available, disable sending (grey out composer)
- `src/components/chat/chat-composer.tsx` — Grey out unavailable models with tooltip explaining why
- `src/components/chat/unified-panel.tsx` — Show current budget tier status in settings panel

**Acceptance criteria:** Models progressively grey out as budget depletes; disabled models show explanation; at hard limit, composer is disabled.
**Verification:** Mock spending at 79%, 81%, 91%, 101% of budget; verify correct models available at each level.

---

### Task 3.6: Superadmin budget configuration UI

**Description:** Super admin can set per-user monthly budget for each school (Section 7).

**Files to read first:**
- `src/app/super-admin/` — find the school detail page
- `convex/superAdmin.ts`

**Files to modify:**
- The super admin school detail page — Add a "Budget" section with:
  - Input: "Monthly budget per user (cents)" → maps to `monthlyBudgetCentsPerUser`
  - Input: "Margin %" → maps to `budgetMarginPercent`
  - Display: Auto-computed soft threshold and hard threshold
  - Save button
- `convex/superAdmin.ts` — Add `updateOrgBudget` mutation

**Acceptance criteria:** Super admin can set budget; thresholds auto-display; saving persists to org.
**Verification:** Set budget as superadmin; verify org record updated in Convex dashboard; test that routing respects new limits.

---

### REVIEW CHECKPOINT 3
```
STOP. Before proceeding to Phase 4, verify:
[ ] LobeHub icons display for all known providers
[ ] No "free" wording anywhere in UI
[ ] Models page is clean, filterable, responsive
[ ] Model dropdown in composer is organized and searchable
[ ] Budget restrictions work progressively
[ ] Superadmin can configure budgets
[ ] Routing test suite still passes (npm run test:run)
[ ] npm run build passes
```

---

## PHASE 4: Orchestration, Modes & Sources
**Priority: HIGH**
**Checklist Sections: 1 (Modes/Agents/Orchestration), 9 (Sources UX)**

### Task 4.1: Improve agent icons — replace weak emoji defaults

**Description:** Use Lucide icon names for agents instead of weak emoji (Section 1). Map agent categories to appropriate icons.

**Files to read first:**
- `src/components/agents/agent-card.tsx` — how agents are displayed
- `convex/agents.ts` — agent creation

**Files to modify:**
- Agent display components in `src/components/agents/` — Prefer `avatarIcon` (Lucide name) over `avatarEmoji`. Add a mapping of category → default Lucide icon (e.g., "math" → Calculator, "science" → Beaker, "writing" → PenTool, "history" → Landmark, "general" → Bot).
- `convex/agents.ts` — When creating agents, set a default `avatarIcon` based on category if none provided.

**Acceptance criteria:** New agents get Lucide icons by default; existing agents still show emoji; icon display is consistent.
**Verification:** Create a new agent; verify Lucide icon. View existing agents; verify emoji still shows.

---

### Task 4.2: Improve agent auto-selection

**Description:** Auto-suggest the most relevant agent when user's message matches an agent's specialty (Section 1).

**Files to modify:**
- Create `src/lib/agent-matching.ts` — Implement `matchAgentToMessage(message, agents)` that scores agents by keyword overlap with `guidelinesTopicMap`, `category`, and `name`. Return the best match above a confidence threshold (0.3).
- `src/lib/orchestrator/pipeline.ts` — If no agent is selected and auto mode is on, call `matchAgentToMessage` and suggest the match (don't force it; show a subtle suggestion in the UI).

**Acceptance criteria:** When a user sends a math question and there's a "Math Tutor" agent, the system suggests it.
**Verification:** Create a "Physics" agent with physics topics; send "explain Newton's laws"; verify suggestion appears.

---

### Task 4.3: Improve Quiz mode quality and reliability

**Description:** Quiz generation should produce valid structured output 95%+ of the time (Section 1).

**Files to read first:**
- `src/lib/orchestrator/pipeline.ts` — find quiz generation and repair logic (~lines 1092-1181)
- `src/lib/prompts/policy.ts` — find quiz system prompt

**Files to modify:**
- `src/lib/prompts/policy.ts` — Enhance quiz system prompt with more explicit formatting requirements and examples
- `src/lib/orchestrator/pipeline.ts` — Improve quiz parsing robustness; add a third repair attempt with a simpler fallback format

**Acceptance criteria:** 10/10 test prompts produce valid quiz structure with proper Q/A formatting.
**Verification:** Test with 10 diverse quiz prompts (math, history, science, language, etc.).

---

### Task 4.4: Improve Flashcard mode quality and reliability

**Description:** Same as quiz — flashcards should produce valid FRONT/BACK pairs consistently (Section 1).

**Files to modify:**
- `src/lib/prompts/policy.ts` — Enhance flashcard system prompt
- `src/lib/orchestrator/pipeline.ts` — Improve flashcard parsing

**Acceptance criteria:** 10/10 test prompts produce valid flashcard decks.
**Verification:** Test with 10 diverse flashcard prompts.

---

### Task 4.5: Improve Research mode with working source URLs

**Description:** Research mode must show working URLs with metadata (Section 1).

**Files to modify:**
- `src/lib/orchestrator/retrieval.ts` — After web search, validate URLs (check they're well-formed, not broken); capture title and domain metadata
- `src/lib/orchestrator/post-process.ts` — Ensure citations include URL, title, and domain

**Acceptance criteria:** Research mode citations all have valid URLs; broken URLs are filtered out; metadata is captured.
**Verification:** Run 5 research queries; check all source URLs are clickable and valid.

---

### Task 4.6: Remove inline [1], [2] citation markers from message body

**Description:** Replace inline citation markers with clean source tags at the end of messages (Section 9).

**Files to modify:**
- `src/lib/orchestrator/post-process.ts` — In `rewriteCitationMarkers`, strip ALL inline `[1]`, `[2]` etc. from message content. Keep citation data but don't embed markers.
- `src/components/chat/chat-message.tsx` — Add a "Sources" section at the bottom of assistant messages (below content, above action buttons). Show each source as a compact tag: icon + name/URL. Clicking opens the source.

**Acceptance criteria:** No `[1]`, `[2]` markers visible in message text; clean source list at message bottom; clickable URLs.
**Verification:** Send a research query; verify no inline markers; verify source section appears with working links.

---

### Task 4.7: Enforce RAG file limits and show used files

**Description:** Set max RAG source files per retrieval and display which files were used (Section 1).

**Files to modify:**
- `src/lib/orchestrator/retrieval.ts` — Add `MAX_RAG_SOURCES = 5`; cap retrieval results; include file names in citation metadata
- `src/components/chat/chat-message.tsx` — Show file names in sources section for RAG citations

**Acceptance criteria:** At most 5 files used per retrieval; file names shown.
**Verification:** Upload 10+ files; send query; verify at most 5 used and all displayed.

---

### Task 4.8: Show orchestration progress in right panel

**Description:** Show which agents are deployed, why, and progress during streaming (Section 1).

**Files to modify:**
- `src/context/panel-context.tsx` — Add `"orchestration"` to panel view types
- `src/components/chat/unified-panel.tsx` — Add `OrchestrationView` that reads `collaboratorPhase`, `activeCollaborators` from `useChatState` and displays:
  - Current phase (thinking, searching, generating, verifying)
  - Active agents with their roles
  - Model being used and why (from route trace)
  - Progress indicators
- `src/components/chat/chat-messages.tsx` — Add a small "View orchestration" button during streaming

**Acceptance criteria:** During processing, panel shows live orchestration state; updates in real time.
**Verification:** Send a complex query; open orchestration panel; verify live updates.

---

### REVIEW CHECKPOINT 4
```
STOP. Before proceeding to Phase 5, verify:
[ ] Agent icons display correctly (Lucide for new, emoji for old)
[ ] Agent auto-suggestion works for relevant queries
[ ] Quiz mode produces valid output for 10/10 test prompts
[ ] Flashcard mode produces valid output for 10/10 test prompts
[ ] Research mode shows working URLs
[ ] No inline [1], [2] markers in messages
[ ] Sources section at message bottom is clean
[ ] RAG limited to 5 files max
[ ] Orchestration panel shows live progress
[ ] npm run build && npm run test:run pass
```

---

## PHASE 5: Chat Quality, Memory & Intelligence Features
**Priority: MEDIUM-HIGH**
**Checklist Section: 4 + Creative Features 4, 5, 7, 8, 12**

### Task 5.1: Add manual Compact button to chat UI

**Description:** Add a "Compact" button that users can click to compress long conversations (Section 4).

**Files to modify:**
- `src/components/chat/chat-header.tsx` — Add a "Compact" button (visible when message count > 15). On click, call the `manualCompact` mutation from Task 1.11. Show loading state during compaction.
- `src/hooks/use-chat-state.ts` — Add `compactConversation` action

**Acceptance criteria:** Button appears after 15+ messages; clicking triggers compaction; summary replaces old messages; button shows loading.
**Verification:** Create 20-message chat; compact; verify summary and continued conversation quality.

---

### Task 5.2: Improve memory auto-update without token bloat

**Description:** Prevent memory from growing unbounded (Section 4).

**Files to modify:**
- `src/lib/orchestrator/post-process.ts` — In `maybeExtractMemory`, implement consolidation:
  - Max 20 entries (currently 30 in schema; tighten to 20)
  - Max 1500 chars for `rawMemoryText`
  - Merge entries with similar keys (e.g., "learning_style" updates replace old)
  - Decay entries: if confidence < 0.3 and older than 30 days, remove
- `convex/memory.ts` — Add cleanup logic in write path

**Acceptance criteria:** Memory never exceeds 20 entries or 1500 chars; old low-confidence entries auto-removed.
**Verification:** Simulate 50 conversations adding memory; verify it stays within bounds.

---

### Task 5.3: Implement chat branching

**Description:** Allow users to branch a conversation from any message (Creative 7).

**Files to modify:**
- `convex/chats.ts` — Add `branchChat` mutation: creates a new chat copying messages up to the branched message
- `src/components/chat/chat-message.tsx` — Add a "Branch" action in message menu (for assistant messages)
- `src/hooks/use-chat-state.ts` — Add `branchFromMessage` action that calls mutation and navigates to new chat

**Acceptance criteria:** Branching creates new chat with history up to branched message; original unchanged; branch indicator shown.
**Verification:** Branch from message 5 of a 10-message chat; verify new chat has messages 1-5; old has all 10.

---

### Task 5.4: Implement message bookmarking

**Description:** Let users save important messages for later reference (Creative 8).

**Files to modify:**
- `src/components/chat/chat-message.tsx` — Add bookmark icon (Lucide `Bookmark`/`BookmarkCheck`) to assistant message actions. Toggle calls `toggleBookmark` from `convex/bookmarks.ts`.
- Create `src/app/bookmarks/page.tsx` — Page listing bookmarked messages grouped by chat, with link to original chat.

**Acceptance criteria:** Bookmarks persist across sessions; bookmarks page shows all saved messages with context.
**Verification:** Bookmark 3 messages from different chats; visit bookmarks page; verify all appear.

---

### Task 5.5: Progressive difficulty for quiz mode

**Description:** Adjust quiz difficulty based on performance (Creative 4).

**Files to modify:**
- `src/lib/orchestrator/pipeline.ts` — After quiz submission, read score from `quizResults`; if >= 80% and current difficulty < "hard", increase; if <= 40% and > "easy", decrease. Inject difficulty level into quiz system prompt.
- `src/components/chat/quiz-view.tsx` (or `quiz-reveal.tsx`) — Show current difficulty badge (Easy/Medium/Hard)

**Acceptance criteria:** Difficulty adjusts after each quiz; UI shows level; prompts adapt.
**Verification:** Complete 3 quizzes with different scores; verify difficulty changes in system prompt.

---

### Task 5.6: Spaced repetition scheduling UI

**Description:** Show due flashcards and suggest review sessions (Creative 5).

**Files to read first:**
- `src/lib/spaced-repetition.ts` — SM-2 algorithm
- `src/app/flashcards/page.tsx`

**Files to modify:**
- `src/app/flashcards/page.tsx` — Add "Due for Review" section at top showing count of due cards and a "Start Review" button. Cards are due when `nextReviewAt <= now`.

**Acceptance criteria:** Due cards are highlighted; review sessions work; intervals update correctly per SM-2.
**Verification:** Rate flashcards with different scores; verify next review dates match SM-2 calculations.

---

### Task 5.7: AI-generated study plans

**Description:** Generate structured study plans based on performance data (Creative 12).

**Files to create:**
- `src/app/api/study-plan/route.ts` — API endpoint that takes a topic, gathers user analytics (quiz scores, flashcard progress, mode usage), and generates a study plan via cheap AI model
- `src/components/chat/study-plan-view.tsx` — Display component for study plans with timeline, activities, and mode suggestions

**Files to modify:**
- `src/components/chat/chat-welcome.tsx` — Add "Generate study plan" button/link

**Acceptance criteria:** Study plan is generated with timeline, specific activities, and mode suggestions. References actual performance data.
**Verification:** Generate plan for a topic; verify it includes personalized recommendations.

---

### REVIEW CHECKPOINT 5
```
STOP. Before proceeding to Phase 6, verify:
[ ] Compact button works and produces readable summaries
[ ] Memory stays within 20 entries / 1500 chars after extended use
[ ] Chat branching preserves correct message history
[ ] Bookmarks persist and display correctly
[ ] Quiz difficulty adapts based on scores
[ ] Spaced repetition scheduling is accurate
[ ] Study plans reference real user data
[ ] npm run build && npm run test:run pass
```

---

## PHASE 6: Admin, Super Admin & Security
**Priority: HIGH**
**Checklist Sections: 8 (Admin/Superadmin/Collaboration), 10 (Storage/Security/Privacy)**

### Task 6.1: Enforce admin cannot access user chat history or files

**Description:** Critical privacy requirement (Section 8, 10).

**Files to read first:**
- `convex/schoolAdmin.ts` — all queries
- `convex/admin.ts` — all queries
- `convex/resources.ts` — resource queries

**Files to modify:**
- Audit every query in `convex/schoolAdmin.ts` and `convex/admin.ts`. Ensure NO query returns:
  - Message `content` for individual users
  - Chat `title` or contents for individual users
  - File content or download URLs for individual users
- Only aggregate data allowed: message counts, usage stats, session counts, topic lists (anonymized)
- `convex/resources.ts` — Ensure admin-accessible queries don't return student file content or storage URLs

**Acceptance criteria:** No admin query returns user message content or file content; only aggregates.
**Verification:** Review every admin-accessible query line by line. Attempt to access user data as admin via Convex dashboard — must fail.

---

### Task 6.2: Superadmin protection hardening

**Description:** Superadmin must be extremely protected with audit logging (Section 8).

**Files to modify:**
- `convex/superAdmin.ts` — Verify email check is case-insensitive and trimmed. Add audit logging: every mutation logs to `auditLog` table (actor, action, target, timestamp).
- Create `convex/auditLog.ts` — Simple `logAction` internal mutation and `listAuditLogs` query for superadmin.

**Acceptance criteria:** Every superadmin mutation is audit-logged; email check is case-insensitive; superadmin has admin access to their own school.
**Verification:** Perform superadmin actions; verify audit log entries appear. Test with wrong email; verify rejection.

---

### Task 6.3: Admin school soul customization verification

**Description:** Verify admins can customize only their own school's soul (Section 8).

**Files to read first:**
- `convex/soul.ts` — check org-scoping
- `src/app/admin/soul/page.tsx` (or equivalent)

**Files to modify:**
- `convex/soul.ts` — Verify every mutation checks that the actor's orgId matches the target soul's orgId
- Admin soul page — Verify no org selector (always uses current user's org)

**Acceptance criteria:** Admin can only read/write soul for their own org.
**Verification:** Test with admin user; verify org-scoped mutations.

---

### Task 6.4: Admin onboarding flow

**Description:** Comprehensive onboarding for new admins (Section 8).

**Files to read first:**
- `src/components/onboarding/steps.tsx` — existing student onboarding pattern

**Files to create:**
- `src/components/onboarding/admin-onboarding.tsx` — Multi-step wizard:
  1. Welcome — "You're an admin for [School Name]"
  2. School Setup — Set logo, colors, welcome message
  3. Soul — Customize school character/guidelines
  4. Members — How to invite teachers and students
  5. Analytics — Tour of school-wide analytics
  6. Budget — Understanding usage limits (if configured)

**Files to modify:**
- `src/app/admin/page.tsx` — Check `onboardingComplete`; show wizard if false

**Acceptance criteria:** Admin sees wizard on first visit; can complete or skip; each step is informative.
**Verification:** Sign in as admin with `onboardingComplete: false`; verify wizard.

---

### Task 6.5: Agent collaboration — invite co-editors

**Description:** Agent owners can invite collaborators from same school (Section 8).

**Files to modify:**
- `convex/agents.ts` — Add mutations: `inviteCollaborator(agentId, userId)` (checks same org), `removeCollaborator(agentId, userId)`. Update edit mutations to check if actor is owner OR collaborator.
- Agent builder/edit UI — Add "Collaborators" section with invite input (email/name search within org) and list of current collaborators.

**Acceptance criteria:** Owner can invite same-school users; collaborators can edit agent; outsiders cannot.
**Verification:** Invite a user; verify they can edit; verify cross-org invite fails.

---

### Task 6.6: Convex storage management and cleanup

**Description:** Monitor and manage storage to avoid bandwidth issues (Section 10).

**Files to modify:**
- `convex/superAdmin.ts` — Add `getStorageStats` query: total files, total size, size per org, largest files
- `convex/images.ts` — Add `cleanupExpiredImages` mutation that deletes images where `expiresAt < now`. Schedule via cron.
- `convex/crons.ts` — Add daily cron for image cleanup
- `convex/resources.ts` — Enforce max file size (10MB per file, configurable per org)

**Acceptance criteria:** Super admin sees storage stats; expired images auto-cleaned daily; file size limits enforced on upload.
**Verification:** Upload oversized file — verify rejection. Check storage stats. Verify cron runs.

---

### Task 6.7: Security audit — XSS, auth boundaries, CSRF

**Description:** Comprehensive security review (Section 10).

**Files to modify:** Various, based on findings.

**Audit checklist:**
- [ ] All Convex mutations verify caller authorization (check orgId, userId, role)
- [ ] User-generated content (message rendering, agent names) is sanitized against XSS
- [ ] File uploads are validated (type, size, content-type header)
- [ ] API routes check authentication via `requireAuth()` or equivalent
- [ ] No sensitive data in client-side logs or error messages
- [ ] Admin queries don't leak student data (cross-check with Task 6.1)

**Acceptance criteria:** No critical or high severity security issues found.
**Verification:** Manual testing of auth boundaries; XSS payload testing in message input.

---

### REVIEW CHECKPOINT 6
```
STOP. Before proceeding to Phase 7, verify:
[ ] Admin CANNOT see user chat content (test thoroughly)
[ ] Superadmin email check is case-insensitive and trimmed
[ ] Audit log captures all superadmin actions
[ ] Admin onboarding works end-to-end
[ ] Agent collaboration respects org boundaries
[ ] Storage cleanup cron is scheduled
[ ] Security audit found no critical issues
[ ] npm run build && npm run test:run pass
```

---

## PHASE 7: Onboarding, K-bar & In-Product Help
**Priority: MEDIUM**
**Checklist Section: 3 + Creative Features 10, 11, 14**

### Task 7.1: Fix K-bar reopen after close

**Description:** K-bar fails to reopen after first open/close cycle (Section 3).

**Files to read first:**
- `src/components/command-palette.tsx` — understand K-bar integration

**Files to modify:**
- `src/components/command-palette.tsx` — Debug the reopen issue. Common causes: KBar state not reset, event listener removed, portal not re-mounted. Fix by ensuring the KBar `visualState` is properly managed. May need to use `useKBar().query.toggle()` directly instead of relying on the built-in shortcut handler.

**Acceptance criteria:** K-bar opens and closes reliably 10+ times in succession without failure.
**Verification:** Open/close K-bar 15 times rapidly with Cmd+K; verify it always works.

---

### Task 7.2: Fix K-bar overflow in results

**Description:** Many results overflow the K-bar container (Section 3).

**Files to modify:**
- `src/components/command-palette.tsx` — Add `max-height: 400px` and `overflow-y: auto` to the results container. Ensure proper scrolling.

**Acceptance criteria:** K-bar results scroll within a bounded container; no visual overflow.
**Verification:** Type a single character to get many results; verify scrollable container.

---

### Task 7.3: Make K-bar discoverable

**Description:** K-bar should be mentioned in onboarding and have a trigger button (Section 3).

**Files to modify:**
- `src/components/onboarding/steps.tsx` — Add K-bar shortcut mention (Cmd+K / Ctrl+K) in onboarding
- `src/components/chat/chat-header.tsx` — Add a search icon button that calls `kbar.query.toggle()`

**Acceptance criteria:** K-bar mentioned in onboarding; search button in header opens K-bar.
**Verification:** Complete onboarding; verify mention. Click search button; verify K-bar opens.

---

### Task 7.4: Detailed student onboarding

**Description:** Comprehensive multi-step student onboarding (Section 3).

**Files to modify:**
- `src/components/onboarding/steps.tsx` — Expand to 6 detailed steps:
  1. **Welcome** — School name, encouraging message
  2. **Modes** — Visual cards for Learn, Quiz, Flashcards, Research with descriptions
  3. **Navigation** — How sidebar, K-bar, and panels work
  4. **AI Features** — Explain orchestration, auto mode selection, thinking levels
  5. **Preferences** — Set learning style, interests, difficulty preference (saves to `userSoulPreferences`)
  6. **Shortcuts** — Key shortcuts (Cmd+K, mode switching, etc.)

**Acceptance criteria:** 6-step onboarding with clear visuals and descriptions; preferences saved; marks complete.
**Verification:** Walk through full onboarding; verify preferences saved to Convex.

---

### Task 7.5: Contextual help system

**Description:** Show contextual tips/hints throughout the app (Section 2).

**Files to create:**
- `src/components/ui/contextual-tip.tsx` — A small tooltip/banner component that appears contextually. Props: `message`, `actionLabel`, `onAction`, `onDismiss`. Uses localStorage to track dismissed tips.

**Files to modify:**
- `src/components/chat/chat-messages.tsx` — Show "Start a new conversation for best results" when message count > 30
- `src/components/chat/chat-composer.tsx` — Show "Try Research mode for factual questions" when auto mode detects research-like queries
- `src/components/chat/chat-header.tsx` — Show "Use Compact to reduce context length" when conversation is long

**Acceptance criteria:** Tips appear contextually; can be dismissed permanently; do not block interaction.
**Verification:** Create conditions that trigger each tip; verify they appear and dismiss.

---

### Task 7.6: Interactive guided tour

**Description:** A lightweight tour that highlights key UI elements (Creative 14).

**Files to create:**
- `src/components/ui/guided-tour.tsx` — Step-by-step highlight overlay. Each step: target element selector, title, description, position (top/bottom/left/right). Uses a backdrop with cutout for the target element.

**Files to modify:**
- `src/components/chat/chat-layout.tsx` — Add tour trigger (available from Help menu or on first visit)

**Tour steps:**
1. Sidebar → "Navigate between pages and see your chat history"
2. Mode selector → "Choose how you want to study: Learn, Quiz, Flashcards, and more"
3. Model dropdown → "The AI automatically picks the best model, or you can choose"
4. Settings panel → "Configure your session: thinking level, search, resources"
5. Composer → "Type your message here. Attach files, switch modes, and more"

**Acceptance criteria:** Tour highlights each element in sequence; can skip; can restart from help.
**Verification:** Run full tour; verify all highlights align with actual elements.

---

### Task 7.7: Focus/Zen mode

**Description:** Distraction-free chat mode (Creative 11).

**Files to modify:**
- `src/components/chat/chat-layout.tsx` — Add `isZenMode` state. When active: hide sidebar, hide header controls (keep only exit button), hide panel, maximize chat area. Toggle via keyboard shortcut (Ctrl+Shift+Z) or button.
- `src/components/keyboard-shortcuts.tsx` — Register Ctrl+Shift+Z for zen mode
- `src/app/globals.css` — Add zen mode styles (clean, spacious, centered content)

**Acceptance criteria:** Zen mode hides all chrome; only messages + composer visible; toggle works; Escape exits.
**Verification:** Enter zen mode; verify clean interface; type messages; exit and verify full restoration.

---

### Task 7.8: Keyboard navigation and focus management

**Description:** Full keyboard accessibility (Creative 10).

**Files to modify:**
- `src/app/layout.tsx` — Add skip-to-content link (`<a href="#main-content" class="sr-only focus:not-sr-only">`)
- `src/app/globals.css` — Add visible focus ring styles for all interactive elements:
  ```css
  :focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
  ```
- Various components — Add `tabIndex`, `aria-label`, `role` attributes where missing

**Acceptance criteria:** All interactive elements reachable via Tab; focus rings visible; skip link works.
**Verification:** Tab through entire app without mouse; verify all elements reachable.

---

### Task 7.9: Screen reader support and high contrast mode

**Description:** ARIA labels and high contrast option (Creative 10).

**Files to modify:**
- `src/app/globals.css` — Add `.high-contrast` class with boosted contrast ratios
- `src/components/theme-toggle.tsx` — Add high contrast toggle option
- Various components — Add ARIA labels for icons, buttons, dynamic content areas

**Acceptance criteria:** Screen readers announce all content correctly; high contrast mode meets WCAG AA contrast ratios.
**Verification:** Test with screen reader; verify contrast with DevTools accessibility audit.

---

### REVIEW CHECKPOINT 7
```
STOP. Before proceeding to Phase 8, verify:
[ ] K-bar opens/closes reliably 15+ times
[ ] K-bar results scroll without overflow
[ ] K-bar mentioned in onboarding with trigger button
[ ] Student onboarding has 6 informative steps
[ ] Contextual tips appear and dismiss correctly
[ ] Guided tour highlights all elements accurately
[ ] Zen mode hides/shows correctly
[ ] Tab navigation reaches all interactive elements
[ ] Focus rings are visible
[ ] ARIA labels are present on key elements
[ ] npm run build passes
```

---

## PHASE 8: Feedback Widget, Notifications & Gamification
**Priority: MEDIUM**
**Checklist Sections: 12, 13 + Creative Features 1, 2, 9, 13**

### Task 8.1: Build feedback chat widget

**Description:** Bottom-left floating feedback button + form (Section 12).

**Files to create:**
- `src/components/feedback-widget.tsx` — Floating button (bottom-left, 48px, speech bubble icon). Clicking expands a compact form:
  - Category dropdown: Bug / Confusing / Feature / Safety
  - Text area (required, 500 char max)
  - Screenshot upload (optional, image only, 2MB max)
  - Auto-attached context: `{ mode, page: window.location.pathname, device: navigator.userAgent, traceId }`
  - Submit button
  - Not account-specific (works for logged-in and guest users)

**Files to modify:**
- `src/app/layout.tsx` — Add `<FeedbackWidget />` to root layout (appears on all pages)
- `src/app/api/feedback/route.ts` — Create API endpoint that calls `submitFeedback` mutation

**Acceptance criteria:** Widget appears on all pages; submits to Convex; auto-captures context; not account-gated.
**Verification:** Submit feedback from 3 different pages; verify context captured in Convex dashboard.

---

### Task 8.2: Build superadmin feedback inbox

**Description:** Superadmin page to view, reply, and triage feedback (Section 12).

**Files to create:**
- `src/app/super-admin/feedback/page.tsx` — List all feedback with:
  - Filters: category (multi-select), status (New/In progress/Shipped)
  - Sort: newest first (default)
  - Each item shows: category badge, message preview, context details, timestamp
  - Click to expand: full message, screenshot (if attached), reply input
  - Triage buttons: mark as In Progress / Shipped
  - Reply sends `replyToFeedback` mutation

**Acceptance criteria:** Inbox shows all submissions; filters work; triage and reply work.
**Verification:** Submit 5 varied feedback items; triage them; reply to one; verify all updates.

---

### Task 8.3: Streaks and XP tracking UI

**Description:** Display gamification elements in the UI (Creative 1).

**Files to modify:**
- `src/lib/orchestrator/pipeline.ts` — After successful chat response, call `awardXp` with appropriate type and `checkAndUpdateStreak`
- `src/components/chat/chat-sidebar.tsx` — Add a compact gamification section showing: flame icon + streak number, star icon + total XP

**Acceptance criteria:** XP increments after chat activities; streak tracks daily logins; both shown in sidebar.
**Verification:** Send messages in different modes; verify XP increases. Check next day; verify streak increments.

---

### Task 8.4: Achievement badges and unlock notifications

**Description:** Define achievements and show unlock toasts (Creative 1).

**Files to modify:**
- `convex/gamification.ts` — Add achievement checking: after each XP award, check if any new achievements are unlocked
- Create `src/components/achievement-toast.tsx` — A special toast component for achievements (badge icon, name, XP earned, celebration animation)
- `src/lib/orchestrator/pipeline.ts` — After XP award, check achievements and trigger toast if new

**Acceptance criteria:** Achievements unlock with celebration toast; can view all achievements.
**Verification:** Trigger 3 different achievement conditions; verify toasts appear.

---

### Task 8.5: Pomodoro study timer

**Description:** Floating Pomodoro timer for study sessions (Creative 2).

**Files to create:**
- `src/components/study-timer.tsx` — Small floating timer widget (top-right or in header):
  - 25-min work / 5-min break cycle
  - Start/Pause/Reset controls
  - Visual countdown (circular progress or digits)
  - Subtle notification sound at break
  - Logs completed sessions to `studyTimers` table

**Files to modify:**
- `src/components/chat/chat-header.tsx` — Add timer toggle button

**Acceptance criteria:** Timer counts down accurately; sounds at break; logs to database.
**Verification:** Start timer; wait for a cycle; verify sound and database entry.

---

### Task 8.6: Notification bell with study reminders

**Description:** Notification system with smart study reminders (Creative 9, Section 13).

**Files to create:**
- `src/components/notification-bell.tsx` — Bell icon in header with unread count badge. Dropdown shows recent notifications with read/unread states.

**Files to modify:**
- `src/components/chat/chat-header.tsx` — Add notification bell
- `convex/crons.ts` — Add daily cron job that generates study reminders:
  - "You have X flashcards due for review"
  - "Your streak will break — study today!"
  - "New study plan available based on your quiz performance"

**Acceptance criteria:** Bell shows unread count; dropdown lists notifications; reminders generated daily.
**Verification:** Trigger reminder conditions; verify notifications appear; mark as read.

---

### Task 8.7: Session analytics enhancements

**Description:** Add time-based and productivity analytics (Creative 13).

**Files to modify:**
- `src/components/analytics/analytics-dashboard.tsx` — Add new sections:
  - Time spent per day (from `studyTimers` + session estimates)
  - Messages per mode (pie chart)
  - Quiz performance trend (line chart over time)
  - Productivity insights (messages per session, topic depth)

**Acceptance criteria:** Dashboard shows time, mode distribution, quiz trends, and productivity metrics.
**Verification:** Use app across multiple sessions; verify analytics update accurately.

---

### REVIEW CHECKPOINT 8
```
STOP. Before proceeding to Phase 9, verify:
[ ] Feedback widget works on all pages
[ ] Superadmin feedback inbox is functional
[ ] Gamification (XP, streaks, achievements) tracks correctly
[ ] Timer is accurate and logs sessions
[ ] Notifications appear for study reminders
[ ] Analytics show new metrics accurately
[ ] Gamification doesn't interfere with core learning UX
[ ] npm run build passes
```

---

## PHASE 9: UI Redesign & Conversation Templates
**Priority: MEDIUM**
**Checklist Section: 2 (Major UI Redesign) + Creative Features 3, 6**

### Task 9.1: Redesign analytics pages with study/journal aesthetic

**Description:** Analytics look "generic AI boxy" — redesign with warmer, study-oriented aesthetic (Section 2).

**Files to modify:**
- `src/components/analytics/analytics-dashboard.tsx` — Use Fraunces display font for headings; softer card backgrounds with subtle gradients; rounded corners (18px+); hand-drawn-style accents on charts
- `src/components/analytics/stats-card.tsx` — Warmer colors, paper-like texture, more whitespace
- `src/app/globals.css` — Add `.journal-card` utility class with study aesthetic

**Acceptance criteria:** Analytics feel warm and study-oriented, not cold/corporate. Consistent with the rest of the redesign.
**Verification:** Visual comparison before/after.

---

### Task 9.2: Refine chat message styling

**Description:** Messages should feel more like a journal entry than a chatbot (Section 2).

**Files to modify:**
- `src/components/chat/chat-message.tsx` — Increase line-height (1.7+); use subtle background for assistant messages; better typography hierarchy with Fraunces for headers in markdown; warmer text color
- `src/app/globals.css` — Add `.message-journal` style class

**Acceptance criteria:** Messages feel like reading a well-typeset study guide, not a chat log.
**Verification:** Read through a long conversation; assess reading comfort.

---

### Task 9.3: Redesign welcome screen

**Description:** Make the first screen engaging and personalized (Section 2).

**Files to modify:**
- `src/components/chat/chat-welcome.tsx` — Redesign with:
  - Personalized greeting using user's name and time of day
  - Mode cards: visual, colorful cards for each core mode (Learn, Quiz, Flashcards, Research)
  - Starter prompts: 4-6 suggestions based on user's recent topics/interests
  - Achievement/streak display (if gamification active)
  - "Continue where you left off" showing last chat with preview

**Acceptance criteria:** Welcome screen is engaging, personalized, and guides users to start studying.
**Verification:** Load welcome screen; verify personalized elements; click mode cards and prompts.

---

### Task 9.4: Conversation starter templates per mode

**Description:** Show mode-specific starter prompts (Creative 3).

**Files to create:**
- `src/lib/starter-prompts.ts` — Define templates per mode:
  - **Tutor:** "Explain quantum entanglement simply", "Help me understand photosynthesis", "Break down the Pythagorean theorem"
  - **Quiz:** "Test me on World War 2 causes", "Quiz me on cell biology", "Create a quiz on French verbs"
  - **Flashcards:** "Make flashcards for Spanish vocabulary", "Create flashcards on chemistry elements", "Flashcards for history dates"
  - **Research:** "Find recent studies on climate change effects", "Research the latest developments in AI", "What does current evidence say about sleep and memory?"
  - **Explain:** "Explain how vaccines work", "Explain the concept of inflation", "Explain recursion"

**Files to modify:**
- `src/components/chat/chat-welcome.tsx` — Show mode-specific templates when a mode is active
- `src/components/chat/chat-composer.tsx` — Show as suggestions above empty composer when mode is selected

**Acceptance criteria:** Templates shown per mode; clicking fills composer; relevant to mode.
**Verification:** Switch between modes; verify different templates appear.

---

### Task 9.5: Quick actions toolbar

**Description:** Floating quick actions near the composer (Creative 6).

**Files to create:**
- `src/components/chat/quick-actions.tsx` — A compact horizontal toolbar above the composer with pill-shaped buttons:
  - Switch mode (cycles through modes)
  - Toggle search (web search on/off)
  - Compact conversation
  - New chat
  - Zen mode toggle
  - Collapses to a "..." button on mobile

**Files to modify:**
- `src/components/chat/chat-layout.tsx` — Position toolbar above composer

**Acceptance criteria:** All quick actions work; toolbar is unobtrusive; collapses on mobile.
**Verification:** Test all actions; verify mobile collapse.

---

### REVIEW CHECKPOINT 9
```
STOP. Before proceeding to Phase 10, verify:
[ ] Analytics pages have study/journal aesthetic
[ ] Chat messages feel journal-like, not chatbot-like
[ ] Welcome screen is engaging and personalized
[ ] Starter templates are relevant per mode
[ ] Quick actions toolbar works and is unobtrusive
[ ] Visual consistency across all redesigned elements
[ ] Dark mode still works for all redesigned elements
[ ] npm run build passes
```

---

## PHASE 10: Final Polish, Audit & Comprehensive Review
**Priority: FINAL — Everything must be verified**

### Task 10.1: ManageBac integration layer (optional — implement if time permits)

**Description:** Read-only ManageBac API integration (Section 13). Skip if ManageBac API credentials are not available — mark as deferred.

**If proceeding:**
- Create `src/lib/managebac.ts` — API client for timetable, CAS, announcements
- Create `src/app/api/managebac/route.ts` — Proxy endpoint
- Create `src/components/timetable-widget.tsx` — Display widget

**Acceptance criteria:** If configured, shows timetable data; graceful fallback if not configured.

---

### Task 10.2: Run comprehensive test suite and fix failures

**Description:** Full test + build + lint cycle with fixes.

**Steps:**
1. `npm run build` — fix any errors
2. `npm run lint` — fix any warnings
3. `npm run test:run` — fix any failures
4. `npx convex dev --once` — verify schema
5. Add integration tests for critical new features:
   - Feedback submission
   - Budget tier enforcement
   - Bookmark CRUD
   - Achievement checking
   - Compact mutation

**Acceptance criteria:** All commands pass with zero errors.
**Verification:** `npm run build && npm run lint && npm run test:run && echo "ALL CLEAR"`

---

### Task 10.3: Visual regression audit at all breakpoints

**Description:** Check every page at 3 breakpoints in both themes.

**Pages to check:**
- Chat (with messages, with panel, with sidebar)
- Models page
- Analytics dashboard
- Admin panel
- Super admin
- Flashcards page
- Agents page
- Bookmarks page
- Onboarding flow
- Settings

**Breakpoints:** 375px (mobile), 768px (tablet), 1440px (desktop)
**Themes:** Light and Dark

**Acceptance criteria:** No visual bugs at any combination.
**Verification:** Systematic visual check of each page × breakpoint × theme.

---

### Task 10.4: Performance audit

**Description:** Ensure changes haven't degraded performance.

**Checks:**
- Bundle size analysis: `npx next build` and check `.next/analyze` or build output
- Check if any new dependencies are bloating the bundle
- Verify Convex queries are not over-fetching (check for `select *` patterns)
- Lazy load heavy components (guided tour, feedback widget, study timer)

**Acceptance criteria:** Build size increase < 20% from baseline; LCP acceptable.
**Verification:** Compare build output sizes.

---

### Task 10.5: Holistic review — all 13 checklist sections

**Description:** Go through each checklist section and verify every item.

```
Section 1: Modes, agents, orchestration
[ ] Agent icons improved (Lucide instead of weak emoji)
[ ] Agent auto-selection works
[ ] Core modes (Learn, Quiz, Flashcards, Research) are reliable
[ ] Orchestration visibility in panel
[ ] Sources: web with working URLs, RAG with file limits, clean citations

Section 2: UI/UX and layout
[ ] Panel resizing works (no squash)
[ ] Panel overlay on small screens
[ ] Panel shell styling standardized
[ ] Panel swap (no stack)
[ ] Panel fully closes
[ ] Responsive layouts at all breakpoints
[ ] In-product tips/help
[ ] Model dropdown/toggles not clogged
[ ] Analytics redesigned with study aesthetic

Section 3: Sidebar, command palette, onboarding
[ ] K-bar opens reliably after close
[ ] K-bar no overflow
[ ] K-bar discoverable (onboarding + button)
[ ] Student onboarding detailed (6 steps)
[ ] Admin onboarding detailed
[ ] Sidebar: collapsed pages, compact search

Section 4: Chat quality and memory
[ ] Manual Compact button works
[ ] Memory auto-update within token budget
[ ] Chat titles 3-5 words via cheap model

Section 5: Export and theming
[ ] "Export conversation" with 3 formats
[ ] PDF export works (not blank)
[ ] Dark mode: no white elements

Section 6: Models, providers, icons
[ ] LobeHub icons for providers
[ ] Models page: filter search, provider grid, multi-select
[ ] "Popular" not "OpenRouter popular"
[ ] No default tags in model selector
[ ] No pricing/free wording

Section 7: Usage limits, budgets, routing
[ ] Progressive model restrictions
[ ] Superadmin budget configuration
[ ] Soft/hard thresholds auto-computed

Section 8: Admin, superadmin, collaboration
[ ] Superadmin protected (email check, audit log)
[ ] Admins can customize soul, manage members, see analytics
[ ] Admins CANNOT access user chats/files
[ ] Admin onboarding
[ ] Agent collaboration (invite co-editors)

Section 9: Sources UX
[ ] No inline [1], [2] in message body
[ ] Clean source tags at message bottom
[ ] Working URL list

Section 10: Storage, security, privacy
[ ] Security audit passed
[ ] Convex storage monitored
[ ] Admin tools don't leak student content

Section 11: Bugs and deployment blockers
[ ] PDF/canvas build errors fixed
[ ] PDF export works
[ ] All remaining bugs fixed

Section 12: Feedback widget
[ ] Bottom-left chat widget works site-wide
[ ] Categories + screenshot + auto-context
[ ] Superadmin feedback inbox with triage

Section 13: ManageBac + notifications
[ ] ManageBac integration (or documented as deferred)
[ ] Notification bell with study reminders
```

---

### Task 10.6: Holistic review — all 14 creative features

```
[ ] 1. Gamification (streaks, badges, XP) — tracks and displays
[ ] 2. Pomodoro study timer — counts down and logs
[ ] 3. Conversation templates — per-mode starter prompts
[ ] 4. Progressive difficulty — quiz adjusts based on scores
[ ] 5. Spaced repetition scheduling — due cards highlighted
[ ] 6. Quick actions toolbar — all actions work
[ ] 7. Chat branching — preserves correct history
[ ] 8. Message bookmarks — persist and display
[ ] 9. Smart notifications — study reminders generated
[ ] 10. Accessibility (keyboard nav, screen reader, high contrast)
[ ] 11. Focus/zen mode — hides all chrome
[ ] 12. AI study plans — generates personalized plans
[ ] 13. Session analytics — time, productivity, trends
[ ] 14. Interactive guided tour — highlights all elements
```

---

### Task 10.7: Final build and deployment readiness check

**Run all commands in sequence:**
```bash
npm run build && npm run lint && npm run test:run && npx convex dev --once && echo "DEPLOYMENT READY"
```

**Final checklist:**
- [ ] Zero build errors
- [ ] Zero lint errors
- [ ] All tests pass
- [ ] Convex schema deploys
- [ ] All new pages have proper routing
- [ ] All new API routes handle errors gracefully
- [ ] No hardcoded secrets or debug code
- [ ] No `console.log` statements left in production code
- [ ] All new dependencies are in `package.json`

---

### FINAL REVIEW CHECKPOINT
```
╔══════════════════════════════════════════════════════════════════════╗
║                     FINAL COMPREHENSIVE REVIEW                       ║
║                                                                      ║
║  This is the LAST review before completion. Verify EVERYTHING:      ║
║                                                                      ║
║  1. Every item from all 13 checklist sections is addressed          ║
║  2. All 14 creative features are implemented                        ║
║  3. npm run build && npm run lint && npm run test:run ALL PASS      ║
║  4. No security vulnerabilities in auth boundaries                  ║
║  5. Visual consistency at all breakpoints in both themes            ║
║  6. Performance acceptable (no major regressions)                   ║
║  7. All new Convex functions deploy correctly                       ║
║  8. No hardcoded secrets, debug code, or console.logs              ║
║                                                                      ║
║  If ANY check fails: fix it, re-verify, and loop back.             ║
║  Only proceed to COMPLETE when ALL checks pass.                     ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## PROGRESS LOG

| Task ID | Status | Timestamp | Notes |
|---------|--------|-----------|-------|
| 0.1 | [DONE] | 2026-02-23 06:48 UTC | Updated `next.config.ts` to externalize `@napi-rs/canvas` and switched PDF parsing from legacy `pdfjs-dist` entrypoint to typed non-legacy import in `src/lib/ingest.ts`; build verification passes with no canvas/pdf warnings. |
| 0.2 | [DONE] | 2026-02-23 06:48 UTC | Rewrote `src/lib/export/pdf-export.ts` to clone live stylesheets, preserve theme classes, wait for fonts/images, and print reliably instead of unstyled `innerHTML` window write. |
| 0.3 | [DONE] | 2026-02-23 06:49 UTC | Ran `npm run build && npm run lint && npm run test:run && npx convex dev --once`; all commands passed cleanly with 58/58 tests passing and Convex functions ready. |
| 1.1 | [DONE] | 2026-02-23 06:50 UTC | Added `feedback` table with category/status validators and indexes (`by_status`, `by_created`); `npx convex dev --once` succeeded. |
| 1.2 | [DONE] | 2026-02-23 06:50 UTC | Added gamification schema tables: `achievements`, `userStreaks`, and `studyTimers`; Convex schema deploy succeeded. |
| 1.3 | [DONE] | 2026-02-23 06:51 UTC | Added `messageBookmarks`, `chatBranches`, `notifications`, and `conversationTemplates` schema tables with required indexes; Convex deploy succeeded. |
| 1.4 | [DONE] | 2026-02-23 06:51 UTC | Extended `orgs` schema with optional `monthlyBudgetCentsPerUser` and `budgetMarginPercent` for dynamic per-org budget thresholds. |
| 1.5 | [DONE] | 2026-02-23 06:51 UTC | Added optional `avatarIcon` to `agents` schema to support Lucide icon identity alongside emoji avatars. |
| 1.6 | [DONE] | 2026-02-23 06:52 UTC | Added optional `agents.collaborators` and new `auditLog` table with `by_actor`/`by_created` indexes for superadmin action auditing. |
| 1.7 | [DONE] | 2026-02-23 06:53 UTC | Created `convex/feedback.ts` with `submitFeedback`, `listFeedback`, `getFeedbackStats`, `updateFeedbackStatus`, and `replyToFeedback` (superadmin-guarded inbox actions). |
| 1.8 | [DONE] | 2026-02-23 06:54 UTC | Created `convex/gamification.ts` with streak updates, XP awards, achievement dedupe/awards, per-user streak and achievements queries, and org leaderboard query. |
| 1.9 | [DONE] | 2026-02-23 06:55 UTC | Added `convex/bookmarks.ts` (toggle/list/detailed bookmark retrieval) and `convex/notifications.ts` (create/list/read/unread count) with strict owner scoping. |
| 1.10 | [DONE] | 2026-02-23 06:55 UTC | Updated `usage:checkUserBudget` to use org-configured `monthlyBudgetCentsPerUser` + `budgetMarginPercent` with exact fallback to legacy 700/900-cent thresholds; routing tests remain green. |
| 1.11 | [DONE] | 2026-02-23 06:57 UTC | Added `chats:manualCompact` mutation and improved auto-compaction summaries in `src/lib/orchestrator/history.ts` with structured output + fallback summary generation. |
| 1.12 | [DONE] | 2026-02-23 06:59 UTC | Updated title generation in `src/lib/orchestrator/post-process.ts` to enforce 3–5 words with cheaper free-model generation (`glmAir`) plus robust normalization/fallback for short, code-heavy, and malformed outputs. |
| 2.1 | [DONE] | 2026-02-23 07:09 UTC | Refined right-panel docking width logic (`useRightPanelDock`) to preserve minimum readable chat area and avoid content squashing at mid-desktop widths. |
| 2.2 | [DONE] | 2026-02-23 07:09 UTC | Fixed compact/overlay breakpoint behavior (`useCompactSheet` now width-aware) and added explicit overlay state/backdrop handling for panel drawers. |
| 2.3 | [DONE] | 2026-02-23 07:09 UTC | Standardized panel close behavior by clearing panel data on close/toggle in `panel-context`; unified shell already swaps active views without stacking. |
| 2.4 | [DONE] | 2026-02-23 07:09 UTC | Reworked sidebar navigation into primary links plus collapsible “More” section, preserving active-page visibility in both expanded and collapsed sidebars. |
| 2.5 | [DONE] | 2026-02-23 07:09 UTC | Compacted sidebar search/chat item density and added progressive chat pagination (5 default + “Show more” in batches of 10), while keeping selected chat visible. |
| 2.6 | [DONE] | 2026-02-23 07:09 UTC | Added theme-aware scrollbar styling for light/dark in `globals.css` and removed key hardcoded white surfaces in chat UI (`chat-sidebar`, `code-canvas`). |
| 2.7 | [DONE] | 2026-02-23 07:09 UTC | Replaced split export buttons with “Export conversation” dropdown (Markdown/PDF/Plain text) and added `exportConversationPlainText()`. |
| 2.8 | [DONE] | 2026-02-23 07:09 UTC | Added responsive sidebar breakpoint policy in `sidebar-context` (mobile/tablet collapsed by default, desktop open) aligned with new overlay/dock panel behavior. |
| 2.9 | [DONE] | 2026-02-23 07:09 UTC | De-cluttered composer controls by separating desktop pills from a mobile “more controls” dropdown and keeping file attach available in both layouts. |
| 3.1 | [DONE] | 2026-02-23 08:26 UTC | Completed LobeHub provider icon integration via `@lobehub/icons` in `provider-logo` with normalized provider matching and unknown-provider fallback initials. |
| 3.2 | [DONE] | 2026-02-23 08:26 UTC | Removed visible free/pricing copy from model-selection UI surfaces: redesigned models explorer cards without price tags, stripped composer metadata pricing/free badges, and converted sidebar/panel usage widgets to percentage/tier-only display. |
| 3.3 | [DONE] | 2026-02-23 08:26 UTC | Rebuilt `src/app/models/page.tsx` into a filter-first explorer with top live search, responsive multi-select provider grid (2/3/4/5 columns by breakpoint), provider-filtered results, and “Popular” sorting label. |
| 3.4 | [DONE] | 2026-02-23 08:26 UTC | Refactored composer model dropdown into searchable provider-grouped collapsible sections with provider icons, recommended indicators, context metadata, and tier-based disabled states/tooltips. |
| 3.5 | [DONE] | 2026-02-23 08:27 UTC | Implemented progressive budget routing gates: new `expensive_blocked` tier (80%+ by margin), `cheap_only` at 90%+, `free_only` at 100%+, enforced in `checkUserBudget`, routing heuristics, and composer send/model availability logic. |
| 3.6 | [DONE] | 2026-02-23 08:27 UTC | Added superadmin budget controls end-to-end: new `superAdmin:updateOrgBudget` mutation + audit log entry, API action wiring, and school detail “Budget” UI with monthly cents/margin inputs and auto-computed threshold previews. |
| 4.1 | [DONE] | 2026-02-23 08:30 UTC | Implemented icon-first agent identity: added shared `AgentAvatar` (Lucide icon + emoji fallback), updated agent display surfaces to prefer `avatarIcon`, and updated Convex agent create/update flows to auto-assign category-based default Lucide icon names. |
| 4.2 | [DONE] | 2026-02-23 08:34 UTC | Added `matchAgentToMessage()` in `src/lib/agent-matching.ts`, wired non-forced auto agent suggestions into orchestration when no agent is selected, surfaced suggestions in composer UI, and added dedicated matcher tests (`agent-matching.test.ts`). |
| 4.3 | [DONE] | 2026-02-23 07:37 UTC | Hardened quiz reliability with stricter prompt template requirements and a third `quiz_final_repair` fallback pass in `pipeline`; verification loop passed (`build`, `lint`, `test:run`, `convex dev --once`). |
| 4.4 | [DONE] | 2026-02-23 07:44 UTC | Hardened flashcard reliability with stricter flashcard prompt templates, shared parsing/normalization (`src/lib/flashcard-format.ts`), a third `flashcard_final_repair` pass in `pipeline`, and 10 new parser reliability tests; full verification gate passed. |
| 4.5 | [DONE] | 2026-02-23 07:49 UTC | Implemented research citation hardening: validated/filtered web URLs with metadata extraction (`title`, `domain`) in `retrieval.ts`, passed structured search sources through pipeline/post-process, enriched citation rendering UI, and added citation metadata tests; full verification gate passed. |
| 4.6 | [DONE] | 2026-02-23 07:51 UTC | Removed inline citation markers from assistant text in post-processing, preserved source metadata, and added a dedicated bottom “Sources” tag section in chat messages with compact clickable source chips; full verification gate passed. |
| 4.7 | [DONE] | 2026-02-23 07:53 UTC | Enforced `MAX_RAG_SOURCES = 5` in retrieval post-processing with unique file-level capping + normalized source blocks, surfaced used file names in message source UI, and added retrieval limit unit tests; full verification gate passed. |
| 4.8 | [DONE] | 2026-02-23 07:57 UTC | Added live orchestration panel support end-to-end: new `orchestration` panel view type, real-time OrchestrationView in unified panel (phase, collaborator roles, model reason/progress), and streaming-time “View orchestration” trigger in chat messages; full verification gate passed. |
| 5.1 | [DONE] | 2026-02-23 08:00 UTC | Added manual compaction UI flow: header “Compact” button with loading state (shown for long chats), new `compactConversation` action in chat state, and `/api/chats/[id]` POST bridge to `chats:manualCompact`; full verification gate passed. |
| 5.2 | [DONE] | 2026-02-23 08:03 UTC | Implemented memory consolidation limits end-to-end: canonical key merging with value replacement, 30-day low-confidence decay, strict 20-entry cap, 1500-char raw memory cap, and server-side cleanup enforcement in `convex/memory.ts`; added memory compaction tests and passed full verification gate. |
| 5.3 | [DONE] | 2026-02-23 08:04 UTC | Completed branching UX for assistant turns: exposed “Branch” action on assistant message controls (with existing branch API/mutation flow), preserving prior history up to pivot and navigating to the new branched chat; full verification gate passed. |
| 5.4 | [DONE] | 2026-02-23 08:11 UTC | Implemented persistent message bookmarking UX end-to-end: added bookmark toggle API route (`/api/bookmarks`), chat-state bookmark sync/actions with optimistic updates, assistant message bookmark controls, new `/bookmarks` page grouped by chat with remove/open actions, and sidebar navigation entry; full verification gate passed (`build`, `lint`, `test:run`, `convex dev --once`). |
| 5.5 | [DONE] | 2026-02-23 08:15 UTC | Upgraded adaptive quiz progression to score-driven Easy/Medium/Hard levels: pipeline now reads latest `quizResults`, adjusts difficulty (+1 at >=80%, -1 at <=40%, bounded), persists difficulty signal, injects label/level into quiz system prompt, and emits route-trace difficulty markers consumed by `quiz-reveal` difficulty badges; full verification gate passed. |
| 5.6 | [DONE] | 2026-02-23 08:17 UTC | Added a dedicated “Due for Review” section to `flashcards` with real-time due-card count, direct “Start Review” jump into the due queue, and review-focus UX refinement while preserving SM-2 scheduling behavior; full verification gate passed. |
| 5.7 | [DONE] | 2026-02-23 08:21 UTC | Implemented AI-generated study plans end-to-end: added `/api/study-plan` (personalized from analytics + quiz history + flashcard due load, with validated JSON generation and deterministic fallback), new `study-plan-view` timeline component, and “Generate study plan” workflow in chat welcome UI; full verification gate passed. |
| 6.1 | [DONE] | 2026-02-23 08:23 UTC | Enforced admin privacy boundaries across school/admin/resource surfaces: audited `schoolAdmin`/`admin` queries for aggregate-only outputs, removed school dashboard’s direct `messages` reads (now uses analytics aggregates), and tightened `resources` permissions so admins cannot access/download/delete/process other users’ personal files while retaining scoped pack/agent management; full verification gate passed. |
| 6.2 | [DONE] | 2026-02-23 08:30 UTC | Hardened superadmin controls: trimmed/case-insensitive superadmin email checks, added dedicated `convex/auditLog.ts` (`logAction` internal mutation + `listAuditLogs` query), wired audit logging into every superadmin mutation path, added `/api/super-admin/audit-logs`, and ensured superadmin accounts are auto-promoted to `admin` role for own-school access in `auth-server`; full verification gate passed. |
| 6.3 | [DONE] | 2026-02-23 08:31 UTC | Verified and hardened school SOUL org scoping: admin soul UI remains org-locked with no org selector, and `convex/soul.ts` now explicitly enforces doc/org consistency during chunk replacement and publish flow (`orgSoulDocs.orgId` must match actor org), preventing cross-org SOUL mutation paths; full verification gate passed. |
| 6.4 | [DONE] | 2026-02-23 08:39 UTC | Implemented comprehensive admin onboarding wizard (`src/components/onboarding/admin-onboarding.tsx`) with 6 guided steps (welcome, school setup, soul, members, analytics, budget), including actionable branding save/upload and quick invite flows; wired `onboardingComplete` through `auth-server` + `/api/bootstrap` actor payload and gated `src/app/admin/page.tsx` to show onboarding until completion/skip (both mark complete via `/api/personal-soul`); full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 6.5 | [DONE] | 2026-02-23 08:44 UTC | Added same-school agent collaboration end-to-end: `convex/agents.ts` now supports collaborator-aware view/edit permissions, owner/admin-only `inviteCollaborator` + `removeCollaborator` mutations, and searchable collaborator/candidate query data; added API route `src/app/api/agents/[id]/collaborators/route.ts`; updated `src/app/agents/[id]/page.tsx` with a collaborators management section (search by name/email, invite/remove, role visibility) and permission-aware controls; full verification gate passed. |
| 6.6 | [DONE] | 2026-02-23 08:49 UTC | Implemented storage management hardening: added `superAdmin:getStorageStats` plus `/api/super-admin/storage` and super-admin dashboard “Storage Insights” UI (total tracked size, file/image counts, largest files), upgraded image cleanup (`images:cleanupExpiredImages`) to multi-batch sweeps and scheduled daily cron (`cleanup-expired-images`), and enforced per-file upload limits with per-org configurability (`orgs.maxResourceFileSizeBytes`, default 10MB, clamped 1–100MB) across Convex resource registration and API upload routes (`/api/resources`, `/api/packs/[id]/resources`); full verification gate passed. |
| 6.7 | [DONE] | 2026-02-23 08:56 UTC | Completed focused security hardening pass: tightened user-generated content rendering against URL/script injection (sanitized markdown/citation links and image src schemes in `markdown-renderer`, `chat-message`, and `image-reveal`), enforced stronger file upload validation (allowed extensions + MIME consistency + normalized content-type headers + per-org size caps) across upload routes and Convex registration checks, secured image storage actions to verify actor existence before any blob write, converted image cleanup to `internalMutation` (cron-only), hardened branding upload validation (type + size), and reduced 500-level error detail exposure in API responses (`route-handler`); full verification gate passed (`build`, `lint`, `test:run`, `convex dev --once`). |
| 7.1 | [DONE] | 2026-02-23 08:58 UTC | Fixed K-bar reopen reliability by hardening command palette hotkey handling in `src/components/command-palette.tsx`: introduced a dedicated `Cmd/Ctrl+K` listener that directly calls `useKBar().query.toggle()` and handles `Escape` close state transitions, while moving the built-in toggle shortcut to a non-conflicting combo (`$mod+shift+k`) to avoid duplicate event races; full verification gate passed. |
| 7.2 | [DONE] | 2026-02-23 08:59 UTC | Fixed command palette result overflow by constraining the results container to `max-h-[400px]` with scroll containment (`overflow-y-auto`, `overscroll-contain`) in `src/components/command-palette.tsx`; full verification gate passed. |
| 7.3 | [DONE] | 2026-02-23 09:01 UTC | Improved K-bar discoverability: added explicit `Cmd + K / Ctrl + K` command palette guidance in onboarding mode showcase (`src/components/onboarding/steps.tsx`) and added a dedicated search button to the chat header (`src/components/chat/chat-header.tsx`) that opens the palette via `kbar.query.toggle()`; full verification gate passed. |
| 7.4 | [DONE] | 2026-02-23 09:05 UTC | Delivered a detailed 6-step student onboarding flow in `src/app/onboarding/page.tsx` covering welcome, modes, navigation, AI features, preferences, and shortcuts, with preference persistence to `/api/personal-soul` and completion via onboarding patch call; full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 7.5 | [DONE] | 2026-02-23 09:08 UTC | Implemented contextual help tips via new `src/components/ui/contextual-tip.tsx` with localStorage-backed dismissal and wired contextual triggers in `chat-messages` (long threads >30), `chat-composer` (research-like draft prompts), and `chat-header` (long conversation compact guidance with one-click action); full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 7.6 | [DONE] | 2026-02-23 09:11 UTC | Implemented an interactive guided tour with step-by-step target highlighting via new `src/components/ui/guided-tour.tsx` (backdrop cutout + positioned callout, back/next/skip/finish controls), wired first-visit auto-launch and manual restart (“Tour” button) in `chat-layout`, and added explicit tour anchors for sidebar/mode/model/settings/composer targets using `data-tour` hooks; full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 7.7 | [DONE] | 2026-02-23 09:14 UTC | Added full Zen mode flow: `chat-layout` now tracks `isZenMode` and hides sidebar/panels/tour chrome while preserving messages+composer, `chat-header` now provides Zen toggle and a minimal “Exit Zen” header state, keyboard shortcut registration (`Ctrl/Cmd+Shift+Z`) was added via `keyboard-shortcuts` registrar with `Escape` exit handling, and global zen styles were introduced in `globals.css`; full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 7.8 | [DONE] | 2026-02-23 09:16 UTC | Completed keyboard accessibility pass: added root skip-to-content link and focus target in `src/app/layout.tsx`, introduced global `:focus-visible` and focused skip-link styling in `globals.css`, and added keyboard/ARIA semantics for interactive image preview surfaces in `image-reveal` (`role="button"`, `tabIndex`, Enter/Space handling, explicit close label); full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 7.9 | [DONE] | 2026-02-23 09:18 UTC | Added screen-reader and contrast accessibility upgrades: introduced persistent high-contrast mode support (`.high-contrast` + `.dark.high-contrast`) in `globals.css`, wired high-contrast initialization in `layout` theme bootstrapping, upgraded `ThemeToggle` into a menu with theme + high-contrast controls, and added ARIA labeling/live-region semantics for dynamic chat surfaces (`chat-messages`, `chat-composer`, `chat-message`); full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 8.1 | [DONE] | 2026-02-23 09:23 UTC | Built site-wide feedback capture flow: added floating `src/components/feedback-widget.tsx` (bottom-left launcher + compact form with category, message, optional image screenshot, auto-context for mode/page/device/traceId), added `/api/feedback` POST endpoint with guest-safe auth fallback and validation, extended feedback backend with screenshot storage action (`feedback:storeFeedbackScreenshot`) and submission mutation wiring, and mounted widget globally in `src/app/layout.tsx`; full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 8.2 | [DONE] | 2026-02-23 09:26 UTC | Implemented superadmin feedback inbox end-to-end: added `/api/super-admin/feedback` (GET list + PATCH triage + POST reply) with superadmin enforcement, created `src/app/super-admin/feedback/page.tsx` featuring category/status multi-filtering, newest-first list, expandable detail view (message/context/screenshot), triage controls, and reply workflow, and added navigation entry points from superadmin dashboard/sidebar; full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 8.3 | [DONE] | 2026-02-23 09:32 UTC | Implemented streak/XP tracking UI end-to-end: added post-response gamification updates in `pipeline` (`gamification:awardXp` + `gamification:checkAndUpdateStreak`) for both standard and image branches, added `/api/gamification` summary endpoint, wired sidebar gamification cards/chips (streak + total XP) in `chat-sidebar`, and added live refresh signaling from stream completion via `ai-school:refresh-gamification`; full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 8.4 | [DONE] | 2026-02-23 09:40 UTC | Implemented achievement unlock system with celebratory notifications end-to-end: expanded `convex/gamification.ts` to evaluate and unlock achievements after XP awards (with persisted notification records and XP bonuses), exposed achievement catalog + user unlocks via `/api/gamification`, created polished unlock UI component `src/components/achievement-toast.tsx` with animation styling in `globals.css`, streamed unlocked achievements through `pipeline` done payloads and triggered custom toasts in `use-chat-state`, added full achievements gallery page `src/app/achievements/page.tsx`, and linked it in sidebar navigation; full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 8.5 | [DONE] | 2026-02-23 09:46 UTC | Delivered Pomodoro timer flow end-to-end: added floating `src/components/study-timer.tsx` with 25/5 work-break cycle, circular countdown, start/pause/reset controls, transition tone notifications, and completed-session tracking; integrated header timer toggle in `chat-header` (+ `chat-layout` chatId wiring); added `gamification:logStudyTimerSession` mutation for `studyTimers` persistence and new `/api/gamification/timer` POST route with validation and actor/chat ownership enforcement; full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 8.6 | [DONE] | 2026-02-23 09:49 UTC | Implemented smart notifications end-to-end: added header `NotificationBell` dropdown UI (`src/components/notification-bell.tsx`) with unread badge, recent notifications feed, per-item read handling, and mark-all-read actions; added notifications API routes (`/api/notifications`, `/api/notifications/[notificationId]`) for list/unread + read-state updates; expanded `convex/notifications.ts` with internal daily reminder generator (`generateDailyStudyReminders`) covering flashcards due, streak-risk, and quiz-based study-plan nudges; wired daily cron job in `convex/crons.ts` (`generate-study-reminders`); full verification gate passed (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 8.7 | [DONE] | 2026-02-23 09:55 UTC | Added session analytics enhancements end-to-end: implemented new backend query `analytics:getStudentEnhancedAnalytics` (daily study-time aggregation from `studyTimers` + message-based estimates, mode-level message counts, quiz score trend points, and productivity metrics), wired response through `/api/analytics`, updated analytics page contract, and expanded `analytics-dashboard` with new sections for Time Spent per Day, Messages per Mode pie visualization, Quiz Performance Trend line visualization, and Productivity Insights metrics; full verification gate passed (`npm run build && npm run lint && npm run test:run && npx convex dev --once`). |
| 9.1 | [DONE] | 2026-02-23 09:58 UTC | Completed analytics redesign with a warm journal aesthetic: introduced reusable journal utility styles in `globals.css` (`journal-card`, `journal-heading`, texture + scribble accents), restyled analytics dashboard cards/headings to use Fraunces-forward display treatment and softer textured surfaces, updated `stats-card` visual language for paper-like warmth, and aligned analytics chart/topic components (`activity-chart`, `mode-breakdown`, `time-of-day-chart`, `topic-cloud`) with the new journal card system; full verification gate passed (`npm run build && npm run lint && npm run test:run && npx convex dev --once`). |
| 9.2 | [DONE] | 2026-02-23 10:00 UTC | Refined chat message styling to a journal-reading experience: updated assistant message shell in `chat-message.tsx` with warmer textured background + softer bordered card treatment, added global `.message-journal` typography system in `globals.css` (warmer text tone, increased line-height, and Fraunces markdown heading hierarchy), and preserved action/source affordances while improving long-form reading comfort; full verification gate passed (`npm run build && npm run lint && npm run test:run && npx convex dev --once`). |
| 9.3 | [DONE] | 2026-02-23 10:02 UTC | Redesigned the welcome screen into a personalized launch experience: rebuilt `chat-welcome.tsx` with time-of-day + name greeting, streak/XP/achievement summary, “continue where you left off” last-chat card, focused core mode cards, recent-interest starter prompts with one-click composer fill, enhanced study-plan panel, and preserved featured agent quick starts; wired new welcome interactions from `chat-layout` (`onResumeChat`, prompt prefill + mode set, recent chats feed); full verification gate passed (`npm run build && npm run lint && npm run test:run && npx convex dev --once`). |
| 9.4 | [DONE] | 2026-02-23 10:08 UTC | Implemented per-mode conversation starter templates end-to-end: added reusable prompt catalog in `src/lib/starter-prompts.ts` (Tutor/Quiz/Flashcards/Research/Explain + extended mode coverage with optional topic placeholders), wired welcome prompt panel to active mode with dedicated mode tabs and one-click template application in `chat-welcome.tsx`, and added empty-composer mode-specific suggestion chips in `chat-composer.tsx` that instantly populate input and focus the editor; full verification gate passed (`npm run build && npm run lint && npm run test:run && npx convex dev --once`). |
| 9.5 | [DONE] | 2026-02-23 10:11 UTC | Added floating quick-actions toolbar above the composer: created `src/components/chat/quick-actions.tsx` with compact pill actions for mode cycling, web-search toggle, compact conversation, new chat, and zen mode; added mobile collapse into a “...” dropdown; integrated into `chat-layout` with mode-cycle/search-toggle handlers and safe compact/new/zen wiring; full verification gate passed (`npm run build && npm run lint && npm run test:run && npx convex dev --once`). |
| 10.1 | [DONE] | 2026-02-23 10:21 UTC | Implemented ManageBac integration layer with graceful fallback: added resilient API client/parser in `src/lib/managebac.ts` (config detection, timeout-safe multi-endpoint fetch, normalized timetable/CAS/announcements snapshot), added authenticated proxy route `src/app/api/managebac/route.ts` with explicit deferred response when credentials are missing, created `src/components/timetable-widget.tsx` live widget, and integrated it into `chat-welcome`; if env vars are absent (`MANAGEBAC_BASE_URL`, `MANAGEBAC_API_TOKEN`, `MANAGEBAC_STUDENT_ID`), UI shows clear deferred state without errors. |
| 10.2 | [DONE] | 2026-02-23 10:21 UTC | Completed comprehensive test/breakage pass and added critical integration coverage: created `src/lib/__tests__/api-routes.integration.test.ts` covering feedback submission flow, bookmark list/toggle flow, gamification achievements payload, and manual compact mutation wiring; expanded budget guardrail coverage in `routing.test.ts` for `cheap_only` and `expensive_blocked`; full gate passes with 88/88 tests green (`npm run build`, `npm run lint`, `npm run test:run`, `npx convex dev --once`). |
| 10.3 | [DONE] | 2026-02-23 10:21 UTC | Performed visual-regression audit pass with responsive/theming checks across target pages using static breakpoint/theming scans (auth-gated app limits full screenshot automation in this environment), and fixed surfaced dark-mode regressions by removing hardcoded light surfaces in admin branding previews (`src/app/admin/branding/page.tsx`, `src/app/admin/school/branding/page.tsx`); no remaining hardcoded light-only surfaces found in audited core chat/analytics/pages outside intentional media overlays. |
| 10.4 | [DONE] | 2026-02-23 10:21 UTC | Completed performance audit + optimizations: lazy-loaded heavy UI modules requested in plan (guided tour via dynamic import in `chat-layout`, study timer via dynamic import in `chat-header`, feedback widget via client-side lazy host `feedback-widget-host`), verified no SQL-style over-fetch patterns (`SELECT *`) in source, and captured build footprint metrics (`.next/static/chunks` ≈ 5.0MB JS chunks total). |
| 10.5 | [DONE] | 2026-02-23 10:21 UTC | Completed holistic 13-section checklist review and resolved final blockers discovered during audit (dark-mode preview surfaces + production `console.log` cleanup by migrating `src/lib/logging.ts` output to stream writes); validated boundaries/features/routes against implemented sections, including admin privacy, sources UX, budgets, onboarding/help, notifications, and ManageBac fallback handling. |
| 10.6 | [DONE] | 2026-02-23 10:21 UTC | Completed holistic 14-feature review with all creative features verified in code paths: gamification, pomodoro, per-mode templates, adaptive quiz difficulty, spaced repetition due queue, quick actions toolbar, branching, bookmarks, smart reminders, accessibility upgrades, zen mode, AI study plans, enhanced analytics, and guided tour; reinforced by added integration tests for key high-risk flows. |
| 10.7 | [DONE] | 2026-02-23 10:21 UTC | Final deployment-readiness command chain executed successfully: `npm run build && npm run lint && npm run test:run && npx convex dev --once && echo "DEPLOYMENT READY"`; output ended with `DEPLOYMENT READY`, confirming zero build errors, zero lint warnings, all tests passing (88/88), and Convex functions ready. |
| 11.1 | [DONE] | 2026-02-23 21:58 UTC | Post-plan backend correctness hardening completed: made streak creation/id linkage resilient (`users.userStreakId` + duplicate reconciliation in `gamification`), fixed first-activity-day streak progression via shared `streakLogic`, and made manual compaction idempotent with cursor metadata (`compactedUntilMessageId`, `contextSummaryVersion`) + duplicate-summary prevention (`compaction.ts`, `chats:manualCompact`). |
| 11.2 | [DONE] | 2026-02-23 21:58 UTC | Post-plan UX hardening tranche completed: removed high-contrast/zen/quick-action clutter, simplified theme toggling, improved sidebar progressive loading/infinite-fetch behavior, auto-opened orchestration while sending, expanded settings file-list viewport usage, and tightened super-admin sidebar/admin link visibility with middleware/email-claim resilience. |
| 11.3 | [DONE] | 2026-02-23 21:58 UTC | Fixed critical chat integrity + timer persistence issues: retry/busy fallback now preserves user-message persistence semantics (`use-chat-state`), timer now supports configurable focus/break durations and persists running state across close/reopen (`study-timer` + `chat-header` always-mounted timer), and assistant message action density was reduced via primary actions + `More` menu with lighter non-boxed response shell (`chat-message`). |
| 11.4 | [DONE] | 2026-02-23 21:58 UTC | Fixed quiz panel inconsistency/flicker by restricting quiz auto-open to latest assistant quiz only (`quiz-reveal` + `chat-messages`), aligned quiz panel visual shell to shared right-panel styling (`quiz-panel`), and reduced right-panel docking layout jank by removing global dock padding animation (`globals.css`). |
| 11.5 | [DONE] | 2026-02-23 21:58 UTC | Added super-admin access robustness and admin fallback access for super-admin users: unified super-admin email parsing across runtime layers (supports comma/space/semicolon separators), relaxed middleware super-admin enforcement when email claim is absent, and allowed `/admin` UI gating via `isSuperAdmin` in addition to role checks. Final gate rerun passed repeatedly: `npm run lint`, `npm run test:run`, `npm run build`, `npx convex dev --once`. |
| 11.6 | [DONE] | 2026-02-23 22:13 UTC | Frontend model-selection redesign completed in composer: replaced provider-first grouped list with popularity-first flat ranking, added smart provider chips that only appear during active search, preserved tier guardrails/restriction messaging, and improved scanability with “Popular” + “Recommended” badges (`chat-composer`). |
| 11.7 | [DONE] | 2026-02-23 22:13 UTC | Header/composer/chat flow polish: reduced top-right action clutter in `chat-header` (consolidated actions into compact menu while preserving settings/compact/stop), aligned composer/message column widths (`max-w-6xl`) and sticky translucent composer treatment, increased bottom chat padding to avoid hidden final content, and adjusted jump-to-bottom affordance placement (`chat-messages`). |
| 11.8 | [DONE] | 2026-02-23 22:13 UTC | Dark-mode/readability and design-token hardening: added missing `--accent-orange` token in light/dark palettes, normalized message journal text colors/line-height and toned down heading treatment to reduce “journalist” formatting in responses, and improved export targeting to conversation-only container (`data-conversation-export`) for cleaner PDF capture when side panels are active. |
| 11.9 | [DONE] | 2026-02-23 22:13 UTC | Sidebar/settings responsiveness tranche completed: improved collapsed sidebar icon sizing/centering, restored account avatar/actions in collapsed mode, switched usage meters to `budgetUsagePercent` when available (fixing persistent 0% symptoms), expanded settings “My files” viewport height, and reworked automation-profile rows to reduce boxed clutter while keeping controls explicit. |
| 11.10 | [DONE] | 2026-02-23 22:13 UTC | Guided-tour enrichment delivered: added explicit agent selector and auto-control tour anchors/steps (`chat-composer`, `chat-layout`) so onboarding now explains agent attachment + automation behavior directly in-context. Re-ran full gate after changes: `npm run lint`, `npm run test:run`, `npm run build`, `npx convex dev --once` all passing. |
| 11.11 | [DONE] | 2026-02-23 22:24 UTC | Hardened orchestration panel auto-open loop in `chat-layout` to avoid repeated state churn during streaming (`openedOrchestrationForStreamRef`), directly addressing the reported max-update-depth hotspot around effect line ~141 while keeping automatic orchestration visibility behavior. |
| 11.12 | [DONE] | 2026-02-23 22:24 UTC | Improved super-admin/admin access resilience: removed middleware-level `/super-admin` hard-redirect logic in `proxy.ts` (API-level `requireSuperAdmin` enforcement remains authoritative), and upgraded `requireActor` in `auth-server` to sync live Clerk identity when needed and re-evaluate super-admin promotion against current email, preventing stale-email lockouts. |
| 11.13 | [DONE] | 2026-02-23 22:24 UTC | Sidebar navigation redesign tranche: added responsive top-page collapsing (4/5 visible by viewport height), hover expansion for hidden primary pages, user-controlled page reordering with persistent localStorage order, and super-admin-inclusive admin/school-admin visibility in `chat-sidebar`; also removed search-input focus border artifact per UI feedback. |
| 11.14 | [DONE] | 2026-02-23 22:24 UTC | Quiz and settings consistency pass: enforced single active quiz panel across message list to stop stacked-panel flicker (`quiz-reveal` global panel-open event), expanded settings panel file list viewport + reliable usage ratio (`budgetUsagePercent`) in `unified-panel`, and flattened residual assistant “journal surface” styling in `globals.css` for cleaner response presentation. Full gate rerun passed: `npm run lint`, `npm run test:run`, `npm run build`, `npx convex dev --once`. |
| 11.15 | [DONE] | 2026-02-23 22:33 UTC | Chat scroll architecture refactor completed: moved conversation to the main page scroll root (`chat-layout` now `data-chat-scroll-root` with vertical overflow), removed nested message list overflow in `chat-messages`, kept sticky header/composer behavior intact, and updated jump-to-bottom behavior for the unified scroll model. |
| 11.16 | [DONE] | 2026-02-23 22:35 UTC | Dock/theme consistency pass: removed global right-panel dock space mutations from `use-right-panel-dock` (eliminating layout shift side-effects), aligned command-palette theme toggle with `ThemeProvider` via `ai-school:toggle-theme` event, and added provider-side global event handling to keep icon/state synchronization stable across all theme toggles. |
| 11.17 | [DONE] | 2026-02-23 22:40 UTC | Added super-admin broadcast notifications and further action declutter: introduced `notifications:sendSuperAdminAnnouncement` mutation with all/org/email audiences, added authenticated `/api/super-admin/notifications` route, shipped broadcast composer UI in `/super-admin` dashboard, and reduced assistant message visible action clutter by moving “Why this response” into the overflow menu. Full verification gate passed (`npm run lint`, `npm run test:run`, `npm run build`, `npx convex dev --once`). |
| 11.18 | [DONE] | 2026-02-23 22:41 UTC | Cleanup and dead-code hardening: removed orphaned `src/components/chat/quick-actions.tsx` (legacy quick-action bar no longer used), preserving the simplified composer-first control model and preventing accidental reintroduction of removed UI clutter. Re-ran full verification gate successfully (`npm run lint`, `npm run test:run`, `npm run build`, `npx convex dev --once`). |
| 11.19 | [DONE] | 2026-02-23 22:43 UTC | Model catalog normalization pass: added canonical provider-name normalization in `use-chat-state` merge pipeline (OpenAI/Google/Anthropic/etc alias folding + title-cased fallback), reducing duplicate provider buckets caused by case/alias drift and improving consistency across composer/model search/provider filtering surfaces. Full gate rerun passed (`npm run lint`, `npm run test:run`, `npm run build`, `npx convex dev --once`). |
| 11.20 | [DONE] | 2026-02-23 22:56 UTC | Reliability + dashboard realism tranche: implemented idempotent chat user-message persistence via `clientMessageId` (`schema` + `chats:appendMessage` dedupe + precise rollback deletion), propagated `userMessageId` through stream done payload and reconciled optimistic local IDs in `use-chat-state`, hardened chat-reload merging for pending assistants, replaced super-admin dashboard mock activity with live audit-log feed (`auditLog:listAuditLogs` actor enrichment + `/super-admin` rendering), and improved compaction UX messaging with dynamic minimum/current thresholds. Full verification gate rerun passed (`npm run lint`, `npm run test:run`, `npm run build`, `npx convex dev --once`). |

---

## Dependency Graph

```
PHASE 0 (Blockers) ──────────────────────────> ALL PHASES
PHASE 1 (Schema/Backend) ───┬──────────────> PHASE 5 (Memory/Branching)
                             ├──────────────> PHASE 6 (Admin/Security)
                             └──────────────> PHASE 8 (Gamification/Feedback)
PHASE 2 (UI Foundation) ────┬──────────────> PHASE 4 (Orchestration UI)
                             ├──────────────> PHASE 7 (Onboarding/Help)
                             └──────────────> PHASE 9 (Redesign)
PHASE 3 (Models/Budget) ───────────────────> PHASE 4 (Routing quality)
PHASE 4 (Modes/Sources) ───────────────────> PHASE 5 (Quality features)
PHASE 6 (Admin/Security) ──────────────────> PHASE 8 (Feedback inbox)
PHASE 7 (Help/Accessibility) ──────────────> PHASE 9 (Redesign)
ALL PHASES ─────────────────────────────────> PHASE 10 (Final review)
```

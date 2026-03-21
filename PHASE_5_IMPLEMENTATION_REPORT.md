# Phase 5: UI/Product System — Implementation Report

## Overview
Phase 5 focuses on delivering a premium, polished UI experience across the chat interface, preview system, sidebar, and landing page. All changes are frontend-only (except the messages schema update for branching).

## Completed Items

### 1. Chat Width 680px (Section 7A)
**Files modified:**
- `src/components/chat/chat-messages.tsx` — Changed `max-w-6xl` to `max-w-[680px]` on message container
- `src/components/chat/chat-composer.tsx` — Changed `max-w-6xl` to `max-w-[680px]` on composer wrapper

**Result:** Messages and composer now have generous side margins, creating a readable column layout that doesn't compress the right panel.

### 2. Right Panel Slide Animation (Section 7B)
**Files modified:**
- `src/components/chat/unified-panel.tsx` — Added `animateIn` state with `requestAnimationFrame` trigger. Applied CSS `transform` and `opacity` transitions to the `<aside>` element when in sheet mode:
  - `transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease`
  - Sheet slides from `translateX(24px)` to `translateX(0)`, compact from `translateY(16px)` to `translateY(0)`

### 3. Setting Pill Auto/Off/On Distinction (Section 7C)
**Files modified:**
- `src/components/chat/chat-composer.tsx` — `SettingPill` component now has three distinct visual states:
  - **Off**: Gray/dim with `opacity-60`, text-tertiary color
  - **Auto**: Animated glow border via `auto-pill-active` CSS class
  - **On**: Solid accent fill with cyan border and tinted background
  - Size reduced from `h-9 w-9` to `h-8 w-8`
- `src/components/chat/unified-panel.tsx` — `AutoChoice` panel component also updated with three-state visual distinction:
  - **Off**: Default secondary background
  - **Auto**: Animated `auto-pill-active` glow
  - **On**: Accent-tinted background with cyan ring
- `src/app/globals.css` — Added `@keyframes auto-pill-glow` animation and `.auto-pill-active` class

### 4. Orchestrator Progress UI (Section 7D)
**Files modified:**
- `src/components/chat/unified-panel.tsx` — Enhanced progress section:
  - Replaced dot indicators with proper icons: `CheckCircle2` (completed), `Loader2` with spin (in_progress), `XCircle` (skipped), plain dot (pending)
  - Added auto-fade: section gets `opacity-60` when stage is "complete" and not sending
  - Better text styling: active steps get `font-medium text-primary`, completed get `text-secondary`, pending get `text-tertiary`

### 5. Sidebar Collapsed Fixes (Section 7E)
**Files modified:**
- `src/components/chat/chat-sidebar.tsx`:
  - **Streak/XP**: Changed from `flex items-center gap-2` (horizontal) to `flex flex-col items-center gap-1` (vertical stacking)
  - **Notifications/Utilities**: Changed container from `overflow-y-auto` with `mask-image` to `overflow-visible` — fixes clipped dropdown menus and notification popovers
  - **Spectra text**: Added `<p>Spectra</p>` below org name in expanded sidebar header

### 6. Header Alignment (Section 7F)
**Files modified:**
- `src/components/chat/chat-header.tsx`:
  - Header uses `min-h-[var(--header-height,56px)]` for consistent sizing
  - Inner row uses `h-[var(--header-height,56px)]` with flex centering
  - Header content max-width aligned to `max-w-[680px]` to match messages
  - Compact tip max-width also aligned
- `src/app/globals.css` — Added `--header-height: 56px` CSS custom property

### 7. Model Display on Chat Switch (Section 7G)
**Files modified:**
- `src/components/chat/chat-layout.tsx`:
  - Added `modelTransitioning` state that sets to `true` for 600ms when `selectedChatId` changes
  - `lastModelUsed` memo returns `undefined` during transition, causing natural skeleton/loading state in child components
  - Uses `prevSelectedChatRef` to detect chat switches

### 8. Source Cards Compact (Section 7H)
**Files modified:**
- `src/components/chat/chat-message.tsx` — `CitationCards` component redesigned:
  - Changed from `grid gap-2 sm:grid-cols-2` with `min-h-[4.75rem]` cards to `flex flex-wrap gap-1.5` with inline pill-style cards
  - Cards now show domain/title only in a single line with truncation
  - Card height reduced ~60% (from ~76px to ~28px)
  - Section spacing reduced from `mt-8 pt-4` to `mt-6 pt-3`

### 9. Inline Code/Preview Toggle (Section 7I)
**Status:** Already implemented (verified). The `CodeBlock` component in `markdown-renderer.tsx` already has:
- `showPreview` state toggle
- Eye/EyeOff icon button
- Switches between `CodePreview` and `SyntaxHighlighter` inline

### 10. CSP Fix for Preview Sandbox (Section 7J)
**Files modified:**
- `src/lib/code-sandbox.ts` — Updated CSP meta tag to allow jsdelivr CDN:
  ```
  script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net
  ```
  This unblocks Mermaid, React, ReactDOM, and Babel CDN scripts within the sandboxed iframe.

### 11. PostMessage Scoping with frameId (Section 7J)
**Files modified:**
- `src/lib/code-sandbox.ts`:
  - Created `buildResizeScript(frameId)` function that embeds a unique `frameId` in each iframe's resize/error scripts
  - All `parent.postMessage()` calls now include `{ frameId }` in the payload
  - Updated `wrapHtml()` and `buildReactSrcdoc()` to accept and pass `frameId`
  - `buildSrcdoc()` accepts optional `frameId` parameter
- `src/components/chat/code-preview.tsx`:
  - Uses `useId()` to generate a stable unique `frameId` per component instance
  - Passes `frameId` to `buildSrcdoc()`
  - `handleMessage` callback filters events by `frameId` — ignores messages from other iframes

### 12. Branch Navigation Schema + UI (Section 7K)
**Files modified:**
- `convex/schema.ts` — Added to messages table:
  - `parentMessageId: v.optional(v.id("messages"))` — links to parent for branch tracking
  - `siblingIndex: v.optional(v.number())` — position among siblings (0-based)
  - `siblingCount: v.optional(v.number())` — total sibling count
  - Added `by_parent_message` index on `parentMessageId`
- `src/hooks/use-chat-state.ts` — Extended `Message` type with `parentMessageId`, `siblingIndex`, `siblingCount`
- `src/components/chat/chat-message.tsx`:
  - Added `siblingIndex`, `siblingCount`, `onNavigateSibling` props
  - Added branch navigation UI: `◀ 1/3 ▶` indicator with prev/next buttons
  - Renders in assistant message header next to `ModelRoutingBadge`
  - Only visible when `siblingCount > 1`

### 13. School Branding CSS Vars (Section 8C)
**Status:** Already implemented (verified). `sidebar-context.tsx` already reads `org.primaryColor`/`org.accentColor` and sets `--brand-primary`/`--brand-accent` CSS vars on the document root.

### 14. Landing Page Polish
**Files modified:**
- `src/app/landing/orchestration-demo.tsx` — Simplified model names:
  - "Claude Sonnet" → "Claude"
  - "Gemini 2.5 Pro" → "Gemini"
  - "GPT-4o" → "GPT"
- `src/app/landing/landing-client.tsx`:
  - Same model name simplification in conversation examples
  - Mode card hover: `transform-origin` changed from `top center` to `center center`, scale reduced from `1.15` to `1.0`
- `src/app/landing/soul-diagram.tsx` — Added `soul-core-pulse` animation to AI Core element for a breathing glow effect
- `src/app/globals.css` — Added `@keyframes soul-core-pulse` keyframes
- `src/components/chat/chat-sidebar.tsx` — Added "Spectra" text below school name in sidebar header

## Test Results
- **TypeScript**: Clean compilation (`npx tsc --noEmit` — zero errors)
- **Vitest**: 25 test files passed, 156 tests passed. 6 pre-existing failures in pipeline, routing, memory-compaction, spaced-repetition, and clarification tests (unrelated to Phase 5 UI changes)

## Files Changed Summary
| File | Changes |
|------|---------|
| `src/app/globals.css` | `--header-height` var, auto-pill-glow keyframes, soul-core-pulse keyframes |
| `src/components/chat/chat-messages.tsx` | 680px max-width |
| `src/components/chat/chat-composer.tsx` | 680px max-width, SettingPill 3-state visuals |
| `src/components/chat/chat-header.tsx` | Header height alignment, 680px max-width |
| `src/components/chat/unified-panel.tsx` | Slide animation, AutoChoice 3-state, orchestrator progress icons |
| `src/components/chat/chat-sidebar.tsx` | Collapsed fixes, Spectra text |
| `src/components/chat/chat-message.tsx` | Compact source cards, branch navigation UI |
| `src/components/chat/code-preview.tsx` | frameId scoping |
| `src/components/chat/chat-layout.tsx` | Model display transition state |
| `src/lib/code-sandbox.ts` | CSP fix, frameId in PostMessage |
| `src/hooks/use-chat-state.ts` | Branch fields on Message type |
| `convex/schema.ts` | Branch navigation fields + index on messages |
| `src/app/landing/orchestration-demo.tsx` | Simplified model names |
| `src/app/landing/landing-client.tsx` | Simplified model names, mode card animation |
| `src/app/landing/soul-diagram.tsx` | Core pulse animation |

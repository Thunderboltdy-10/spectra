# Implementation Plan: Phase 1.3 Critical Fixes

## Overview
This plan addresses all critical bugs and missing features reported in Phase 1.3 of PLAN.md, plus additional issues identified during testing.

---

## Critical Issues to Fix

### 1. Image Generation 1MB Limit (HIGH PRIORITY)
**Problem:** Images stored as base64 data URLs exceed Convex's 1MB document limit.

**Solution:**
1. Add `storeImageBlob` action to `convex/images.ts` that:
   - Accepts base64 image data
   - Decodes to Uint8Array  
   - Stores via `ctx.storage.store()`
   - Returns serving URL via `ctx.storage.getUrl()`

2. Modify `src/lib/openrouter.ts`:
   - After receiving imageUrl, check if it's a data URL
   - If yes, call `storeImageBlob` mutation
   - Replace imageUrl with Convex serving URL

3. Update `src/lib/orchestrator/pipeline.ts`:
   - Use the serving URL from openrouter
   - Store URL (not base64) in message content

---

### 2. Hardcoded Image Models (HIGH PRIORITY)
**Problem:** Image generation uses hardcoded model `google/gemini-3-pro-image-preview`.

**Solution:**
1. Add image model selection to the UI (similar to manual model selector)
2. Pass selected image model through the pipeline
3. Store user's preferred image model per chat or globally
4. Add image models to the model catalog with `imageGen` tag

**Files to modify:**
- `src/lib/model-config.ts` - Add image model options
- `src/components/chat/chat-layout.tsx` - Add image model selector
- `src/lib/orchestrator/pipeline.ts` - Accept image model parameter

---

### 3. Auto Mode Not Updating UI Properly (HIGH PRIORITY)
**Problem:** When pipeline auto-switches mode, UI doesn't always reflect the change.

**Issues found:**
- Line 1171 in `use-chat-state.ts` updates settings for `selectedChatId` instead of the stream's chatId
- Image mode completion doesn't include `suggestedMode`

**Solution:**
1. Fix mode update to use stream chatId:
   ```typescript
   // In stream done handler, use chatId from payload, not selectedChatId
   if (payload.suggestedMode && payload.suggestedMode !== mode) {
     setMode(payload.suggestedMode as StudyMode);
     // Use the chatId from the stream, not selectedChatId
     const streamChatId = payload.chatId || selectedChatId;
     if (streamChatId) {
       void updateExistingChatSettingsForChat(streamChatId, { 
         mode: payload.suggestedMode as StudyMode 
       }).catch(() => {});
     }
   }
   ```

2. Add `suggestedMode` to image mode completion in `pipeline.ts`:
   ```typescript
   suggestedMode: effectiveMode !== safeMode ? effectiveMode : undefined,
   ```

---

### 4. Conversation Title Generation (HIGH PRIORITY)
**Problem:** New chats don't get auto-generated custom titles.

**Issues found:**
- Title is set to user's first message slice (line 697 in use-chat-state.ts)
- Early title generation exists but may not be working

**Solution:**
1. Ensure `maybeGenerateTitleFromUserPrompt` is called for first message
2. Update title in UI when `chat_title` event received from stream
3. Verify early title promise is working in pipeline.ts

---

### 5. Draft Prompt localStorage with Sidebar Indicator (HIGH PRIORITY)
**Problem:** Draft prompts are lost when switching chats. No indicator shows if chat has draft.

**Solution:**
1. Add localStorage persistence:
   ```typescript
   // Key format: `ai-school:draft:${chatId}`
   // Store when user types
   // Load when switching to chat
   ```

2. Add draft indicator to sidebar chat items
3. Show badge or icon when chat has unsent draft

**Files to modify:**
- `src/hooks/use-chat-state.ts` - Add draft persistence
- `src/components/chat/chat-sidebar.tsx` - Add draft indicator
- `src/components/chat/chat-composer.tsx` - Load/save drafts

---

### 6. Loading Spinner for Processing Chats (MEDIUM PRIORITY)
**Problem:** No visual indicator in sidebar when a chat has an active stream.

**Solution:**
1. Pass `activeStreamIds` to sidebar
2. Show spinner/indicator next to chat title when active
3. Update in real-time as streams complete

**Files to modify:**
- `src/components/chat/chat-sidebar.tsx` - Add loading indicator
- `src/context/sidebar-context.tsx` - May need to track active streams

---

### 7. Quiz Explanation Orphan Chat Bug (HIGH PRIORITY)
**Problem:** Quiz explanation requests create new orphan chats because no chatId is passed.

**Location:** `src/components/chat/quiz-reveal.tsx` lines 166-223

**Solution:**
1. Pass `chatId` in the explanation request body:
   ```typescript
   const res = await fetch("/api/chat", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       chatId,  // <-- ADD THIS
       mode: "general",
       message: `Explain...`,
       // ... rest of payload
     }),
   });
   ```

2. Need to pass chatId from parent component to QuizReveal

---

### 8. Topic Anchoring in Quiz/Flashcard Repair (HIGH PRIORITY)
**Problem:** Quiz about "microeconomics" generates respiratory system questions.

**Root Cause:** Repair prompts don't strongly anchor to original topic.

**Solution:** Already partially implemented in pipeline.ts lines 989-992, but verify:
1. Repair prompts include: `"The student asked: "${normalizedMessage}"...`
2. Regeneration prompts include the same
3. System prompts for quiz/flashcard modes include topic anchoring

---

### 9. Auto Mode Color/Icon Verification (MEDIUM PRIORITY)
**Problem:** Auto mode may not show correct color/icon.

**Status:** Already defined in `src/lib/modes.ts`:
- Icon: `Sparkles`
- Color: `linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)`

**Solution:** Verify the gradient works properly in the mode selector.

---

### 10. Image Mode Icon (MEDIUM PRIORITY)
**Problem:** Image mode missing icon.

**Status:** Already defined in `src/lib/modes.ts`:
- Icon: `ImagePlus`

**Solution:** Verify it's working in mode selector.

---

## Implementation Order

### Phase 1: Critical Data Fixes
1. Fix 1MB image limit (storeImageBlob)
2. Fix quiz explanation orphan chat
3. Fix auto mode scope to stream chat
4. Add suggestedMode to image mode

### Phase 2: UI/UX Improvements  
5. Draft prompt localStorage
6. Loading spinner in sidebar
7. Conversation title generation fix

### Phase 3: Model Selection
8. Remove hardcoded image models

### Phase 4: Polish
9. Verify auto mode colors/icons
10. Flashcard page improvements

---

## Detailed Code Changes

### 1. convex/images.ts - Add storeImageBlob

```typescript
export const storeImageBlob = mutation({
  args: {
    actorClerkId: v.string(),
    base64Data: v.string(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    // Decode base64 to Uint8Array
    const base64 = args.base64Data.replace(/^data:image\/\w+;base64,/, "");
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Store in Convex storage
    const blob = new Blob([bytes], { type: args.mimeType });
    const storageId = await ctx.storage.store(blob);
    const servingUrl = await ctx.storage.getUrl(storageId);

    return { storageId, servingUrl };
  },
});
```

### 2. src/lib/openrouter.ts - Upload base64 images

Modify `openRouterGenerateImage` to:
1. Accept `actorClerkId` parameter
2. Check if returned imageUrl is a data URL
3. If yes, call storeImageBlob mutation
4. Return the serving URL instead

### 3. src/lib/orchestrator/pipeline.ts - Image mode fixes

1. Pass actor.clerkId to openRouterGenerateImage
2. Add suggestedMode to image mode completion payload
3. Verify early title generation works

### 4. src/components/chat/quiz-reveal.tsx - Fix orphan chat

1. Accept chatId prop
2. Pass chatId in explanation request body

### 5. src/hooks/use-chat-state.ts - Mode update fix

1. Create helper function to update chat settings by ID
2. Use stream's chatId for mode updates, not selectedChatId
3. Add draft localStorage persistence

### 6. src/components/chat/chat-sidebar.tsx - Draft & loading indicators

1. Accept activeStreamIds prop
2. Show loading spinner for active chats
3. Show draft indicator for chats with saved drafts

---

## Testing Checklist

- [ ] Generate image - verify no 1MB error
- [ ] Generate image - verify URL is Convex serving URL, not base64
- [ ] Switch chats while streaming - verify mode doesn't bleed
- [ ] Create new chat - verify title gets generated
- [ ] Type draft, switch chats, return - verify draft persists
- [ ] Submit quiz answers, request explanation - verify no orphan chat created
- [ ] Use auto mode with "create image" prompt - verify switches to image mode
- [ ] Verify auto mode shows gradient color
- [ ] Verify image mode shows ImagePlus icon
- [ ] Verify loading spinner shows in sidebar for active streams

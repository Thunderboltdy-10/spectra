# Clarification System Audit Report
**Audit Focus**: Clarification & Human-in-the-Loop
**Scope**: Detection, Generation, Persistence, Resume, UX Analysis

---

## 1. Clarification Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      CLARIFICATION FLOW DIAGRAM                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐     ┌────────────────────────────────────────────────────┐    │
│  │ User sends   │     │ Detection Phase (clarification.ts)                 │    │
│  │ T2+ T3 req   │────>│ needsClarification() called                        │    │
│  └──────────────┘     │ Triggers when:                                      │    │
│                       │ 1. No prior clarification asked                      │    │
│                       │ 2. RequestClass >= T2 & mode != quiz/flashcard        │    │
│                       │ 3. No conflicting directives detected                 │    │
│                       │                                                        │    │
│                       │ Detection Triggers:                                   │    │
│                       │ • Vague research queries (lacksResearchSpecificity)   │    │
│                       │ • Generic prompts (isVagueEnhancedRequest)            │    │
│                       │ • Conflicting directives (recency vs search opt-out)  │    │
│                       │ • Conflicting model/agent directives                  │    │
│                       └────────────────────────────────────────────────────┘    │
│                                    │                                              │
│                        ┌───────────┘                                              │
│                        │                                                          │
│                        ▼                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │ Generation Phase (clarification-generator.ts)                              │  │
│  │ openRouterChatCompletion with:                                              │  │
│  │   - Model: text-role specialization                                         │  │
│  │   - Prompt: Structured JSON response                                         │  │
│  │   - Temp: 0.1                                                                │  │
│  │   - Tokens: 520                                                               │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                │                                    │
│                        ┌──────────────────────┘                                    │
│                        │                                                           │
│                        ▼                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │ Persistence Phase (clarification.ts)                                        │  │
│  │ buildRecentContextSnapshot() → JSON.stringify()                             │  │
│  │ Fields stored in chat.recentContext:                                        │  │
│  │   - version: 1                                                               │  │
│  │   - kind: "clarification_pending"                                            │  │
│  │   - createdAt: timestamp                                                     │  │
│  │   - requestClass, mode                                                       │  │
│  │   - retrieval (citations, sourceBlock, diagnostics)                          │  │
│  │   - search (text, urls, sources, provider)                                   │  │
│  │   - clarification (context, questions)                                       │  │
│  │                                                                              │  │
│  │ Cache key: recentContextAt timestamp                                         │  │
│  │ TTL: FIVE_MINUTES_MS = 300,000ms (5 minutes)                                │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                │                                    │
│                        ┌──────────────────────┘                                    │
│                        │                                                           │
│                        ▼                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │ UI Rendering (clarification-card.tsx)                                      │  │
│  │ - ClarificationBlock rendered as inline assistant message                    │  │
│  │ - Supports: single_choice, multi_choice, confirmation, free_text            │  │
│  │ - Max 3 questions per clarification                                           │  │
│  │ - Disabled while server sending                                               │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                │                                    │
│                        ┌──────────────────────┘                                    │
│                        │                                                           │
│                        ▼                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │ Resume Phase (on user answer submission)                                    │  │
│  │ buildClarificationResumeFollowUp({                                          │  │
│  │   message: "Clarification answers: ...",                                    │  │
│  │   answers: { questionId: value... },                                        │  │
│  │   sourceMessageId: assistant_clarification_message_id                        │  │
│  │ })                                                                          │  │
│  │                                                                              │  │
│  │ Returns: { message, options }                                                │  │
│  │ options: {                                                                   │  │
│  │   skipLocalUser: true,  ← Prevents user bubble creation                     │  │
│  │   skipServerUserPersist: true,  ← Prevents duplicate DB storage            │  │
│  │   clarification: {                                                           │  │
│  │     sourceMessageId: ...,                                                    │  │
│  │     answers: { ... }                                                         │  │
│  │   }                                                                          │  │
│  │ }                                                                            │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                │                                    │
│                        ┌──────────────────────┘                                    │
│                        │                                                           │
│                        ▼                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │ Loop Prevention (isClarificationFollowUpMessage)                            │  │
│  │ - Detects structured answer patterns                                         │  │
│  │ - Checks question: "id: answer" matching                                    │  │
│  │ - Detects "please continue" phrasing                                        │  │
│  │ - Detects option label matching                                              │  │
│  │ - Detects numbered answer continuation                                       │  │
│  │                                                                              │  │
│  │ Follow-up is processed to continue flow instead of re-triggering            │  │
│  │ clarification                                                                │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                │                                    │
│                        ┌──────────────────────┘                                    │
│                        │                                                           │
│                        ▼                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │ Cache Expiry / Rehydration (use-chat-state.ts)                              │  │
│  │ On chat load / rehydration:                                                  │  │
│  │ 1. parseRecentContext(rawCache, savedAt, now)                               │  │
│  │ 2. If valid (within TTL):                                                    │  │
│  │    - Check if hasClarificationMessage exists                                  │  │
│  │    - If valid & no answer already shown → Render clarification card          │  │
│  │ 3. Cache expiry > 5 minutes returns null                                     │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Detection Criteria Analysis

**Detection Location**: `src/lib/orchestrator/clarification.ts` → `needsClarification()`

| Criterion | Implementation | Thresholds |
|-----------|---------------|-------------|
| RequestClass Filter | `requestClassAtLeast(requestClass, "T2")` | T0 bypassed, only T2/T3 eligible |
| Mode Filter | `mode === "quiz" \|\| mode === "flashcard" return false` | Quiz/exam modes excluded |
| LastAssistantWasClarification | `lastAssistantWasClarification return false` | Prevents re-triggering |
| Conflicting Directives | `hasConflictingDirectives()` | • Recency vs search opt-out<br>• Forced model vs multi-agent |
| Vague Research | `lacksResearchSpecificity()` | Requires: scope anchor + output constraint OR temporal constraint |
| Vague Enhanced | `isVagueEnhancedRequest()` | • `^(help|do|make|write|...)` generic lead<br>• No concrete anchor<br>• ≤5-9 words |

**Vague Research Detection**:
```typescript
const hasScopeAnchor = /\b(about|on|for|between|vs|regarding|focused|from|since)\b/i;
const hasOutputConstraint = /\b(citations|sources|brief|outline|report|bullets)\b/i;
const hasTemporalConstraint = /\b(20\d{2}|today|this week|last [year|month|week])\b/i;
return !hasScopeAnchor && !hasOutputConstraint && !hasTemporalConstraint;
```

**Vague Enhanced Request Detection**:
```typescript
const genericLead = /^(help|do|make|write|explain|research|plan)\b/;
const hasConcreteAnchor = /\b(about|on|for|with|using|specific|topic|question)\b/i;
return words.length <= 5 || (genericLead && !hasConcreteAnchor && words.length <= 9);
```

---

## 3. Persistence Analysis

**Persistence Location**: `src/lib/orchestrator/clarification.ts` → `buildRecentContextSnapshot()`

| Aspect | Implementation |
|--------|----------------|
| **Storage Format** | JSON string in `chat.recentContext` field |
| **Timestamp** | `chat.recentContextAt` stores creation timestamp |
| **Cache TTL** | `FIVE_MINUTES_MS = 300,000ms` (5 minutes) |
| **Key** | `recentContextAt` timestamp serves as cache key |
| **Serialization** | `JSON.stringify(snapshot)` in `serializeRecentContext()` |
| **Deserialization** | `parseRecentContext()` validates on load |
| **Expiry** | `now - savedAt > FIVE_MINUTES_MS → return null` |
| **Cleanup** | Concurrent mutation: `chats:setRecentContext` clears cache on resolution |

**Cache Expiry Logic** (`parseRecentContext`):
```typescript
const now = params.now ?? Date.now();
if (now - savedAt > FIVE_MINUTES_MS) return null;
```

**Cache Rehydration** (`use-chat-state.ts`):
```typescript
const recentContextCache = parseRecentContext({
  raw: data.chat.recentContext,
  savedAt: data.chat.recentContextAt,
});
if (recentContextCache?.clarification && !hasClarificationMessage) {
  // Render clarification card
}
```

**Issues Identified**:
- ❌ Cache expires after 5 minutes → Lost clarification context
- ❌ No DB persistence for clarification answers
- ❌ Answers stored only in client message, not server DB
- ❌ Lost when user navigates away and returns after 5 min
- ❌ No option for user-specified longer expiry

---

## 4. Resume Mechanism Analysis

| Aspect | Implementation |
|--------|----------------|
| **Answer Type** | `ClarificationAnswerValue = string \|\| string[] \|\| boolean` |
| **Skip Local User** | `skipLocalUser: true` → Answers don't create user message bubbles |
| **Skip Server Persist** | `skipServerUserPersist: true` → Prevents duplicate DB writes |
| **Source tracking** | `sourceMessageId` tracks original clarification message |
| **Follow-up pattern** | Generated with "Clarification answers:" prefix |

**Resume Flow**:
```
User submits answers → buildClarificationResumeFollowUp({
  message: "Clarification answers:\n-\n... \nPlease continue",
  answers: { question1: value1, question2: value2 },
  sourceMessageId: "assistant-clarification"
})
→ onFollowUp called → Server processes with answers attached
→ Conversation continues with clarified context
```

**Answer Formats Supported**:
- `single_choice` → Single string ID
- `multi_choice` → String array of IDs
- `confirmation` → boolean
- `free_text` → String (trimmed, max 2000 chars)

**Issues Identified**:
- ❌ No server-side answer storage → Lost on server restart
- ❌ No retry mechanism if resume fails
- ❌ Answers not persisted to Long-term storage

---

## 5. UX Implications of Poor Clarification Design

| UX Area | Current Implementation | Problem |
|---------|----------------------|---------|
| **New Message Creation** | Creates new assistant message | - Breaks conversation flow<br>− Requires user to scroll<br>- Visual interruption |
| **Answer Display** | `skipLocalUser: true` hides answers | - No visual feedback<br>- User doesn't see their answers<br>- Feels unresponsive |
| **Answer Persistence** | Only inline message | - Expires after 5 min<br>- Lost on navigation<br>- Lost on refresh |
| **Conversation Flow** | Clarification interrupts | - "Before I start..." feels blocking<br>- User expects continuation |
| **Inline Answers** | Not implemented | - No inline answer UI<br>- Requires full message submission |
| **Confirmation UX** | Continue button | - Could use "I understand" + submit |
| **Answer Reuse** | No reuse | - Could auto-fill on re-open |
| **Multi-step** | Single message | - Should consider progressive questions |
| **Context Visibility** | Full context shown | - Could be summarized for brevity |

---

## 6. Code-Level Issues

### Critical Issues

| Issue | File | Line | Description | Severity |
|-------|------|------|-------------|----------|
| CACHE_EXPIRES | clarification.ts | 275-277 | 5-minute TTL causes data loss | 🟥 High |
| NO_DB_PERSIST | clarification-resume.ts | 13-25 | Answers never saved to schema | 🟥 High |
| BREAKS_FLOW | clarification-card.tsx | 40-42 | Creates new message instead of inline UI | 🟥 High |
| NO_RETRY | clarification-generator.ts | 60-80 | LLM call can fail → lost clarification | 🟡 Medium |
| NO_DEBOUNCE | clarification.ts | 157-170 | All questions submitted at once | 🟡 Medium |

### Moderate Issues

| Issue | File | Description |
|-------|------|-------------|
| GENERIC_QUESTIONS | clarification.ts | Questions lack specificity |
| NO_OPTION_SUMMARY | clarification-generator.ts | No summary of option impacts |
| NO_PROGRESSIVE_UI | clarification-card.tsx | All questions visible at once |
| NO_PARTIAL_SUBMIT | clarification-card.tsx | Must answer all to continue |
| NO_ANSWER_VALIDATION | clarification-card.tsx | Basic trim, no format validation |
| NO_TIMEOUT_WARNING | clarification-card.tsx | No "cache expiring soon" notice |

### Low-Priority Issues

| Issue | File | Description |
|-------|------|-------------|
| HARD_LIMITED_QUESTIONS | clarification.ts | Max 3 questions hardcoded |
| NO_LOCAL_STORAGE_FALLOUT | use-chat-state.ts | LocalStorage used for drafts, not clarifications |
| NO_LOADING_STATE | clarification-card.tsx | Generated questions always immediate |
| NO_EMPTY_STATE | clarification-card.tsx | Not shown, but questions could be clearer |

---

## 7. Missing Features

| Feature | Priority | Rationale |
|---------|----------|-----------|
| **Server-side answer storage** | 🟥 High | Answers must persist beyond 5 min TTL |
| **Inline answer UI** | 🟥 High | Better UX than new message submission |
| **Progressive questions** | 🟡 Medium | Show 1 at a time, confirm before next |
| **Answer preview** | 🟡 Medium | Preview saved answers inline |
| **User-specified TTL** | 🟡 Medium | Allow "remember until resolved" option |
| **Retry on parse error** | 🟡 Medium | If LLM returns invalid JSON, fallback to generic |
| **Answer grouping** | 🟣 Low | Group related questions |
| **Context summary** | 🟣 Low | Summarize clarification context |
| **Option impact hints** | 🟣 Low | Explain impact of each option |
| **Answer retraction** | 🟣 Low | Allow correcting answers before continuation |

---

## 8. Recommendations

### Immediate Fixes (🟥 High Priority)

1. **Implement server-side answer storage**
   - Extend Convex schema: `clarificationAnswers` table
   - Store answers alongside `recentContext`
   - Expiry: Same as TTL or explicit user resolution

2. **Add inline answer display**
   - Remove `skipLocalUser` default for clarification
   - Show answers inline in clarification message
   - Better visual feedback

3. **Add retry on parse failure**
   ```typescript
   if (!block) {
     // Try generic fallback
     const fallback = buildFallbackClarificationBlock(reason);
     return { block: fallback, modelUsed, usage };
   }
   ```

4. **Extend cache expiry based on complexity**
   ```typescript
   const FIVE_MINUTES_MS = 5 * 60 * 1000;
   const COMPLEX_DURATION_MS = 45 * 60 * 1000; // 45 min for complex
   const SIMPLE_DURATION_MS = 10 * 60 * 1000; // 10 min for simple
   if (auto.complexity === "high") {
     if (now - savedAt > COMPLEX_DURATION_MS) return null;
   }
   ```

### Short-term Improvements (🟡 Medium Priority)

5. **Add progressive UI**
   - Show questions one at a time
   - Confirm before showing next
   - Reduce cognitive load

6. **Add answer validation**
   - Validate string length and content
   - Validate boolean for confirmations
   - Show error on invalid input

7. **Add timeout warnings**
   - "Your answers will expire in 4 minutes"
   - Auto-submit pending before timeout

8. **Add retry on LLM error**
   - Fallback to generic questions
   - Log error for user feedback

### Long-term Enhancements (🟣 Low Priority)

9. **Add option impact summaries**
   - Explain consequence of each option
   - Helps user make informed choice

10. **Add contextual help**
    - "Why is this question asked?"
    - Links to documentation

11. **Implement answer grouping**
    - Logical grouping of questions
    - Better UI organization

---

## 9. Files Analyzed

| File | Purpose | Lines Analyzed |
|------|---------|----------------|
| `src/lib/orchestrator/clarification.ts` | Detection, persistence, serialization | ~520 |
| `src/lib/orchestrator/clarification-generator.ts` | LLM question generation | ~180 |
| `src/lib/chat/clarification-resume.ts` | Answer types, resume logic | ~30 |
| `src/components/chat/clarification-card.tsx` | UI rendering, answer handling | ~200 |
| `src/hooks/use-chat-state.ts` | Rehydration, state management | ~1200 |
| `src/components/chat/chat-messages.tsx` | Message rendering, detection | ~1400 |

---

## 10. Summary

**System Strengths**:
- ✅ Well-structured detection logic
- ✅ Handles conflicting directives gracefully
- ✅ JSON response parsing with fallbacks
- ✅ Structured question types
- ✅ Cache rehydration on load

**System Weaknesses**:
- ❌ 5-minute cache expiry causes data loss
- ❌ No server-side answer storage
- ❌ Poor UX with new message creation
- ❌ Generic question generation
- ❌ No progressive question UI

**Impact**: Users lose clarification context after 5 minutes, answers not persisted, poor UX with conversation flow interrupts.

**Primary Action**: Implement server-side answer storage and inline UI to resolve critical UX and data loss issues.

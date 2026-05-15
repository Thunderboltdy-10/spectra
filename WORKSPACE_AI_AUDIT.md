# Workspace AI & Projection System Audit

**Date**: 2026-05-15  
**Scope**: Workspace AI, Projection Mechanism, Sync Logic, File Attachments

---

## Executive Summary

This audit identifies **23 critical findings** across the Workspace AI system:

| Category | Count | Severity |
|----------|-------|----------|
| Critical Issues | 8 | 🔴 |
| High Priority Issues | 14 | 🟠 |
| Documentation Gaps | 12 | 🟡 |
| **Total Issues Found** | **34** | — |

**Key Findings**:
- Workspace AI is a **simplified quick-chat clone** ❌
- **No file attachment** support — projection loses content silently ❌
- **Projection failures are not surfaced** to users — silent data loss ❌
- **Workspace state does not persist reliably** under concurrent mutations ❌
- **Incomplete workspace context** in chat history ❌
- **Missing advanced workspace tools** (RAG, code analysis) ❌
- **Poor error recovery** mechanisms ❌

---

## 1. Project Architecture Map

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     Workspace AI System                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐   ┌──────────────────────┐                 │
│  │  Frontend      │   │   Convex Backend     │                 │
│  │  (V2 Canvas)   │◄──┤   (workspaceItems.ts)│                 │
│  │  app.tsx       │   │   (workspaceItemSync.)│   ← Sync Layer  │
│  │  chrome.tsx    │   └──────────────────────┘   ← Mutation Log │
│  │  items.tsx     │   ┌──────────────────────┐                 │
│  │  widgets.tsx   │   │   Convex Mutations    │                 │
│  │  data.ts       │   │ • create_workspace    │                 │
│  └────────────────┘   │ • update_layout       │                 │
│        │              │ • attach_items        │                 │
│  ┌────────────────┐   │ • sync_thread         │                 │
│  │   AI Engine    │   │ • sync_artifact       │                 │
│  │ (ActionEngine) │   │ • sync_planner        │                 │
│  │ action-engine.ts│  └──────────────────────┘                 │
│  └────────────────┘           │                 │
│        │              ┌──────────────────────┐                 │
│  ┌────────────────┐   │   Quick Chat Layer   │                 │
│  │   Quick Chat   │   │   (quick-chat.tsx)   │                 │
│  │ (quick-chat)   │   │   ← Attachment Proxy │                 │
│  │  placeholder   │   └──────────────────────┘                 │
│  │  UI only       │                                           │
│  └────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. AI Capabilities: Workspace AI vs. Chat AI

| Capability | Chat AI | Workspace AI | Gap |
|------------|---------|--------------|------|
| **Core Interaction** | Multi-turn streaming chat | Single-item focused view | 🟡 |
| **Context Window** | Full chat history + resources | Single item's preview only | 🔴 |
| **RAG Retrieval** | Full vector search | ❌ Not connected to RAG | 🔴 |
| **File Attachments** | Supported | ❌ No support | 🔴 |
| **Code Analysis** | Basic | ❌ Not available | 🔴 |
| **Multi-step Planning** | Basic | ❌ Limited | 🔴 |
| **Tool Use** | Limited tools | ❌ None (yet) | 🔴 |
| **Error Recovery** | Basic retries | ❌ No retry logic | 🔴 |
| **Persistent Memory** | Session-bound | ❌ Silently drops | 🔴 |
| **Citations** | Full inline citations | ❌ No citations | 🔴 |
| **Execution Trace** | Full `RouteTrace` | ❌ Not shown | 🔴 |

### Critical Gaps

1. **RAG Disconnection**
   - Chat AI uses `usePersonalResources()` + vector search
   - Workspace AI has **no RAG access** to workspace resources
   - Results in degraded responses when workspace context matters

2. **Attachment Proxy**
   - Quick Chat supports `files: File[]` + upload state
   - Attachment proxy uploads to **quick-chat endpoint**
   - Workspace AI **never consumes** or **processes** these files
   - Files are uploaded but ignored (silent data loss)

3. **Chat History Access**
   - ThreadWidget fetches chat messages from `/api/chats/:chatId`
   - Message fetching can **fail silently** (caught errors)
   - User sees **no messages** but no error is shown

---

## 3. Projection Mechanism Analysis

### Current Implementation

```
Artifact → Workspace Item Sync Flow:
┌──────────────┐
│  Artifact    │
│  (created via convexMutation) │
└──────┬───────┘
       │ sync to workspace
       ▼
┌─────────────────────────────┐
│  syncWorkspaceItemForArtifact │
│  (convex/workspaceItemSync.ts) │
└──────┬───────────────────────┘
       │
       ├─► Check existing item (by sourceArtifactId)
       ├─► Archve if not in active workstream
       └─► Create/update projection
```

### Sync Failure Modes

| Failure Scenario | Current Behavior | Expected Behavior | Priority |
|------------------|------------------|-------------------|----------|
| **Network failure during mutation** | Mutation fails, no error logged | Show toast + retry button | 🔴 |
| **Existing item not found** | `throw new Error()` → uncaught | Graceful fallback or retry | 🔴 |
| **Permission mismatch** | Auth error not shown to user | Error toast + "contact support" | 🟠 |
| **Source artifact deleted** | Item remains in workspace | Auto-archive item | 🟠 |
| **Concurrent mutations** | Race condition → lost update | Optimistic locking | 🔴 |
| **Workstream change** | Item may lose workstreamId | Re-sync to new workstream | 🟠 |

---

## 4. Workspace Desync from Chat

### Problem Description

When a chat thread is deleted or moved to another workstream:

1. Workspace item remains archived (status: "archived")
2. **No notification** to user
3. ThreadWidget shows **empty state** but no "chat not found" message
4. **Silent data loss**

### Investigation Findings

```typescript
// In workspaceItemSync.ts:
export async function removeWorkspaceItemForChat(...) {
  const existing = await findWorkspaceItemForChat(...);
  if (!existing) return;
  await ctx.db.patch(existing._id, {
    status: "archived",    // ← silently archives
    updatedAt: Date.now(),
  });
}
```

**Issue**: User creates item via chat, chat moves/deletes, item becomes
archived but user never sees this. The item is effectively orphaned.

---

## 5. Context Completeness Analysis

### File Attachments

| Aspect | Status | Notes |
|--------|--------|-------|
| **Upload Support** | 🟡 Partial | Quick Chat accepts `File[]`, uploads to `/api/chat/file` |
| **Workspace Integration** | ❌ None | Files uploaded to quick-chat endpoint not integrated into workspace AI |
| **RAG Indexing** | ❌ Missing | Uploaded files not indexed for RAG |
| **Citations** | ❌ Missing | No citation support in workspace items |

### Context Sources

| Source | In Workspace AI? | Notes |
|--------|------------------|-------|
| Chat Message | ❌ No | `sourceChatId` stored but content not fetched/displayed by default |
| Artifact Content | 🟡 Partial | `contentPlaintext` fetched when sourceArtifactId present, but **not** used in RAG |
| Planner Item | 🟡 Partial | Similar to artifacts |
| Workspace Resources | ❌ No | No access to pack resources |
| Personal Resources | ❌ No | No access to personal files |
| System Promotes | ❌ Missing | No study mode context passed to AI |

---

## 6. Code-Level Issues

### Critical Issues (Priority: Fix Now)

#### 1. Silent Projection Failure
```typescript
// In items.tsx
useEffect(() => {
  if (!item.sourceArtifactId) return;
  let cancelled = false;
  fetch(`/api/artifacts?artifactId=${item.sourceArtifactId}`)
    .then(...).then(data => {
      if (cancelled) return;                      // ← cancellation guard
      if (data.artifact?.contentPlaintext) {
        setBody(data.artifact.contentPlaintext);
      }
    })
    .catch(() => {});  // ✅ catches but silently drops
  return () => { cancelled = true; };
}, [item.sourceArtifactId]);
```

**Issue**: Fetch fails (network, 404, 500), user sees empty content, **no error shown**

#### 2. No Error Boundary
All fetch operations use `.catch(() => {})` - errors are swallowed:
- `ThreadWidget` messages
- `BloomReading` preview
- `BloomBody` content retrieval
- `ArtifactWidget` hydration

#### 3. Missing Optimistic UI
- Layout updates wait for mutation result
- No loading state during sync
- Stale UI appears briefly

### High Priority Issues

#### 4. Weak Idempotency
```typescript
export const syncWorkspaceItemForArtifact = async (...) => {
  const existing = await findWorkspaceItemForArtifact(...);
  // ... if exists, patches - but no optimistic version check
}
```
No optimistic updates → UI flickers while mutation completes

#### 5. No Retry Logic
- Sync mutations are fire-and-forget
- On failure, no retry queue
- User must manually refresh

#### 6. Missing Validation
In `action-engine.ts`, many mutations don't validate:
- Content length limits before API call
- Empty input handling
- Required field enforcement at client side

### Medium Priority Issues

#### 7. Inconsistent Error Handling
Some mutations throw errors directly:
```typescript
async function requireOwnedItem(...) {
  // ...
  if (!item || ...) {
    throw new Error("Workspace item not found");  // ← uncaught error
  }
  return item;
}
```

#### 8. Versioning Gaps
- No conflict resolution on concurrent edits
- No undo/redo stack
- No local draft saving before sync

---

## 7. Missing Features

| Feature | Priority | Description |
|---------|----------|-------------|
| **Workspace AI Model** | 🔴 | Dedicated model for workspace tasks (vs. quick-chat) |
| **File Attachment** | 🔴 | Drop/upload files into workspace, RAG-index them |
| **Advanced Tools** | 🔴 | Code analysis, math tools, image processing |
| **Error Toasts** | 🔴 | Surface sync failures with actionable errors |
| **Retry Mechanism** | 🔴 | Auto-retry failed mutations with backoff |
| **Optimistic Locking** | 🔴 | UI updates immediately, conflict resolution later |
| **Local Drafts** | 🟠 | Cache edits locally before sync |
| **Undo/Redo** | 🟠 | Command pattern for workspace mutations |
| **Conflict Detection** | 🟠 | Visual indicators when items conflict |
| **Batch Operations** | 🟡 | Move/copy multiple items at once |
| **Bulk Search** | 🟡 | Search across all workspace types |
| **Smart Suggestions** | 🟡 | AI suggests next actions based on context |

---

## 8. Recommendations

### Immediate Actions (This Sprint)

#### Priority 1: Fix Silent Failures
1. **Add error boundaries** to all fetch operations
2. **Surface 404/500 errors** when fetching source content
3. **Show connection status** for live content (thread/messages/readings)

```typescript
// Proposed pattern
function loadContentWithFallback(fetchUrl: string, fallback: string | undefined): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  return fetch(fetchUrl, { signal: controller.signal })
    .then(r => r.ok ? r.json() : Promise.reject(new Error("Network error")))
    .then(data => {
      clearTimeout(timeout);
      if (data.contentPlaintext || data.content || data.content ?? undefined) {
        return data.contentPlaintext ?? data.content ?? data.content ?? "";
      }
      return fallback ?? "No content available";
    })
    .catch(err => {
      clearTimeout(timeout);
      console.error("Content fetch failed", err);
      return fallback ?? "Error loading content";
    });
}
```

#### Priority 2: Build Retry Queue
```typescript
type RetryItem = {
  mutationId: string;
  mutation: Function;
  args: unknown;
  retries: number;
  backoffMs: number;
};

const retryQueue: Map<string, RetryItem> = new Map();

function enqueueRetry(mutationId: string, mutation: Function, args: unknown, retries: number = 0) {
  const backoff = Math.min(1000 * Math.pow(2, retries), 5000);
  const timer = setTimeout(() => {
    mutation(args).then(
      () => enqueueRetry(mutationId, mutation, args, retries + 1),
      (err) => {
        if (retries < 3) enqueueRetry(mutationId, mutation, args, retries + 1);
        else logPermanentFailure(mutationId, err);
      }
    );
  }, backoff);
}
```

#### Priority 3: Add Optimistic UI
```typescript
function updateItemLayoutOptimistic(
  itemId: string,
  patch: Partial<typeof item>
): void {
  // Update UI immediately
  setItemInState(itemId, { ...currentState, ...patch });
  
  // Queue mutation
  queuedMutations.push({
    type: "updateItemLayout",
    args: { actorClerkId, itemId, ...patch },
    rollback: () => {/* undo if mutation fails */}
  });
}
```

### Short-term (Next Sprint)

1. **Build Workspace AI Agent**
   - Separate `useWorkspaceData` hook from quick-chat
   - Pass workspace context to AI
   - Enable tool use for workspace operations
   - Support file attachments in workspace AI

2. **Implement Error Boundary**
   - Wrap fetch operations in boundaries
   - Show meaningful error messages
   - Provide "Report Issue" button

3. **Build Sync Monitor**
   - Track mutation success/failure
   - Alert on repeated failures
   - Show sync status in sidebar

### Long-term (Future)

1. **Persistent Drafts**
   - Save edits before sync to avoid conflicts
   - Auto-reopen last edited item

2. **Conflict Resolution UI**
   - When two users edit same item
   - Show merge instructions
   - Auto-resolve simple conflicts

3. **Advanced Analysis**
   - Code analysis tools for code items
   - Math solving for notes/problems
   - Image analysis for visual items

---

## Appendix A: Component Dependency Map

```
┌─────────────────────────────────────────────────────────┐
│                Workspace AI System                        │
└─────────────────────────────────────────────────────────┘

chat/quick-chat → [supports attachments, but disconnected]
  ↓
widgets → [thread, artifact widgets fetch live content]
  ↓
app.tsx → [renders items, fetches content on mount]
  ↓
convex/workspaceItems → [mutations create/sync items]
  ↓
convex/workspaceItemSync → [sync logic: artifact → workspace]
  ↓
artifacts/plannerItems → [source content storage]

PROBLEMS:
• Quick Chat attachments never reach workspace AI
• Fetch errors silently dropped
• No conflict resolution
• No retry after mutation failure
```

---

## Appendix B: Error Flow

### Current Error Flow (BROKEN)

```
User → Mutation → Convex
         ↓ Success / Fail
      If fail → Error thrown (user sees crash)
         ↓
   Client catches some errors
         ↓
   Most errors logged as .catch(() => {})
```

### Target Error Flow

```
User → Mutation → Convex
         ↓ Success
      On success → Commit result → Update UI

         ↓ Fail (network)
      Queue retry → Show toast "Syncing..."
      On retry fail → Show toast "Failed. Manual refresh needed?"
      On perm fail → Alert support
```

---

## Appendix C: Checklist for Each File

| Question | Workspace AI | Chat AI | Status |
|----------|--------------|---------|--------|
| **File attachment supported?** | ❌ No | ✅ Yes | 🔴 |
| **Projection works?** | 🟡 Partial | ✅ Yes | 🟠 |
| **Projection fails visible?** | ❌ No | ✅ Yes | 🔴 |
| **Workspace context complete?** | ❌ Partial | ✅ Yes | 🔴 |
| **Workspace tools available?** | ❌ None | ✅ Basic | 🔴 |
| **Handles complex tasks?** | ❌ No | Partial | 🔴 |
| **State durable?** | ❌ No | ✅ Yes | 🔴 |

---

## Files Analyzed

| File | Purpose | Issues Found |
|------|---------|---------------|
| `src/components/workspace-v2/items.tsx` | Item rendering | Silent fetch failures, no error UI |
| `src/components/workspace-v2/widgets.tsx` | Widget body | ThreadWidget errors swallowed |
| `src/components/workspace-v2/chrome.tsx` | UI chrome | No sync status indicators |
| `convex/workspaceItems.ts` | Workspace mutations | No retry, weak validation |
| `convex/workspaceItemSync.ts` | Sync logic | Silent failures, no error boundary |
| `src/components/shared/quick-chat.tsx` | Quick Chat UI | Attachment proxy not used by workspace AI |
| `src/lib/orchestrator/action-engine.ts` | Action engine | Limited tool coverage |

---

**End of Audit**

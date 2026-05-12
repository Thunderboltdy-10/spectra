# Commit Analysis: "Redesign of Tools and AI"

## What's Working ✅

### Orchestrator Pipeline
- Models are selected and execute correctly
- Tool calls execute and emit events
- Events stream properly to UI

### Routing System
- Phase router with weighted scoring (8 dimensions)
- Model anchor system with TTL and capability validation
- Freshness filtering, provider diversity, cache-aware routing
- Challenger lane exploration mode

### UI Components
- Runtime cards with state indicators
- Execution timeline visualization
- Workspace V2 with view modes (topic/type/timeline)
- Command bar with runtime request chips

### Resources
- Upload → processing → indexed lifecycle
- Image base64 conversion for vision models
- Document quickExtractText (4000 chars)
- Preferred capabilities tracking

---

## What's Missing / Incomplete 🚨

### 1. Runtime Contract (Scaffolding Only)
- [ ] `AiRun` type defined but **never constructed** - just dead types
- [ ] `validateAiRunEventContract()` defined but **never called**
- [ ] `RuntimeContextEnvelope` structure defined but not populated
- [ ] No actual run tracking/observability implemented

### 2. Model Anchor Integration
- [ ] `resolveStableModelAnchor()` exists in `model-anchor.ts` but **not imported** in pipeline
- [ ] Pipeline builds anchors manually (lines 2345-2369) instead of using the resolver
- [ ] Clarification answers added to route trace but **no logic to resume** previous context

### 3. Message State Architecture (Two Parallel Systems)
| Feature | Old (`useChatState`) | New (`ChatMessageAccumulator`) |
|---------|---------------------|------------------------------|
| Error content storage | ✅ | ❌ - only sets streaming=false |
| Attachments | ✅ | ❌ - missing |
| Draft auto-save | ✅ | ❌ - missing |
| Bookmarks | ✅ | ❌ - missing |
| Search hits | ✅ | ❌ - missing |
| Collaborators | ✅ | ❌ - missing |
| Proactive banner | ✅ | ❌ - missing |
| Auto-enhance prompt | ✅ | ❌ - missing |

**Problem:** New architecture is incomplete replacement. Both systems still active.

### 4. Event Handling Gaps
Missing handlers in `ChatMessageAccumulator.consume()`:
- [ ] `artifact_saved`
- [ ] `artifact_progress`
- [ ] `artifact_error`
- [ ] `file_upload_progress`
- [ ] `file_uploaded`
- [ ] `system_message`
- [ ] `thinking_chunk` (different from `thinking_segment`?)

### 5. Routing System Issues
- [ ] No integration between heuristic router and phase router - unclear which runs in production
- [ ] No explicit hybrid mode
- [ ] Challenger state not persisted (runtime-only)
- [ ] No A/B testing framework
- [ ] Model anchor TTL not configurable per-mode
- [ ] No explicit retry logic for failed models

### 6. Resource Processing
- [ ] **Audio files** - listed in policy but normalizer doesn't handle them
- [ ] No audio `preferredCapabilities` in capability gate
- [ ] Normalizer re-fetches quickExtractText when already available from backend
- [ ] Sequential processing - could benefit from parallel
- [ ] Network failures silently fall back (no explicit error UI)

### 7. Phase Router Output
- [ ] No cost estimation in decision output
- [ ] No logging of routing decisions for observability
- [ ] Missing fallback when broker fails and no spending tier consideration

---

## Quick Wins to Implement

1. **Hook up runtime contract validation** - Call `validateAiRunEventContract()` during streaming

2. **Use `resolveStableModelAnchor()`** - Import and use the existing resolver in pipeline

3. **Complete message state migration** - Add missing features to `ChatMessageAccumulator` or consolidate to one system

4. **Add missing event handlers** - Implement artifact and file upload handlers

5. **Audio support** - Add audio type inference and capability tracking in normalizer

6. **Deduplicate quickExtractText** - Use backend-provided value instead of re-fetching

7. **Persist challenger state** - Add persistence layer for exploration mode

---

## Unknowns Requiring Investigation

- Which routing system is actually used in production? Both?
- What's the relationship between heuristic and phase router?
- Is the new message-state meant to fully replace old one?
- What's the plan for `AiRun` tracking?
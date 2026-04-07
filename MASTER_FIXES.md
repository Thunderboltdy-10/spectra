# Master Fix Tracker — Workspace Redesign

## ROOT CAUSE ANALYSIS (completed pre-implementation)

### Canvas Entry Bug (CRITICAL)
In `workspace-canvas.tsx handleInit` (line 1103):
- When `primaryWorkstreamId` is set from URL param, `handleInit` sets `animatedCommitRef.current = primaryWorkstreamId`
- This PREVENTS the `useEffect` at line 942 from running (it has an early return guard)
- But `handleInit` does NOT call `setVisibleWorkstreamIds([primaryWorkstreamId])` or `fetchContentForWorkstream`
- Result: internal nodes NEVER build → only the workspace card shows, no content

### Double-Zoom Bug (CRITICAL)
- `handleInit` sets viewport at zoom 0.85 (instant)
- When `positions` updates (workstreams load), `useEffect` at line 942 re-runs
- If `animatedCommitRef.current !== primaryWorkstreamId`, it zooms AGAIN at 1.0 with 450ms animation
- Fix: ensure animatedCommitRef is always set before positions update triggers the effect

### Workspace Card Still Showing (CRITICAL)
- `WorkstreamNode` with `isCommitted: true` renders as "dissolving" (semi-transparent, smaller) but still visible
- `hidden` is only set when `isDimmed && neighborOpacity <= 0`, NOT when committed
- Fix: set `hidden: isCommitted` to fully remove committed workspace card from view

### Quick Chat Not Visible
- EdgeUtilityOverlay renders quick chat at `bottom-10 right-10 z-40` - should be visible
- BUT the `WorkspaceCommandBar` is also rendered at bottom (in workspace page + in right panel)
- User says it was repositioned and config got messed up → reset `utilityPositions["command_bar"]` to null
- User wants quick chat in EdgeUtilityOverlay only (not in right panel as separate component)

### Right Panel Extra Right Margin
- In `right-push-panel.tsx` or `right-side-panel.tsx`, there's extra right spacing
- The panel renders with a fixed width but content has extra padding/margin on right side

### Artifact Error [object Object]
- `right-push-panel.tsx` line 421: `throw new Error(errData.error || "Failed to load artifact")`
- `errData.error` might be an object, not a string → `String(errData.error || "Failed to load artifact")`

### Policy Correction Text Leaking
- `pipeline.ts` lines 4283-4288 strips it at END of generation only
- But the text might appear mid-response or the stripping regex needs to be more aggressive
- Also check policy.ts system prompt - it says NEVER to mention it but model still does

### OpenRouter API Key False Warning
- Convex `env.ts` reads `process.env.OPENROUTER_API_KEY` at module load time
- Convex env vars must be set in Convex dashboard, not in Next.js .env
- The admin panel shows this warning from Convex query functions
- Fix: admin page should not show OpenRouter warning as an infrastructure error if it's a Convex env issue
- OR: the admin page already shows `openRouterConfigured` from the API → check that properly

### Editor Drag Handle Displacement
- `drag-handle.ts` line 131: `left = Math.max(0, contentLeft - 52)`
- `contentLeft = blockRect.left - wrapperRect.left` 
- If wrapper is the scroll container, not the visual editor, this is wrong
- The wrapper lookup: `view.dom.closest(".tiptap-root")` 
- Need to verify .tiptap-root is the right container and has correct positioning

### Image Upload vs URL Popup
- TiptapEditor uses `@tiptap/extension-image` which by default shows URL dialog on click
- Need to override the image node's click handler to trigger file upload instead

### Copy-Paste White Flash
- The `importClipboardData` in tiptap-editor triggers some DOM manipulation causing flash
- Need to investigate what causes the white flash

## FIX GROUPS

### Group 1: Canvas/Workspace Core (Sub-agent A)
- [ ] Fix handleInit: call setVisibleWorkstreamIds + fetchContentForWorkstream when primaryWorkstreamId set
- [ ] Fix committed workspace node: set hidden: isCommitted in workstreamNodes map  
- [ ] Prevent double-zoom: ensure animatedCommitRef is set before positions effects run
- [ ] Remove WorkstreamFieldNode (ugly static card) - it's in FLOW_NODE_TYPES but may not be used in buildWorkspaceNodes

### Group 2: Edge Overlay + Quick Chat + Controls (Sub-agent B)  
- [ ] Reset quick chat position config (clear utilityPositions["command_bar"])
- [ ] Fix controls hover → make always accessible or fix the hover click issue
- [ ] Fix context menu close on outside click (already has pointerdown handler but may not work)
- [ ] Remove WorkspaceCommandBar from inside right panel (user doesn't want it there)
- [ ] Fix Quick Chat context-awareness (show workspace/thread/artifact name)
- [ ] Fix quick chat animation when right panel opens (flies down then up)

### Group 3: Right Panel + Aesthetic (Sub-agent C)
- [ ] Fix extra right margin in right panels
- [ ] Right panel should be smaller (icon-only unless hovered) 
- [ ] Fix right panel quick chat aesthetic
- [ ] Context label should change based on panel type (workspace/thread/artifact)

### Group 4: Pipeline + Admin + Artifact Error (Sub-agent D)
- [ ] Fix errData.error → String() coercion in right-push-panel.tsx:421
- [ ] Fix "Policy correction:" stripping to be more comprehensive
- [ ] Fix OpenRouter API key false warning in admin panel
- [ ] Fix ManageBac base URL default value
- [ ] Platform stats aggregation fix (condition in superAdmin.ts)

### Group 5: Editor Fixes (Sub-agent E)
- [ ] Fix drag handle Y displacement and X position
- [ ] Fix image upload (not URL popup)
- [ ] Fix copy-paste white flash
- [ ] ThinkingBlock: remove show more/less (already removed - it's always shown), verify no collapse logic

## STATUS
All groups: PENDING

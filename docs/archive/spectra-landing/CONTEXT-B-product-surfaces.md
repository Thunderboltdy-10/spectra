# CONTEXT B — Spectra Product Surfaces

## Headline finding

**A "reuse real components" landing already exists and works.** `src/app/landing/demo/real-surfaces.tsx` (238 lines) and `live-work-demo.tsx` (126 lines) feed **real product components** with deterministic fixtures. Header comment states the discipline: *"no auth, no Convex, no router, no network (fixtures only); no interactive callbacks that would fire requests; timestamps are coarse so SSR/CSR agree."*

Proven-standalone already: `ArtifactCard`, `ResultCardStack`, `ThreadCard`, `ConversationSurface`, `deriveLiveDockTab`, `CrossfadeText`.

---

## 1. Live Dock

**Container:** `src/features/spectra/components/live-dock.tsx` → `LiveDock` (899 lines)
**Pure model:** `src/features/spectra/runs/live-dock/live-dock-model.ts` (+ barrel `index.ts`)

```ts
export type LiveDockProps = {
  workspaceId?: string;
  optimistic?: { id; prompt; runId?; status; steps?: Array<{title; status}> } | null;
  onOpen?: (runId, threadId, title, workId?) => void;
  onDeselect?: () => void;
  onStop?: (runId: string) => void | Promise<void>;
  onRetry?: (runId: string) => void;
  onAction?: (card: ResultCardStreamView, action: "confirm" | "cancel") => void | Promise<void>;
  onRevise?: (card: ResultCardStreamView, revision: string) => void | Promise<void>;
  onInput?: (threadId, response, attachments?: CommandAttachment[]) => void | Promise<unknown>;
  onSteer?: (runId, mode: "refine_current_goal"|"redirect_next_step"|"replace_goal"|"cancel_current_action", text) => void | Promise<unknown>;
  openThreadId?: string;
};
```

**State: HEAVY.** Module-level singleton (`sharedTabs`, `listeners`, `pollTimer`) polling `getSpectraRunTabs({limit:120})` every 4s via `beginPolling()`, plus `window` `spectra:threads-changed`. Also `useSpectraContextStore` (zustand), `useNow(60_000)`, `useSpectraMotion()`, `useStreamingReveal`. No prop can inject tabs.

**Verdict: NEEDS-SPLIT.** Pure part already extracted and landing-proven: `deriveLiveDockTab(source: LiveDockTabSource)` → `{title, semanticStep, state, titlePending, ...}`, plus `allocateLiveDockWidths`, `selectExpandedInputRun`, `closePreservesRunningJob`. `real-surfaces.tsx` hand-rolls ~20 lines of tab chrome because no view component exists. **Extracting `LiveDockView` is the highest-value refactor in this domain.**

**Semantic states** (`LiveDockTruthState`): `working | waiting | needs_input | completing | completed | completed_limited | paused | reconnecting | cancelled | failed_terminal`. Step text from a `phaseSteps` map.

**DOM:** `data-live-dock-version="2"`, `data-run-status={state}` (+ `"starting"` on optimistic), `data-input-expanded`, `data-mobile-sheet`, `data-title-run={runId}`, `data-title-streaming`, `.spectra-run-tab-strip`, `aria-label="Live Dock"`, `aria-live="polite"`.

---

## 2. Quick Chat / composer

**Quick Chat IS the `CommandBar`** (confirmed via `surface: "quick_chat"` + `quickChatSuggestions` preference).
**File:** `src/features/spectra/components/command-bar.tsx` → `CommandBar`, `CommandBarMenuItem`, `CommandBarSubmenu` (722 lines)

```ts
type CommandBarProps = {
  placeholder: string;
  menu?: ReactNode; context?: ReactNode; className?: string;
  onSubmit?: (value, attachments: CommandAttachment[]) => void | boolean | Promise<void|boolean>;
  busy?: boolean; allowAttachments?: boolean;
  attachmentsPortalTarget?: HTMLElement | null;
  onStop?: () => void; allowConcurrent?: boolean;
  onStartNewThread?: () => void; activeRunId?: string;
  onSteer?: (runId, mode, text) => void | Promise<unknown>;
};
export type CommandAttachment = { id; name; mimeType; size;
  handling: "pdf"|"text"|"docx"|"xlsx"|"pptx"|"image"; data?; error? };
```

**State: PROPS-READY (near).** Internal hooks are provider-free: `useSpectraPreferences()` (localStorage, falls back to `DEFAULT_SPECTRA_PREFERENCES`) and `useLocalAutocomplete({surface:"quick_chat", enabled})`. Context chips injected via the `context` ReactNode slot.

**DOM:** `[data-spectra-composer]` is the canonical focus selector. `aria-label`s: "Send command", "Stop active response", "Open actions", "Start a new thread", "Attached files".

**Related:** `context-controls.tsx` (987) → `ContextFocusControl`, `SelectionActionBar`, `GlobalSearch`; `composer-artifact-dock.tsx`; `viewport-context-picker.tsx`.

---

## 3. Workbench + shared top tab rail

**Shared rail:** `src/features/spectra/components/artifact-studio.tsx:3477` → `StudioTabRail` — used by Workspace (`pages/workspace-shell.tsx:5346`) and Library (`pages/artifacts-shell.tsx:1373`).

```ts
StudioTabRail({ hubTabs: Array<{id;label}>; activeHubTabId: string|null;
  artifacts: SpectraArtifact[]; tabs: StudioTab[]; activeArtifactId?: string|null;
  dirtyIds: Set<string>; onActivateHub; onCloseHub; onAddHub;
  onActivateTab; onCloseTab; canGoBack?; canGoForward?; onGoBack?; onGoForward? })
```
**PROPS-READY**, portals into `#spectra-shell-tab-slot`, renders inline (bordered, `h-12`) when absent.

**Split panes:** `workbench-split-tree.tsx` → `WorkbenchSplitTree({node: WorkbenchNode; onChange; renderTab})` — **PROPS-READY**, fully controlled. Pure logic `workbench/layout/split-tree.ts` (`collectWorkbenchTabs`, `splitWorkbenchPane`, `moveWorkbenchTab`, `setSplitRatio`, `createAutomaticWorkbenchLayout`). DOM: `data-workbench-pane`, `data-workbench-split`, `aria-selected`.

**Inspector:** `workbench-inspector-tabs.tsx` → `WorkbenchInspectorTabs({work, overview})` — **HEAVY** (fetches comments + versions on `work._id`). Needs `InspectorTabsView`.

---

## 4. Conversation / thread / chat

**View:** `conversation-surface.tsx:1686` → `ConversationSurface` (2303-line file)
```ts
ConversationSurface({
  detail: SpectraThreadDetail | null; loading?; empty?: ReactNode; composer?: ReactNode;
  activeCards?: ResultCardView[]; onCardOpen?; onCardAction?; onCardRevise?;
  workspaces?: SpectraWorkspace[]; onOpenArtifact?; onOpenWorkspace?;
  compact?: boolean; liveExchange?: SpectraLiveExchange | null;
  onChoice?; onRetryRun? })
```
**PROPS-READY** — proven by `DemoConversation` in `real-surfaces.tsx` (`detail={DEMO_DETAIL}` and nothing else). `useRunLedger(runId)` returns `null` unseeded. One `postSpectra` behind a user action — don't wire that callback.

**Container (avoid):** `ThreadConversation` (:2174) — HEAVY: `getSpectraThread` + `getSpectraWorkspaces` on mount, 2s polling, `useSpectraRun({surface:"chat"})`, window listeners, supplies `CommandBar` into `composer`.

**Message rendering + inline citations:** `spectra-rich-content.tsx` → `SpectraRichContent({content: string; className?; verifiedSourceIds?: readonly string[]})` — **PROPS-READY**, pure. Parses `[[cite:src-id:span|Label]]` → verified (cyan bordered button) vs unverified (grey); `[[ref:workId]]` → button firing `spectraBus.command("work.open", …)`. Parser: `rich-content/parser.ts` (`IncrementalRichContentParser`). Base renderer `src/components/chat/rich-text.tsx`.
DOM: `.spectra-rich-content`, `data-rich-complete`, `data-tone`, `.spectra-stream-active` (only last block shimmers).

**Panel:** `live-thread-panel.tsx` → `LiveThreadPanel({threadId; title; liveExchange?; width; onWidthChange; onClose; onContinue?; continuing?; onOpenArtifact?; onOpenWorkspace?})` — HEAVY by delegation.

---

## 5. Work-type views

All in `artifact-studio.tsx` (16,526 lines) or sibling `*-studio.tsx`. **Near-identical props contract**: `{artifactId, content: unknown, onChange, aiChangedPaths?, readOnly?, synchronizationReady?, syncMessage?, onActiveRegionChange?}`.

| Type | File / line | Exported? | Verdict |
|---|---|---|---|
| Document | `artifact-studio.tsx:6387` `DocumentStudio` | **no** | PROPS-READY, NEEDS-EXPORT |
| Quiz | `artifact-studio.tsx:12122` `QuizStudio` | **no** | PROPS-READY, NEEDS-EXPORT |
| Flashcards | `artifact-studio.tsx:8127` `FlashcardStudio` | **no** | PROPS-READY, NEEDS-EXPORT |
| Presentation | `presentation-studio.tsx:1065` `PresentationStudio` | yes | PROPS-READY |
| Sheet | `sheets-studio.tsx:709` `SheetsStudio` | yes | PROPS-READY |
| Code | `code-studio.tsx:376` `CodeStudio` | yes | PROPS-READY (needs `artifacts: []`) |
| Whiteboard | `whiteboard-studio.tsx:473` `WhiteboardStudio` | yes | PROPS-READY |
| Plan | `plan-studio.tsx:106` `PlanStudio` | yes | PROPS-READY |
| Timetable | `timetable-studio.tsx:307` `TimetableStudio` | yes | PROPS-READY |

```ts
// SheetsStudio (representative)
{ artifactId: string; content: unknown; onChange: (content: unknown) => void;
  aiChangedPaths?: string[]; readOnly?: boolean; mode?: "split"|"tab";
  synchronizationReady?: boolean; syncMessage?: string;
  onActiveRegionChange?: (regionId: string) => void }
// DocumentStudio adds: title, collaborationDocument?: Y.Doc, header: ReactNode
// QuizStudio: mode: "split"|"tab" is REQUIRED; readOnly || mode==="split" ⇒ preview view
```
`content` is `unknown` and normalized internally (`normalizeSheetsContent`, `normalizePresentationContent`, `normalizeCodeContent`, `documentJsonFromContent`) — **partial fixture objects are filled with defaults**. `aiChangedPaths` drives the AI-diff highlight.

**Avoid:** `ArtifactStudio` (:3045) and `ArtifactStudioEditor` (:3669) — `useRouter()`, `useArtifactLiveModel()` (opens Hocuspocus/Yjs socket), `contextSourceRegistry`, `spectraBus.handle`. Render the leaf `*Studio` directly. `useArtifactStudioState` (:2853) is the state container. `StudioSplitShell` (:3307) is a pure resizable-panel chrome.

---

## 6. Comments

`artifact-comments-panel.tsx` → `ArtifactCommentsPanel` (352)
```ts
export type ArtifactCommentRegion = { regionId: string; label: string; kind?: string };
ArtifactCommentsPanel({ open; artifactId; artifactTitle;
  regions: readonly ArtifactCommentRegion[]; preferredRegionId?; currentAccountId?;
  relativePosition?; onClose })
```
**HEAVY** — fetches comments/preference/school-members, writes via `postSpectra`. **NEEDS-SPLIT** → `CommentsPanelView({comments, regions, ...})`. Pure anchor logic: `comments/comment-anchor.ts`.

---

## 7. References / embeds

`artifact-embed.tsx:501` → `ArtifactEmbed({embed: SpectraArtifactEmbed; busy?; onOpenSource?; onRetry?; onModeChange?: (mode:"compact"|"expanded"); onResize?; onRequestAccess?; onCancelAccessRequest?; onUseLiveVersion?})` — **PROPS-READY**; only `useSpectraMotion()` internally. Rich permission states (`no_access`, `accessRequest`) purely from `embed.state`.

`artifact-embeds-panel.tsx:36` → `ArtifactEmbedsPanel` — likely fetch-coupled, verify.

Pure: `references/model/reference-node.ts`, `references/insertion/insert-reference.ts`, `references/registry.ts`. Editor nodes: `editor/reference-citation-nodes.ts`. Sandbox: `embed/sandbox-protocol.ts`.

---

## 8. Sources

Logic-only. `sources/records/source-record.ts` → `SourceRecord`, `EvidenceSpan`, `VerifiedCitation`, `createVerifiedSource()`, `createEvidenceSpan()`, `verifyCitation(citation, sources, evidence)`, `canonicalizeSourceUrl`, `contentHash`. Also `sources/research/{full-source,parallel-search}.ts`, `sources/work-source-contracts.ts`.
Sources surface visually through `SpectraRichContent`'s `verifiedSourceIds` and `ResultCardView.provenance.{artifactTitles, attachmentNames}`.

---

## 9. Runs

- **State machine:** `runs/state/run-state-machine.ts` — `RunProtocolState`, `RunStateSnapshot`, `isTerminalRunState()`. Pure.
- **Semantic steps:** `runs/live-dock/live-dock-model.ts` `phaseSteps`. Pure.
- **Streaming reveal:** `runs/streaming/use-streaming-reveal.ts` → `useStreamingReveal(content, {profile:"conversation", enabled})` → `{visibleText, active}`. **Provider-free; ideal for landing typing effects.**
- **Ledger:** `collaboration/run-ledger.ts` → `useRunLedger(runId)`, `operationCounts()`.
- **Steering:** `runs/steering/steering-queue.ts`. Engine (HEAVY): `ai/use-spectra-run.ts:284`.
- **Cards:** `result-card.tsx:84` `ResultCardStack({cards?; onAction?; onRevise?; onOpen?; activeThreadId?; activeRunId?; onContinue?})` — **PROPS-READY**. `toggleContinuation()` calls `postSpectra` — leave `onContinue` undefined.
- `run-detail-panel.tsx:39` `RunDetailPanel({runId, card, onClose, onAction, onUseThread, onSaved})` — HEAVY.
- `durable-run-tabs.tsx` is a 3-line re-export shim.

---

## 10. Cards (landing-proven)

- `artifact-card.tsx:145` `ArtifactCard({artifact: ArtifactCardView; selected?; actions?; onSelect?; className?; size?: "compact"|"normal"|"large"; quiet?; selectionMode?; contextSelected?; onToggleContext?})` — **PROPS-READY, zero hooks.** `ArtifactCardView.aiState: "generated"|"edited"|"creating"|"updating"|"failed"` + `aiProgress: number` → the AI shimmer. `blueprintMeta` exports per-type label/icon/color.
- `thread-card.tsx:9` `ThreadCard({thread: SpectraThread; workspaceLabel?; pinned?; continued?; running?; waiting?; selected?; selectionMode?; compact?; onOpen?; onContinue?; onToggleSelection?; actions?})` — **PROPS-READY**.

---

## 11. Cursor-targetable DOM contract

`collaboration/target-attributes.ts` + `interaction-geometry.ts`. Module doc: *"That single annotation is what lets cursors, carets, selections, drag ghosts, resize frames and held-control affordances all resolve to the exact control — and it is why none of those features need per-artifact code."*

Constants (`interaction-geometry.ts:27-33`): `data-spectra-surface`, `data-spectra-target` (canonical), `data-spectra-part`, `data-spectra-line`. Helpers: `targetAttrs(path, part?, primitive?)`, `partAttrs(part)`, `collectionPath("cards", 2, "front")`, `BOX_HANDLE_PARTS`.
Fallback chain (:138): `[data-spectra-target]` → `[data-region-id]` → `[data-spectra-region]`. Also `data-spectra-held`/`-held-by`, `data-spectra-hidden-target="true"`, `data-spectra-primitive`, `data-work-id` (`artifact-studio.tsx:6527`), `data-spectra-surface="artifact"` (:5992), `data-spectra-card="result"`, `data-card-state`.

---

## MINIMUM PROVIDER SET

**Spectra needs almost no providers.** State is zustand + `useSyncExternalStore` + localStorage, not React context. `src/components/providers.tsx` wires `GlobalErrorBoundary → ThemeProvider → ConvexProviderWithClerk → {DynamicFavicon, GlobalSettingsDrawer, LocalComputeCacheController, CookieConsentManager, Toaster}` — Convex/Clerk are conditional on `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and no surface reads Convex directly (all go through `features/spectra/data/api.ts` fetch wrappers).

**Global baseline:** (1) CSS custom properties from `src/app/globals.css` — non-negotiable; (2) `ThemeProvider`; (3) `"use client"`.

| Surface | Needs beyond baseline |
|---|---|
| `SpectraRichContent`, `ArtifactCard`, `ThreadCard`, `WorkbenchSplitTree`, `StudioTabRail` | **Nothing.** |
| `ConversationSurface` | Nothing. |
| `ResultCardStack` | `<Toaster/>` only if an action fires; omit `onContinue`. |
| `CommandBar` | Nothing. Set `preferences.writing.smartCompletion=false` to keep autocomplete inert. |
| `ArtifactEmbed`, Live Dock chrome | Nothing. |
| Work-type studios | Nothing if rendered as leaves with `readOnly`. Pass `artifacts={[]}` where required. |
| `LiveDock` (container) | **Cannot render standalone** (module-level 4s polling). Use `deriveLiveDockTab()` + a `LiveDockView`. |
| `ThreadConversation`, `ArtifactCommentsPanel`, `WorkbenchInspectorTabs`, `RunDetailPanel` | **Cannot render standalone.** Use view halves. |

**Ambient globals (harmless if absent):** `#spectra-shell-tab-slot`, window events `spectra:threads-changed` / `spectra:escape` / `spectra:sidebar-layout` / `ai-school:toggle-settings`, `document.documentElement.dataset.spectraMotion`, `spectraBus` (`features/spectra/events`, plain emitter).

---

## Recommended sequence
1. **Extract `LiveDockView`** from `live-dock.tsx`.
2. **Export `DocumentStudio` / `QuizStudio` / `FlashcardStudio`** from `artifact-studio.tsx`.
3. Extract `CommentsPanelView` and `InspectorTabsView` if in scope.
4. Fixtures follow `app/landing/demo/real-surfaces.tsx` discipline.

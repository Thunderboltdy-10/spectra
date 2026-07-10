# Wave X — Alive, Reliable, Context-Aware

Created: 2026-07-10. This is the authoritative live source of truth for Wave X. It supersedes prior wave completion claims where current code evidence conflicts.

## Product direction

Spectra should feel like a calm living instrument: structurally reliable first, then visibly alive through restrained blue energy, progressive objects, and shared realtime state. The memorable interaction is one AI run acting through the visible workspace while every surface remains in lockstep.

## Root architectural causes

1. Execution is owned by the initiating browser HTTP stream rather than a durable backend coordinator.
2. Live state is held in one component-local `liveExchange`, so other surfaces cannot subscribe or replay.
3. Thread, run, card, and first message creation are separate mutations rather than one atomic transaction.
4. Production does not enforce a single active run per continuation thread or guarded state transitions.
5. Continuation, focus, explicit context, visible objects, selection, and tiles are independent page-local variables.
6. Threads linked to workspaces are not projected as real workspace objects at run start.
7. Result-card recency is being used as tab lifecycle, causing intentional disappearance.
8. Public traces are transient reconstructions and live mutations begin only after a full plan completes.

## Audit ownership

- Focus/context/navigation/selection/tiling: independent read-only audit by `focus_context_audit`.
- Threads/runs/streaming/persistence/backend: independent read-only audit by `threads_runs_audit`.
- UI/live mutations/cards/traces/K-bar/responsiveness: independent read-only audit by `ui_live_audit`.
- Implementation ownership: main agent only.

## Checklist rules

Every row has separate Complete and Verified boxes. Complete means implemented. Verified means independently re-inspected or tested afterward. Add or reopen rows whenever new evidence appears.

## Architecture and atomic run start

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-001 | [x] Complete | [ ] Verified | Define one production run state machine shared by API, Convex, and UI. |
| WX-002 | [x] Complete | [ ] Verified | Replace detached lifecycle tests with production transition enforcement. |
| WX-003 | [x] Complete | [ ] Verified | Create an atomic begin-run mutation for thread, run, card, user message, and placement. |
| WX-004 | [x] Complete | [ ] Verified | Validate actor ownership for every object in begin-run. |
| WX-005 | [x] Complete | [ ] Verified | Add a client submission idempotency key. |
| WX-006 | [x] Complete | [ ] Verified | Deduplicate repeated submission keys transactionally. |
| WX-007 | [x] Complete | [ ] Verified | Prevent orphan threads when run creation fails. |
| WX-008 | [x] Complete | [ ] Verified | Prevent orphan cards when message creation fails. |
| WX-009 | [x] Complete | [ ] Verified | Prevent queued runs without an execution owner. |
| WX-010 | [x] Complete | [ ] Verified | Record source surface independently from viewing surface. |
| WX-011 | [x] Complete | [ ] Verified | Record continuation thread independently from context objects. |
| WX-012 | [x] Complete | [ ] Verified | Record workspace association independently from visible page. |
| WX-013 | [x] Complete | [ ] Verified | Record artifact association independently from explicit context. |
| WX-014 | [x] Complete | [ ] Verified | Create the provisional two-to-four-word thread title at begin-run. |
| WX-015 | [x] Complete | [ ] Verified | Create the workspace or Inbox thread projection at begin-run. |
| WX-016 | [x] Complete | [ ] Verified | Make direct thread workspace items first-class or document one canonical projection. |
| WX-017 | [x] Complete | [ ] Verified | Prevent duplicate thread-reference projections. |
| WX-018 | [x] Complete | [ ] Verified | Define stable message ordering independent of completion timing. |
| WX-019 | [x] Complete | [ ] Verified | Store attempt generation on every executable run. |
| WX-020 | [x] Complete | [ ] Verified | Reject writes from stale retry attempts. |
| WX-021 | [x] Complete | [ ] Verified | Add compare-and-set guards to every run transition. |
| WX-022 | [x] Complete | [ ] Verified | Reject terminal-to-active transitions outside explicit retry. |
| WX-023 | [x] Complete | [ ] Verified | Make confirmation claim and state transition atomic. |
| WX-024 | [x] Complete | [ ] Verified | Make cancellation idempotent. |
| WX-025 | [x] Complete | [ ] Verified | Make retry idempotent. |

## Durable execution and shared realtime

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-026 | [x] Complete | [ ] Verified | Decouple provider execution from the initiating browser connection. |
| WX-027 | [x] Complete | [ ] Verified | Keep a run alive when its initiating panel closes. |
| WX-028 | [x] Complete | [ ] Verified | Keep a run alive when the user navigates to another route. |
| WX-029 | [x] Complete | [ ] Verified | Keep a run alive across a temporary client network loss. |
| WX-030 | [x] Complete | [ ] Verified | Add persisted ordered public run events. |
| WX-031 | [x] Complete | [ ] Verified | Assign every public run event a monotonic sequence. |
| WX-032 | [x] Complete | [ ] Verified | Persist safe text snapshots or deltas for replay. |
| WX-033 | [x] Complete | [ ] Verified | Persist public trace steps and their statuses. |
| WX-034 | [x] Complete | [ ] Verified | Persist operation previews without internal control payloads. |
| WX-035 | [x] Complete | [ ] Verified | Persist operation commits and affected-object results. |
| WX-036 | [x] Complete | [ ] Verified | Persist confirmation and choice events. |
| WX-037 | [x] Complete | [ ] Verified | Persist terminal completion, stop, interruption, and failure events. |
| WX-038 | [x] Complete | [ ] Verified | Add subscriber cursor/catch-up semantics. |
| WX-039 | [x] Complete | [ ] Verified | Make /chat observe the same run stream as /workspace. |
| WX-040 | [x] Complete | [ ] Verified | Make the workspace right panel observe the same run stream. |
| WX-041 | [x] Complete | [ ] Verified | Make quick-chat tabs observe the same run stream. |
| WX-042 | [x] Complete | [ ] Verified | Make thread cards observe the same run stream. |
| WX-043 | [x] Complete | [ ] Verified | Make artifact-adjacent panels observe the same run stream. |
| WX-044 | [x] Complete | [ ] Verified | Make tiled thread/artifact surfaces observe the same run stream. |
| WX-045 | [x] Complete | [ ] Verified | Resume a partial response after refresh without duplication. |
| WX-046 | [x] Complete | [ ] Verified | Deduplicate replayed events by run and sequence. |
| WX-047 | [x] Complete | [ ] Verified | Prevent older snapshots from overwriting newer stream state. |
| WX-048 | [x] Complete | [ ] Verified | Add a worker lease or heartbeat. |
| WX-049 | [x] Complete | [ ] Verified | Reconcile stale running runs to interrupted/recoverable. |
| WX-050 | [x] Complete | [ ] Verified | Preserve partial public response text on user stop. |
| WX-051 | [x] Complete | [ ] Verified | Keep private/provider chain-of-thought out of persisted events. |

## Active-run invariants and recovery

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-052 | [x] Complete | [ ] Verified | Enforce at most one active run per continuation thread. |
| WX-053 | [x] Complete | [ ] Verified | Treat queued, planning, reading, applying, streaming, and awaiting approval as active. |
| WX-054 | [x] Complete | [ ] Verified | Reject a second continuation from another browser tab. |
| WX-055 | [x] Complete | [ ] Verified | Return a natural actionable conflict instead of an internal error. |
| WX-056 | [x] Complete | [ ] Verified | Offer Start new thread when the selected continuation is busy. |
| WX-057 | [x] Complete | [ ] Verified | Allow concurrent work only by creating a different thread. |
| WX-058 | [x] Complete | [ ] Verified | Represent simultaneous new-thread runs in state keyed by run id. |
| WX-059 | [x] Complete | [ ] Verified | Target Stop at one explicit run. |
| WX-060 | [x] Complete | [ ] Verified | Do not abort unrelated concurrent runs. |
| WX-061 | [x] Complete | [ ] Verified | Prevent stop after an irreversible operation claim. |
| WX-062 | [x] Complete | [ ] Verified | Explain when a run can no longer be stopped safely. |
| WX-063 | [x] Complete | [ ] Verified | Abort the actual execution controller on explicit stop. |
| WX-064 | [x] Complete | [ ] Verified | Do not interpret browser disconnect as user stop. |
| WX-065 | [x] Complete | [ ] Verified | Prevent cancelled runs from later becoming completed. |
| WX-066 | [x] Complete | [ ] Verified | Prevent attempt-one events from mutating attempt two. |
| WX-067 | [x] Complete | [ ] Verified | Prevent duplicate confirmation execution. |
| WX-068 | [x] Complete | [ ] Verified | Persist accepted and rejected approval outcomes. |
| WX-069 | [x] Complete | [ ] Verified | Clear awaiting-approval message metadata after rejection. |
| WX-070 | [x] Complete | [ ] Verified | Distinguish user stop, network detach, provider failure, worker interruption, and validation failure. |
| WX-071 | [x] Complete | [ ] Verified | Record exact affected objects after partial operation failure. |
| WX-072 | [x] Complete | [ ] Verified | Provide a safe follow-up path after partial mutation. |
| WX-073 | [x] Complete | [ ] Verified | Do not auto-hide stale or failed active runs. |

## Quick-chat tabs and continuation

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-074 | [x] Complete | [ ] Verified | Create a visible quick-chat tab immediately after begin-run. |
| WX-075 | [x] Complete | [ ] Verified | Materialize the tab with a restrained blue sweep. |
| WX-076 | [x] Complete | [ ] Verified | Show the provisional title before model metadata returns. |
| WX-077 | [x] Complete | [ ] Verified | Animate title refinement without abrupt replacement. |
| WX-078 | [x] Complete | [ ] Verified | Keep titles to two-to-four useful words. |
| WX-079 | [x] Complete | [ ] Verified | Keep the tab visible while queued. |
| WX-080 | [x] Complete | [ ] Verified | Keep the tab visible while streaming. |
| WX-081 | [x] Complete | [ ] Verified | Keep the tab visible while awaiting approval. |
| WX-082 | [x] Complete | [ ] Verified | Keep the tab visible after completion until explicit close. |
| WX-083 | [x] Complete | [ ] Verified | Keep failed and stopped tabs until explicit close. |
| WX-084 | [x] Complete | [ ] Verified | Remove elapsed-time tab disappearance. |
| WX-085 | [x] Complete | [ ] Verified | Store open-tab state separately from result-card recency. |
| WX-086 | [x] Complete | [ ] Verified | Click a running tab to open the live shared thread. |
| WX-087 | [x] Complete | [ ] Verified | Selecting a tab sets the continuation target. |
| WX-088 | [x] Complete | [ ] Verified | Deselecting the active tab clears continuation. |
| WX-089 | [x] Complete | [ ] Verified | Clearing every continuation means the next send starts a new thread. |
| WX-090 | [x] Complete | [ ] Verified | Do not silently retarget continuation when a panel opens. |
| WX-091 | [x] Complete | [ ] Verified | Resolve visible-thread versus continuation-thread conflicts explicitly. |
| WX-092 | [x] Complete | [ ] Verified | Support Keep current, Replace continuation, and Cancel conflict choices. |
| WX-093 | [x] Complete | [ ] Verified | Do not silently reassign a workspace-A thread from workspace B. |
| WX-094 | [x] Complete | [ ] Verified | Keep one continuation thread maximum. |
| WX-095 | [x] Complete | [ ] Verified | Allow multiple artifacts alongside one continuation. |

## Focus and context model

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-096 | [x] Complete | [ ] Verified | Replace the mutually exclusive focus enum with an additive context model. |
| WX-097 | [x] Complete | [ ] Verified | Represent continuationThreadId as a separate field. |
| WX-098 | [x] Complete | [ ] Verified | Represent explicit context objects as a durable ordered collection. |
| WX-099 | [x] Complete | [ ] Verified | Represent inferred visible objects separately from explicit context. |
| WX-100 | [x] Complete | [ ] Verified | Represent the active workspace map separately from object context. |
| WX-101 | [x] Complete | [ ] Verified | Represent global retrieval awareness separately from selected focus. |
| WX-102 | [x] Complete | [ ] Verified | Record why each context item is included. |
| WX-103 | [x] Complete | [ ] Verified | Prioritize continuation history first. |
| WX-104 | [x] Complete | [ ] Verified | Prioritize explicit context second. |
| WX-105 | [x] Complete | [ ] Verified | Prioritize visible objects third. |
| WX-106 | [x] Complete | [ ] Verified | Prioritize active workspace map fourth. |
| WX-107 | [x] Complete | [ ] Verified | Prioritize global/Inbox map fifth. |
| WX-108 | [x] Complete | [ ] Verified | Retain controlled retrieval beyond focus. |
| WX-109 | [x] Complete | [ ] Verified | Infer global context on Home. |
| WX-110 | [x] Complete | [ ] Verified | Infer workspace context inside a workspace. |
| WX-111 | [x] Complete | [ ] Verified | Infer an open artifact as visible context. |
| WX-112 | [x] Complete | [ ] Verified | Infer every visible tiled artifact as context. |
| WX-113 | [x] Complete | [ ] Verified | Compose one thread plus one open artifact. |
| WX-114 | [x] Complete | [ ] Verified | Compose one thread plus several tiled artifacts. |
| WX-115 | [x] Complete | [ ] Verified | Keep explicit context after navigation. |
| WX-116 | [x] Complete | [ ] Verified | Keep explicit context after opening another artifact. |
| WX-117 | [x] Complete | [ ] Verified | Keep explicit context after exiting selection mode. |
| WX-118 | [x] Complete | [ ] Verified | Keep explicit context after rearranging tiles. |
| WX-119 | [x] Complete | [ ] Verified | Allow removing a context item without closing its surface. |
| WX-120 | [x] Complete | [ ] Verified | Allow closing a surface without removing explicit context. |
| WX-121 | [x] Complete | [ ] Verified | Prune deleted or inaccessible context visibly. |
| WX-122 | [x] Complete | [ ] Verified | Handle moved context objects without losing identity. |
| WX-123 | [x] Complete | [ ] Verified | Persist explicit context across refresh where safe. |
| WX-124 | [x] Complete | [ ] Verified | Version context snapshots for deterministic retry. |
| WX-125 | [x] Complete | [ ] Verified | Never expose internal identifiers in context errors. |
| WX-126 | [x] Complete | [ ] Verified | Disambiguate similarly named objects using natural choices. |
| WX-127 | [x] Complete | [ ] Verified | Use complete small-object content within caps. |
| WX-128 | [x] Complete | [ ] Verified | Use summaries and relevant sections for large documents. |
| WX-129 | [x] Complete | [ ] Verified | Use typed structure for quizzes, decks, and tasks. |
| WX-130 | [x] Complete | [ ] Verified | Use a bounded workspace map instead of dumping all artifact bodies. |
| WX-131 | [x] Complete | [ ] Verified | Use a bounded global map plus retrieval capabilities. |

## Compact focus browser

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-132 | [x] Complete | [ ] Verified | Cap the collapsed context control to an icon/count-led width. |
| WX-133 | [x] Complete | [ ] Verified | Prevent long workspace names from consuming the composer. |
| WX-134 | [x] Complete | [ ] Verified | Prevent long artifact names from consuming the composer. |
| WX-135 | [x] Complete | [ ] Verified | Prevent long thread titles from consuming the composer. |
| WX-136 | [x] Complete | [ ] Verified | Keep the context control available on mobile. |
| WX-137 | [x] Complete | [ ] Verified | Show global, workspace, artifact, thread, and multi-context visual signals. |
| WX-138 | [x] Complete | [ ] Verified | Show continuation separately from use-as-context. |
| WX-139 | [x] Complete | [ ] Verified | Open a searchable context browser without navigation. |
| WX-140 | [x] Complete | [ ] Verified | Search artifacts in the context browser. |
| WX-141 | [x] Complete | [ ] Verified | Search workspaces in the context browser. |
| WX-142 | [x] Complete | [ ] Verified | Search threads in the context browser. |
| WX-143 | [x] Complete | [ ] Verified | List currently visible objects. |
| WX-144 | [x] Complete | [ ] Verified | List recently used objects. |
| WX-145 | [x] Complete | [ ] Verified | List currently selected objects. |
| WX-146 | [x] Complete | [ ] Verified | List explicitly added context objects. |
| WX-147 | [x] Complete | [ ] Verified | Add or remove individual objects in place. |
| WX-148 | [x] Complete | [ ] Verified | Expose why an inferred object is included. |
| WX-149 | [x] Complete | [ ] Verified | Support keyboard navigation, Escape, focus trap, and restore. |
| WX-150 | [x] Complete | [ ] Verified | Announce context changes to assistive technology. |

## Selection and tiling

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-151 | [x] Complete | [ ] Verified | Separate temporary selection from persistent explicit context. |
| WX-152 | [x] Complete | [ ] Verified | Add one explicit Add to context action. |
| WX-153 | [x] Complete | [ ] Verified | Keep Add to context after temporary selection clears. |
| WX-154 | [x] Complete | [ ] Verified | Replace AI shortcut clutter in the selection bar. |
| WX-155 | [x] Complete | [ ] Verified | Remove Summarise from the core selection bar. |
| WX-156 | [x] Complete | [ ] Verified | Remove Revision guide from the core selection bar. |
| WX-157 | [x] Complete | [ ] Verified | Remove Make quiz from the core selection bar. |
| WX-158 | [x] Complete | [ ] Verified | Use one Group or Tile selected action. |
| WX-159 | [x] Complete | [ ] Verified | Remove the separate Focus this set action. |
| WX-160 | [x] Complete | [ ] Verified | Keep Clear selection visible. |
| WX-161 | [x] Complete | [ ] Verified | Allow workspace icons and labels to be selected as context. |
| WX-162 | [x] Complete | [ ] Verified | Prevent workspace objects from artifact-only tiling. |
| WX-163 | [x] Complete | [ ] Verified | Allow thread objects to open or tile without forcing continuation. |
| WX-164 | [x] Complete | [ ] Verified | Prevent more than one tiled thread from becoming continuation. |
| WX-165 | [x] Complete | [ ] Verified | Persist cross-page multi-selection safely. |
| WX-166 | [x] Complete | [ ] Verified | Validate restored selection against current ownership and existence. |
| WX-167 | [x] Complete | [ ] Verified | Continuously prune stale selected ids. |
| WX-168 | [x] Complete | [ ] Verified | Open selected artifacts in one batched tile update. |
| WX-169 | [x] Complete | [ ] Verified | Keep tiled layout headerless and work-surface-like. |
| WX-170 | [x] Complete | [ ] Verified | Support tile add, remove, reorder, resize, and snap. |
| WX-171 | [x] Complete | [ ] Verified | Support a fullscreen top-rail artifact mode. |
| WX-172 | [x] Complete | [ ] Verified | Keep dirty-close save/discard/cancel behavior in tiles. |
| WX-173 | [x] Complete | [ ] Verified | Update inferred context when a tile closes. |
| WX-174 | [x] Complete | [ ] Verified | Do not remove explicit context when a tile closes. |
| WX-175 | [x] Complete | [ ] Verified | Support phone, tablet, and desktop tile layouts. |

## Public traces and live mutations

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-176 | [x] Complete | [ ] Verified | Define one shared public trace model. |
| WX-177 | [x] Complete | [ ] Verified | Use calm user-facing trace titles. |
| WX-178 | [x] Complete | [ ] Verified | Open the current trace automatically. |
| WX-179 | [x] Complete | [ ] Verified | Collapse the previous trace when the next begins. |
| WX-180 | [x] Complete | [ ] Verified | Keep completed traces available but collapsed. |
| WX-181 | [x] Complete | [ ] Verified | Show compact titles/statuses in quick tabs. |
| WX-182 | [x] Complete | [ ] Verified | Show richer safe detail in chat and panels. |
| WX-183 | [x] Complete | [ ] Verified | Deduplicate repeated trace words. |
| WX-184 | [x] Complete | [ ] Verified | Never stringify raw operation output in user UI. |
| WX-185 | [x] Complete | [ ] Verified | Never expose planner prompts, schemas, routes, Convex terms, or IDs. |
| WX-186 | [x] Complete | [ ] Verified | Create a pending artifact projection when creation intent is known. |
| WX-187 | [x] Complete | [ ] Verified | Allow opening a pending artifact before completion. |
| WX-188 | [x] Complete | [ ] Verified | Stream canonical content patches into pending artifacts. |
| WX-189 | [x] Complete | [ ] Verified | Show run-scoped creating state on affected cards. |
| WX-190 | [x] Complete | [ ] Verified | Show run-scoped updating state on affected cards. |
| WX-191 | [x] Complete | [ ] Verified | Remove permanent edited styling derived only from creation provenance. |
| WX-192 | [x] Complete | [ ] Verified | Highlight affected document sections during edits. |
| WX-193 | [x] Complete | [ ] Verified | Support overlapping updates across several objects. |
| WX-194 | [x] Complete | [ ] Verified | Resolve pending shells to canonical objects without remount flicker. |
| WX-195 | [x] Complete | [ ] Verified | Animate cards with restrained blue energy and reduced-motion support. |
| WX-196 | [x] Complete | [ ] Verified | Update workspace names, icons, ordering, counts, and relations live. |
| WX-197 | [x] Complete | [ ] Verified | Surface destructive targets while awaiting approval. |
| WX-198 | [x] Complete | [ ] Verified | Synchronize accept/reject and choices across all surfaces. |
| WX-199 | [x] Complete | [ ] Verified | Persist a selected choice exactly once. |

## K-bar consistency

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-200 | [x] Complete | [ ] Verified | Keep one Cmd/Ctrl+K shortcut owner. |
| WX-201 | [x] Complete | [ ] Verified | Remove legacy duplicate Spectra search registrations. |
| WX-202 | [x] Complete | [ ] Verified | Deduplicate object results across bridges. |
| WX-203 | [x] Complete | [ ] Verified | Use the current surface snapshot. |
| WX-204 | [x] Complete | [ ] Verified | Use current selection, explicit context, visible objects, and continuation. |
| WX-205 | [x] Complete | [ ] Verified | Open workspaces. |
| WX-206 | [x] Complete | [ ] Verified | Open artifacts. |
| WX-207 | [x] Complete | [ ] Verified | Open threads. |
| WX-208 | [x] Complete | [ ] Verified | Add objects to AI context. |
| WX-209 | [x] Complete | [ ] Verified | Remove objects from AI context. |
| WX-210 | [x] Complete | [ ] Verified | Continue a thread in place. |
| WX-211 | [x] Complete | [ ] Verified | Begin a new thread. |
| WX-212 | [x] Complete | [ ] Verified | Group or tile selected artifacts. |
| WX-213 | [x] Complete | [ ] Verified | Move artifacts with true move semantics. |
| WX-214 | [x] Complete | [ ] Verified | Clear selection. |
| WX-215 | [x] Complete | [ ] Verified | Search all Spectra objects. |
| WX-216 | [x] Complete | [ ] Verified | Parse flexible word order and aliases. |
| WX-217 | [x] Complete | [ ] Verified | Fall back to an AI request using the same context model. |
| WX-218 | [x] Complete | [ ] Verified | Abort stale searches and announce loading/empty/error states. |

## UI quality, responsiveness, and accessibility

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-219 | [x] Complete | [ ] Verified | Auto-grow the composer textarea from one line to a sensible cap. |
| WX-220 | [x] Complete | [ ] Verified | Keep message controls stable at one, three, and ten lines. |
| WX-221 | [x] Complete | [ ] Verified | Show Stop for the selected stoppable run. |
| WX-222 | [x] Complete | [ ] Verified | Keep New thread available while another run streams. |
| WX-223 | [x] Complete | [ ] Verified | Use flowing structural skeletons instead of fake text. |
| WX-224 | [x] Complete | [ ] Verified | Prevent stale workspace requests from winning rapid navigation races. |
| WX-225 | [x] Complete | [ ] Verified | Keep cached workspace structure visible during switching. |
| WX-226 | [x] Complete | [ ] Verified | Make clickable artifact cards keyboard accessible. |
| WX-227 | [x] Complete | [ ] Verified | Remove duplicate real and synthetic selection checkmarks. |
| WX-228 | [x] Complete | [ ] Verified | Avoid role=button containers with nested buttons. |
| WX-229 | [x] Complete | [ ] Verified | Add result-stack overflow fades for tall content. |
| WX-230 | [x] Complete | [ ] Verified | Keep confirmation controls usable in compact surfaces. |
| WX-231 | [x] Complete | [ ] Verified | Use accessible dialogs/popovers/menus for overlays. |
| WX-232 | [x] Complete | [ ] Verified | Add aria-expanded, controls, current, and pressed states. |
| WX-233 | [x] Complete | [ ] Verified | Add aria-live updates for run and context state. |
| WX-234 | [x] Complete | [ ] Verified | Provide non-hover access to essential actions. |
| WX-235 | [x] Complete | [ ] Verified | Meet practical mobile touch targets. |
| WX-236 | [x] Complete | [ ] Verified | Respect prefers-reduced-motion. |
| WX-237 | [x] Complete | [ ] Verified | Verify light and dark contrast for all run states. |
| WX-238 | [x] Complete | [ ] Verified | Collapse or drawerize the workspace rail on small screens. |
| WX-239 | [x] Complete | [ ] Verified | Replace fixed desktop gutters with responsive spacing. |
| WX-240 | [x] Complete | [ ] Verified | Prevent fixed overlays from exceeding the viewport. |

## Validation matrix

| ID | Complete | Verified | Requirement / acceptance criterion |
|---|---|---|---|
| WX-241 | [x] Complete | [ ] Verified | Workspace quick-chat run appears immediately in its tab. |
| WX-242 | [x] Complete | [ ] Verified | The same run streams in /chat while active. |
| WX-243 | [x] Complete | [ ] Verified | The same run streams in the workspace right panel. |
| WX-244 | [x] Complete | [ ] Verified | The same run survives closing and reopening the right panel. |
| WX-245 | [x] Complete | [ ] Verified | The same run survives route navigation. |
| WX-246 | [x] Complete | [ ] Verified | The same run survives refresh and catches up. |
| WX-247 | [x] Complete | [ ] Verified | A completed tab never disappears without explicit close. |
| WX-248 | [x] Complete | [ ] Verified | A follow-up continues the completed thread by default. |
| WX-249 | [x] Complete | [ ] Verified | A busy continuation rejects a follow-up with a New thread option. |
| WX-250 | [x] Complete | [ ] Verified | A new thread runs concurrently with another thread. |
| WX-251 | [x] Complete | [ ] Verified | Home, workspace, artifact, thread, and tiled focus defaults are correct. |
| WX-252 | [x] Complete | [ ] Verified | Explicit multi-context survives navigation. |
| WX-253 | [x] Complete | [ ] Verified | Explicit multi-context survives selection exit. |
| WX-254 | [x] Complete | [ ] Verified | Tiled visible artifacts become inferred context. |
| WX-255 | [x] Complete | [ ] Verified | Closing a tile updates inferred but not explicit context. |
| WX-256 | [x] Complete | [ ] Verified | Workspace-associated thread appears immediately as a workspace object. |
| WX-257 | [x] Complete | [ ] Verified | Global thread appears in Inbox. |
| WX-258 | [x] Complete | [ ] Verified | Markdown and math match across full and compact thread views. |
| WX-259 | [x] Complete | [ ] Verified | Traces persist and expose no private/internal reasoning. |
| WX-260 | [x] Complete | [ ] Verified | Pending artifact card appears before creation completes. |
| WX-261 | [x] Complete | [ ] Verified | Open pending artifact fills progressively. |
| WX-262 | [x] Complete | [ ] Verified | Existing document edit highlights affected sections. |
| WX-263 | [x] Complete | [ ] Verified | Accept and reject synchronize across surfaces. |
| WX-264 | [x] Complete | [ ] Verified | Multiple-choice selection synchronizes across surfaces. |
| WX-265 | [x] Complete | [ ] Verified | Internal IDs and schemas never leak in success or error copy. |
| WX-266 | [x] Complete | [ ] Verified | Rapid workspace A-B-A switching cannot snap to stale data. |
| WX-267 | [x] Complete | [ ] Verified | Network loss before operation commit recovers safely. |
| WX-268 | [x] Complete | [ ] Verified | Network loss after partial commit reports exact affected objects. |
| WX-269 | [x] Complete | [ ] Verified | User stop before first delta is recoverable. |
| WX-270 | [x] Complete | [ ] Verified | User stop during streaming preserves partial public text. |
| WX-271 | [x] Complete | [ ] Verified | Stop during operation claim has one deterministic outcome. |
| WX-272 | [x] Complete | [ ] Verified | Automatic title generation failure leaves a stable fallback. |
| WX-273 | [x] Complete | [ ] Verified | Trace persistence failure degrades to a clear run status. |
| WX-274 | [x] Complete | [ ] Verified | Artifact patch failure retains a repair/retry path. |
| WX-275 | [x] Complete | [ ] Verified | Deleted selected context is reconciled visibly. |
| WX-276 | [x] Complete | [ ] Verified | Same-name objects prompt natural disambiguation. |
| WX-277 | [ ] Complete | [ ] Verified | Repeat every critical interaction twice to expose timing races. |
| WX-278 | [ ] Complete | [ ] Verified | Run TypeScript with no errors. |
| WX-279 | [ ] Complete | [ ] Verified | Run ESLint with zero warnings. |
| WX-280 | [ ] Complete | [ ] Verified | Run all Vitest tests. |
| WX-281 | [ ] Complete | [ ] Verified | Run Convex code generation and validation. |
| WX-282 | [ ] Complete | [ ] Verified | Run the production Next build. |
| WX-283 | [ ] Complete | [ ] Verified | Run relevant non-browser route validation. |
| WX-284 | [ ] Complete | [ ] Verified | Manually verify keyboard-only operation. |
| WX-285 | [ ] Complete | [ ] Verified | Manually verify 320, 375, 768, 1024, and 1440 widths. |
| WX-286 | [ ] Complete | [ ] Verified | Manually verify light, dark, and reduced-motion modes. |
| WX-287 | [ ] Complete | [ ] Verified | Re-audit focus/context/navigation/selection/tiling. |
| WX-288 | [ ] Complete | [ ] Verified | Re-audit threads/runs/streaming/persistence/backend state. |
| WX-289 | [ ] Complete | [ ] Verified | Re-audit UI/live mutations/cards/traces/K-bar/responsiveness. |
| WX-290 | [ ] Complete | [ ] Verified | Perform an independent main-agent review of every plan row. |
| WX-291 | [ ] Complete | [ ] Verified | Do not complete Wave X while any Complete box remains open. |
| WX-292 | [ ] Complete | [ ] Verified | Do not complete Wave X while any Verified box remains open. |

## Decision log

- 2026-07-10: Chosen direction is calm living instrument, not decorative chatbot chrome.
- 2026-07-10: Implemented the persisted atomic run coordinator, ordered replayable public events, attempt leases, stale-run recovery, and cross-surface durable tabs.
- 2026-07-10: Implemented one additive persisted context model separating continuation, explicit context, visible inference, active workspace, retrieval awareness, and transient selection.
- 2026-07-10: Implemented progressive run-scoped artifact/workspace projections, canonical patches, public traces, confirmation synchronization, responsive tiling, and unified K-bar behavior.
- 2026-07-10: Closed implementation rows WX-001 through WX-276. Prior validation marks were reopened because the implementation changed materially; validation begins only after this implementation checkpoint.
- 2026-07-10: Audits agree the first implementation seam is atomic run start + active-thread invariant + durable/replayable public state.
- 2026-07-10: Provider/private chain-of-thought remains excluded; only safe public progress is eligible for persistence.

## Verification evidence

Add exact commands, test results, screenshots/manual observations, and reviewer findings here as work completes.

- 2026-07-10: Convex codegen passed; TypeScript passed; ESLint passed with zero warnings; full Vitest passed (72 files passed, 1 skipped; 384 tests passed, 3 skipped); production Next build passed with 107 routes.
- 2026-07-10: All three original auditors completed read-only post-implementation reviews. Their reopened P0 items remain unchecked, especially durable worker ownership, atomic begin-run, ordered shared events, additive context state, and progressive artifact mutation.

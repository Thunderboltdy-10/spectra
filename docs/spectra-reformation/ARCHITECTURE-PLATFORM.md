# ARCHITECTURE-PLATFORM — collaboration, backend rules, frontend baseline, budgets

Owner phases: P0 (baseline, budgets), P5 (collaboration), P6 (adoption). Binding under CANON R9–R10, R13, R16, D41–D44.

## 1. Collaboration (decided 2026-08-25: Hocuspocus for the pilot)

- **The Hocuspocus gateway is the production realtime system.** It binds tokens to document names correctly, projects Yjs→Convex, and is complete. The Cloudflare Durable Object worker stays **disabled**: it has a confirmed room-binding hole (SEC-1 — token claims never checked against the routed room, `workers/collaboration/src/room.ts:79-102`) and no projection parity. P0 fixes the binding anyway (cheap, defense in depth); enabling the DO path is a *future* program gated on binding + projection parity + load tests.
- **Hosting** (answers "where does Hocuspocus live"): the gateway (`scripts/collaboration-gateway.mjs`) is a single stateful Node WebSocket process → containerize and run on one small always-on host (Fly.io, Railway, or a Hetzner VM — any of the three; pick in P5.I2 by ops preference). Requirements: WebSocket support, sticky single instance (rooms are in-memory), health checks, restart-safe (state reloads from Convex on room open — already true). One modest instance comfortably serves a school pilot; horizontal sharding by room hash is the documented scale path, and CF DO the eventual one.
- **Convex projection goes checkpoint-based**: today every debounced edit batch writes a full `collaborationUpdates` row *and* patches full `artifact.content` (+900KB projections, `textIndex` slice). P5 moves to interval/idle checkpoints with update-log continuity — durability unchanged (the durable-ack protocol is kept), write amplification removed.
- **Presence rendering is scoped**: the single `useSyncExternalStore` over the whole transport snapshot dies; `usePresence`/`useSyncState`/field-level selectors replace it so a peer cursor costs a cursor layer render, not an 8k-line studio render (PERF-3). Publisher caps stay.
- Preserved: region claims, append CAS (`liveStateVectorHash`), change groups, IndexedDB-before-connect ordering, native bootstrap protocol, reauthorize polling.

## 2. Convex rules (the I/O disaster, generalized)

One dev user generated ~34 GB/period; the causes are patterns, so the rules are patterns (enforced by review + budgets, lint where possible):

1. **List queries never return content.** Summary projections only (id, title, type, timestamps, state); content is fetched by id on open. (`spectraArtifacts.list` shipping full `content` ≈ 11.5 GB.)
2. **No cron scans tables.** Scheduled work uses `scheduler.runAt` per item (compute next fire time at write) or an indexed due-window query. Minute-crons reading 1k documents each (planner/timetable ≈ 9 GB) are the counterexample.
3. **Status queries are indexed.** `reconcileStaleRuns`'s global unindexed filter scan gets `by_status_lease`. Any `.filter()` over an unindexed field on a growing table is a defect.
4. **Fan-out queries are denormalized.** `listTabs` collecting all messages/events per tab per poll (≈ 4.6 GB) → slim summary fields maintained at write time.
5. **Counts come from aggregates** (already true for board; `hydrateNodes` child-count N+1 moves to `orgNodeAggregates`).
6. **Polling has a ceiling**: any client poll < 10s interval needs a written justification; prefer subscriptions and SSE cursors (both exist).
7. **Blobs live in storage, not rows**: run transcripts, version before/after, big projections use content-addressed refs.

## 3. Frontend baseline (built P0, adopted through P6)

- **Primitives** (in `src/components/ui/`, tokens-only styling): Button/IconButton, Dialog (single overlay, focus trap, `layer` prop), Input/Field (focus ring restored — the global `input:focus-visible` suppression is removed), Popover/Dropdown, Tooltip, StatusBadge, Skeleton, EmptyState, Spinner, Toast wrapper, Sheet. Nothing else until these are universal.
- **Layering contract** (kills z-index anarchy: composer at 220 over confirm dialogs at 94, share at 400, 2147483000 twice): named layers `base(0) < chrome(40) < dropdown(60) < panel(80) < modal(100) < composer-dock(120) < toast(140)`. All overlays portal through Dialog/Popover with a layer name; numeric z-index in feature code is lint-banned.
- **Enforcement**: ESLint arbitrary-value rule (warn in P0 → error per-directory through P6), raw-hex ban, z-index ban; codemods burn down the 5,090 existing escapes top-offender-first. `spectra-app.css` shrinks by deletion as components adopt primitives — remediation CSS (`.spectra-wave-y .text-\[11px\]` overrides) is deleted with its cause, never extended.
- **God-file seams** (P1 does the load-bearing ones because sync truth depends on them): `artifact-persistence.ts` (save/close/dirty), `artifact-native-sync.ts` (lens refresh/reconcile), `useSyncPresentation` (ARCHITECTURE-TRUTH §5), then chrome/adapters/history splits in P6. The `refreshToolbar` re-render counter and per-keystroke `getJSON`+stringify die in P5's render work (PERF-1/2).
- **Interaction language** (R16): state chips on rows, inline fills, motion-token transitions — not toast chains. One dialog voice, one empty-state voice, one skeleton. Copy follows R13 (plain words).

## 4. Budgets (L4 gate table — initial values, tightened at P8)

| Budget | Value |
|---|---|
| First paint, any primary surface | ≤ 15 requests, largest payload ≤ 300 KB, no collection fetches (D42) |
| Convex bytes read per user action | ≤ 1 MB typical action; opening an artifact ≤ its content + fixed overhead |
| Idle product, per minute | ≤ 5 queries, 0 cron table scans attributable to this user |
| Keystroke main-thread (fixture densities: 40-page doc / 200k-cell book / 120-slide deck) | ≤ 8 ms |
| Remote presence frame cost | cursor-layer render only; 0 studio-body renders |
| Bridge quiet 10k-file mount | 0 cloud mutations steady-state; < 1% CPU |
| Collaboration: 30 clients one doc | typing latency < 100 ms p95; gateway stable > 1 h |

## 5. Security posture (P0 items, restated)

CF DO room binding fixed even while disabled; micropip egress closed (allowlist/proxy — SBX-1); logout/account-switch storage sweep (Bridge tokens, caches — SEC-3/WC-2); Bridge local-server pre-pairing token hole + Origin-resume hardening (BR-8); payload hash verification server-side (SEC-4); build endpoint bounded (SEC-6). Key rotation is Pablo's (STATE §5).

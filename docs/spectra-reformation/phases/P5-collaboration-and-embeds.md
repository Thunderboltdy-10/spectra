# P5 — Collaboration & Embeds

**Goal:** collaboration is production-real for a classroom (30 concurrent editors, humans + AI + external saves composing safely) and embeds become a natural consumer of the unified artifact model (N9's intent, absorbed). Rendering stops paying whole-studio costs for peer presence.

**Prerequisites:** P1 accepted (truth), P3 accepted (IR — embeds derive interactions from it), P4.I2 useful but not blocking. **Architecture:** ARCHITECTURE-PLATFORM §1, ARCHITECTURE-CAPABILITIES §6. **Findings absorbed:** Part XVI (PERF-1..6), Part XV (SBX-2..5), CS-9 (payload GC — if not closed in P1), collaboration scale risks from the Yjs review.

**Difficulty (PROCESS §4):** V1 = Hard / GPT 5.6 Sol xhigh. I1, I2, I3 = Medium-thinking / Grok 4.6 High.

## P5.I1 — Render architecture (MT)

Scoped selectors replace the monolithic transport snapshot subscription: `usePresence` (cursor layer only), `useSyncState`, field-level model hooks; presence frames re-render the cursor layer, not the studio (PERF-3). Kill the `refreshToolbar` counter and per-keystroke `getJSON`+stringify (PERF-2); presentation pointermove stops deep-cloning the deck (PERF-1 — mutate-in-model with structural sharing); sheets commit path drops redundant serializations (PERF-4); persistence emits gated by equality, eviction without full `getAll` (PERF-5); non-collab fallback path same treatment (PERF-6). Gate: L4 keystroke/presence budgets at fixture densities.

## P5.I2 — Gateway productionization + hosting (MT)

Containerize `collaboration-gateway.mjs`; deploy to the host Pablo picks (Fly.io / Railway / Hetzner — present a one-page comparison, then do it); health checks, restart drills (state reload from Convex verified), connection backoff. Convex projection goes checkpoint-based (interval/idle, durable-ack protocol kept) — per-edit full-content patches end (the collaboration slice of the I/O problem). Payload/update-log compaction verified under load.

## P5.I3 — Embeds convergence (MT)

One embed model: the server contract (`artifactEmbeds`) and client `ReferenceNode` merge into a single schema (SBX-2 fork closed). "Live" means live: embeds subscribe to source changes (SBX-3). Interaction levels derive from the IR (an embedded quiz exposes the quiz capabilities the embed mode permits); permissions resolve at render (already good — keep). Chat becomes an embed host (composer/dock wiring); cross-artifact embeds (document↔sheets, whiteboard↔quiz/flashcards) through the same one host; native fallback on export (EXTENSION semantics: SVG/PNG + reference, strict-native refuses honestly). Published-build bearer-URL exposure bounded (SBX-4); embed CPU bounded off-screen (SBX-5).

## P5.V1 — Multi-writer + classroom load verification (H)

The composition matrix, adversarially: two humans + one AI editing one artifact; external Word save mid-session; offline peer reconverging; AI editing while a human types in the same region (claims honored); revocation mid-session. Classroom load: 30 real browser clients (scripted) in one document — typing latency p95 < 100 ms, gateway stable > 1 h, budgets held. Embed journeys: embed a quiz in a document, take it, edit the source, watch the embed update; export with fallbacks and verify in Word.

**Model: GPT 5.6 Sol max** (retiered 2026-08-30, ORCHESTRATION §4). Never concurrent with another live-product verifier. The two-human legs use both signed-in Playwright profiles (account A and account B — STATE §2; account B is created once via ORCHESTRATION §9 and must exist before this VU starts). RC.V1 (ORCHESTRATION §8) runs before this unit and may share its corpus copies.

## Exit gate

Load + composition suites recorded; L4 budgets met at densities; embed journeys PASS; no truth divergence reproducible between Yjs, Convex projection, and bytes under the matrix; Pablo pass with a second human.

### P5.I1 implementation log (2026-08-29)

- Three snapshot identities on the transport: sync (connection/durability), presence (cursors), preview (target path / speculation, not cursor x/y).
- `useArtifactCollaboration` subscribes to sync only; studio body uses `usePresencePreview`; cursor/indicator/InteractionLayer are leaves on `usePresence`.
- Presence preview listeners fire only when the signature changes; empty `[]` reuses `EMPTY_PRESENCE` so sync ticks do not wake the cursor layer.
- InteractionLayer observers bind to frame identity, not point JSON.
- Presentation `producePresentationContent` keeps untouched slide/object identity; pointermove mutates a local `gestureDeck` and commits on pointerup.
- Document collab `onUpdate` no longer `getJSON`/stringify; `refreshToolbar` is gone. TipTap still re-renders DocumentStudio on transactions (workbar not extracted).
- Sheets commit uses structural `sameContent` plus a bounded identity hash; no whole-workbook stringify on that path.
- Persistence `patch()` is equality-gated; eviction uses `listMeta()`; IDB v2 `work-meta` store.
- Workbar overflow warn is once per `label:tab`, not every render. Shape essentials were not demoted.
- Taste: preview includes every peer's path/act so Follow-human stays in the studio without cursor frames; drag defers parent `onChange` until pointerup.
- Focused Vitest: 5 files / 39 tests. Scoped ESLint: 0 errors on new logic; existing studio token warnings unchanged.
- Secret scan 2191 files; `git diff --check` passed. L4 live 30-client budgets remain P5.V1.
- Status: IMPLEMENTED. No acceptance claimed.

### P5.I2 implementation log (2026-08-29)

- Hosting: Fly.io (chosen) vs Railway vs Hetzner. Fly: sticky single machine, native WS + HTTP health, `auto_stop` off, Madrid. Railway: easy git deploy, idle-sleep risk unless paid. Hetzner: cheapest always-on, you run compose/TLS/restarts. Config: `deploy/collaboration-gateway/` (Dockerfile, fly.toml, railway.toml, compose.yml). No live deploy — Pablo owns secrets and the host flip.
- Human append stores the Yjs update and state-vector hash only; `artifact.content` / `textIndex` / Library title move on idle 2s / max 15s checkpoint (durable-ack kept). AI writes and native initialization still project on append.
- Gateway `/_spectra/health` reports `ready` or `degraded` with connections/uptime. Dev supervisor backoff on child exit; client `HocuspocusProviderWebsocket` uses the same 400ms×2 band, cap 12s, jitter.
- Restart reload: `onLoadDocument` applies Convex snapshot + later updates. Compaction when uncompacted ≥256KB, ≥200 updates, first snapshot, or 60s idle; `verifySnapshot` deletes compacted updates and superseded snapshots.
- Focused Vitest: 3 files / 25 tests (`collaboration-checkpoint`, `collaboration-gateway`, `collaboration-native-projection`). Scoped ESLint: 0 errors. Secret scan 2195 files; `git diff --check` passed.
- Gate repair 2026-08-30 (`570e326`): five checkpoint-test buffer sites now copy bytes into guaranteed `ArrayBuffer`s; focused Vitest 2/2, secret scan across 2,220 tracked files, path diff-check, and mandatory `npx convex dev --once --typecheck=enable` all passed. No P5.I3 file changed.
- CS-9 payload GC (`beginPayloadUpload` refCount) is not this unit. L4 30-client / multi-writer stays P5.V1. Embeds stay P5.I3.
- Status: IMPLEMENTED. No acceptance claimed.

### P5.I2 realtime proxy repair log (2026-08-30)

- RC.V1 falsified query-only WebSocket upgrades: Next forwarded `?foo=1` instead of `/?foo=1`, so the proxy returned HTTP 400 while direct port 1234 returned 101.
- One shared proxy-path helper now preserves `/` for empty, query-only, and ordinary room targets; gateway regression coverage includes all four shapes.
- Live raw handshakes now return `101 Switching Protocols` both direct and through `localhost:3000/_spectra/realtime?foo=1`.
- Hocuspocus v4 does not attach or lifecycle-manage an externally supplied socket. The transport now attaches before connect and owns socket reconnect, disconnect, failure cleanup, and destroy.
- Lifecycle regression coverage red-proved missing `attach()` and now verifies attach/connect/retry/disconnect/destroy ownership.
- Fresh Account A loaded the real RC corpus copy through the proxy with one gateway connection and no repeated WebSocket warning; no production-host claim is made.
- The protected-paragraph materialization probe refused honestly and was reverted; the corpus copy remained byte-identical.
- Focused Vitest 4 files / 20 tests; scoped ESLint, capability IR, secret scan, scoped diff-check, and mandatory Convex one-shot typecheck all passed.
- Evidence: `.shots/reformation/P5.I2/manifest.md`. Status remains **IMPLEMENTED** pending independent RC.V1/P5.V1 verification.

### P5.I3 implementation log (2026-08-30)

- Canonical `ArtifactEmbedReference` now owns shared validators and client/server identity; legacy document references adopt one stable Convex row.
- Convex projections stay live and retain honest removed/denied/missing states; update, restore, and bounded bulk removal preserve host placement semantics.
- Interaction levels derive from capability IR. Quiz practice is interactive only when permitted and published; an unpublished quiz offers `Publish to practice` without a false start action.
- Document, whiteboard, references panel, composer dock, and shared chat all render through one embed host; thread embeds persist and reload from Convex.
- Cross-artifact placement uses the same command/host path, including stable 4:3 whiteboard embed nodes.
- Native export emits an escaped SVG/reference fallback; strict-native files refuse live placement until changed to Enhanced.
- Private published-code bearer URLs remain server-side behind an authenticated same-origin stream with payload size and SHA-256 verification.
- Code runtimes unmount off-screen or on hidden pages; non-code live projections remain subscribed.
- Focused Vitest: 5 files / 43 tests. Scoped ESLint: 0 errors (existing token/style warnings only).
- Capability IR gate, secret scan, diff-check, Convex schema/typecheck, and the single Impeccable detector pass all passed.
- Fresh Account A context reloaded the Convex quiz embed; shared chat rendered a live read-only document host; console errors 0. Evidence: `.shots/reformation/P5.I3/manifest.md`.
- Local collaboration-proxy WebSocket failures kept document body insertion local; gateway was ready and persistent embed projection still passed. Proxy/load composition remains P5.I2/P5.V1.
- Status: IMPLEMENTED. No acceptance claimed.


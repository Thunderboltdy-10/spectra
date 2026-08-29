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

**Model: GPT 5.6 Sol xhigh.** Never concurrent with another live-product verifier.

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

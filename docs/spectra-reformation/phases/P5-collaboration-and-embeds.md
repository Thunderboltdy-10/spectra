# P5 — Collaboration & Embeds

**Goal:** collaboration is production-real for a classroom (30 concurrent editors, humans + AI + external saves composing safely) and embeds become a natural consumer of the unified artifact model (N9's intent, absorbed). Rendering stops paying whole-studio costs for peer presence.

**Prerequisites:** P1 accepted (truth), P3 accepted (IR — embeds derive interactions from it), P4.I2 useful but not blocking. **Architecture:** ARCHITECTURE-PLATFORM §1, ARCHITECTURE-CAPABILITIES §6. **Findings absorbed:** Part XVI (PERF-1..6), Part XV (SBX-2..5), CS-9 (payload GC — if not closed in P1), collaboration scale risks from the Yjs review.

**Difficulty (PROCESS §4):** V1 = Hard / GPT 5.6 Sol xhigh. I1, I2, I3 are implemented history. V1 is the first active launch unit.

## P5.I1 — Render architecture (MT)

Scoped selectors replace the monolithic transport snapshot subscription: `usePresence` (cursor layer only), `useSyncState`, field-level model hooks; presence frames re-render the cursor layer, not the studio (PERF-3). Kill the `refreshToolbar` counter and per-keystroke `getJSON`+stringify (PERF-2); presentation pointermove stops deep-cloning the deck (PERF-1 — mutate-in-model with structural sharing); sheets commit path drops redundant serializations (PERF-4); persistence emits gated by equality, eviction without full `getAll` (PERF-5); non-collab fallback path same treatment (PERF-6). Gate: L4 keystroke/presence budgets at fixture densities.

## P5.I2 — Gateway productionization + hosting (MT)

Containerize `collaboration-gateway.mjs`; deploy to the host Pablo picks (Fly.io / Railway / Hetzner — present a one-page comparison, then do it); health checks, restart drills (state reload from Convex verified), connection backoff. Convex projection goes checkpoint-based (interval/idle, durable-ack protocol kept) — per-edit full-content patches end (the collaboration slice of the I/O problem). Payload/update-log compaction verified under load.

## P5.I3 — Embeds convergence (MT)

One embed model: the server contract (`artifactEmbeds`) and client `ReferenceNode` merge into a single schema (SBX-2 fork closed). "Live" means live: embeds subscribe to source changes (SBX-3). Interaction levels derive from the IR (an embedded quiz exposes the quiz capabilities the embed mode permits); permissions resolve at render (already good — keep). Chat becomes an embed host (composer/dock wiring); cross-artifact embeds (document↔sheets, whiteboard↔quiz/flashcards) through the same one host; native fallback on export (EXTENSION semantics: SVG/PNG + reference, strict-native refuses honestly). Published-build bearer-URL exposure bounded (SBX-4); embed CPU bounded off-screen (SBX-5).

## P5.V1 — Multi-writer + classroom load verification (H)

**Model: GPT 5.6 Sol xhigh.** Run alone, serially, in the primary checkout. Do not depend on RC.V1; the completed corpus gate now belongs inside P8 after the code freeze.

### Read-first questions

Before touching code, answer these in the evidence manifest from current implementation truth:

1. What event is the durable boundary for a human Yjs edit, an AI edit, and a native-file edit? Name the exact acknowledgements and stores.
2. Which client state is allowed to say “saved,” “current,” or “available,” and what compensating exit exists if the gateway or Convex dies immediately afterward?
3. Which render leaves subscribe to cursor frames, which subscribe to durability, and what measurement proves the studio body does not rerender on peer pointer movement?
4. What is the tested restart source: verified snapshot plus later updates, or an accidental in-memory survivor?
5. Which embed actions are live IR-backed interactions, which are read-only, and which native exports must refuse?

### Execution cards — keep this order

1. **Environment and integrity preflight.** Use the local Convex stack, local collaboration gateway, both existing signed-in profiles, and a fresh sacrificial fixture directory. Hash any real source tree before disconnecting it; never edit `IBDP1`. Record commit, environment URLs without secrets, profile identities, fixture hashes, gateway build, and all budget constants.
2. **Durability recovery.** One human edit, gateway kill after local apply but before checkpoint, restart, fresh-browser reload, and readback. Repeat with a browser crash and with Convex latency. A local optimistic view is not evidence; the marker must survive a clean process restart.
3. **Two humans + AI, different regions.** Both humans type while one AI operation streams. Verify exact authorship, stable region targets, visible presence, durable reload, and no whole-studio cursor rerenders.
4. **Two humans + two AIs, same region.** Claims must serialize or refuse truthfully. No lost human keystrokes, duplicated AI operation, phantom success, or retry that can double-apply.
5. **Offline and authority changes.** Take one peer offline, edit, revoke that member/device, reconnect, and prove the accepted/rejected effects match the UI sentence and audit trail. Repeat permission downgrade during an in-flight AI request.
6. **Native coexistence.** On copied DOCX, save externally while human and AI activity exists. Resolve/rebase through the real route, reopen in Word, and compare package parts. XLSX/PPTX corpus depth waits for RC.V1, but ordinary native coexistence must work here.
7. **Embed composition.** Embed quiz→document and sheet→whiteboard/chat, reload from a second profile, mutate the source, observe the live projection, exercise allowed interaction, then export and verify the native fallback/refusal.
8. **30-client classroom soak.** Use the checked-in harness unchanged: exactly 30 isolated clients, at least 65 minutes, p95 local typing under 100 ms, all clients contributing samples, bounded reconnect recovery, one converged document/state-vector hash, stable gateway uptime, bounded update bytes, verified final snapshot and compaction. A shortened smoke may debug the harness but cannot pass the card.
9. **Fresh composition rerun.** Repeat the shortest representative marker from cards 2–7 using clean processes and profiles so the pass is not dependent on warmed state.

### Repair rule and blast radius

A failure is triaged LOCAL or SYSTEMIC before editing. Repair a holdable class in the VU and rerun the failed card plus every later card that consumes the same state. Inspect gateway transport, Convex collaboration storage, Yjs adapter, projection checkpoint, presenter, Library summary, and native route when the state crosses them. Do not weaken client count, soak duration, timing thresholds, hash checks, strict-native refusal, or durability assertions. A production-host deploy is not required for this local school-launch gate, but the verdict must say that hosting remains unproved until Pablo deploys it.

### Required evidence and exit

- One manifest with environment, hashes, exact commands, raw timing summary, restart timestamps, gateway health, update/snapshot counts, and every repair commit.
- Numbered browser evidence for cards 2–7 from both profiles where relevant.
- Raw bounded JSON from the 30-client harness plus a human-readable budget table.
- Focused regression tests for every repair, then full Vitest, typecheck, production build, architecture/capability/copy/token/secrets gates, and DOCX/Office/seam fidelity gates.
- PASS requires all nine cards. REJECTED remains active work; it is not a reason to exclude P5 from launch.

## Exit gate

Load + composition suites recorded; L4 budgets met at densities; embed journeys PASS; no truth divergence reproducible between Yjs, Convex projection, and bytes under the matrix; verifier records PASS and P5 closes.

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

### P5.V1 classroom load-harness implementation log (2026-08-30)

- Added a verifier-owned CLI that launches exactly 30 isolated Chromium contexts and runs one real Hocuspocus client in each against a single document.
- The default soak is 65 minutes; configuration rejects 30-client/duration/sample/report/budget weakening, including a strict typing p95 `< 100 ms` gate.
- Every sampled edit records local Yjs transaction time and end-to-end observation time in a designated remote browser; all 30 clients must contribute raw samples and converge to one document/state-vector hash.
- Gateway HTTP health is sampled throughout; uptime may not reset, observation gaps are bounded, and connection deficits must recover inside 30 seconds.
- Three default disconnect drills make an offline edit, reconnect, require remote observation, and require clean durable settlement.
- Durability assertions cover per-client pending/ack/failure telemetry, bounded Convex update rows/bytes during the run, projected-head continuity, and a final verifier-created snapshot that Convex must verify and compact.
- JSON evidence retains complete raw samples up to 4 MiB; overflow emits a guaranteed-bounded failure artifact instead of truncating into an apparent pass. Every assertion/config/runtime failure exits nonzero.
- The gateway and harness now share one signed Convex bridge client, preventing the probe from becoming a second persistence protocol.
- Focused Vitest: 2 files / 24 tests. Scoped ESLint and `tsc --noEmit`: PASS. CLI help smoke, capability gate, secret scan, and diff check: PASS.
- No live soak, browser profile, dev stack, Bridge, Office, corpus, or evidence was used; the fresh P5.V1 verifier owns execution and verdict.
- Status: load harness IMPLEMENTED. P5.V1 remains OPEN; no verification or acceptance claimed.

### P5.V1 verification log (2026-08-31, partial)

- Live school: Windows Next `:3000`, Convex `:3002` `local-pablo_md-ai_school-2`, gateway `:3001` from `spectra-p5v1-fix`. Accounts A (P MD, admin) and B (Pablo MD). Fly.io unproved.
- Cards 1–5 PASS. Card 6 blocked before Word save (same-hash fixture hid the working DOCX). Cards 7–9 not started. Unit stays OPEN.
- Class repairs on this branch: native-room recover only on live-hash mismatch; `replicas.forWork` uses artifact access not owner-only; region claims keep queued AI leases and serialize on promote; AI apply rebases after the wait; patch-verify requires every distinctive authored token (no 70% phantom Updated).
- Evidence: `.shots/reformation/P5.V1/manifest.md`. Pablo asked to PR here and let another agent continue.

### P5.V1 verification log (2026-09-01, native promotion repair — unit still OPEN)

- SYSTEMIC Card 6 class: AI `artifact.update` committed shared Yjs/`artifact.content` before Bridge-verified native bytes; Keep Word then left a phantom AI marker. Repair: `beforeCommit` promotion hook; `queueMaterialization` `verified-first` does not patch work content while pending; `materializationStatus`/`cancelMaterialization`; AI completion waits a durable-ack epoch, not transport cleanliness.
- Red-first: swapping `document.transact` before `beforeCommit` failed `refuses Yjs apply when native promotion fails first`; order restored. Focused 10 files / 119 tests green; `replicas.test.ts` supersede expectation unchanged.
- Live Card 6 on fresh `P5V1-Card6-Fresh-20260831.docx` (`wx7drz5y9v4r6ewsfd31c3hmad8dgkak`): unique AI marker present in Yjs, Convex-visible studio, and ZIP bytes together (SHA `D8F6EC01…` after Word recover-save). Ambiguous *text* “Page 332 Question 5” did not refuse (134 unique `w14:paraId`s). Word opened with “unreadable content” on Python-zip-salted packages; recover+SaveAs wrote `P5V1-NATIVE-WORD-2301` to disk; Spectra Yjs still lacked the Word marker and showed no Keep Word UI after reload. Cards 7–9 unstarted. Fly.io unproved.
- Field Note P6.I4: Library still titles a uniquely hashed fixture row `P5V1-Exercises-control.docx` (shot 64). Do not start P6.I4 here.
- Status: class repair in product+tests; P5.V1 remains OPEN. Evidence `.shots/reformation/P5.V1/manifest.md`.

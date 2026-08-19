# N3 — THE BRIDGE

**Charters:** Bridge & Sync Engineer (primary) + Foundation Engineer (Convex side)
**Prerequisites:** N2 accepted in `STATE.md`
**Architecture:** ARCHITECTURE-BRIDGE (all); ARCHITECTURE-STORAGE §2, §4, §6, §7, §8, §9, §10, §11.2
**Evidence:** `.shots/missions/N3/` plus test artifacts under `bridge/` · **Tier R throughout**, Tier P for the status UI

## Objective

Ship the Spectra Bridge: a Tauri v2 tray application with a Rust core that pairs to the account, holds explicit folder grants, discovers and watches files with stable identity, journals every intent, reads and writes bytes safely, and reports device truth. On the cloud side, land the replica model, the sync journal, the payload module and the truthful status vocabulary. At the end of N3, a user grants `C:\School`, sees that hierarchy inside the Library, and **nothing on disk has been modified** — with a hash proof that says so.

## Why now

Formats come next (N4/N5) and they need real bytes arriving through a trustworthy channel. Building lenses on top of an unreliable transport would produce exactly the silent-corruption failure Nova exists to prevent. N3 also completes the storage half of the model that N1 started, so policies (N6) have somewhere to attach.

## Why nothing in this mission may be approximated

This is the mission where Spectra earns the right to touch other people's files. Every shortcut here becomes a corruption story later. If a workstream cannot be finished properly, finish it properly and let scope slip — never ship a plausible-looking half of it.

## Workstreams (ordered)

### W1 — The Bridge skeleton (Tier R)

1. Create `bridge/` as a Rust workspace: `bridge-core` (protocol, journal, watcher, fs, sync client) and a thin Tauri v2 shell (`bridge-app`) for tray, status window, native dialogs, autostart and updater. Product logic lives in `bridge-core`; the shell is glue.
2. Axum HTTP + WebSocket server bound to `127.0.0.1:47615`. Fixed port, no scanning: if it is taken, fail loudly with a diagnosable message in the tray and the health response.
3. `GET /v1/health` unauthenticated (version, paired flag, protocol version). Everything else authenticated. Origin checks pinned to the Spectra origins recorded at pairing; CORS locked; no wildcards.
4. Windows specifics (file identity, lock detection, autostart, recycle bin, credential store) isolated in one module behind a trait so macOS/Linux is later packaging work, not a redesign.
5. Web client: `src/features/spectra/bridge/` — a typed client with protocol-version handshake and an honest "Update Spectra Bridge" state on major mismatch. Absence of the Bridge is a calm state, never an error banner storm.

### W2 — Pairing, identity, security (Tier R)

1. Pairing per ARCHITECTURE-BRIDGE §2: Spectra settings request a challenge bound to the signed-in account, the Bridge window shows the same short code, the user confirms in the Bridge process, the Bridge exchanges the challenge for a device credential and mints a browser session token. Both halves are required.
2. Device credential in the Windows Credential Manager. Never plaintext config, never in the journal.
3. `bridgeDevices` and `bridgeMounts` in Convex per ARCHITECTURE-STORAGE §4. The server stores opaque grant handles and labels only — **raw filesystem paths never leave the device** (assert this with a test that scans mutation payloads).
4. Grants exclusively through the native dialog inside the Bridge process. All path resolution inside the core with canonicalization, prefix checks, and rejection of `..`, junction and symlink escapes.
5. Revocation from either side: credential dies, syncing stops, local data intact, status reads "Disconnected" truthfully. Re-pairing re-adopts resources by `localResourceId` (W3).
6. Tauri updater with signed releases; version reported to the cloud so settings can warn about an old Bridge.

### W3 — Journal, scan, watcher, identity (Tier R)

1. SQLite journal per ARCHITECTURE-BRIDGE §6: `resources`, `ops`, `queue`, `config`. Intent rows before action, always.
2. Stable `localResourceId` from OS identity (volume serial + file index) with path continuity and content-hash adoption fallbacks per ARCHITECTURE-STORAGE §7.
3. `tree.scan` with cursor pagination over a mount; target a 10k-file mount enumerated without blocking the UI or pinning a core.
4. Watcher on `notify` plus periodic reconciliation scans. Watchers lie; scans are the truth of last resort and their cadence is configurable.
5. Stability windows and Office save patterns: temp-write-then-rename recognized, `~$` lock files understood, revision declared only when the file is quiescent and unlocked. **Never ingest a half-written file** — prove it with a test that writes slowly and asserts no revision is emitted mid-write.
6. Move, rename and delete detection with adoption; external deletion marks the replica unavailable with a reason and never deletes logical work.
7. Double-sync detection: OneDrive/Dropbox/Drive-desktop roots under a mount are flagged so N6 can warn once, clearly.

### W4 — The cloud half (Tier R)

1. `workReplicas` and `syncOperations` per ARCHITECTURE-STORAGE §2 and §8, with idempotency keys shared with the Bridge journal, and `syncConflicts` as a table (records only in N3 — the resolution UX lands in N6).
2. `syncPolicies` schema plus the **single effective-policy function** (I6) used by UI, sync engine, Bridge and AI alike. N3 exposes only the four presets minimally; the full human model is N6.
3. Payload module `payloads.ts`: content-addressed `put/get/head(hash)` with refcounting, backed initially by Convex `_storage`, with an interface that lets R2/S3 replace the backend without touching callers. Multi-MB binaries never land in ordinary rows.
4. Replica migration per §11.2: every existing artifact gets one `kind: "cloud"` replica row, `state: "current"`, revision seeded from `contentHash`/version head. Dry-run first, count invariants (one cloud replica per artifact, zero orphans), then cutover.
5. Server-side validation at the new write boundaries — this is where NV-4 becomes dangerous, so close it for everything the Bridge or a lens can write.
6. Bridge ↔ cloud channel: the Bridge is a headless sync client that works with no browser open. Backoff, resume, and revision-token semantics; no timestamps used for ordering anywhere.

### W5 — Generic resources in the Library (Tier P + R)

1. `resourceClass: "resource"` per ARCHITECTURE-STORAGE §1 — PDFs, images, source files and unknown types exist as real Library citizens. **No fake artifact JSON, ever.**
2. Mounts project into the N1 org tree: the granted root appears as a node, its children as folders and resource/work nodes, with discovery following policy (auto, ask, explicit).
3. A resource surface: preview where cheap and honest (image, PDF via the existing `pdfjs` path, text/code as read-only text), otherwise identity, size, location and a download/open action. Never a mangled pseudo-editor.
4. Native-format files whose lens does not exist yet (DOCX before N4) appear as resources with a truthful "opens in Spectra after Document support lands" affordance — no lying capability, no half-parse.
5. Deleting a mounted resource node in Spectra defaults to unlink-and-leave-the-file, per ARCHITECTURE-STORAGE §3.

### W6 — Truthful status, everywhere (Tier P)

1. Implement the single status selector of ARCHITECTURE-STORAGE §9 and use it in the artifact header, Library rows, Live Dock and AI context. One vocabulary, one code path.
2. Hover/disclosure shows per-replica truth ("This device — Current · Spectra Cloud — Current · Last synchronized 8s ago"). No icon soup, no state the selector cannot prove.
3. Bridge states surface calmly in Spectra settings: Connected, Disconnected, Paused, Update required, plus per-mount state and a real recent-activity line.
4. The tray window ships as specified in ARCHITECTURE-BRIDGE §3 and no larger.

### W7 — The write pipeline and chaos (Tier R)

1. Write pipeline per ARCHITECTURE-BRIDGE §7: base-revision precondition, lock-awareness, temp write, fsync, atomic rename, read-back hash verification, journal `verified`, revision reported. Failures leave the original untouched.
2. Policy-triggered deletes go to the recycle bin, never a hard unlink.
3. Generic write is proven in N3 on resources Spectra owns end-to-end (a Spectra-authored text/`spectra-pkg` placeholder payload and a materialized copy), **not** by rewriting a user DOCX — that requires the lens (N4). The pipeline must exist and be brutally tested before any format touches it.
4. Chaos suite: kill mid-write and replay; double replay; ack lost after success (verify-by-hash finds the file already correct and does not rewrite); disk full; file busy after rename (antivirus pattern); mount vanishing mid-op; Bridge restart with a full queue; cloud rejecting a stale revision.
5. Journal compaction and `bridge logs` diagnosability, since N12 asserts on both.

## Invariants to uphold

I1 (one identity), I2 (typing never waits — the Bridge is never on the keystroke path), I3 (journaled, idempotent transitions), I6 (one policy function), I7 (no silent last-write-wins), I8 (verified means read-back verified). D26, D27, D39. Security is written with the feature, not reviewed after.

## Out of scope

Office lenses and any parsing of DOCX/XLSX/PPTX content (N4/N5) · the human sync-policy UX and mirroring semantics (N6) · conflict resolution UI (N6) · multi-device hardening beyond correct schema and honest states (N6) · macOS/Linux packaging · AI-initiated file operations (N8).

## Acceptance gates

1. **F1 passes:** pair the Bridge, grant a real folder, the hierarchy appears in the Library with truthful states. Evidence: pairing shots, tray shot, Library tree shot, and a **hash manifest of the granted tree taken before and after** proving zero modifications.
2. Chaos suite green from a clean process start, with the run recorded in the log: kill-mid-write, double-replay, lost-ack, disk-full, busy-file, mount-vanish, stale-revision-rejected.
3. Identity: property tests for rename, move, folder rename, delete-and-recreate, and move-while-offline adoption.
4. Office-lock realism: a file open in Word produces no revision until the lock clears (test + honest status shot).
5. Replica migration: dry-run and cutover logs, invariants asserted, existing artifacts unaffected in the browser (spot-check shots).
6. Path privacy: a test asserts no absolute device path appears in any Convex mutation payload or table.
7. Protocol mismatch: forcing a major-version mismatch shows the honest update state (shot).
8. Reboot survival: after a real reboot, the Bridge is connected and mounts are active without user action (shot plus journal excerpt).
9. Scan performance: 10k-file mount enumerates with the UI responsive; note timings.
10. P0 and P10 still pass; STATE updated with the replica/status entries and every open failure honestly listed; mission log ≤40 lines; close-out checks green.

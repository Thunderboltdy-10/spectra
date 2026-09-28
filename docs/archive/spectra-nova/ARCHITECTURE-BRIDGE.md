# ARCHITECTURE — THE SPECTRA BRIDGE

Durable reasoning for N3, N6, N12. The Bridge is a lightweight local helper that makes user-approved files available to Spectra. Spectra remains a website; the Bridge is quiet infrastructure with a tray icon, not a desktop app competing with the browser.

---

## 1. Shape and stack (settled)

- **Tauri v2 tray application** with a **Rust core**. The core is a small always-running service: an Axum HTTP+WebSocket server bound to `127.0.0.1` on a **fixed port (47615; no port scanning — fail loudly if taken)**, a filesystem watcher, a SQLite journal, and a cloud sync client. The Tauri layer provides tray icon/status window, native folder-pick dialogs, autostart registration, and the updater.
- **Windows is the initial platform** (Pablo's environment, school launch reality). The core is portable Rust; nothing in the protocol or journal is Windows-specific; macOS/Linux are later packaging work, not redesigns. Windows specifics are isolated in one module (file identity, lock detection, autostart).
- **Two independent connections:**
  1. **Browser ↔ Bridge** (localhost WS): status, mount management UX, low-latency local reads, pairing.
  2. **Bridge ↔ Spectra Cloud** (HTTPS to Convex + the collaboration gateway): sync participation that works while no browser is open. The Bridge is a headless sync client with its own device credential.
- The webpage never receives filesystem authority (CANON D39): it speaks a typed protocol whose every operation is scoped to granted mounts and validated in the Rust core. No generic "read path X" API exists.

## 2. Pairing, identity, security

- **Pairing flow:** Spectra settings show "Connect this device" → web app requests a pairing challenge from the cloud (bound to the signed-in account) → user confirms in the Bridge window (which displays the same short code) → Bridge exchanges the challenge with the cloud for a **device credential** (bound to `bridgeDevices` row) and mints a **local session token** for the browser origin. Both the code-confirm and the account binding are required; a rogue local process cannot pair silently, and a rogue website cannot talk to the Bridge without the session token.
- Device credential stored in the **OS credential store** (Windows Credential Manager), never in plaintext config.
- Local server: origin-checked (only the Spectra origins configured at pairing), token-authenticated per request/WS session, CORS locked, no wildcard.
- **Grants:** every mount root is picked through the native OS dialog in the Bridge process. The server side stores only opaque grant handles + labels (ARCHITECTURE-STORAGE §4); raw paths stay on the device. All path resolution happens inside the core with canonicalization + prefix checks (no `..` escapes, junction/symlink escapes resolved and rejected).
- **Revocation:** from Spectra (device page) or the tray. Revoked credential → Bridge stops syncing, keeps local data intact, shows "Disconnected" truthfully.
- **Updates:** Tauri updater, signed releases, staged rollout not required initially but version reported to cloud (old-version warning surface in settings).
- **Privacy:** the Bridge sends file *content* to the cloud only as the effective policy allows (`cloudContent: full`); `metadata-only` sends names/hashes/sizes; local-only mounts send nothing but device-local status. This is enforced in the core, not the UI (D39/D37 alignment; CANON D39's language rule owned by product copy).

## 3. The tray experience (deliberately tiny)

Status window: `Spectra Bridge — Connected · Runs quietly on this device · Selected folders are available to Spectra`, list of mounts with per-mount state, pause/resume, a recent-activity line, open-logs, and version. That's it. Everything richer lives in the Spectra web settings (which drive the Bridge over the protocol). The tray must survive reboot (autostart), reconnect after sleep/offline automatically, and never show developer debris.

## 4. Protocol (browser ↔ bridge; versioned, typed)

`GET /v1/health` (unauthenticated: version, paired?, port) · `POST /v1/pair` · WS `/v1/session`:

- `mounts.list / mounts.add (opens native dialog) / mounts.remove`
- `tree.scan { mountId, cursor }` — enumerate with stable `localResourceId`s
- `file.read { resourceId, revision? }` / `file.stat` — streamed, size-capped, mount-scoped
- `file.write { resourceId | newFile, baseRevision, bytes/patch, idempotencyKey }` — §7 pipeline
- `fs.move / fs.rename / fs.delete { resourceId, idempotencyKey }` — only invoked by the policy engine, never directly by UI whims
- `watch.subscribe { mountId }` → debounced, revision-stamped change events
- `status.subscribe` → journal/queue/replica state for truthful UI
- Every mutating message carries an idempotency key; every response carries the journal op id.

Protocol version handshakes on connect; the web app refuses mismatched majors with a clear "Update Spectra Bridge" state (D14 honesty).

## 5. Watching and external-change detection

- Watcher: `notify` (ReadDirectoryChangesW on Windows) + periodic reconciliation scans (watchers lie; scans are the truth of last resort).
- **Stability window:** a change is a *candidate* until the file is quiescent (no writes for a debounce window, size stable, not locked). Office save patterns (write temp → rename over target; `~$` lock files present while open) are recognized explicitly: a revision is declared only after the lock clears or the rename lands. Never ingest a half-written file.
- Each stable revision gets: content hash, mtime, size, OS file id → journal row → reported to cloud as an **external revision** of the corresponding replica (`ahead`). Reconciliation (lens-level, ARCHITECTURE-FIDELITY §5) happens in the cloud/worker context, not in the Bridge — the Bridge moves bytes and truth, it does not interpret formats beyond hashing and packaging.
- Move/rename/delete detection per ARCHITECTURE-STORAGE §7.

## 6. The journal (SQLite, the Bridge's spine)

Tables: `resources` (localResourceId ↔ current path ↔ OS identity ↔ last hash/revision), `ops` (idempotencyKey, kind, state `intent → performed → verified | failed`, pre/post hashes, timestamps, error), `queue` (pending outbound/inbound sync work), `config` (device credential ref, mounts, protocol version).

Rules:

- **Intent before action:** every filesystem mutation writes an `intent` row first; crash recovery replays from intents (verify-by-hash makes replay idempotent, I3/I8 in ARCHITECTURE-STORAGE).
- The journal is the *only* memory the Bridge trusts across restarts. RAM state is disposable.
- Compaction: verified ops older than 30 days fold into per-resource checkpoints.
- The journal is diagnosable: `bridge logs` and the status window read from it; N12's chaos tests assert on it.

## 7. The write pipeline (native files are precious)

For every local write (Spectra → disk):

1. Preconditions: replica `baseRevision` matches the journal's last known revision of the file (else → conflict path, never overwrite); target not locked by another app (Office lock present → wait/queue, status `Syncing… (file open in Word)` — honest, calm).
2. Write to a temp file in the same directory → fsync → atomic rename over target (preserving attributes where the OS allows).
3. Read back → hash → compare → mark `verified` → report revision to cloud.
4. Any failure leaves the original untouched (the temp is discarded) and the op `failed` with a truthful status.
5. Deletes go to the OS recycle bin, not hard unlink, when policy-triggered.

**The Bridge never writes a file the lens layer hasn't produced through the preservation pipeline** (ARCHITECTURE-FIDELITY): it receives finished bytes + expected base revision, it does not synthesize content.

## 8. Materialization (cloud → local)

Creating a local replica for cloud-born work: policy names the location (explicit pick or the mount's `localMirrorRoot`); the lens/export layer produces the native package (or spectra-pkg); the write pipeline lands it; the journal adopts it as a resource. From then on it is an ordinary local replica. Reverse (local work gaining cloud replica) is the same machinery in the other direction. Neither direction ever forks identity (I1).

## 9. Failure recovery summary

Restart mid-write → intent replay. Offline → queue grows, statuses `behind/ahead`, reconnect drains with backoff. Cloud rejects a revision (someone else won) → conflict record, no local overwrite. Clock skew → revisions are opaque tokens + hashes, never timestamps for ordering. Disk full → op `failed: disk-full`, surfaced once, retried on space. Antivirus interference (file busy post-rename) → bounded retries with the file-busy honesty state.

## 10. What the Bridge is not

Not an Electron app hosting Spectra. Not a general local API for arbitrary web pages. Not an MCP server. Not a place where product/UI logic lives. Not a second sync brain — policy interpretation is server-side (I6); the Bridge executes scoped, journaled instructions and reports device truth.

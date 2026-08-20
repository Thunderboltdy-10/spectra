# ARCHITECTURE — STORAGE, IDENTITY, REPLICAS, ORGANIZATION

Durable reasoning for N1, N3, N5, N6 (and consulted by everything else). This document decides the data model; missions implement it. If implementation reveals a factual error here, fix this document in the same commit and note it in the mission log.

---

## 1. The logical work identity

**The existing `spectraArtifacts` row is the logical identity.** We do not create a parallel "workItems v2" table (CANON law 5). The identity is extended, never replaced:

- `_id` stays the stable identity forever: share links, embeds, references, history, threads, runs all keep pointing at it (D40).
- New identity-level fields (N1/N3 add incrementally):
  - `resourceClass`: `"artifact"` (deeply supported Spectra work) | `"resource"` (generic file: PDF, image, unknown — exists in Library, opens in preview/download, no fake Document JSON) | `"thread_reference"` (existing).
  - `nativeFormat`: `null` | `"docx"` | `"xlsx"` | `"pptx"` | `"spectra-pkg"` | `"binary"` | … — what the backing format is when one exists.
  - `compatibilityProfile`: `"strict-native"` | `"enhanced"` | `"spectra-native"` (D36). Default for mounted native files: `strict-native`. Default for born-in-Spectra work: `spectra-native`.
- Threads (`spectraThreads`) remain their own resource class but **participate in placement** (§3) via org nodes, exactly like artifacts.

**Invariant I1:** no operation — mount, sync, policy change, materialization, migration — ever creates a second logical identity for the same work. Duplicate-looking outcomes are bugs by definition.

## 2. Replicas

A logical identity has zero or more replicas. The browser/Yjs state is a *live representation*, not a replica row — it is ephemeral per session (plus the IndexedDB cache) and always reconciles into replicas.

New table `workReplicas`:

```
workReplicas {
  workId: Id<spectraArtifacts>,
  kind: "cloud" | "local",
  deviceId?: Id<bridgeDevices>,        // local only
  localResourceId?: string,             // Bridge-stable identity, NOT a path (§7)
  nativeFormat: string,                 // what bytes this replica holds
  payloadRef?: string,                  // cloud only: object-storage handle (§6)
  revision: string,                      // opaque per-replica revision token
  baseRevision?: string,                 // revision of the shared state this replica last agreed with
  contentHash?: string,                  // hash of the native bytes at `revision`
  state: "current" | "ahead" | "behind" | "diverged" | "pending" | "error" | "unavailable",
  lastVerifiedAt: number,
  error?: { code, message, at },
}
```

Meaning of `state` (these words back the user-facing status, §9):

- `current` — verifiably agrees with the authoritative shared state at `revision`.
- `ahead` — holds changes not yet reconciled into shared state (e.g. an external Word save just detected).
- `behind` — shared state has changes not yet applied here (e.g. Bridge offline).
- `diverged` — both sides changed the same regions; a conflict record exists (§8).
- `pending` — a write/apply is in flight (journal op open).
- `unavailable` — device offline, mount missing, drive gone. Not an error; a truthful fact.

**Authority model.** The authoritative *semantic* state of supported content is the Yjs/cloud collaboration state (exactly today's model — broadcast-first, Convex projection). Replicas are *materializations* of that state into bytes, plus the preserved native parts the lens carries (ARCHITECTURE-FIDELITY). For `resourceClass: "resource"` (no semantic model), the native bytes themselves are authoritative and cloud/local replicas synchronize bytes with revision checks.

**Invariant I2 (typing never waits, D20/D26):** the keystroke path is browser → Yjs → peers, exactly as today. Replica materialization is asynchronous, journaled, verified, and reported truthfully — never inline.

**Invariant I3:** every replica transition is recorded in the sync journal (§8) with an idempotency key. Replays are harmless.

### Legitimate configurations (all must work, D24)

- cloud only (all current Spectra work migrates to this)
- local only (Bridge replica, no cloud payload; cloud may hold *metadata/index only* per policy)
- local + cloud (bidirectional)
- linked-without-modifying (local replica marked read-only-at-source; Spectra edits accumulate as a pending overlay until the user applies or forks — the "protected original" workflow, N6)
- any of the above gaining/losing a replica later without identity change (F6 flow)

## 3. The organizational tree

New table `orgNodes` — one tree for the whole account (Library = the whole tree; a Workspace view = the subtree under a workspace node):

```
orgNodes {
  accountId,
  parentId: Id<orgNodes> | null,        // null = Library root
  kind: "folder" | "workspace" | "work" | "thread" | "link",
  name: string,                          // folders/workspaces; work/thread nodes derive name from source
  sourceId?: string,                     // work → spectraArtifacts._id, thread → spectraThreads._id,
                                         // workspace → spectraWorkspaces._id, link → target orgNode._id
  orderKey: string,                      // fractional ordering within parent
  workspaceContextId?: Id<spectraWorkspaces>, // denormalized: nearest ancestor workspace (null = General-scoped root)
}
```

Decisions (settled — do not re-litigate):

- **Single primary placement.** Filesystem semantics: a work/thread node exists in exactly one place. Cross-references are `link` nodes (also how a nested workspace appears inside another workspace's List — a link/entry, opening it switches context, D32). Migration converts multi-placements: most-recently-touched placement becomes primary; others become links.
- **Workspaces are nodes.** `spectraWorkspaces` keeps workspace-level state (context, sharing, policy defaults); its position in the tree is its `orgNodes` row. Workspaces can live at root, inside folders, or inside other workspaces (as independent contexts).
- **`workspaceContextId` is maintained transactionally** on every move so "which workspace am I in" is O(1) and Board/AI-context queries stay cheap. A nested workspace's own subtree carries *its* id, not the parent's (D32).
- **General** is a real, undeletable workspace created per account at migration. Everything currently unplaced migrates into it (threads included). New work follows D31: current workspace → AI-classified workspace → General. Never null.
- **Logical placement ≠ physical location (D27).** `orgNodes` never stores filesystem paths. The mapping from a local replica to a disk location lives in the Bridge journal + `workReplicas.localResourceId`. Mirroring policies (§5, N6) are the only coupling.

**Invariant I4:** moves/renames in the tree are metadata transactions — they never touch replica content, never close open surfaces (D40), and trigger physical operations only through the policy engine (§5) as separate, journaled, confirmable operations.

**Invariant I5:** cycles are impossible (`link` nodes may point anywhere; `parentId` chains are validated on move; a workspace node cannot be an ancestor of itself).

Deletion semantics: deleting a node soft-deletes (trash) with its subtree; replicas follow policy (cloud replica → trash retention; local files are deleted **only** under an explicit mirroring policy and confirmation — default is "unlink, leave the file"). Hard delete is a later explicit action.

## 4. Mounts and devices

```
bridgeDevices {  accountId, name, platform, publicKey/tokenHash, pairedAt, lastSeenAt,
                 state: "active" | "revoked" | "lost" }

bridgeMounts  {  deviceId, rootLabel, grantId,        // Bridge-side grant handle; server never sees raw paths
                 policyId,                             // default policy for the mount (§5)
                 state: "active" | "detached" | "revoked",
                 stats: { fileCount, lastScanAt } }
```

- A mount is a user-granted root folder on one device. Discovery under a mount follows policy (auto-include / ask / explicit-only).
- Revoking a mount or device: replicas under it become `unavailable`, never deleted; cloud/logical state persists; re-pairing can re-adopt via `localResourceId` matching (§7).
- "Device permanently lost": user marks device lost → its `local` replicas flagged; anything cloud-replicated is intact; anything local-only is honestly reported as unavailable-with-last-known-revision (no fake data).

## 5. Sync policy model (full UX in N6; the engine skeleton lands in N3)

A policy is a named object; nodes inherit from the nearest ancestor with an override. Precedence: **item > folder > workspace > mount > account default**. Every effective policy is explainable ("inherited from Physics IA — change here?").

```
syncPolicies {
  preset: "spectra" | "device" | "both" | "linked",   // the four human choices (D-simple face)
  contentDirection: "local→spectra" | "spectra→local" | "bidirectional" | "manual",
  discovery: "auto" | "ask" | "explicit",
  structure: "independent" | "mirror-to-disk" | "mirror-from-disk" | "mirror-both" | "ask",
  cloudContent: "full" | "metadata-only" | "none",
  localMirrorRoot?: grant handle,        // where cloud-born work materializes when policy says so
  filters: { include/exclude globs, per-subtree overrides },
  timing: "continuous" | "on-save-open" | "manual",
  protectedOriginal: boolean,            // pending-overlay workflow
}
```

Presets map to advanced fields; progressive disclosure shows the four choices first and the machinery only on demand: a human sees "Keep on this device + Spectra", never state vectors, adapters, tombstones, replica authorities or conflict clocks.

**Invariant I6:** the effective policy is computed server-side by one function used by UI, sync engine, Bridge, and AI actions alike. No surface hand-rolls policy interpretation.

## 6. Payload storage

- Native binaries/packages (cloud replicas of DOCX/XLSX/PPTX/spectra-pkg/resources) go through **one payload module** (`payloads.ts`, N3) with `put/get/head(hash)` semantics, content-addressed, refcounted — initially backed by Convex `_storage` (already used for assets; adequate at school scale), designed so R2/S3 can replace the backend without touching callers. Do not shove multi-MB binaries into ordinary Convex rows.
- Convex keeps: identity, tree, replicas, journal, policies, semantic projections (`content` as today), versions, conflict records.
- Yjs realtime state stays where it is (gateway/DO + `collaborationUpdates`/`collaborationSnapshots`).
- Previews/derived assets: existing `artifactAssets` path.

## 7. Local file identity (the move/rename problem)

The Bridge (see ARCHITECTURE-BRIDGE §5) assigns each discovered file a stable `localResourceId` and maintains the mapping in its SQLite journal using, in order: OS file identity (Windows: volume serial + file index / `FileId`), path continuity, and content-hash matching for adoption after moves that break both. Rules:

- Rename/move within a mount → same `localResourceId`, journal records the path change; Spectra placement unaffected unless a mirror-from-disk policy says otherwise.
- File disappears + same-hash file appears elsewhere in a mount within the scan window → treated as a move (adopt), recorded as such.
- Genuinely deleted externally → replica `unavailable` with reason `deleted-externally`; the user decides (restore from cloud/history, or accept removal). **Never** silently delete the logical work.
- OneDrive/Dropbox/Drive-desktop under a mount: detectable via reparse points/known roots — the Bridge flags "double-sync" mounts and the UI warns once, clearly; sync still works but conflict windows are honestly wider (N6 tests this).

## 8. The sync journal and conflicts

Two coordinated journals:

- **Bridge journal** (SQLite, local; ARCHITECTURE-BRIDGE §6): every intended and completed local filesystem operation, with idempotency keys, pre/post hashes, and crash-replay.
- **Cloud journal** `syncOperations` (Convex): every replica transition — direction, opId (same idempotency key as Bridge when applicable), revisions before/after, state `pending → applied → verified | failed | conflicted`, actor (user / AI runId / external-edit / reconciliation / migration / restore).

Conflict records `syncConflicts`: workId, replicas involved, region-level detail where the lens provides it (region ids / part names), the two revisions, resolution state (`open`, `resolved-merged`, `resolved-local`, `resolved-spectra`, `forked`). Conflicts surface per D26: precise, calm, actionable ("Word changed the bibliography while Spectra edited it — keep which?").

**Invariant I7 (no silent last-write-wins):** an `applied` that would overwrite unreconciled changes on the other side must instead produce `conflicted`. Provably disjoint regions merge automatically (lens-verified); everything else asks.

**Invariant I8 (verified means verified):** `verified` requires a post-write read-back hash match (local) or a payload head check (cloud). "Saved locally" in the UI binds to `verified`, not `applied`.

## 9. User-facing status (one vocabulary, product-wide)

Computed from replica states by one shared selector (used by artifact header, Library rows, Live Dock, AI context):

`Saved` (cloud-only current) · `Saved locally` (local verified) · `Synced` (all replicas current) · `Saving…` / `Syncing…` (pending ops) · `Offline · n changes` (behind/queued, count real) · `1 conflict` (open conflict record) · `Unavailable on this device` (mount/device gone). Hover discloses per-replica truth ("This device — Current · Spectra Cloud — Current · Last synchronized 8s ago"). No icon soup; no state the selector cannot prove.

## 10. Offline / multi-device matrix (behavior is settled here; N6 tests it)

| Case | Behavior |
|---|---|
| Cloud changes while device offline | local replica `behind`; Bridge catches up on reconnect via journal; conflicts only if local also changed same regions |
| Local file changes while Spectra offline | Bridge journals the revision; on reconnect it reconciles as an external transaction (D28) |
| Bridge restarts with pending writes | journal replay; idempotency keys make replays harmless (I3) |
| Browser closes mid-edit | Yjs durability as today (gateway/IndexedDB); replicas unaffected |
| Cloud op succeeds, local write fails | replica `error`, status shows truthfully, retry with backoff; never report Synced (I8) |
| Local write succeeds, ack lost | journal has post-hash; on replay, verification sees the file already at target hash → mark verified, no rewrite |
| Two devices hold local replicas | each is its own replica row; reconciliation is pairwise against shared state; same conflict rules |
| File moved while offline | §7 adoption on next scan |
| Folder renamed externally | children keep `localResourceId`s; mirror-from-disk policies propagate the rename; independent policies just update the journal |
| Mounted drive disappears | mount `detached`, replicas `unavailable`, zero data loss, calm status |
| Partially transferred large file | payload module uses content-hash finalize; partials never become a revision |
| Native file corrupted externally | lens open fails → replica `error: unreadable`; cloud/history intact; offer restore |
| Conflict during AI run | AI's op pauses (existing claims model), conflict surfaces, run reports honestly |
| Conflict during collaborator edit | same — conflicts are per-work, not per-actor |
| User revokes Bridge/permissions | §4 revocation semantics |

## 11. Migration plan (N1 does the tree; N3 does replicas)

1. **Tree migration (N1).** Create General per account. For each `spectraWorkspaceItems` row: create `work`/`thread` nodes under the workspace node (workspaces themselves become root-level nodes initially). Multi-placement → primary + links. Unplaced artifacts/threads → General. Old queries (`placements`, `placementStatus`) are replaced at call sites in the same mission; `spectraWorkspaceItems` is deleted after a verified cutover (dry-run on a copy first; count invariants: every artifact/thread has exactly one primary node; zero orphans).
2. **Replica migration (N3).** Every existing artifact gets one `workReplicas` row: `kind: "cloud"`, `state: "current"`, revision seeded from `contentHash`/version head. No payloads move; existing content is already the cloud semantic state. Native payload retention begins when lenses land (N4/N5).
3. **Settings migration (N2).** localStorage v2 preferences → Convex account preferences with device overlay; one-time client upload with merge; localStorage remains the offline cache.
4. Old routes/IDs: `/library/[workId]`, share links, embeds — untouched by design (identity never changes, I1).

## 12. Performance constraints

- Tree queries paginated + indexed by `parentId`; Library virtualizes rows; target: 10k nodes browsable without jank (N1 gate at 2k, N10 revisits at 10k).
- Replica/status selectors are subscription-driven, no polling beyond existing visible-only refresh patterns (M3 discipline).
- Journal tables are append-mostly with periodic compaction (verified ops older than N days fold into a checkpoint).

### The surface read contract (CANON D42 — binding on every consumer of this model)

Pagination in the API is worthless if the UI above it asks for everything anyway. So the contract runs both ways:

- **Surfaces consume windows only.** A list, board, grid or tree reads a page of `orgNodes` (or of work rows) bounded by what the viewport shows plus a margin, and requests the next page as the reader scrolls. No surface fetches a whole subtree, an account's whole artifact set, or "all work in this workspace" in order to group, filter, count or draw it.
- **Board is a windowed query per column, not a client-side regroup of everything.** Grouping is a server-side dimension: the board asks for *this column's* first page, ordered, and pages it independently. Changing the grouping changes the queries, it does not re-partition a fetched array. This is what keeps a board over a 250-item workspace as cheap to open as one over 12.
- **Counts are aggregates.** Column headers, folder row counts and badges read a count query. Fetching rows to display `rows.length` is forbidden — it is the most common way an unbounded read hides in a UI that looks paginated.
- **Switching views of the same scope costs nothing.** List and Board over one scope share the same windowed source and the same cache; a view switch is a re-render, never a re-fetch. A "slow to render" view is nearly always a view that is quietly re-loading data the other view already had.
- **The same rule holds for search.** Search returns a bounded, ranked page from the server; it never filters a client-side copy of the account.
- Every new surface built on this model records its first-paint request count and largest payload in its mission log (PLAYBOOK §5 bounded-read audit). Unbounded reads found in existing surfaces are defects to fix in the mission that touches them, not inherited behaviour to preserve.


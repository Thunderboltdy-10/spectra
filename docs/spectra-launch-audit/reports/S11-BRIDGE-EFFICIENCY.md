# S11 BRIDGE native efficiency baseline: source map

2026-09-26, owned checkout `34de/ai-school`, native source baseline `a68e9c48` with helper refactor `58f6b262`. **Source analysis only. No measured throughput, latency, memory, billing, or byte savings yet.** Shared executable lanes and native fixture access remain scheduled through RUNTIME. PERFORMANCE is independently preparing client/network/memory capture.

## Actual trigger and transfer paths

| Path | Current source behavior | Implication to measure |
| --- | --- | --- |
| Human editor | `artifact-studio.tsx` autosaves after 140 ms (420 ms with a conflict), then `syncLive` explicitly awaits `queueNativeMaterialization` after acknowledged Yjs synchronization | Sheets/presentations do have this path; the block-only catch-up key does not prove writeback is absent |
| Automatic catch-up | `artifact-native-sync.ts` separately invokes materialization after valid initialized live state is clean, synchronized, with no pending native activity/write | No separate trailing materialization debounce is present in this effect |
| In-flight/retry | Hook prevents overlapping calls for the same artifact; sends only action/artifact ID, without an AbortSignal; fences response UI by active artifact; retries at most eight times per content key | Measure calls after artifact switch and after edits during a materialization; do not confuse UI cancellation with server work cancellation |
| Live content key | `native-live-promotion.ts` serializes block IDs, text, and rich properties only; returns empty for sheet/slide collections | A catch-up/retry identity limitation requiring format-specific evidence; explicit human save path remains present |
| AI update | `act.ts beforeCommit -> native-ai-promotion -> materializeDocxArtifact/materializeOfficeArtifact` | Each call performs native work before the legacy canonical transaction; atomic preparation/admission is being replaced by the coordinated contract |
| Changed materialization | Fetch full source with `cache:no-store`, hash verification, open ZIP, mutate, hash output, reopen/readback plus package comparison, then upload | A tiny semantic delta can still cause a full source download and complete package upload |
| Unchanged output | Both materializers compare the generated package hash with the source hash and return after verifying readback | Avoids upload, but conversion/hash cost has already occurred |
| Node native upload | `native-payload-server.ts uploadNativePayload`: `payloads.issueUpload -> POST Buffer.from(payload) -> payloads.put` | The upload always happens before server deduplication |
| Server deduplication | `payloads.put` validates uploaded storage size/SHA-256, then account/hash lookup and active retained storage validation | Deduplicates retained payload identity, not the preceding network transfer |
| Bridge native upload | Rust `upload_resource_payload -> bridgeSync.beginPayloadUpload` validates an existing active same-hash payload and skips POST on a hit; `commitPayloadUpload` completes the binding | Exact full-package dedup before upload already exists in this direction; no part/chunk reuse is implemented here |
| Bridge native write | Worker checks source, downloads full requested payload, refreshes claim, performs safe staging/replacement/readback, then durable acknowledgement | Retrying an already-present exact target still traverses the download path; measure it before changing receipt recovery |

The queue/cloud helper extraction itself introduces no native conversion, payload fetch, upload, or polling loop. It is a transaction composition change. Full snapshots/materialization have valid retention and recovery roles; none of this proves a chunk protocol is the best next change.

## Watcher, feedback, and retry work

The mount watcher wakes every 250 ms. Default stability is 750 ms; provider/double-sync paths use two seconds. Before the stability deadline, matching size/mtime can defer another hash; the deadline still requires a fresh hash under a writer-exclusive reader. An OS content event invalidates the shortcut. A full repair walk is configured for six hours, with separate repair/backoff on unavailable watchers.

After stability, `enqueue_stable_change` acquires and hashes another stable snapshot to protect the handoff, then suppresses a new outbound report only when availability, path, content hash, and acknowledged revision all match. The same-byte feedback can therefore avoid a report/upload while still doing necessary filesystem/identity work. Discovery/upload also rechecks stable bytes before transfer. Do not eliminate these fences merely to reduce counted hashes.

The remote worker uses a 250 ms active interval, idle/failure exponential delay with jitter and a 15 s maximum discovery bound. The shared retry policy starts at one second, caps at 60 s with 20% jitter; mount repair uses five seconds to 15 minutes. `native_ack_queue` processes at most 100 due records per drain and increases attempts/availableAt on failure, without an automatic terminal attempt/deadline. This is bounded batch/delay, not bounded total retry work. Backend waiting-expiry behavior is still an open correctness and cost issue.

## Required controlled measurements

Only disposable native fixtures after RUNTIME freezes web/backend/gateway/Bridge revisions. Record fixture package size, authored JSON size, and semantic edit size, then capture:

1. One paragraph edit and one cell edit on representative large native files: conversion/open/hash/readback counts and time, source download bytes, upload bytes, queue/ack latency, peak process memory.
2. Same immutable package retry: Node upload bytes versus Bridge pre-upload dedup bytes; count actual requests and payload row reads separately.
3. Rapid edits within and beyond autosave spacing, edits while materialization is in flight, final remote edit, and artifact switch: final content/receipt correctness plus completed/cancelled conversion count.
4. Native same-byte save and genuine new save: watcher hash count, reported deltas, uploads, retry traffic, and Office readback.
5. Open idle document/sheet for a fixed interval: per-consumer Bridge health calls, subscriptions, remote poll traffic, CPU/working set, no accidental materialization loop.
6. Lost acknowledgement, Office lock, disconnect/reconnect, stale native base: retry duration/requests/bytes and preserved lineage; retained conflicts and errors must remain visible.

Collect cold and warm cases separately, with exact revision and fixture identity. Native package bytes and collaboration delta bytes are distinct columns. Report observed quantities first; any estimated billing is a separate calculation with assumptions.

Source findings justify testing pre-upload reuse through the existing retained payload lifecycle and materialization coalescing. They do not authorize removing validation, replacing current storage/providers, inventing diff savings, or claiming live acceptance.

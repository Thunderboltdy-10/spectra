# S9-DURABLE — large Office durable content

Date: 2026-09-23 (Europe/Madrid)

Branch: `main`
Status: **implementation complete; live acceptance pending**. This report records local implementation and deterministic checks only. It does not claim launch acceptance.

## Integrated implementation

The capacity foundation was integrated on main in `9aa76b15`, `7d5ce3b0`, `64a4bfb9`, `12d3813c`, and `ae480a67`. This pass adds `0ff1f359` (durable recovery, storage ownership, authorization, and regressions). The current main also retains the independently integrated gateway, Calendar, Keep-class, and formula-cache fixes (`5250792d`, `52ff743f`, `d7713584`, `fa72dc4a`). The remaining local gateway launcher change was reconciled: its shebang is retained and `.gitattributes` pins LF so the launcher works on Windows. Uncommitted W9 recovery/handoff notes were left untouched.

The root cause was a mismatch between accepted Office content and single-message/Convex bounds: a 200,000-cell workbook or formal paper could fit import parsing but exceed the 760 KiB durable append, projection, bootstrap, or snapshot envelope. Sheet arrays chunked inside one value did not make that value small. The integrated path keeps one logical artifact and the existing Yjs/ledger authority. Large updates and projections use immutable storage bodies referenced by bounded manifests, while small/legacy updates remain inline. Adopted bodies are complete and digest checked before a head or replay can use them. Oversized merged batches split or spill; checkpoints, saved versions, replay, AI writes, and native materialization resolve the same durable content references. Small Yjs edits remain deltas; an unchanged semantic projection no longer triggers a full-body durable acknowledgement.

This pass closes three recovery findings:

- **R1:** Both incoming reconciliation entry points distinguish provisional bootstrap from live/persisted remote changes. Legitimate shorter text, empty content, nontext changes, and local clears are accepted; stale/provisional hollow state still cannot overwrite a real head. The invalid Sheets head-heal and blanket Yjs hollow guard were removed.
- **R3:** The public content endpoint streams a bounded body to server storage, then a signed, actor-bound content attestation authorizes adoption. The internal mutation rechecks current artifact authority and policy epoch. Indexed ownership checks block cross-artifact/native/intake aliases during adoption and deduplication. Durable, native, intake, asset, replica-sweep, and bridge-upload cleanup retain storage until its last binding releases. Lost-receipt retry is idempotent even after a redundant upload was deleted.
- **R6:** Definite account, room, or artifact denial revokes a cached collaboration write grant. The quiet-connection sweep refreshes current actor authority even when artifact policy version has not changed. Transient transport failures keep their distinct retry behavior.

The append receipt is returned for already persisted sequence IDs before requiring a spilled body that may since have been compacted, but only after current authorization. Replay rejects missing, incomplete, wrong-digest, out-of-order, or wrong-generation data; manifest reads fall back to inline records only for legacy records without a manifest. Pinned versions and other owners retain referenced bytes through the existing ownership coordinator. No provider, retention policy, product control, or native identity changed.

## Automated evidence

All checks used local fixtures/packages; no shared stack, browser, live AI, or native Office application was started.

| Check | Result |
| --- | --- |
| Durable/recovery/checkpoint focused Convex tests | 38/38 passed after the final ownership fix |
| Replica truth/property tests | 47/47 passed |
| Durable capacity/replay, remote clears, import route, and 200k-cell Yjs fixtures | Passed in the 28-file suite; exact multibyte bounds, incomplete adoption, small distant edits, replay, and first/middle/last values covered |
| Broad relevant Vitest suite | 27/28 files, 430/431 tests passed. One unchanged Sheets microbenchmark asserted `<40 ms` and measured 58.6 ms under parallel suite load; its complete file passed 77/77 in isolation. The threshold was not weakened. |
| TypeScript `tsc --noEmit` | Passed after the final change |
| `npm run lint` | Passed; final touched files also passed focused ESLint |
| `npm run check:capabilities` and `npm run check:architecture` | Passed |
| `git diff --check` | Passed |

There is no known implementation blocker. The parallel-load microbenchmark result is a test-run limitation, not evidence of a functional failure or a verified latency target. No live latency, transfer-byte, or native fidelity claim is made here.

## Deferred live acceptance

These finite tests remain from the original prompt and require a separately authorized live run:

1. On copies of the actual 200k-cell workbook and 695-equation paper, open, edit a distant cell/formula/style and equation/text, save, reload, reconnect, and read a saved version. Check first/middle/last cells, cached-formula truth, unchanged OMML/styles/media/relationships, and native materialization/reopen.
2. Use two ordinary sessions on separate disposable artifacts and two sessions on one deliberate shared artifact for disjoint edits/rebase. Force one lost receipt and one gateway restart after durable commit; verify single convergence, truthful unsynchronized errors, and small-edit transfer bytes.
3. Apply one real AI edit to a large work item, then verify its exact durable version and native result separately.
4. Pin a large version, delete its source, release owners in sequence, and verify retention followed by final-owner garbage collection.
5. Record cold/warm open, save, and reload latency plus read/write/transport bytes for both fixtures; compare full import against small edits without an SLA or cost claim.

Rollback is by reverting the integrated implementation commits together; existing small/legacy inline records remain readable through the no-manifest fallback. A manifest-bearing record requires the digest-verified resolver and must never be treated as an inline fallback when incomplete.

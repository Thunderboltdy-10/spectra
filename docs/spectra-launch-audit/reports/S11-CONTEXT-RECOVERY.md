# S11 CONTEXT recovery and retrieval closeout

Date: 2026-09-27. Owner: `01a0e28b-77e9-7ae1-a0e7-47ccb36c665b`.
Owned checkout: `<local-workspace>`, branch `codex/s11-context-retrieval`.

## Recovered state

Recovered a clean `240a4c88` checkout and read the predecessor's actual interrupted turn `01a0dda9-7edb-7e11-a466-8ed0d3862dea`, earlier completed semantic handoff, and saved test logs. The new session's actual `turn_context` records `gpt-6-astra`, `xhigh`, `danger-full-access`, approval `never`; the default primary directory was not used for project commands or edits. The original user brief and September 27 finish-and-integrate steering were read through the prior coordinator. Final launch verification is deferred.

Existing candidates recovered for focused validation:

- `d1a63a37`, `b8b3aba8`, `e87637a7`: bounded versioned semantic memory and asynchronous embedding jobs, plus stale-job and content-change guards.
- `240a4c88`: indexed exact-thread history search and revision-checked message chunks.
- `6121ce48`: compact orientation references the authenticated restored request rather than an older shortened excerpt.
- `1ec55e6b`: isolated nullable evaluation guard in the actual Foundry intake caller.

Earlier authority/orientation/routing results are recorded in their original reports. The saved 121-case run initially had 17 fixture-hook failures; the separate 18-case routing rerun passed after fixing the hook. Those logs remain intact. Neither that earlier result nor the old synthetic provider measurement validates the new semantic candidate.

## Finished scope

Conversation discovery now uses `spectraThreads.search` to search the existing title field, filtered by authenticated owner, current school, active/archived status and optional primary workspace. It returns up to sixteen compact references per page, defaults to eight, and exposes a continuation cursor bound to the same actor/query/scope. It reads neither message bodies nor related artifact/workspace records. Current school membership and ownership are rechecked on every invocation. Deleted threads are excluded. Workspace membership does not grant access to another person's private conversation.

The additive `spectraThreads.search_title` index is maintained by Convex from existing rows. No new message copy, job, writer hook, custom backfill or persistent cache is introduced. Index maintenance has storage/write cost; it is not free. The endpoint reads the canonical thread row, which may contain `summaryLong`; a small returned tool payload is not proof that the underlying row is small. The focused ledger distinguishes returned database rows/bytes from the compact tool response and does not measure physical index reads, billing or production latency.

This is literal title discovery followed by literal full-history search and exact message chunks. It is not general semantic indexing of artifact bodies or conversations. Learned semantic retrieval applies to memory claims only. No keyword dispatcher or compulsory context stage is added to ordinary chat.

## Shared caller contracts

ENGINE-R owns `plan.ts` and the application tool schema: `read_thread` chronological cursor, query/search cursor, exact message/revision/offset; whole-query `retrieve_memory` forwarding and truthful retrieval status; optional typed `search_objects` conversation discovery. DATA-R2 owns artifact/workspace actor-graph discovery. These owners received the exact backend contracts directly. Source-only backend success does not establish the live AI journey.

Orientation prerequisites remain `c965e77a`, `5a08779d`, `6121ce48` (with `6f8167ab` historical test hook). Exact `spectraContext.getArtifact` / `getWorkspace` reads authorize through centralized authority; model-provided IDs and summaries never confer access. The restored-goal packet points to the full authenticated current user request. ENGINE owns its activation and final exact-target hydration.

## Focused validation

Pending the RUNTIME-R2 guarded lane. Prepared scope: `memory-retrieval.test.ts`, `memory-embeddings.test.ts`, `memory-embedding-provider.test.ts`, `spectra-thread-retrieval.test.ts`, and `gather-orientation.test.ts`, followed by scoped lint/type diagnostics. Provider calls are mocked in these tests. No service starts, backend publication or user-file mutations are included.

## Deferred final verification prompt

On the coordinator's frozen integrated revision, inspect the exact integration hashes and run reports first. Use the existing saved local database and isolated S9-OFFICE runtime only through RUNTIME; preserve original files and school data. Verify both memory and thread search indexes are ready. With disposable conversations, discover an old title beyond the recent page, search for an old decision beyond the first 3,000 characters, page chronological history and reconstruct a long message using its revision. Replace the message, archive/delete the thread, switch school/actor, or revoke source access between pages and confirm denial or `message_changed`, never mixed revisions. Exercise the actual `search_objects` -> `read_thread` tool path and retain returned IDs/cursors and final response evidence.

Confirm greetings and ordinary factual questions invoke no mandatory memory/catalog/provider retrieval, while a contextual request can deliberately retrieve older evidence. Run the frozen expanded semantic corpus with fixed labels and approved provider bounds; report recall, inappropriate-memory use, zero-applicable cases, negation/dates/bilingual cases and main-model selection separately from raw nearest-neighbor ranking. Do not install a threshold from the tiny historical corpus. Measure cold/warm query latency, exact query-cache isolation/hits/expiry, returned database rows/bytes, scheduler/claim writes and embedding queue throughput. Exercise stale leases, source revoke/regrant, correction/forget, provider timeout/rate limit and delayed completion. Confirm returned candidates are not recorded as evidence actually used without a separate use signal. Report production/index/provider limitations and artifact-body semantic indexing separately; do not label this source candidate launch-ready.

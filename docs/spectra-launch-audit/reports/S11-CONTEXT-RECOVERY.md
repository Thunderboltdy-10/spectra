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

**90/90 tests passed across five files at product head `807091cb`, September 27. Scoped ESLint passed with zero warnings.** The coordinator temporarily owned dispatch and granted lane 1 after PRESERVATION released it. Tests completed in 5.35 seconds; lint completed in approximately five seconds. Both phases ran serially with one worker, no file parallelism, a 4 GiB heap cap, inherited `NODE_OPTIONS` plus the preserved `2b0f` filesystem guard, and checkout-local cache/temp paths. No executable remains running. No transitive typecheck, provider experiment, service start, backend publication or user-file mutation was performed.

| File | Cases passed |
| --- | ---: |
| `convex/memory-retrieval.test.ts` | 31 |
| `convex/memory-embeddings.test.ts` | 23 |
| `convex/memory-embedding-provider.test.ts` | 17 |
| `convex/spectra-thread-retrieval.test.ts` | 9 |
| `src/app/api/spectra/run/loop/gather-orientation.test.ts` | 10 |

All provider calls in this group were mocked; the missing-key startup notice is not live-provider validation. The first command stopped before running tests because Vite's runner config loader does not inject `__dirname` into the repository's imported config. Only the ignored private wrapper was corrected to reproduce the repository test settings with explicit paths. `recovery-tests-initial.log` retains that startup failure; `recovery-tests.log` contains the successful five-file run and measurements; `recovery-lint.log` records the successful, silent lint phase. All are under `.spectra-local/launch-s11/context/`. Original predecessor failure logs remain intact. Product source needed no correction during this run.

| Synthetic comparison | DB calls | Returned documents | Serialized returned bytes |
| --- | ---: | ---: | ---: |
| One relevant memory with 1 versus 301 total claims | 11 | 7 | 2,893 |
| One history hit with 1 versus 301 messages | 5 | 5 | 1,296 |
| One title hit with 2 versus 302 conversations | 4 | 4 | 22,120 |
| Authored memory behind 21 versus 221 evidence records | 22 | 22 | 9,492 |

Each row had identical result and ledger across its two corpus sizes. The title fixture deliberately carries a large `summaryLong`, illustrating the real canonical row cost even though the tool omits that summary. These measurements are returned JSON row bytes, not physical index scans, network traffic, cache hit rate, production latency or billing. No broader rerun is implied.

## Exact candidate dependencies and handoff

- Semantic production: `d1a63a37` then `b8b3aba8`; regression follow-up `e87637a7`. Integrate together with their additive schema/index changes and previously integrated current-source authority helpers. The full proposal/history commits are not runtime prerequisites.
- Thread production/tests: `240a4c88` then `807091cb`. These are independent of semantic memory; the second uses the revision helper introduced by the first. Both message-content and title search indexes must be ready before live validation.
- Restored orientation: `6121ce48`, on top of `c965e77a` and `5a08779d`; previously documented validation fixture fix `6f8167ab` remains appropriate. The restored-goal regression now passes.
- Isolated intake nullability: `1ec55e6b`; no semantic-memory dependency. Scoped lint passes; transitive typecheck remains intentionally deferred.

The exact new discovery contract is `spectraThreads.search({query, cursor?, limit?, workspaceId?, status?: "active" | "archived"})` -> `{results:[{type:"thread", id, title, summaryShort?, status, updatedAt}], nextCursor, complete, searchMode:"title"}`. It defaults to active threads and eight results, caps at sixteen, and filters only the primary workspace when supplied. `searchMessages` accepts `cursor`; chronological `listMessages` accepts `before`. `readMessage` requires `revision` for nonzero `offset` and returns `message_changed` when content differs.

No remaining source blocker exists inside this owned backend unit. ENGINE's actual tool adapter, DATA's artifact/workspace discovery integration, coordinated index readiness and final live verification remain separately owned integration prerequisites. The focused backend/orientation checks do not establish that a served AI completed the cross-thread journey or used the returned memories appropriately. The lane is released with the consolidated coordinator handoff; no further scope expansion is planned.

## Deferred final verification prompt

On the coordinator's frozen integrated revision, inspect the exact integration hashes and run reports first. Use the existing saved local database and isolated S9-OFFICE runtime only through RUNTIME; preserve original files and school data. Verify both memory and thread search indexes are ready. With disposable conversations, discover an old title beyond the recent page, search for an old decision beyond the first 3,000 characters, page chronological history and reconstruct a long message using its revision. Replace the message, archive/delete the thread, switch school/actor, or revoke source access between pages and confirm denial or `message_changed`, never mixed revisions. Exercise the actual `search_objects` -> `read_thread` tool path and retain returned IDs/cursors and final response evidence.

Confirm greetings and ordinary factual questions invoke no mandatory memory/catalog/provider retrieval, while a contextual request can deliberately retrieve older evidence. Run the frozen expanded semantic corpus with fixed labels and approved provider bounds; report recall, inappropriate-memory use, zero-applicable cases, negation/dates/bilingual cases and main-model selection separately from raw nearest-neighbor ranking. Do not install a threshold from the tiny historical corpus. Measure cold/warm query latency, exact query-cache isolation/hits/expiry, returned database rows/bytes, scheduler/claim writes and embedding queue throughput. Exercise stale leases, source revoke/regrant, correction/forget, provider timeout/rate limit and delayed completion. Confirm returned candidates are not recorded as evidence actually used without a separate use signal. Report production/index/provider limitations and artifact-body semantic indexing separately; do not label this source candidate launch-ready.

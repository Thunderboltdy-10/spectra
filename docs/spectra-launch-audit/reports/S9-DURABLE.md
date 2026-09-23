# S9-DURABLE — large Office durable content

Date: 2026-09-23 (Europe/Madrid)
Branch: `main`
Implementation source: `2532be1eeaf9851fe95c99ebc6ed1dc04cb0c409`
Status: live acceptance completed with the two bounded limitations in cases 4 and 6 below.

## Source and runtime

The local stack served the source now committed as `2532be1e`. It ran on existing local instance 1 at `http://localhost:3000` with Convex at `http://127.0.0.1:3002`, deployment `local-pablo_md-ai_school-2`, and the existing 7.27 GiB database. Startup guidance was checked; the saved-local-Convex launcher fix was retained. The same stack was stopped and recovered in place to sync the current local functions. No database reset, second stack, worktree, production/provider/billing change, Action, external message, or edit to the original IBDP1 files occurred.

Profile A was the ordinary authenticated actor. The existing Bridge and live configured OpenRouter route were used. The disposable copies and detailed raw evidence are under `.spectra-local/launch-audit/fixtures/S9-DURABLE-20260923` and `.spectra-local/launch-audit/evidence/S9-DURABLE-20260923`. The uncommitted W9 recovery and handoff files were left outside this commit.

## Repairs exercised by acceptance

- Large import bodies use the configured 256 MiB local Next request limit and bounded content adoption. The durable body stays immutable, digest checked, and behind the existing artifact, Yjs, and ledger authority; small cell changes remain deltas.
- Large DOCX projection/materialization carries unchanged native parts. The no-op Word carry path, equations, media, relationships, and unmodeled parts remain intact.
- AI preview staging omits the full sheet body for large workbooks. A cell-sized AI change then uses the same durable artifact update path.
- Generated sheet row/column identities are treated as cell edits where appropriate, so distant AI changes do not claim the whole sheet structure.
- The focused tool schema now requires `fulfillsRequest: true`; stale route-test responses were updated to match.
- The live deletion retry exposed that Convex's scheduled runtime has no Node `Buffer`. Intake cursors now use the existing runtime-safe base64url codec, and pinned cleanup reads only the exact pinned versions/builds instead of scanning all large history.

These repairs do not change retention policy or native identity. The saved local Convex launcher and gateway source were restored after fault injection; `scripts/collaboration-gateway.mjs` has no diff and `.convex-self-hosted.env` is absent.

## Live cases

| Case | Result | Evidence |
| --- | --- | --- |
| Large workbook and paper copy: import, distant edits, save/reload/reconnect, saved-version and native readback | **PASS**, with formula-cache observation below | Artifacts `wx79w21ehqg5c215fp1gmbjpbn8ew8pw` and `wx71v7ca2ks7pmt59gxswwq0f58exg5f`; workbook version 17 `ws7cdfz1a14vne20vwvpy18fad8ey40k`; paper version 7 `ws74fvms13dp4deqddy6pq6jys8ey230` |
| Two sessions, disjoint edits to one shared artifact, lost receipt and restart after durable commit | **PASS** | Sessions `s9-durable-a3` and `s9-durable-b2`; shared artifact above; B2 client `c2d4bf13-aaaf-435f-a494-3c7368bff34d` |
| One actual AI edit of a large workbook through durable commit and separate native check | **PASS** | Runs `wh788ne8k2fsn04c7g1pgbrayx8ezhg3` and `wh7b86gwzkvshz8fdkr1v8x94x8ezqja`; canonical versions 13 and 14 |
| Large pin, source deletion and ordered owner release | **PARTIAL** for elapsed-time physical GC; live pin retention and release sequence passed | Pins `m573f78ecn0vhz6r7deff4v9pn8ez0e3`, `m57farfpzdc6wcv5hc2kvsse9d8ey05b`; deletion generation 2 job `g57gy5efqw944qr74gzpgg0t318eze7c` completed |
| Cold/warm latency and read/write/transport bytes; small edit transfer | **PASS** | Browser instrumentation and request-body captures in the evidence directory |
| Shorter and empty live remote changes; deactivated-actor revocation | **PASS** for live shorter/empty changes; **NOT RUN** as a browser case for revocation | Live changes produced workbook versions 15–17. Deterministic revocation test passed; no safe disposable authenticated actor/deactivation control was available |

### Workbook copy

The input was `S9-DURABLE-workbook.xlsx`, 1,126,377 bytes, SHA-256 `210d7c04ce517913f5099c2e717d8c90f425e6b192e8c14a65746699c6c1dbc7`. Its `Density` sheet contained 200,000 cells, 10,000 rows, and 20 columns at baseline. The final canonical durable payload was 43,680,686 bytes and the reopened native XLSX was 1,119,772 bytes.

The edit pass wrote `T9999 = 1+2`, bolded `S5000`, wrote the last-row marker in `T10000`, and exercised other distant cells. After reload/reconnect, saved version 17 readback and Excel COM reopening agreed on `A1 = 1`, `J5000 = 50000`, `T10000 = S9_DURABLE_LAST_20260923`, and bold `S5000`. Excel 16.0 opened the native file read-only with 10,000 used rows, 23 used columns, 200,003 populated cells, and formula `=1+2` at `T9999`; Excel calculated its value as `3`.

The original workbook had zero formula cells and zero styled cells, so there were no pre-existing formula results or styles to compare. The durable canonical readback retained the cell's prior scalar `199980` alongside the edited formula until Excel recalculated it on native open. The native materialized file clears formula caches and requests full calculation on load. This cache distinction is recorded rather than presenting `199980` as the result of `=1+2`. The native workbook kept two relationship files and removed no package parts; it added `xl/sharedStrings.xml` for edited text. Workbook media count was zero in the input and output.

### Paper copy

The input was `S9-DURABLE-paper.docx`, 1,302,028 bytes, SHA-256 `fcc1d714d1e5049231ada7335a5ab7231757f2fc161891baab53791e2fba3df7`. In the disposable copy, equation block 957 became `\begin{pmatrix}a+b+0 \\ a\end{pmatrix}.` and the text marker `[S9-DURABLE-text-20260923]` was added. Saved version 7 returned HTTP 200 and 1,975,987 response bytes in 281 ms.

Microsoft Word 16.0 reopened the materialized copy read-only: 45 pages, 1,117 paragraphs, 7 tables, 1 inline image, and 695 equations. The edited equation and text marker were present; first, middle, and last equations remained readable. The native DOCX was 1,291,674 bytes with 18 package parts and 3 relationships. Only `word/document.xml` changed; the other 17 parts and all relationship hashes matched. The original media image remained 1,186,444 bytes with SHA-256 `0dbc53914a87cfcf5d788fe935ec56095b2da2960bf3f1fb1d6f01ed9e0e0858`. Equation count remained 695; no package parts or relationships were added or removed.

### Shared edits and live recovery faults

The two headless Profile A sessions edited separate distant cells on the same artifact: A3 wrote `U10000 = S9_DURABLE_SHARED_A_20260923`; B2 wrote `V10000 = S9_DURABLE_SHARED_B_20260923`. One durable receipt was deliberately lost. For the second fault, the gateway was restarted after the durable commit and before receipt delivery. Reconnect/retry converged on both markers; each appeared once in the saved/native workbook. No duplicate effect or lost disjoint edit remained.

Live remote content transitions exercised on `O10000` were `S9_DURABLE_SHORT_20260923`, empty via the ribbon's **More sheet tools → Clear contents**, and restore to `S9_DURABLE_DIGEST_HANDSHAKE_20260923`. Session A3 observed each shorter/empty/restored change without reload; version 17 retained the restored value. Typing an empty string into the formula bar did not durably clear the cell; the explicit Clear contents command did.

### Actual AI edit

The configured live model `openai/gpt-5.6-luna` (OpenAI provider) performed actual cell edits on the same 200k-cell workbook. Run `wh788ne8k2fsn04c7g1pgbrayx8ezhg3` wrote `N10000 = S9_DURABLE_AI_20260923` and persisted canonical version 13 (`ws78786556ek76jrs301ebbr018ez2p8`). Run `wh7b86gwzkvshz8fdkr1v8x94x8ezqja` wrote `W10000 = S9_DURABLE_AI_PREVIEW_FIX_20260923` and persisted canonical version 14. Excel's separate native reopen confirmed both markers. An earlier attempt exposed a full-workbook body being sent to AI preview staging; the corrected path omitted that full body and the live run completed through durable commit.

### Retention and cleanup boundary

Two authenticated pins referenced workbook version 17 from disposable paper container `wx71v7ca2ks7pmt59gxswwq0f58exg5f`. After deleting the source, the first pin still projected `ready` with `sourceUnavailable=true`; after releasing the final pin, the version/snapshot projection disappeared. The first deletion job `g57w3p3gf37m1kyjth0jgw7p4x8ey2mg` exhausted six attempts in intake. The local Convex runtime failure was `Buffer is not defined`; bounded pinned-version reads alone were not sufficient. After the cursor-codec fix, generation 2 job `g57gy5efqw944qr74gzpgg0t318eze7c` completed: 143 rows deleted, 0 retained rows, 1,126,377 original import bytes released. The source artifact and pinned version rows are now absent.

The workbook body is still active at 43,680,686 bytes because valid journal/snapshot ownership remains: two `changeGroups` owners (`ns712yws6gs4xy3caqz4kj6ngs8eybda`, `ns7daxqhmwp67weab8get0tkdx8ez54q`) and one `artifactSnapshotObjects` owner (`md70r0s278vyptcyrnd4dxfhxd8ezypk`). The 1,119,756-byte native base is also retained. This is safe retention, not completed physical GC. The configured 24-hour `PAYLOAD_RELEASE_GRACE_MS` was not changed, and 24 hours were not allowed to elapse. Focused deterministic tests prove owner-by-owner retention and final release by simulating age (`createdAt = Date.now() - PAYLOAD_RELEASE_GRACE_MS - 1`); that is simulated expiry, not elapsed live time.

### Latency and transfer measurements

| Measurement | Cold | Warm/repeated |
| --- | ---: | ---: |
| Workbook open/reload to grid plus settle | 13,142 ms | 12,859 ms |
| Instrumented HTTP | 143 requests; 30,417,602 response bytes | 15 `/api/spectra` GETs; 974,638 response bytes |
| Collaboration WebSocket | 67 sent frames / 15,122 bytes; 28 received / 651,517 bytes | 26 sent / 6,186 bytes; 13 received / 34,867 bytes |
| Realtime socket | — | 5 sent / 1,916 bytes; 1 received / 71 bytes |

The initial workbook upload was 1,126,377 bytes. Before the preview/delta repairs, a small edit posted approximately 43,680,379–43,680,409 bytes. Afterward measured small cell-edit requests were 72–77 bytes and did not call `/api/spectra/content` with the full artifact. The full durable workbook body was read for saved-version/native materialization as expected; the measurements above do not claim an SLA or cost target.

## Automated checks and remaining limits

Final affected suite: 12 files, 161 tests passed, including durable recovery/ownership, retention, DOCX/XLSX, content upload, native promotion, and run routes. The first run exposed two stale `propose_operation` test responses missing the now-required `fulfillsRequest`; those fixtures were corrected and the complete `run-route.test.ts` file then passed 36/36. Final `npx tsc --noEmit`, `npm run lint`, `npm run check:capabilities`, `npm run check:architecture`, and `git diff --check` passed.

An earlier broad parallel suite run was 27/28 files and 430/431 tests: the unchanged Sheets microbenchmark measured 58.6 ms against its `<40 ms` threshold under suite load; that file passed 77/77 in isolation. This live acceptance reran focused changed/direct-neighbor files, not that entire broad suite.

Deactivated-actor revocation is covered deterministically by `convex/durable-recovery.test.ts` (“revokes a deactivated actor's cached grant even with an unchanged artifact policy”), including denial and the quiet-sweep 4403 close. It was not performed in a browser: Profile A must remain active, and no dedicated disposable authenticated actor plus supported live deactivation control was available. The live shorter/empty remote changes did pass.

Moderate UI follow-ups for S9-OFFICE review: the **Export Excel copy** click was intercepted by a workbar overlay, while keyboard focus plus Enter succeeded; the blank formula-bar behavior above may also deserve clearer empty-cell clearing guidance. Impactful review targets are the large-body upload/preview boundary, canonical-vs-native formula cache behavior, structured Yjs cell-vs-structure classification, DOCX no-op package carry, AI durable staging, and Convex runtime-safe deletion cursors. No remaining live failure is hidden by a **PASS** label.

## S9-OFFICE follow-through — 2026-09-23

The S9-OFFICE acceptance saved academic edits on a disposable 695-equation paper but received a protected-part refusal when materializing that combined edit set. It completed Word edit/reimport, a live AI footnote save, Open XML validation, and a Word reopen on a smaller combined academic fixture. The materialization refusal and its boundary are detailed in [S9-OFFICE](S9-OFFICE.md). The equation/text native roundtrip documented above remains an independent S9-DURABLE case.

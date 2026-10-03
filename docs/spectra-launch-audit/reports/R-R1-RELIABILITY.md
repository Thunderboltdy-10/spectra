# R1 — Reliability lane report

Lane R1 closed the open non-AI issues from the live verification. Work was done on `main` in the primary checkout, one
issue per commit, on top of `b62627b5`. Nothing was pushed. Every fix has a regression test that fails on the prior
code, and each passed both `tsc` configs, `npm run lint` and the five `check:*` gates. Every issue was rechecked live on
local instance 8 unless noted. Ledger entries in [`LIVE-ISSUES.md`](../LIVE-ISSUES.md) are set to **FIXED**; only the
verifier sets VERIFIED.

## Fixes

| Issue | Commit | Root cause, in one line |
| --- | --- | --- |
| LV-017 | `51d67062` | The gateway Dockerfile's COPY list omitted two shared runtime modules. |
| LV-062 | `fdcfcf4c` | A Convex nesting rejection escaped an un-awaited `onStateless` and killed the gateway every ~38 s. |
| LV-059 | `024b5cde` | The shell showed an empty busy div, with no message or retry, while Clerk or the account stalled. |
| LV-066, LV-067 | `eae0d851` | A Code collaborative save wrote metadata only, never the file structure. |
| LV-060 | `c57ef0e8` | Timed blocks filled the column, so overlapping blocks covered each other. |
| LV-069 | `fdccb829` | The stale-gesture notice came after the reload, from two paths with different copy. |
| LV-061 | `cefef83d` | A small but deep Word projection went inline to the native commit and broke the nesting limit. |
| LV-068 | `656e1676` | The side-panel quiz workbar had no Add question binding. |
| LV-028 | `5d603a77` | Decision: keep Mod+K; the help omitted it and the audit script expected the wrong key. |
| LV-003 | `f97645c7` | Decision: the preview threw for unusable links, which the route turned into 404 or 410. |
| LV-012 | `f77efa73`, `d88c9691` | Decision: every surface probed Bridge health on mount, on focus and every 15 s, even on unpaired devices. |
| LV-046 | `3fd448d9` | The Library parked its replica snapshot while a write was still waiting for Office. |

Ledger: `2f37866d`.

### LV-062 — realtime failures (High)

- **Root cause.**
  - The gateway process exited about every 38 s.
  - A Bridge-linked DOCX sits exactly at Convex's 16-level nesting limit. Each durable append embedded it one level
    deeper in a `changeGroups` snapshot, so Convex rejected the row.
  - The rejection reached `onStateless`, which Hocuspocus does not await. The unhandled rejection killed every room.
  - Clients then reconnected and the loop repeated. That loop is the "realtime connection failure" seen on Library,
    Quiz, deck, Plan and Code.
- **Fix.**
  - `onStateless` reports the failure to the one peer and does not reject.
  - `shared/convex-nesting.mjs` measures nesting the way Convex does.
  - Snapshots that are too deep are left out of change groups, kept off version rows, or stored as JSON text.
  - Content that is too deep travels by reference, the same way oversized content does.
  - The native commit paths now fail with a worded `*_SNAPSHOT_REQUIRED` error. This touched
    `convex/nativeAiCommit.ts`, an error string only.
- **Tests.** `scripts/collaboration-deep-content.test.mjs` and the persistence-window regression.
- **Live.** With the deep DOCX open for over a minute, the gateway PID did not change. The log had 0 "too nested" lines
  and the console had 0 errors.

### LV-059 — blank routes (Blocker)

- **Root cause.** A plain web restart did not reproduce it: two restarts rendered normally. Blocking the Clerk script
  reproduces it exactly, because the shell gated all content on Clerk and the account record behind an empty
  `aria-busy` div.
- **Fix.** The shell now waits through `AccountConnectionState`:
  - it stays quiet for 1.5 s, then says it is connecting;
  - a failed load shows an error with Try again at once;
  - a load still stalled after 15 s shows Try again too;
  - sign-in and sign-up show the same placeholder.
- **Test.** `account-connection-state.test.tsx`.
- **Live.** After full restarts, every route rendered with 0 console errors.

### LV-066 and LV-067 — Code New file and Rename

- **Root cause.** Code text is bound to Y.Text. The metadata save (`replaceMetadataSnapshot`) wrote only the title,
  summary and tags.
- **Fix.**
  - A new `CodeYjsAdapter.applyStructure` writes the file structure without replaying existing text. It covers files
    added, removed, renamed and reordered, plus project settings.
  - Format now also writes through the shared Y.Text.
- **Test.** The `native-yjs-models.test.ts` case for a metadata-only create and rename.
- **Live.** `src/r1-check.js` was created, then renamed to `src/r1-renamed.js`. Both changes survived a reload.

### LV-060 and LV-069 — Calendar (behaviour only, no restyle)

- **LV-060.**
  - `calendar/domain/timed-lanes.ts` lays overlapping blocks side by side.
  - Tests: `calendar-timed-lanes.test.ts` and a component test that every block in a shared slot stays clickable.
  - Live: the 16:00 deadline and "Maths Unit 7 Test" each open.
- **LV-069.**
  - One toast id and one sentence, announced before the reload, from both gesture paths.
  - Test: the component test holds the reload request open and expects the toast to be showing already.
  - Live: 2 of 2 stale drags showed the notice about 200 ms after the 409.

### LV-061 — DOCX Lens 400

- **Root cause.** The 400 sat next to "Document is too nested (17 > 16)" in the stack log. The version write of the
  native reconciliation received a small but deep projection inline.
- **Fix.** `storeCommitContent` spills content to a durable reference when it is too large **or** too deep.
- **Test.** A case in `native-reconciliation-server.test.ts`.
- **Live.** Reopening DOCX `z97btek17vgv6dw3708grawynd8fgfeh` gave two `lenses/docx` 200 responses and 0 errors.

### LV-068, LV-028

- **LV-068.**
  - When the question rail is hidden, the workbar adds an essential "Add question" binding, with a capability entry.
    The workbar is not otherwise restructured (lane D4).
  - Test: `quiz-studio-panel-add.test.tsx`.
  - Live: 3 → 4 questions, and Undo returns to 3.
- **LV-028.**
  - The shortcut help lists Mod+K, and the P3-WORKSPACE-FLOWS expectation is corrected.
  - Test: `keyboard-shortcuts-help.test.tsx`.
  - Live: Ctrl+K opens the command bar, and "?" shows both rows.

### LV-003 — invitation preview outcome (decision)

- **Fix.**
  - `previewInvitation` returns `{ outcome: "unavailable", reason, message }` in four cases: an unknown link, a revoked
    link, an expired link, or an inactive school. It otherwise returns `{ outcome: "available", ... }`.
  - Authentication still throws. `acceptInvitation` keeps its 404 and 410 statuses.
  - The join page clears the cookie and shows the message with no Retry. Transport errors still offer Retry.
- **Tests.** `memberships-accept.test.ts` and `join-page.test.tsx`.
- **Live.** On the expired sentinel link, the page shows the plain alert with no Retry and no cookie. Both POSTs return
  200 and the console has 0 errors.

### LV-012 — Bridge discovery (decision)

- **Fix.**
  - The `spectra.bridge.discovery` flag is set on this device the first time it pairs. Devices that held a session
    before this change migrate automatically.
  - Until the flag is set, nothing probes the Bridge port.
  - After that, discovery is automatic. It backs off from 15 s to a 5-minute cap while Bridge is unreachable, and a
    focus event only checks once the backoff allows it.
  - All mounted surfaces share one probe.
  - Disconnecting this computer clears the flag.
  - Files and devices shows "Connect Bridge".
  - No allowlist changed.
- **Test.** `bridge-discovery-gate.test.tsx`.
- **Live.** `/library`, the DOCX studio and Files and devices made 0 `/v1/health` requests and logged 0 errors.
  Screenshot: `.spectra-local/live-verification/LV-012-connect-bridge-f77efa73.png`.

### LV-046 — PPTX "Waiting for Office"

- **Root cause.**
  - The studio reads the live `replicas.forWork` query.
  - The Library reads `presentationsForAccount` once and parks the subscription until focus, visibility, or the 180 s
    idle refresh.
  - A snapshot taken while PowerPoint held the deck therefore kept "Waiting for Office" on the Library row after the
    device acknowledged the write.
  - This fits all three cycles: one stayed at least 50 s, and two cleared on a later refresh.
- **Fix.** The loader parks only a settled answer. It stays subscribed while any row has a pending write, a pending
  replica or an Office lock.
- **Test.** `library-replica-loader.test.tsx`.
- **Native check still needed.** It needs a paired Bridge, and this lane may not pair one.
  1. Turn on Native write & sync for a disposable PPTX.
  2. Open the file in PowerPoint.
  3. Edit it in Spectra with the **Library row** visible.
  4. Close PowerPoint.

  The row should drop "Waiting for Office" within seconds of the write landing, with no focus change or reload. If it
  does not, note which surface still shows it (studio header, Library row, or replica disclosure) and the UTC time.

## Checks at close

- **Full suite** (`npx vitest run --maxWorkers=3`, at `2f37866d`): 4679 passed, 1 skipped, 1 failed.
  - The failure was a source-text assertion in `live-dock.test.ts` that pinned the old fixed 15 s Bridge poll.
  - `d88c9691` updates that assertion to the backed-off cadence (Bridge lines only).
  - The file then passes 29/29.
- **Build.** `npm run build` passed after the stack was stopped.
- **Processes.** Instance 8 and the `r1` browser session were stopped. The Bridge was left running.

## Left over, and why

- **LV-061 first open.** A first-open recheck of a fresh Bridge-linked DOCX was not run, because this browser is not
  paired to Bridge and the lane may not pair. Reopening the existing DOCX passed.
- **LV-017 image.** No Docker image was built locally. The import-graph test covers the COPY list.
- **Calendar notes (out of scope).** The notes in the calendar block dialog render raw `<p>` HTML. This was seen during
  the LV-060 check.
- **Disposable local data left in place:**
  - the personal calendar event "Spectra R1 Stale Check 20261003";
  - `src/r1-renamed.js` in the fixture "Spectra Code New File Check 20261002";
  - `.spectra-local/live-verification/bridge-disposable-20261002-run1` is unchanged. R1 removed the one DOCX copy it
    added. The folder still holds the disposable DOCX, XLSX and PPTX samples, plus a stale Word lock file
    `~$ectra Bridge Disposable Complex DOCX Sample.docx` dated 2026-10-02 13:56, which a verifier can delete.
- **Tooling.** Restarting the stack fetched the Convex local backend binary into
  `%LOCALAPPDATA%\convex\binaries\precompiled-2026-09-28-5c7cb5b\`.
- **Bridge process.** The pre-existing Bridge (PID 13120, port 47615) was never stopped, restarted or paired.

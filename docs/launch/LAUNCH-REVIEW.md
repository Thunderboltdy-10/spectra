# Spectra launch review

Written 10 November 2026 on `fixing-ai-harness` at `639524a0`. It follows a full read of `LAUNCH-VERIFICATION-REPORT.md`, the code that branch changed, the engineering decisions underneath it (Bridge sync, work kept on the computer, the AI pipeline, the island), and use of the running app.

This is the work order for the agent that implements next. Every decision in it is made. Do the phases in order: each builds on the one before.

## How to work from this

- **Marks.** *Verified* means I read the code, ran the gate or saw it in the app. *Lead* means it was reported and fits what I saw but I did not confirm it; confirm before changing code.
- **You may fix more than is listed.** If you find another defect or a clear improvement while working, fix it, in the same spirit as the items here, and record it. Do not widen a fix into a redesign.
- **Keep the design.** Spectra's interface is clean and established. Where something works, leave it. Every interface change here uses existing tokens, components and motion verbs (`docs/design/LANGUAGE.md`, `MOTION.md`, `LIFE.md`, `ISLAND.md`, `SHELL.md`). Load the `frontend-design` skill before Phase 7 and look at every change in the running app at 1280×720 and 1920×1080, light and dark, with reduced motion on and off.
- **Prefer correcting and deleting to adding.** The previous agent wrote more code than it needed. If a fix needs more than about 150 new lines outside tests, reconsider the approach first.
- **Test first** for Phases 1 to 5: write the failing test, then the fix. A prompt change is a behaviour change: run the golden set (A7) after each one.
- **Do not weaken a test** to pass it, and do not accept a mocked check where a live one is possible.
- **Do not commit.** Never stage `tsconfig.json`.
- **Gates, all green at the end of every phase:** both TypeScript projects; lint with zero warnings; `check:architecture`, `check:copy`, `check:capabilities`, `check:secrets`, `check:skills`, `check:design-tokens`; the full test suite; `cargo test` for bridge-core and bridge-app.
- **Record progress** in `docs/launch/IMPLEMENTATION.md`: one line per item ID with its evidence. No narrative.

---

## 1. Verdict

The branch is 538 files, +31,403 / −9,143 against `main`. It holds four changes: a rebuilt AI harness with three runtimes; work kept on the computer (a Yjs room server and SQLite store inside the Bridge); web-only pairing and account switching; and sixty-one verification fixes.

**Sound, leave alone.** The loop (`ai/harness/loop.ts`) is the best code on the branch. File sync's write path is careful: it checks the file against the revision it expected, never writes while Office holds the file, never recreates a deleted file, verifies by reading back, and on a real conflict overwrites nothing and shows both sides with two choices (`bridge-app/src/main.rs:2581–2808`, `artifact-studio.tsx:6000–6054`). Per-account stores, `computer_names.rs`, native confirmation before an AI-named path is synced, exact-byte Undo on Word files, approval convergence and the account-scoped replica readers (LV-54 to LV-61) all hold up. Every gate passes except one.

**Not launch-ready**, in order of concern:

1. The Bridge trusts too much: any page on `localhost` can pair silently with a release build, any website can trigger an update, and the Bridge runs whatever Codex policy the server sends.
2. Work kept on the computer can be lost or appear empty: six specific paths, three inside one computer and three when a second computer is involved.
3. A quiet two minutes moves a run to paid AI with no word in the thread, and there is no way to prefer one's other subscription first.
4. Speed: a one-sentence edit takes 10 to 48 seconds, and the default thinking level is High.
5. Feel: an answer asked from the Library is never shown, panels squeeze pages below their minimums, focus rings are hidden from keyboard users.
6. Convex cost: idle traffic is every live query re-running on each sign-in token refresh, which no fix so far touched.
7. `check:design-tokens` is red with 14 problems.

---

## 2. Decisions

These are settled. Build to them.

| # | Decision |
| --- | --- |
| D1 | **When a person's own AI fails mid-run:** retry once on the same runtime, silently. Then move down the person's chosen order (for example Codex, then Claude Code, then Spectra). No failure is shown in the thread. When the run moves, one quiet line in the thread says so at that point, and one line at the end says who finished. If the person allows only their own subscriptions, the run stops and says why. |
| D2 | **Origins.** Production is `https://spectra.ink`. A release Bridge accepts only its baked origins. `localhost` is accepted only by debug builds. |
| D3 | **Nothing opens when a message is sent.** When the reply arrives, a small peek rises from the thread's tab and shows it briefly; hovering opens the thread. The "is ready" toast goes. A setting to open the thread on send exists and is off by default. |
| D4 | **Claude Code ships**, after a pass run through Spectra on Haiku at low thinking. |
| D5 | **Convex sign-in token:** ten minutes. |
| D6 | **Backups are stored online by Spectra**, and the choice says so. A second computer can take a work over, and edits made on either side are merged, never chosen between. |
| D7 | **Thinking defaults to Medium.** Titles and other side calls run at the lowest thinking the runtime offers. |
| D8 | **"Artifact" stays** as a word on screen. |
| D9 | **Out of scope:** launch-day operations tooling; screen-reader naming work beyond what exists. |

---

## Phase 0. Start green

### G1. Fix the red gate — Verified

`npm run check:design-tokens` fails with 14 problems. The verification report never ran it.

- `lucide-react` imported directly in `components/ui/number-field.tsx`, `code/code-tray.tsx`, `document-status-rail.tsx`, `quiz/question-answer.tsx`, `workbar-item-selector.tsx`. Use Spectra's icon set.
- Font sizes under 11 px in `spectra-desk.css` (:493, :540), `spectra-editor-chrome.css` (:395, :403, :447), `spectra-editors.css` (:347), `spectra-embeds.css` (:410), `spectra-landing.css` (:2921, :3189).

Also off the contract and not caught by the gate:

- `spectra-admin.css` near :1087 uses `--motion-medium`, which is undefined, so that transition is dropped.
- `--ease-out` is undefined; `spectra-app.css` near :14381 and `spectra-devices.css` near :287 rely on fallbacks. The first also animates `padding-right`.
- `spectra-today.css` near :345 animates `max-height`. MOTION.md allows transform, opacity and filter.
- Nineteen new `15px` font sizes; the scale is 12/13/14/16/20/24/32/44.
- `--z-chrome` falls back to 30 where the token is 40.
- An empty reduced-motion block in `spectra-island.css` near :305.

Fix them, then extend the gate to fail on undefined custom properties and off-scale sizes.

---

## Phase 1. The Bridge: trust

### B1. Pairing accepts any local page — Verified

`bridge-core/src/server.rs:276–291`: `accept_pairing_offer` accepts an origin that is in `allowed_origins` **or** passes `is_local_development_origin` (:24), which matches `http(s)://localhost`, `127.0.0.1` and `[::1]` on any port, in release builds too. The same test feeds CORS (:504). `pair_offer` (:769) takes the origin from the JSON body and never reads the HTTP `Origin` header. `auto_pair` then completes with no native step. Any program serving a page on localhost can pair silently and receive a session token.

Do this:

1. Accept local origins only under `cfg!(debug_assertions)`. One predicate, used by the offer check and CORS. Release builds accept exactly the origins baked from `SPECTRA_ORIGINS` (`bridge-app/src/main.rs:980`, checked by `bridge/scripts/verify-release-env.py`). Set it to `https://spectra.ink` in `bridge/bridge-app/RELEASE.md:18`; add `https://www.spectra.ink` only if the app is served there.
2. On `/v1/pair`, require an `Origin` header, require it to equal the body's `browser_origin`, and require it to be allowed.
3. Keep pairing and account switching silent. With the origin locked, only the real app can start them. Show the connected account's name in the tray menu so the state is always visible.
4. Correct the two comments that describe protection that no longer exists (`server.rs:21–23`, `:767`) and rewrite the Pairing section of `docs/product/DEVICES.md`, which still specifies a native dialog.

Done when: a release build refuses an offer from `http://localhost:5173`; a request whose `Origin` header differs from its body is refused; first install and account switches still take about 1.5 s; tests cover each.

### B2. Any website can trigger an update — Verified

`request_update` (`server.rs:788`) is outside the `authenticate` layer, takes no body and checks no origin. A `no-cors` POST from any site reaches it. Updates are signed, so this is a forced download, install and restart on demand, not code execution.

Do this: when an `Origin` header is present it must be allowed; one request per ten minutes; and B4's rule applies.

### B3. The Bridge must own the command line — Verified

`bridge-core/src/agent_relay.rs:133–150`: for Codex only the first argument is checked (`app-server`); for Claude, the first argument and the presence of `--tools ""` and `--strict-mcp-config`. Codex's sandbox and approval policy are set by Spectra's server in `subscription-runtime.ts` (`thread/start` with `sandbox: "read-only"`, `approvalPolicy: "never"`, and a denylist of feature flags in `codexIsolation`).

The Bridge holds an outbound socket to the hub and runs what arrives. Whoever controls the hub or the server controls the arguments and the Codex policy on every connected computer. A denylist also fails open when Codex adds a feature.

Do this in the Bridge, so the far side sends intent and the Bridge decides the rest:

1. **Claude.** Accept a small typed request (model, effort, whether Spectra's tool server is attached) and build the argument list in Rust from one template. Refuse anything else.
2. **Codex.** Always spawn exactly `codex app-server`. Read each JSON-RPC message from the far side before forwarding. Allow only the methods `subscription-runtime.ts` uses (take the list from its `request(` calls). On `thread/start` and `turn/start`, overwrite `sandbox` to `read-only` and `approvalPolicy` to `never`, and drop `config` keys not on a short allowlist. Refuse and log everything else.
3. At thread start, read back the tool list Codex reports and stop if it holds anything but Spectra's tools.
4. Percent-encode the hub `sid` (:718, :757). Write the relay token file owner-only on macOS and Linux. Lower `MCP_REPLY_TIMEOUT` (:57, thirty minutes) to five, ending in a clear tool error.

Done when: a test relay that sends `sandbox: "danger-full-access"` sees it rewritten; unknown methods and extra Claude flags are refused; the Codex golden set still passes.

### B4. Updates must not interrupt work — Verified

`start_update_checks` (`main.rs` near :3890) installs every 12 hours without checking for a run, a sync or an open room. Defer while any is active, try again when idle, and finish open rooms before restarting.

### B5. One panic should not take the Bridge down — Lead

`server.rs` has 168 `.unwrap()` calls, many on lock guards (:241, :251, :359, :389, :503, :848). A panic while one is held poisons it for every later request. `rooms.rs` and `works.rs` already use a `locked()` helper that recovers. Use it throughout `server.rs`.

---

## Phase 2. Work kept on the computer

One rule governs this phase: **nothing is decided by comparing clocks.** Content is merged, because both sides are Yjs documents of the same work. "What changed since" is counted. A work has exactly one home, changed by one mutation.

### Inside one computer

#### W1. A backup can mark edits as backed up that it does not hold — Verified

`bridge/device-backup.ts:58–73`: the bundle is read, uploaded and recorded, then `backedUp` is called with `at` from the Convex server's clock (`deviceWorks.ts:288–299`). `works.rs:565` sets `backed_up_at = at WHERE updated_at <= at`. A work edited between the read and the record is marked as backed up though the bundle holds the older version, and the next incremental backup skips it. Two machines' clocks are being compared.

Do this: replace the clock with a counter.

- Add `store_meta.rev`, a number that goes up by one in the same transaction as every write to a work (append, compact, import, save_projection, restore). Add `works.rev` (set to it on each write) and `works.backed_up_rev`.
- `backup` reads `rev` under the lock before reading works and returns it as `snapshotRev`. The client passes it to `backedUp`, which sets `backed_up_rev = ?1 WHERE rev <= ?1`.
- "Changed since backup" (:496, :525) becomes `rev > backed_up_rev`.
- Migrate existing rows: `rev = 1`; `backed_up_rev = 1` where `backed_up_at >= updated_at`, else 0.

Test: back up, append an update, mark with the snapshot's number, and the work still counts as changed.

#### W2. Removing a work that is open brings it back — Verified

`rooms.rs:510–515`: `remove` drops the room and deletes the rows while peers still hold the room. Their next edit re-creates the row with a log that has no base; when the last peer leaves, `finish` writes the full state back.

Do this: a `removed` flag on the room, set under its lock. `apply` refuses and tells the connection the work is gone; `finish` does nothing. Test: join, remove, apply, leave; the store has no rows for it.

#### W3. One unreadable row makes a work unopenable — Verified

`rooms.rs` `join` (near :380) and `merge_state` fail the whole load if any logged update fails to decode or apply. Backup and export use the same merge, so the work cannot be rescued either.

Do this: skip an update that fails, log its sequence number, continue. If the saved state itself fails, load the newest row in `work_versions`. Show a quiet notice on the work: "Part of this artifact's recent history couldn't be read. The last saved version is shown."

#### W4. "Saved" should survive a power cut — Verified

The store runs `synchronous=NORMAL` in WAL mode, and the browser is sent `durable_ack` after that commit. Set `synchronous=FULL`. Measure a ten-minute typing session before and after; edits are already applied off the request path.

#### W5. Compaction assumes the row exists — Verified

`works.rs` `compact` updates `works.state` then deletes `work_updates` without checking a row changed. Make it an upsert, or roll back unless exactly one row changed.

### Across computers

Today a work kept on a computer belongs to one store (`spectraArtifacts.storageStoreId`). Opened elsewhere it says "This work is kept on another of your computers" (`device-works.ts:317–320`). "Bring back the backup" restores the account's backups and re-homes works to this computer (`work-home-choice.tsx:273–311`). That design is right. Its implementation has three faults that lose or hide work.

#### W6. Opening can show an empty artifact where the real one was — Verified

`enterDeviceRoom` (`device-works.ts:321–326`) seeds the store with `device.seed` whenever this browser session has not seeded the work. The seed's content comes from the Convex row (`collaboration/token/route.ts:82–91`), and `movedToDevice` set that content to the type's empty default (`deviceWorks.ts:239`). So whenever the home matches but the store does not hold the work (see W7; also a lost or replaced store file), the work opens empty and editable, and the real copy is out of reach.

Do this: seeding is for creation only.

- Add `storageSeeded: true` on the artifact, set by `movedToDevice`, by `finishCreate`, and by the first successful seed of a new work.
- Pass it in the token response. In `enterDeviceRoom`, ask the store whether it holds the work (`get`). If it does not and `storageSeeded` is true, do not seed. Fail with a new code, `COLLABORATION_DEVICE_MISSING`, worded: "This artifact isn't on this computer. Bring it back from your backup." with that action beside it.

Test: a seeded work whose store row is absent never produces an empty room.

#### W7. Bringing a backup across re-homes works it did not bring — Verified

`adoptRestored` (`deviceWorks.ts:142–155`) sets `storageStoreId` to this computer for **every** work the account keeps on any computer, whether or not the backup contained it. Anything created or moved on the other computer after its last backup, and everything on a third computer, is now homed here with nothing in the store. With W6, those open empty.

Do this: the Bridge's `restore` returns the ids it restored (today a count, `rooms.rs:534`). `adoptRestored` takes that list and re-homes only those.

#### W8. Backups from different computers are mixed into one chain — Verified

`deviceBackups` rows carry `storeId`, but three readers ignore it:

- `backupsToRestore` (`deviceWorks.ts:322–337`) takes the account's rows back to the latest full backup **of any store**. A full backup from computer B hides computer A's chain.
- `pruneBackups` (:303–319) keeps the newest full backup of any store and what follows, and can delete another computer's only full backup.
- `settings` (:40–58) reports the latest backup of any store, so a second computer believes its own backup is not due.

Do this: each store has its own chain. All three take a `storeId` and work within it. "Bring back the backup" names the source when there is more than one: "From Pablo's laptop, backed up 2 hours ago."

#### W9. Restore should merge, not replace — Verified

`restore_filtered` in `works.rs` replaces a work when the backup's `updatedAt` is newer than the local one, comparing two computers' clocks, and discards the older side's edits. `restore` also runs under an open room, whose next compaction silently undoes it.

Do this: merge the incoming state into the existing one (`merge_state(existing, [incoming])`); nothing is lost in either direction. Save a version named "Before restore" first. When the work is open, apply the incoming state to the live room as an update so open browsers receive it.

#### W10. Taking a work over, and the edits left behind — new, to D6

With W6 to W9 in place, moving between computers is safe but can strand edits: computer A wrote after its last backup, B took the work over from that backup, and A's later edits sit on A.

Build the hand-over on what exists:

1. **On B, "Bring it here".** Restore A's chain (W8), merge (W9), re-home what arrived (W7). Before starting, say the age: "This copy is from Tuesday 14:02. Anything written on Pablo's laptop after that is merged in when that computer next opens Spectra."
2. **On A, next time Spectra is open.** A lists the works in its store whose home is now another store. If any has `rev > backed_up_rev`, A runs one incremental backup and records it with `forStoreId` set to the new home. A no longer opens those works (the existing "kept on another of your computers" message) and keeps their bytes for thirty days.
3. **On B, on open and while open.** B reads backups addressed to its store that it has not merged (keep the last merged backup id per source store in `store_meta`), merges only works it is home for, and marks them merged. `deviceWorks:settings` is already subscribed; let it carry "a hand-over is waiting" so B acts without polling.

Because every step is a merge, order and timing do not matter: the same result follows whichever computer comes online first, and repeating a step changes nothing.

Tests, each with two stores in one process: A edits after backup, B takes over, A hands over, B holds both sets of edits; the same with the steps in the other order; a hand-over applied twice; A offline for good (B keeps the backup's state and says its age).

#### W11. Say where the backup goes — Verified

`work-home-choice.tsx:31–37`: "This computer, with a backup" never says where the backup is. Replace its second line with "A copy is saved online with Spectra once a day, so a lost computer costs a day at most". Under "Only this computer" the first line stays as it is.

### W12. Smaller ones — Verified

- `backup_bundle` holds the single store lock while reading and compressing everything, and builds the file in memory. Read rows under the lock; compress outside it.
- 200 versions are kept per work, each a full copy. Cap by total bytes as well as count.
- Outgoing messages to a browser use an unbounded channel (`rooms.rs:907`). Bound it and drop the connection when full.
- Nothing closes a silent peer. Close after two missed pings.
- `deleteBackups` (`deviceWorks.ts:340`) collects every row in one mutation. Page it.
- `moveWorkToCloud` (`device-works.ts:199–218`) ignores a failed local `remove`, leaving a stale copy in the store. Retry it on the next open, and make `import` of a work the store already holds merge (as W9) instead of overwrite.

---

## Phase 3. Prove the Bridge in every case

The write path is careful, but the verification so far covered the main flows on one machine. Run every case below on the **release** build after Phases 1 and 2, as two accounts, and fix what does not match. The second column is the required behaviour.

### Files in synced folders

| Case | Required behaviour | In code |
| --- | --- | --- |
| Edit in Spectra, file closed | Written, read back, "Up to date" | Verified |
| Edit in Spectra while Word has the file open | Nothing is written while Word holds it; the artifact says it is waiting for Word; written when Word lets go | Verified |
| Edit in Word, Spectra idle | Spectra takes the new version; an open editor updates in place | Lead |
| Both changed | Nothing overwritten; the banner shows both sides; "Keep Spectra version" or "Keep Word version" | Verified |
| File deleted outside Spectra | Never recreated; the artifact stays in Spectra and says the file is gone, with one action to put it back | Verified not recreated; the action is a Lead |
| File renamed or moved inside the folder | Same artifact, new name; no duplicate | Lead |
| File moved out of the folder | Treated as deleted, as above | Lead |
| Folder missing (drive unplugged, folder renamed) | "Not available here"; **no artifact is marked deleted**; resumes when the folder returns | Lead. `report_missing_resources` (`sync.rs:598`) must never run for a root that cannot be read. Test this one first. |
| Folder paused | Changes wait without counting as failures; drain on resume | Verified |
| Offline | Changes queue in the journal and drain in order; an entry overtaken by a newer one is dropped | Verified |
| Bridge killed mid-write | No partial file; the write replays or is recognised as already done | Verified by design; run it |
| Folder inside OneDrive, Dropbox or iCloud | Provider conflict copies ("name (1).docx") are not imported as new artifacts without the person choosing | Lead |
| Office lock files, temporary files | Ignored | Lead |
| File over the size limit | One clear sentence; no retry loop | Verified refusals stop retrying |
| Case-only rename, long path, non-Latin name | Same artifact, no duplicate | Lead |
| Switch account on the same computer | The other account's folders neither sync nor appear | Verified by the earlier agent; run it |
| System clock changed, daylight saving, sleep and wake | No effect | Lead |
| Remove a device | Syncing stops; files on the computer stay | Lead |

### Work kept on the computer

| Case | Required behaviour |
| --- | --- |
| Edit with no internet | Saved on the computer at once; backed up later |
| Bridge quits while typing | The page keeps the draft and says so; on return the draft merges with no loss and no duplicate |
| Disk full | "This edit couldn't be saved on this computer. Your draft is still here." and it is |
| Two tabs or two browsers, same work | Both edit live |
| Trash, then keep typing in another tab | The work stays deleted (W2) |
| Backup interrupted mid-upload | Nothing is marked backed up (W1) |
| Open on a second computer | The clear message and "Bring it here" (W10) |
| First computer returns with later edits | Merged on the second (W10) |
| Store file lost on the home computer | Never an empty artifact; offers the backup (W6) |
| Share a work kept on the computer | Moves online first, then shares |
| AI edits it while no browser has it open | Works through the Bridge when it is running; says plainly when it is not |
| Move everything online, interrupted halfway | Each work is in exactly one place (W12) |

### Conditions

Sleep ten minutes and wake, with a work open and with a run working. Network off for two minutes mid-edit and mid-run. Bridge restarted during a Codex run. An update arriving while idle and while busy (B4). A four-hour session with an edit every few minutes: Bridge memory steady, no stuck "Saving".

---

## Phase 4. The AI runtime

### A1. One chain, one silent retry, quiet hand-over — to D1, Verified

Today: `subscription-runtime.ts:81` sets `IDLE_TIMEOUT_MS = 120_000`. On silence, or on any error at all, `withRuntimeFallback` (:1309–1339) sends the rest of the run to OpenRouter. The only sign is a trace step. AI-068 stalled; the student evening spent 143 s on Codex before moving; AI-047 moved after `DEVICE_STORE_UNAVAILABLE` at 490 ms, before Codex was asked anything. The setting offers one runtime and no order (`preferences.ts:36`).

**The order.** Add `ai.runtimeThen`, an ordered list of what to try after `ai.runtime`, default `["spectra"]` (today's behaviour). In Settings, under the Default row in `runtime-settings.tsx`, one more row, "If it can't answer", shown when Default is Codex or Claude Code:

| Default is Codex | Stored as |
| --- | --- |
| Claude Code, then Spectra | `["claude", "spectra"]` |
| Spectra | `["spectra"]` |
| Claude Code | `["claude"]` |
| Stop | `[]` |

Mirror it for Claude Code. Offer the Claude or Codex options only when that runtime is ready on this computer. Replace the last sentence of the group's description ("If your subscription can't answer, Spectra's model takes over…") with "If yours can't answer, Spectra follows the order you set here. Work that runs on a schedule always uses Spectra's."

**The chain.** Replace `withRuntimeFallback(primary, fallback)` with one that takes the ordered callers. The harness hands every call the whole transcript, so a move at a tool boundary loses only the unfinished turn, as now. Per runtime:

| Failure | Handling |
| --- | --- |
| Cannot connect (Bridge unreachable, CLI missing, signed out, store unavailable) | One retry after a second. Then the next in the order. |
| Silence mid-turn | `turn/interrupt` (:724), a fresh thread on the same runtime with the transcript so far, one more try. Then the next in the order. |
| The subscription refuses (usage limit, expired login) | No retry. The next in the order. |

Keep `SPECTRA_AI_RUNTIME` as it is: it forces one runtime and disables the chain.

**What the person sees.**

- The retry shows nothing. No error, no red, no extra step.
- When the run moves, one line appears in the run's steps at that point and stays after the run: "Continued with Claude Code". The reason is available on hover, from `runtimeFallbackLabel` (:1294), reworded for a chain: "Codex stopped responding".
- At the end, beside "Worked for", one more: "Finished with Claude Code". If it moved twice, the last runtime is named.
- If the order runs out: the run ends where it is, keeps what it finished, and says "Codex stopped responding, and you've chosen not to use anything else. What was done so far is saved." with Retry.

**The wait.** Read the longest healthy gap between events from the run traces under `.spectra-local`. Set the silence limit to twice that, never under 45 s and never over 120 s.

Done when: a relay that goes silent mid-turn gives one invisible retry and a run that finishes on the same runtime; a relay that stays dead moves down the order with the two lines; `[]` stops with the sentence; nothing reaches OpenRouter unless the order includes Spectra.

### A2. Know before sending

`use-agent-runtime.ts` already learns each runtime's state and re-checks on window focus. Use it at the point of choice: in the island's model menu, show each runtime's state in words beside it ("Codex, ready on this computer"; "Codex, open Spectra Bridge to use it"), and re-check when the composer takes focus if the last check is older than its 60 seconds. A send to a runtime known to be unreachable starts at the next in the order without waiting for a failure.

### A3. Claude Code — to D4, Verified

`subscription-runtime.ts:1256–1261` lists `claude-fable-5-1`; the current model is `claude-fable-5-2`. Replace the dated id with the CLI's alias if it has one, so the list cannot go stale, and confirm each entry by starting a session.

Then run fifteen cases through Spectra on Claude Code with Haiku at low thinking: three questions; three edits to a cloud document; two to a Word file, one with Ask and one with Always; one creation each of a document, a quiz, a flashcard deck and a presentation; one `ask_user` round trip; one Stop; one Undo. Fix what fails. Then B3's Claude template is proven against the same set.

### A4. Side calls at the lowest thinking — to D7, Verified

- `thread-title.ts:70` asks for `"low"`. The profiles go lower (`model-config.ts:16–23`: `none`, `minimal`). Ask for `"none"`; Codex and Claude already map what they do not support down to their own lowest (`subscription-runtime.ts:346`, `:922`). Confirm the configured OpenRouter model accepts it; if not, `"minimal"`.
- `memory-reflection.ts:91`: the same.
- Compaction (`run.ts:132`) sets no level and inherits the run's. Set `"low"`; a summary needs care but not High.
- When the run is on a subscription, a title starts a whole CLI session beside the run (`model.ts:205–230`). Use the smallest model there: `haiku` on Claude Code; on Codex the smallest in the account's list. Titles must never delay or fail a run; that already holds.

### A5. "Worked for" should mean worked — Verified

The loop tracks active time (`LoopState.elapsedMs`, per working stretch, stopping on a pause). The label shows wall time, so a run that waited 25 s for an answer says 42 s. Show the active time.

---

## Phase 5. AI behaviour and speed

### A6. Speed — Verified

Targets: first output under 1.5 s; a simple edit under 8 s. Measured: a short question about 7.6 s; a one-sentence edit to a cloud document 10 to 15 s; "add a summary paragraph" to a Word file 48 s; the student evening's runs 8 to 113 s. All at High.

1. **Default to Medium.** `preferences.ts:42`: `thinking` defaults to `"high"`. Make it `"medium"`. The zod default applies to everyone who never chose, which is what we want. `reasoningProfile` on line 34 (`configured_maximum`, `balanced`, `fast`) looks like an older setting for the same thing; if nothing reads it, remove it, and if something does, make one setting.
2. **Measure, then cut.** Much has been optimised already, so find what is left by measurement, not by guess. For one fixed prompt ("add a closing sentence") on a cloud document and on a Word file, at Medium, record from the trace: send to first event; each model turn; each tool call; save. Write the table into `docs/launch/IMPLEMENTATION.md`.
3. **Turns.** A simple edit should be two model turns: read-and-edit, then reply. The prompt already says "Saved means saved, so do not read the work again". If the traces show more, find which tool result invites the extra read and fix the result's wording.
4. **Before the first turn.** Everything between send and the first model request (context building, `beginRun`, runtime start, relay connect) is pure overhead. Anything over 500 ms there is the first thing to cut: start the runtime's session when the composer takes focus (A2 already checks it), and build context in parallel with it.
5. **Word files.** If the floor is the Bridge round trip and the conversion, set an honest target of 15 s and meet it.
6. **Thinking for one-line edits.** If, at Medium, a one-sentence edit still spends most of its time thinking, send requests the harness can cheaply recognise as small (short prompt, one artifact in focus, no attachments) at Low. Only if the measurement says so.

Done when: the fixed prompt meets 8 s on a cloud document and 15 s on a Word file at Medium, on Codex.

### A7. A repeatable golden set

The 118-run campaign cannot be repeated cheaply. `ai/harness/evals` exists. Take twenty prompts from the campaign and the student evening, one behaviour each (find by vague name; small edit keeps the voice; one-tap question; undo; refuse a computer command; plan around a constraint; one page; quiz without equivalent answers; embed when asked; no embed when not; title names the subject), give each a checkable outcome, and run them on Codex after every prompt or tool-description change. Build this before A8.

### A8. Six sentences in the system prompt — Verified

`ai/harness/prompt.ts`. The file's header says the prompt is written in the voice Spectra answers in, and that invariants live in tool code. Lines added during verification break both, and one is dangerous. The prompt is 1,877 words against a 1,500 target. Replace as follows.

1. `Undo the preceding run with undo_previous_run before new writes; report any changes left in place.` reads as an instruction to undo before every write. Replace with: `When someone asks you to undo or take back what you just did, call undo_previous_run before you write anything new, and tell them if anything stayed changed.`

2. `Use ask_user whenever waiting for an answer. Ask only for a user-requested choice or information needed to proceed. Otherwise look it up or make a sensible assumption and state it briefly.` contradicts the rule that practice questions stay in the conversation, which is why AI-069/070/071/077 asked in plain text. Replace with: `When you need a decision before you can go on (which of two artifacts they mean, which of a few options), ask with ask_user and give the choices, so they can answer in one tap. A question that is part of teaching or practice belongs in your reply. Never ask for what you can look up or sensibly assume; if you assume, say so in a clause.` A plain-text question still works; build nothing to detect it.

3. `Plan from Now onward; never recommend an elapsed slot unless explicitly requested.` Replace with: `Plan from now onward: a time that has already passed today is not a suggestion.` The invariant moves to the tool (A9).

4. `Find computer-synced works with list_library by title first; unopened files may only have a name. For files outside Spectra, devices lists names, never contents; offer to sync relevant files. Refuse commands or computer-file deletion; offer read-only names instead.` Replace with: `Files synced from their computer are in the library like anything else; find them by title, and expect one nobody has opened yet to have only a name. For files that are not in Spectra, devices can list names in their usual folders, never contents: say what you found and offer to sync the ones that matter. You cannot run commands on their computer or delete its files, so say that plainly and offer what you can do.`

5. Move out: the paragraph beginning "When a student is lost before an upcoming test" becomes a skill loaded when it applies; "Only say a work opened at a passage if you passed that region; otherwise name the section" moves into that tool's result.

6. Bring `docs/ai/HARNESS.md` in line: it names `remember`, `forget_memory` and `recall`; the code has `read_memory` and `update_memory`.

### A9. Invariants in tools

- **Times that have passed (AI-066).** The calendar and task tools refuse a start before now with a result the model can act on: "That time has already passed. It is 19:21 on Tuesday." No such check exists in the tool sources today. Allow it when the request is to log something that already happened.
- **Length (AI-001, AI-049).** A 247-word sheet came out as two pages. Document creation and edits return an estimate ("Saved. About 2 pages.") from block structure against the page. Check it against the Pages view on five fixtures; within a quarter page is enough for the model to notice and trim.
- **Equivalent quiz answers (AI-004).** One sentence in the quiz guide: no two options may be the same answer in another form. Reject a quiz whose numeric options are equal after normalising.
- **A tool that never returns.** The loop checks its budget between turns only. Wrap `executeOne` in a five-minute limit that becomes a tool error, unless every tool already has its own.

Leave AI-065 (task made but not embedded) alone; firmer wording would produce embeds nobody asked for.

### A10. Thread titles name the subject — Verified

Four threads about one document are titled "Document summary paragraph", "Summarize a document", "Document summary request" and "Document summary request"; on the rail all read "Document sum…". `thread-title.ts:26–35` gives the title call only the first message. Also give it the title of the artifact in focus and the titles of the threads now on the rail, and add to its instructions: "Lead with the subject, not the kind of request. When an artifact is in focus, start from its name. Differ from the listed titles." Expected: "Physics progress summary".

### A11. Smaller ones

- `tools/memory.ts:56`: `update_memory` declares `effect: "read"` though it writes. The label feeds the permission decision (`run.ts:328`), the step shown (`run.ts:354`) and the evals' list of read-only tools (`evals/runner.ts:135`). Label it `write` and keep it from asking through its permission category. If run undo does not cover memory files, say in the thread when memory changed.
- The hub ticket is minted in four places (`subscription-runtime.ts` near :98, `src/lib/device-store.ts` near :14, `convex/bridgeSync.ts` near :148, `scripts/run-relay.mjs` near :27). One function.
- Factual slips in generated study material (the French accent rule; the line and plane angle) are model quality. Add no validators for facts.

---

## Phase 6. Efficiency

Convex is the largest cost. Three findings account for most of it.

### E1. Idle traffic is the token refresh — pattern Verified; confirm the cause first, it takes ten minutes

The latest idle capture (`.spectra-local/launch-verification-2026-11-08/idle-48-cost.json`): 259 runs in 300 s across two pages. Every query live on both pages ran 12 times; every query live on one ran 6; all but one of each were cache hits. Six per page in five minutes is once every 50 seconds, for every query alike. Nothing in the data changes on that rhythm; the sign-in token does. `ConvexProviderWithClerk` (`src/components/providers.tsx:27`) asks Clerk for a `convex`-template token; Clerk's templates default to 60 seconds; the client refreshes shortly before expiry; the server re-evaluates every subscription when the identity is re-sent.

1. Set the `convex` JWT template's lifetime to 600 seconds in Clerk, first on the development instance. Repeat the 300-second capture. Each query should run once, not six times. If it does not, stop and find the real cause before changing anything else.
2. Apply the same on production.
3. Check Convex's usage page for whether cache hits are billed as function calls, and restate the idle budget in the efficiency doc in the unit that is billed (uncached runs and bytes per minute if they are not).

### E2. Two causes of uncached idle work — Verified

- **One line defeats the cache for two queries.** `convex/schoolSyncShared.ts:32`, in `schoolSetupForAccount`: `Date.now() - account._creationTime > ESTABLISHED_AFTER_MS`. A query that reads the clock is not served from cache. `dailyBriefs:today` (6 runs, none cached, 45 KB) and `managebac:onboardingStatus` (12 runs, 6 uncached, 30 KB) both call it. Return an `establishedAt` time instead of the boolean and let callers compare: the `today` query (`dailyBriefs.ts:64`, through `briefAllowed` at :48) compares against the `day` it is given; mutations may read the clock; `today/use-daily-brief.ts:56` compares in the browser. Then search every query's call tree for `Date.now()`; this one hid in a shared helper.
- **The gateway re-checks every open artifact on a timer.** `scripts/collaboration-gateway.mjs:110`: `POLICY_SWEEP_MS` is 60 s in production. Each sweep (:1720) makes one `policy` action per open artifact and one `authorize` action per connection, each a Convex action plus a query: two actions a minute per open artifact, all day. Permission changes are already pushed (`enforceActivePolicyVersions(only)`, `POLICY_PUSH_MAX_AGE_MS`), and each connection's lease expires on its own. Set the production sweep to five minutes.

### E3. A run should not cost megabytes — Verified

Run windows measure 1.3 to 7.8 MB against a 1 MB budget.

- **Tabs.** `spectraRuns:listTabs` is fetched over HTTP (`src/app/api/spectra/route.ts` near :449) by `island/run-tabs.ts`, again on every `threads.changed` and `run.changed` (near :232) and on a timer (near :102). One window recorded 23 calls and 289 KB.
  1. Keep on the tab row everything the rail shows: state, title, whether a question or an undo is waiting, the current step's caption while working, and the first 280 characters of the final reply. Update them where the run already writes its state. A list is then one small read per tab. Phase 7 needs the caption and the reply.
  2. Carry the changed tab's fields in the event and patch the local list from it. Fetch only when a tab is added or removed.
  3. At most one fetch a second, trailing. Remove the timer if events cover every change; if not, find the gap and close it.
- **Selecting a tab.** `selectTab` (`convex/spectraRuns.ts` near :2461) collects two index ranges and patches `updatedAt` on tabs, invalidating every tab list; three calls cost 325 KB. Which card is open is a fact about this browser. Keep "seen" as one patch to one row; keep the selection locally; check what else reads the server's copy before removing it.
- **Tallies.** `orgTree:workspaceTallies` reads 157 whole documents, 196 KB, whenever any artifact changes, to print "3 artifacts, 4 threads". Subscribe only while the Library is on screen, and keep the two counts on the workspace row, updated where artifacts are filed and trashed.
- **Starting a run.** `beginRun` is 133 to 291 KB. Read its trace for whole documents read for one field.

Done when: a simple edit on an open document records under 1 MB of database I/O from send to done.

### E4. Fewer queries live at once

About 25 queries are live on an ordinary page. Five describe the session and almost never change: `identity:account`, `memberships:listMine`, `catalogGraph:identity`, `bridge:hasDevice`, `deviceWorks:settings`. One query returning the first four removes three runs from every refresh on every page. Leave `deviceWorks:settings` separate; W10 makes it carry hand-over state.

### E5. Smaller ones

- `bridgeSync.reconcileMissingResources` (near :548) is a public mutation that does nothing. If no shipped Bridge calls it by name, remove it; if one does, say so in a comment and remove it with that version.
- **Lead:** `purgeNonOfficeResources` reschedules itself across all replicas; `undoStateFor` reads up to 400 rows. Confirm both are bounded.

---

## Phase 7. Feel

Small, precise changes. The island and dock are not being redesigned.

### F1. Focus must be visible to keyboard users — Verified

`src/components/keyboard-modality.tsx` and `spectra-app.css` near :3466: `html:not([data-keys]) :focus-visible { outline: none !important; … }`, with `data-keys` set only after Tab or F6. The browser's own `:focus-visible` already hides rings for the mouse. This rule removes them for anyone moving by arrow keys through menus, lists and tabs before pressing Tab, and from text fields. Delete the component and the rule. Find the verification entry that asked for it and solve only that: if the complaint was rings on clicked text fields, give inputs a quiet focused border from existing tokens.

### F2. Panels give way in the stated order — Verified

SHELL.md: the rail collapses first, then collapsible panels, then page navigation, and only then does the Side float over the stage. Stage minimums: Library 560, Calendar 640. At 1280×720:

- Calendar with a thread in the Side shows three days, not seven, with the rail still wide and its Recent list down to one item.
- Library with an artifact in the Side: the pane is 620 wide, the Library 420, one column of tiles, rail still wide.
- From the verification report's images (Lead): four columns at once with a pinned island card, the presence chip over the document title, and a clipped "Back to editing".

Find the one place that decides column widths and make it follow the documented order: with the Side open, if the stage would fall below its page's minimum, collapse the rail; if it still would, float the Side over the stage. Never four columns. Correct the order in the existing layout; write no new one.

Related Leads: the History pane narrows the Side from 371 to 300 while other panes keep their width (panes share one width); with a pane open, quiz and flashcard text wraps to one word per line (the same minimum, inside the artifact area).

### F3. The reply peek — to D3

Today, asking "where are the nodes of a standing wave?" from the Library ends in a toast, "Standing wave nodes is ready" with Open (`island.tsx:1146–1150`). The answer is never on screen.

Nothing changes at send: the message travels into the prism, the tab appears, nothing opens. When the run finishes and its thread card is not open, a peek rises from its tab.

- **Form.** A small card growing out of the tab, anchored above it, using the same origin and spring as the tab-to-card morph. Width: the smaller of 360 px and the stage width less its gutters. Body: the final reply, at most three lines, clipped with the standard fade. No header, no close button.
- **When the run changed an artifact,** the body is one line saying what changed, taken from the reply's first sentence ("Added a closing sentence to Physics progress"), with **Undo** and **Show** at the right (F5). When it made a new artifact, the line names it, with **Open**.
- **Life.** It stays eight seconds; the count pauses while the pointer is over it or the rail. Then it folds back into the tab, which keeps its unread lip.
- **Opening.** Resting the pointer on it for 300 ms, clicking it, or pressing the tab grows it into the full thread card: the card starts from the peek's box, so it reads as one surface growing.
- **Manners.** One at a time; a newer one replaces it. Never over an open thread card, a menu or a dialog. It never takes focus: typing in the composer or the editor continues undisturbed. Escape dismisses it. Clamp it to the stage (F6).
- **Reduced motion.** Fade only.
- **Everywhere.** The rail is on every page, so the peek appears wherever the person is when the run finishes. Remove the "is ready" toast and `readyLine`.

The text comes from the tab row (E3), so the peek costs no extra read.

**The setting.** In Settings, with the island's options: "Open the thread when I send", off by default (`ai.openOnSend`). When on, the thread card opens over its tab at send, using the existing morph, and no peek is needed.

Rewrite ISLAND.md §Sending and its implementation note to say this once, and the comment at `island.tsx` near :671.

Done when: a question from Home shows its answer in a peek without anything having opened at send; resting on it opens the thread; a one-sentence edit shows the one-line peek with Undo and Show and the caret never leaves the document; with reduced motion it fades.

### F4. The dock says what is happening — Verified

The composer's placeholder already carries run status (`island.tsx:800–805`): "Working on Standing wave nodes…. Ask something else?". It names a thread, not what Spectra is doing, and the punctuation doubles. The slot exists; change only what it says.

- While a run sent from here is working, the field is empty and not focused: the placeholder is the live step caption with an ellipsis, the same line the thread shows: "Reading Physics progress…". It changes in place with the existing crossfade.
- When the field takes focus: "Ask something else".
- No run working: "Ask Spectra anything". Replying in a thread: "Reply to …" as now.

The caption comes from the tab row (E3). Fix `shortTitle` to cut on a word boundary and never follow its own ellipsis with a full stop.

The verification report records two step captions overlapping during a streaming change (AI-101, Lead). One line is reserved; the old caption fades out as the new fades in over it; two are never readable at once.

### F5. Opening an artifact lands on the edit

The machinery exists. `work.open` takes a region (`chat-shell.tsx:472`); every studio has a resolver (`useOpenAnchor` in the document, presentation, sheets, quiz, flashcard, code, whiteboard and task studios); the landing scrolls there, draws the ring and sends the light in (`anchors/use-open-anchor.ts`); and the AI's live position already carries a region while it writes (`collaboration/follow-ai.ts:361–369`). What is missing is memory: an artifact card in a thread does not keep where its run wrote, so opening it later lands at the top. (Lead: I found no region on the cards; confirm.)

- When a run's write succeeds, record on that run's artifact card the first region it changed in that artifact, in reading order: `{ id, label, excerpt }`, the `WorkRegion` shape in `anchors/locate.ts`. Take it from what the write tool already knows.
- Opening the card, and **Show** on the peek, sends `work.open` with that region.

| Artifact | Lands on |
| --- | --- |
| Document | The first changed block, centred |
| Presentation | The changed slide, selected |
| Sheets | The changed range, on its sheet |
| Quiz | The changed question |
| Flashcards | The changed card |
| Code | The file, at the changed line |
| Whiteboard | The changed node, framed (the canvas pans) |
| Task | The changed field |
| A new artifact | The top; no mark |

A region that no longer exists lands nowhere and says nothing; that is already the behaviour.

One Undo per run per screen: the peek's while it shows, the artifact card's in the thread. The student evening screenshots show "Undo Spectra's changes" twice at once (Lead); remove the duplicate.

### F6. The island rail — Verified

- **With the composer kept open, every tab stands all the time.** `island.tsx:811`: `raised` is true whenever the composer is visible, so on Home and Library finished threads stand permanently over the page. `spectra-island.css` already says "at rest only the threads in play show". With the composer open and the pointer away, raise only tabs that are working, waiting for an answer, have a problem or are unread; the rest rise when the island is hovered or focused.
- **Tabs are cut hard at the left.** With the Side open, the first visible tab reads "ent sum…" under the + button. Snap the scroller so a tab at the leading edge is whole or absent; keep the fade for the trailing edge.
- **Cards and popups stay on the stage.** A card opened from the first tab can reach left over the navigation rail (its edge near x=210, the rail ending at 232). Clamp cards, the peek and the approval popup to the stage with the standard gutter; the report records the approval popup clipped at the top at 1280×720 (Lead).

### F7. Words — few, since most of Spectra shows rather than tells

- Home says "Good afternoon, Andrew." with "Your evening" beneath it. One function decides the part of day for both. (Verified)
- The Superadmin heading says "Platform"; its denial reaches people as "Something went wrong"; "Schools using the most" adds bytes and tokens into "12.9m used". Rename it, give the denial its own sentence ("This page is for Spectra's operators."), rank by one unit. (Lead)
- Error strings in `artifact-embeds-panel.tsx` say what failed without what to do next. Add the next step to each. (Lead)
- A view-only embedded graph has controls that look live and do nothing. Show them as unavailable; on a click, "Open this to change it" with the action. (Lead)
- In `bridge/humanize.ts`, read every message aloud once as a student would meet it. "Does not match" (:195) for a diverged file is unclear on its own: "Changed in both places". Keep the rest that already read plainly.

### F8. Visual items left open by the verification report — Lead

The worked example's matrix reserves far more height than it uses; model previews are cropped; the whiteboard does not fit on open; Analytics' partial-state row is cramped at 1280; Task hides its location line in side and full views; a literal "#" appeared once in a title. Look at each in the app, fix what reproduces, record what did not.

### F9. A first question that lands

On Home for a new account with nothing yet, show three suggestions drawn from what Spectra can see (a due date from School, a recent artifact, a class), using the existing suggestion rows. With F3, the answer rises in front of them. No new component.

---

## Phase 8. Clean up

Confirm each has no caller first, including callers by name from Rust and from `scripts/`.

- `s.png` at the repository root (120 KB, tracked). Delete.
- `LAUNCH-VERIFICATION-PROMPT.md`, `LAUNCH-VERIFICATION-REPORT.md` and this file: move to `docs/launch/` when the work is done.
- `src/app/api/spectra/dev-trace/route.ts` writes browser timing marks to disk when an environment variable is set. Remove it or put it behind a dev-only build flag.
- `console.warn` in `today/brief-server.ts` near :152.
- `forgetIdentityForTests` exported from a production module.
- About thirty exports with no references (Lead). In `convex/bridgeSync.ts`, `workSignal`, `ownedStoredWorks` and `agentHubTicket` are called by name from the Bridge; keep them.
- Native `title=` attributes in new files where the rest of the app uses Tooltip (Lead).
- New components with logic and no tests: `history/version-history.tsx`, `studio-pane.tsx`, `studio-context-menu.tsx`, `rail-recent-works.tsx`, `devices/device-folder-browser.tsx`, `runtime-settings.tsx`, `memory-files-settings.tsx`. Test what is listed, what is disabled and what a click sends, not the markup.
- Docs to bring in line with the code: `docs/product/DEVICES.md` (pairing; work kept on the computer and the hand-over), `docs/ai/HARNESS.md` (memory tools; the runtime order), `docs/design/ISLAND.md` (sending, the peek, the dock line).

Do not refactor the LV-54 to LV-61 replica readers. They are verbose but correct, covered by 512 lines of tests, and every index they added is used.

---

## Final pass

On the release Bridge build, as two accounts:

1. First install; switch accounts both ways.
2. A question from Home: nothing opens at send; the peek shows the answer; resting on it opens the thread.
3. A one-sentence edit on a cloud document and on a Word file, timed, at Medium; the peek's Show lands on the sentence; Undo takes it back.
4. One creation of each artifact type; opening each card lands as F5 says.
5. An `ask_user` round trip; Stop; Undo.
6. A run with the Codex relay killed mid-turn, with the order set to Claude Code then Spectra, to Spectra, and to Stop.
7. The fifteen Claude Code cases (A3).
8. A work kept on the computer taken over on a second store and handed over from the first (W10).
9. Every row of the Phase 3 tables.
10. The keyboard alone from Home to a sent message and back, every focus visible.
11. A 300-second idle capture, and one edit run's database cost.
12. The golden set.

---

## What this review did not read

The collaboration gateway's server code beyond its policy timer; the internals of the Word, slides and sheet converters; ManageBac sync beyond its idle queries; the admin and analytics pages' logic; the landing page; billing; the macOS build of the Bridge; any deployed environment. The interface pass was one student account at 1280×720. If you work in these and find a defect, fix it under the same rules.

# Spectra live verification — 11 November 2026

**Verdict: I would not hand this build to students tomorrow.** The basic study loop is promising, but the recovery tests found duplicated document content, a rejected Word approval, an unconfirmed file write described as saved, and three configured Codex fallback paths that did not run after connection loss. Fix those first, then address the unusable narrow work panels, the overflowing generated slide, the incorrect standing-wave algebra, and the failed one-page quality gate. The coverage at the end explicitly identifies checks that remain unverified; this is not a complete launch sign-off.

Both requested accounts have saved authenticated browser profiles and were reopened successfully. That does not mean both accounts, or every feature, are fully working: the findings below prevent that claim. This is a report-only verification; no code fixes were made.

**22 findings: 10 major, 10 minor, 2 polish.** The highest priorities are [duplicated recovered text](#f19), [failed deleted-file recovery](#f22), [rejected Word approval](#f08), [premature saved claims](#f12), and [failed configured fallback](#f15). Finding numbers remain stable from discovery; the entries are ordered by severity and impact.

## Method and environment

- Followed `docs/launch/LIVE-VERIFICATION-PROMPT.md`. Browser interaction used the requested `playwright-cli` skill, mouse/keyboard actions and persistent Chrome profiles. JavaScript was used only for read-only observation and timing, never page operation.
- Normal use: **Andrew Freeman**, whose saved Account menu identifies `ixos.protocol@gmail.com`. School use: **P MD**, `pmartinez@student-tgc.com`. Both saved profiles authenticated without entering a password. No passwords or session tokens are included here.
- Local stack: `npm run local:start:all -- --instance 8`, serving `http://localhost:3000`. The unqualified launcher initially selected a different local instance with no school membership. I stopped that newly started instance and used the existing saved instance. I did not seed or reset the database. That startup detour is test setup, not a student-facing defect.
- Existing release Bridge: **0.1.0**, machine **THUNDERBOLTDY10**, local endpoint port 47615. It was already running before this session. Therefore this is not evidence of a clean installation.
- Mostly **1280 × 720**, with **1024 × 700** and **1920 × 1080** checks in light and dark mode. The exact layout coverage and gaps are listed below.
- Word was operated on a separate off-screen Windows desktop using background input. A new fixture, initially `.playwright-cli/Live verification Word.docx`, contained `Photosynthesis uses light energy. Oxygen is released from water.` Its later native addition was ` Native Word check.` Existing recovered Word documents were not edited. Bridge was temporarily launched on the same off-screen desktop for native folder pickers, then returned to its original normal-desktop background launch.
- App changes in this session are ordinary UI-created verification work, sync connections, preferences and study interactions. No application code, settings files or database were directly edited; no commit was made.
- The file fault injections used scoped PowerShell renames, moves and one deletion of this UI-created fixture, with read-only native metadata, SHA-256 and DOCX text checks. Isolated fixture directories were created under `.playwright-cli` and the configured OneDrive root. No unrelated native file was moved or deleted. Browser operations remained CLI mouse/keyboard actions. These native fault injections, downloads and automatic screenshot/eval artifacts are distinct from application implementation changes.
- Times below are Send-to-observation wall time unless explicitly labelled as the app's own “Worked for” time. A DOM observer records Enter on the composer and visible text mutations. A progress indicator is not counted as an answer. Approximate or unmeasured values are labelled.
- Screenshot links are relative to this repository. Screenshots captured during failed automation selectors or loading transitions are not used as proof of completed actions.
- **335 PNG screenshots** were captured in `.playwright-cli/live-*.png`, including useful transitional and tooling-diagnostic captures. That is an evidence-file count, not 335 independent passed assertions. All 256 Markdown links in this report were checked for existing targets or finding anchors before delivery.
- Activity ran from approximately 06:44–08:27 UTC and resumed at 11:55 UTC through the final checks. The intervening pause was not controlled OS sleep and is not credited as the requested sleep test or a continuous editing soak. Madrid was UTC+1. Local dates and the afternoon greeting agreed with 11 November during the final checks.
- Procedural limitation: several early tool batches advanced before the captured image was returned for inspection. Later file checks inspected their screenshots before dependent actions. The evidence supports the specific observations below, but strict screenshot-before-every-next-step compliance is not claimed.

## Findings, most serious first

<a id="f19"></a>

### F19 — Major: recovered local work duplicates its paragraphs after migration and reopening

**Where:** `Live verification closed local draft`, after two-tab editing, Trash/Restore, then Move them online.

**Steps:** Create the document under Only this computer. Close its editor and have the AI replace its one sentence. Open it in two tabs, add a second paragraph, trash it in one tab, continue typing in the other, restore and reload. Confirm the two paragraphs and 16-word count. Close the second tab. In Devices select Online and Move them online for the one local work. Reopen it from its conversation.

**Expected:** The two paragraphs survive exactly once. Recovery should offer a clear comparison before applying conflicting copies.

**Actual:** Immediately after restore/reload the document contained exactly the intended two paragraphs, 16 words. The migration displayed **Your work is online now**. On reopening, both paragraphs appeared twice, 32 words, with **A local draft needs review. It is kept on this device.** Opening the review showed a current version with two copies of the paragraph pair and a local draft with four copies. I had not selected Apply changes. No manual edits were made between the verified 16-word state and migration/reopening.

**Scope:** Duplication is confirmed for this combined recovery sequence. The observations do not isolate whether Trash/Restore, migration, stale local state, or their interaction caused it. I have not established missing text or corruption of unrelated work. The disposable fixture is retained for investigation rather than manually repaired.

One confirmation reload and reopening still showed four paragraphs / 32 words. The proposed 64-word local draft was not applied; this does not establish exponential growth on every reload. [Persisted duplicated content](.playwright-cli/live-268-duplicate-after-reopen-confirmation.png).

**Evidence:** [16-word restored baseline](.playwright-cli/live-257-local-restored-content.png), [One work to migrate](.playwright-cli/live-258-local-migration-online-choice.png), [Migration success](.playwright-cli/live-259-local-migration-started.png), [32-word reopened document](.playwright-cli/live-261-dark-conversation-work-1280.png), [Current/local recovery excerpts](.playwright-cli/live-266-local-draft-duplicate-excerpts.png).

<a id="f22"></a>

### F22 — Major: Put it back cannot restore the deleted Word fixture and leads to an unusable comparison

**Where:** The isolated folder-backed Word work, Library → Status details.

**Steps:** After the rename/move tests, restore the fixture to `live-file-fixture/Live verification Word.docx`. Confirm Status names this path and says Saved. Verify its SHA-256 is still the original. Delete only that disposable native file at 12:13:54 UTC. Open its Offline status, then press Put it back at 12:14:20. Open the resulting Two versions status and press Compare. Dismiss the status popover to inspect the panel. Reload once.

**Expected:** Recreate the preserved work at the stated path, or show an actionable conflict with the versions that require a decision.

**Actual:** The toast said **Putting the file back in its folder**, but no native file was created. Status became **Two versions**, saying the work changed in two places. Compare opened Version history, containing only **Now / The work as it is**, without Keep Spectra / Keep Word choices or a desktop version. The original 12-word paragraph remained readable in Spectra. Reloading did not restore the missing file or produce a comparison choice. Native enumeration was still empty at 12:15 UTC. This is failure of the offered recovery path, not unexpected deletion: the initial deletion was intentional and restricted to the test fixture.

**Limits:** This follows the combined rename, move, missing-root and pause sequence. It does not prove that a fresh import followed by deletion fails identically. No unrelated files were removed. The text was not lost from Spectra; native recovery required a separate export workaround.

**Workaround verified:** More document tools → Export → Export Word copy downloaded the preserved file. Its DOCX text matched exactly, and after placing that test-owned download back at the original path, its SHA-256 was **608102225D81975EE9BEA2A3246DA7C5D48A9B24AD044599436F14CAF59BFA98**, identical to the native pre-deletion fixture. This workaround does not turn Put it back into a pass. The download event named it `Live verification Word.docx.docx`, an additional small naming rough edge. [Export choices](.playwright-cli/live-313-export-options.png), [Export completed in the same work](.playwright-cli/live-314-word-export-recovery.png).

**Evidence:** [Saved short-path baseline](.playwright-cli/live-305-restored-short-path.png), [Deleted-file explanation and Put it back](.playwright-cli/live-306-deleted-fixture-recovery.png), [Putting back toast and conflict marker](.playwright-cli/live-307-put-it-back.png), [Two versions](.playwright-cli/live-308-put-back-conflict.png), [Only Now in history](.playwright-cli/live-310-put-back-history.png), [Conflict remains after reload](.playwright-cli/live-311-delete-recovery-reload.png).

<a id="f08"></a>

### F08 — Major: Allow rejects an unchanged Word file as a stale approval

**Where:** Claude → edit `Live verification Word.docx`, with Devices → Changes to desktop files → Ask first.

**Steps:** Create and save the separate 13 KB fixture in Word. Add it through Devices → Add files. Close it in Word. After import completes, ask to change only the second sentence to `Splitting water releases oxygen.` Wait for the prompt and press Allow.

**Expected:** The explicit approval applies the proposed narrow edit, or the prompt clearly refreshes before accepting a click if its proposal has become stale.

**Actual:** The prompt appeared **8.251 seconds** after Send. About 32 seconds later I pressed Allow. The app displayed **“The artifact or proposed edit changed. Prepare a new approval.”** The first sentence and second sentence were still the original text. There was no manual file edit between preparation and approval. The prompt reappeared and remained pending; I later declined it to clear the test. I did not run a second AI request to retry this same task.

**Limits:** The later Always test was started while this first approval remained pending, then this approval was declined. Those overlapping run states limit conclusions about the later test; they do not explain away the earlier failed Allow click.

**Evidence:** [Original imported text](.playwright-cli/live-117-word-ask-edit-sent.png), [Permission prompt](.playwright-cli/live-118-word-permission.png), [Allow error](.playwright-cli/live-119-word-permission-accepted.png), [Original in native Word](.playwright-cli/live-124-word-open-before-always.png), [Declined old prompt](.playwright-cli/live-129-old-permission-declined.png).

<a id="f12"></a>

### F12 — Major: the reply says a Word edit is saved while the file is still waiting

**Where:** Claude → Word first-sentence edit, Devices → Always, Word open.

**Steps:** Set desktop writes to Always. Open the fixture in native Word. Ask to change only the first sentence to `Photosynthesis stores light energy as chemical energy.` Open the result and compare its status with the assistant's reply and native Word.

**Expected:** The assistant distinguishes saved in Spectra from confirmed in the desktop file, and explains any deferred write.

**Actual:** The edit appeared correctly in Spectra. The assistant said **“The edit is saved to the synced file.”** At the same time the run summary said **Saved in Spectra · waiting for your file to confirm**, and the work status was **Waiting for Office / Open in Word**. Native Word still displayed the original. A read-only file metadata check showed the original 13,421-byte file with its original 07:13:52 UTC modification time. After Word closed, another read-only inspection confirmed the original paragraph remained on disk at the observation point. The deferred state is a sensible safeguard; the definitive saved claim is false at that moment.

**Limits:** Native Word is on an off-screen desktop, which may affect Office integration. Also see the overlapping old approval noted in F08. Neither limit changes the visible mismatch between the assistant's definitive statement and the app's own pending status. Do not treat this as proof that all normal desktop Word writes fail.

**Later reconciliation:** I manually added ` Native Word check.` in native Word and saved it. After closing Word, the disk file was 13,467 bytes, modified at 07:35:47 UTC, with the original two sentences plus that addition. Spectra eventually displayed a conflict and offered Keep Spectra version / Keep Word version. I chose Word. After reload, Spectra matched the native text exactly. This is a successful explicit conflict resolution, not proof that the earlier AI write reached Word. No silent overwrite or duplicate Word fixture was observed. [Conflict choices](.playwright-cli/live-219-word-after-native-save.png), [Native saved text](.playwright-cli/live-213-word-save-settled.png), [Verified after reload](.playwright-cli/live-233-word-resolution-settled.png).

**Evidence:** [Always selected](.playwright-cli/live-126-always-allow.png), [Saved claim](.playwright-cli/live-130-word-always-result.png), [Native original](.playwright-cli/live-131-word-native-after-always.png), [Edited Spectra copy](.playwright-cli/live-132-word-always-online.png), [Pending Office status](.playwright-cli/live-134-office-wait-explanation.png).

<a id="f15"></a>

### F15 — Major: runtime Codex connection loss ignores the three fallback choices

**Where:** Settings → AI subscriptions → Default AI Codex → If it can't answer.

**Steps:** Select each fallback once. Start a long worked-examples answer. While its rail is still working and before any answer text appears, terminate only the Codex process whose parent is the recorded release Bridge. For the Spectra choice, also stop Bridge and restart it from its original launch arguments. Do not press Retry.

**Expected:** The three fallback choices use the configured next available provider, or clearly explain why that provider cannot continue. Stop should stop without switching providers.

**Actual:** All four runs ended with **Spectra paused this run / The AI session has closed. / Retry**. None of the three configured fallback paths produced an answer or switched providers. Bridge stayed alive for the Claude-only and Claude-then-Spectra cases; both subscriptions had been detected as logged in. The Spectra fallback also did not resume after Bridge restarted. The Stop outcome itself is consistent with the selected policy. Requests were retained; no answer text or work artifact had appeared before termination.

| Selected choice | Interruption | App's work time at terminal state | Outcome / evidence |
|---|---|---:|---|
| Spectra | Codex child and Bridge stopped at 07:55:38 UTC; Bridge restarted at 07:55:46 | 13 s | No fallback; [selection](.playwright-cli/live-199-fallback-spectra-confirmed.png), [active](.playwright-cli/live-195-codex-restart-active.png), [terminal warning](.playwright-cli/live-198-codex-restarted-running.png) |
| Claude Code, then Spectra | Codex child stopped at 07:57:16; Bridge alive | 19 s | No fallback; [selection](.playwright-cli/live-200-fallback-chain-selected.png), [active](.playwright-cli/live-201-chain-codex-active.png), [terminal warning](.playwright-cli/live-203-chain-failure.png) |
| Claude Code | Codex child stopped at 07:58:05; Bridge alive | 14 s | No fallback; [selection](.playwright-cli/live-204-fallback-claude-selected.png), [active](.playwright-cli/live-205-claude-fallback-active.png), [terminal warning](.playwright-cli/live-206-claude-fallback-outcome.png) |
| Stop | Codex child stopped at 07:58:53; Bridge alive | 17 s | Stopped, as requested; [selected option](.playwright-cli/live-210-stop-selected-menu.png), [terminal warning](.playwright-cli/live-209-stop-fallback-outcome.png) |

**Measurement limit:** These are forced failures during an active run, before streamed answer text, not a test of losing the connection after partial prose has appeared. The first short interruption attempt finished before the process was killed and was excluded. One longer repeat corrected that harness timing error. The other policy cases were each run once. Process termination was scoped by parent PID and executable; the Codex desktop agent was not terminated.

<a id="f01"></a>

### F01 — Major: comments/history/references squeeze the document into an unreadable strip

**Where:** Andrew's document beside its conversation at 1024 × 700, light and dark; also a school task with the navigation rail collapsed. Full HD still leaves the document narrow when a wide conversation and Comments compete.

**Steps:** Open `Live verification biology notes` from its conversation. Open Comments. Resize to 1024 × 700. Repeat with History and References.

**Expected:** The document and active panel remain usable, or the layout collapses a competing pane and offers a clear way back.

**Actual:** The navigation rail, conversation and right panel consume almost all available width. The document is reduced to a narrow strip behind the panel; its text cannot be read or edited sensibly. This occurs with all three panels, so it is not a single unusually long label. At 1280 pixels it is less severe but still crowded.

**Evidence:** [Comments at 1024](.playwright-cli/live-39-comments-1024-light.png), [History at 1024](.playwright-cli/live-41-document-history-1024.png), [References at 1024](.playwright-cli/live-43-references-1024.png), [Comments at 1280](.playwright-cli/live-38-document-comments.png).

The later dark-mode confirmation reproduces the unreadable strip at 1024. At full HD the conversation consumes most of the newly available width while the document remains clipped by Comments. [Dark 1024](.playwright-cli/live-262-dark-conversation-comments-1024.png), [Dark full HD](.playwright-cli/live-263-dark-conversation-comments-fullhd.png).

<a id="f10"></a>

### F10 — Major: a generated slide has a clipped heading and an overflow warning

**Where:** Claude's `Live verification cell slides`, slide 2, first opened from its conversation, 1280 × 720.

**Steps:** Request exactly three concise slides about mitosis, meiosis and comparison. Wait for completion. Open the returned presentation and advance to slide 2.

**Expected:** A readable, finished presentation whose text fits its objects.

**Actual:** After the app reported **2m 28s** of work, slide 2's heading ran beyond its text box and was clipped. The editor visibly flagged **Text overflows this object**. Slide 1's diagram and slide 3's comparison were readable. The final reply also exposed the internal explanation **“the table layout kept getting flagged”** despite the user never requesting a table. That explanation is unhelpful, and the final artifact still has a visible layout error.

**Timing limit:** While I was on Devices, the composer first showed `Creating Live verification cell slides` at **67.965 seconds**, then `Editing…` at **88.008 seconds**. These are progress events, not answer text. The exact first-answer time was not isolated while the thread was closed; the app's 148-second work time is recorded instead of pretending it is a measured Send-to-finish duration.

**Evidence:** [Final reply](.playwright-cli/live-98-slides-background-answer.png), [Slide 1](.playwright-cli/live-101-slides-open-actual.png), [Clipped slide 2](.playwright-cli/live-103-slide-two.png), [Readable comparison](.playwright-cli/live-104-slide-three.png).

<a id="f14"></a>

### F14 — Major: a standing-wave derivation gives the wrong sum of its own waves

**Where:** Codex, `Standing wave formation steps`, twelve-step explanation.

**Steps:** Ask: `Explain in twelve numbered steps how a standing wave forms, with an equation in each step. Keep each step to two sentences.` Read steps 1, 2 and 6 together.

**Expected:** The stated total displacement follows algebraically from the two component waves.

**Actual:** The answer defines `y1 = A sin(kx − ωt)` and `y2 = −A sin(kx + ωt)`, then claims their sum is `−2A sin(kx) cos(ωt)`. The actual sum of those stated waves is `−2A cos(kx) sin(ωt)`. For example, at x = 0 and ωt = π/2, the two stated waves sum to −2A while the answer's formula gives zero. The later node explanation therefore does not follow from its starting equations. The run's visible work time was 10 seconds. The earlier, separate two-sentence standing-wave question was correct.

**Evidence:** [Definitions and claimed sum together](.playwright-cli/live-194-codex-equations.png), [Later consequences](.playwright-cli/live-193-codex-restart-outcome.png). This completed run was an interruption timing miss; it is excluded from the connection-loss results below.

<a id="f09"></a>

### F09 — Major: Stop reports stopped, then the visible conversation resumes Working

**Where:** Claude, `Standing wave equation derivation`.

**Steps:** Ask for a long derivation with ten worked examples. Open its conversation and press Stop while it is still starting. Observe immediately and again about 12 seconds later.

**Expected:** A stable stopped state, with any partial result labelled clearly. A student should know whether more work can still be created.

**Actual:** Stop disappeared and the rail's accessible summary said **“Stopped by you. Any partial response remains available in the thread.”** Immediately after the click, the conversation contained only the user's request. In the later screenshot it again displayed **Working for 54s**, with **Creating Standing Waves: Derivation and Ten Worked Examples** underneath, while the rail still showed the stopped marker. No first answer had appeared before Stop. This is a confirmed contradictory visible state; I have not established that the server continued writing after cancellation, as the resurrected progress could also be stale UI.

**Evidence:** [Before Stop](.playwright-cli/live-111-stop-before.png), [Immediately after](.playwright-cli/live-112-stop-after.png), [Working/Creating returns](.playwright-cli/live-113-stop-settled.png).

<a id="f02"></a>

### F02 — Major: the golden one-page task fails its explicit page constraint

**Where:** Required AI quality command, `npm run eval:ai -- --golden`.

**Steps:** Run the command once, then inspect its HTML report and structured result.

**Expected:** A request for a one-page photosynthesis revision sheet fits one page, and the assistant describes the result honestly.

**Actual:** **19/20 scenarios passed; exit code 1.** `golden: one page` failed: the generated sheet measured **1.69 pages**, 383 words. The reply nevertheless described it as a one-page/condensed result. First output 1,748 ms; total 12,244 ms. Suite duration 88.6 seconds. The report identifies model `openai/gpt-6-luna`; this is separate from the live Claude/Codex UI checks.

**Evidence:** [Suite summary](.playwright-cli/live-05-golden-results.png), [One-page failure](.playwright-cli/live-06-golden-one-page.png), [Machine results](.spectra-local/ai-evals/2026-11-11/results.json), [Full HTML report](.spectra-local/ai-evals/2026-11-11/report.html).

<a id="f18"></a>

### F18 — Minor: opening Share moves local work online before a sharing choice

**Where:** More work actions → Share work on `Live verification local draft`, created under Only this computer.

**Steps:** Open Share work. Before selecting anyone or making a public link, read the toast and sharing dialog.

**Expected:** Explain the required online migration before changing the storage choice, or perform it when the user actually invites someone or creates a link.

**Actual:** Merely opening the dialog displayed **Moved online so the people you share with can open it**, while access was still Only you and link sharing was Off. This is an early storage change that a student exploring Share could miss. No external access was granted by merely opening the dialog. The later deliberate public link worked and was turned off; this finding is about migration timing and clarity, not an unauthorized public disclosure.

**Evidence:** [Share dialog with migration toast, before a link](.playwright-cli/live-244-share-local-work.png), [Deliberately created link](.playwright-cli/live-245-local-share-link-created.png), [Link turned off](.playwright-cli/live-247-public-link-turned-off.png), [Public view becomes unavailable](.playwright-cli/live-248-public-draft-content.png).

<a id="f06"></a>

### F06 — Minor: switching saved account profiles leaves confusing Bridge/fallback status

**Where:** Devices and Claude run details after reconnecting this computer under the school account, then returning to Andrew.

**Steps:** Pair the existing Bridge in Andrew's Devices page. Open the saved school profile and reconnect this computer there. Return to Andrew and send a Claude question. Expand the fallback details. Close the school browser, reconnect Andrew, and run the next scheduled Claude question.

**Expected:** If this Bridge can serve only the current account, explain which account/computer needs reconnecting. Provider failure wording should distinguish an unpaired account from an absent process.

**Actual:** The first Claude answer completed with the **Finished with Spectra** fallback. Its detail said **“Spectra Bridge isn't running”**, while the release Bridge process was alive. Andrew's Devices page needed reconnection. After closing the competing school profile and reconnecting Andrew, the next Claude question completed without the fallback badge. This establishes a visible account/connection-state problem; it does not prove concurrent multi-account Bridge support is intended.

No cross-account document contents were exposed: opening Andrew's newly created private document URL from the school profile redirected to the school Library, and its private sentence was absent.

**Evidence:** [School reconnect](.playwright-cli/live-42-reconnect-school.png), [School post-reconnect status](.playwright-cli/live-44-school-reconnected.png), [Fallback explanation](.playwright-cli/live-50-claude-fallback-details.png), [Andrew needs reconnect](.playwright-cli/live-51-andrew-after-account-switch.png), [Reconnected Andrew](.playwright-cli/live-52-andrew-reconnected-only-browser.png), [Next Claude answer](.playwright-cli/live-54-claude-question-two-outcome.png), [Isolation check](.playwright-cli/live-49-isolation-settled.png).

<a id="f11"></a>

### F11 — Minor: a small Word import remains at zero progress for minutes

**Where:** Devices → Add files → newly saved `Live verification Word.docx`.

**Steps:** Add the 13,421-byte Word file while it is open in Word. Observe Devices. Close it in Word. Wait, then pause and resume its sync card.

**Expected:** A quick import, or an explanation that Office is blocking it and what to do.

**Actual:** From roughly **07:16 to 07:21 UTC**, the card showed Syncing / **0 of 1 files**, without an error or an Office explanation. It was still zero after Word closed. Pause changed the card to Paused; Resume returned it to Syncing. It subsequently became Up to date and opened with its original text intact. I cannot tell whether pause/resume caused recovery or merely coincided with a slow import. No duplicate fixture was observed.

Later isolated-folder and OneDrive imports reached Up to date without reproducing this multi-minute zero-progress state. This finding is scoped to the original import sequence, not every small Word import.

**Evidence:** [Initial import](.playwright-cli/live-95-word-added.png), [Still zero](.playwright-cli/live-96-word-sync-settled.png), [Still syncing after close](.playwright-cli/live-105-word-after-close.png), [Paused](.playwright-cli/live-106-word-paused.png), [Resumed](.playwright-cli/live-107-word-resumed.png), [Eventually up to date](.playwright-cli/live-109-older-thread-concurrent.png), [Original opens](.playwright-cli/live-117-word-ask-edit-sent.png).

<a id="f20"></a>

### F20 — Minor: a rename during Pause remains stale after Resume and reload

**Where:** Devices → `live-file-fixture`, after a missing-folder/Retry recovery.

**Steps:** Restore the renamed-away root folder and press Retry; observe Up to date. Pause that folder at 12:10:20 UTC. Rename its one file from `Biology/生物のノート.docx` to `Biology/Paused rename.docx` at 12:10:35. Resume at 12:10:39. Open the work's Status details, then reload and open Status again at 12:12:08.

**Expected:** Resume reconciles changes made while paused, or indicates that a scan is still pending. Saved status names the existing file.

**Actual:** About 89 seconds after Resume, including a full reload, Status still said Saved and named `生物のノート.docx`. Native enumeration showed only `Paused rename.docx`, with the unchanged 13,467 bytes. A subsequent move to a long path while syncing was active refreshed the same work to its new path. No text was lost and no second native file was created. This is limited to this combined missing-root recovery / pause / rename sequence; I did not isolate which earlier state contributed.

**Evidence:** [Paused](.playwright-cli/live-297-folder-paused.png), [Resumed](.playwright-cli/live-298-folder-resumed-rename.png), [Stale status after reload](.playwright-cli/live-302-resume-stale-file-status.png), [Later active move refreshes path](.playwright-cli/live-304-long-path-status.png). Screenshot 300's filename says “correct filename”; its contents actually show the stale name, so it is not evidence of recovery.

<a id="f03"></a>

### F03 — Minor: Home opens the full thread with “Open thread when I send” turned off

**Where:** Settings → Spectra AI, then Home.

**Steps:** Observe the “Open thread when I send” switch off. From Home send the standing-wave question. Later begin a new document request from Home.

**Expected:** With that option off, Home stays in place and the answer arrives through the background conversation UI.

**Actual:** Sending navigated directly to `/home?threadId=…` and opened the full conversation. The same transition occurred on a later fresh request. Background answering itself works: after navigating to Calendar, an answer bubble appeared there.

**Evidence:** [Off preference](.playwright-cli/live-13-settings.png), [Question after sending](.playwright-cli/live-25-home-question-sent.png), [Calendar background answer](.playwright-cli/live-26-calendar-during-question.png), [Fresh document request](.playwright-cli/live-28-document-request.png).

<a id="f04"></a>

### F04 — Minor: a question back is shown twice while its conversation is already open

**Where:** Claude question-back flow, `Choosing a study subject` conversation.

**Steps:** Ask for a revision tip, first asking which subject and offering Maths/Biology. Wait for the question while leaving the conversation open.

**Expected:** One clear question with one set of answer choices.

**Actual:** The same question and Maths/Biology choices appeared both inline and in a floating prompt. The floating prompt also offered to open the thread even though it was already open. Clicking Biology in the floating prompt did continue correctly and produced a Biology revision tip. The duplicate presentation adds uncertainty about whether both need an answer.

**Evidence:** [Duplicate question and choices](.playwright-cli/live-57-claude-asks.png), [Answer accepted](.playwright-cli/live-58-claude-answering-choice.png), [Useful follow-up](.playwright-cli/live-59-choice-followup.png).

<a id="f05"></a>

### F05 — Minor: Open full first moves to Library but leaves the work in its panel

**Where:** A whiteboard opened from its floating conversation over Settings, 1280 × 720.

**Steps:** From Settings, open the `Live verification cell map` conversation. Open its work card. Press Open full once. Wait about 38 seconds. Press Open full again.

**Expected:** One press opens the full editor.

**Actual:** The first press navigated to Library and retained the side panel. It was still a side panel after the wait. The second press opened the full editor and added the work's view tab. This is context-dependent: a school task already opened in Library did open full on the first press. The initial broad suspicion was withdrawn during testing; this later sequence establishes the narrower, reproducible case.

**Evidence:** [Opened over Settings](.playwright-cli/live-212-whiteboard-open.png), [First press](.playwright-cli/live-214-whiteboard-full.png), [Still a panel after waiting](.playwright-cli/live-216-whiteboard-full-settled-still-panel.png), [Second press opens full](.playwright-cli/live-217-whiteboard-second-open-full.png).

<a id="f13"></a>

### F13 — Minor: a usable graph is presented with a technical error and “Preview stopped”

**Where:** `Live verification wave graph`, opened from the Claude reply, 1280 × 720.

**Steps:** Open the generated graph. Wait for its preview. Press Restart once after the error. Move the amplitude slider to its maximum and press Reset.

**Expected:** A clean, working graph or an accurate, understandable explanation of a real failure.

**Actual:** A red banner says **ResizeObserver loop completed with undelivered notifications.** A lower preview state says **Preview stopped** and offers Restart. Restart reproduced the error. Nevertheless, the embedded graph was live: End on the amplitude slider changed A to 3, the dashed curve and explanatory text updated, and Reset restored A to 2. The conflicting failure UI is misleading, and its raw browser error is not useful to a student. The reply also calls the graph “above” although this conversation shows an Open card rather than an inline graph.

**Evidence:** [Reply with Open card](.playwright-cli/live-138-graph-result.png), [Error on opening](.playwright-cli/live-140-graph-settled.png), [Restart](.playwright-cli/live-141-graph-restart.png), [A = 3](.playwright-cli/live-142-graph-amplitude.png), [Reset](.playwright-cli/live-143-graph-reset.png).

<a id="f16"></a>

### F16 — Minor: selecting Stop displays Select in the closed fallback control

**Where:** Settings → AI subscriptions → If it can't answer.

**Steps:** Choose Stop, then reopen the list.

**Expected:** The closed control displays Stop, matching the selected policy.

**Actual:** The closed control displays **Select**, while the reopened list marks **Stop** selected. A student cannot see their chosen policy without opening the list. The stopped run confirms this was not merely an unselected option.

**Evidence:** [Select after choosing Stop](.playwright-cli/live-207-fallback-stop-selected.png), [Stop checked in the menu](.playwright-cli/live-210-stop-selected-menu.png).

<a id="f17"></a>

### F17 — Minor: another tab keeps editing trashed work without a warning

**Where:** Two tabs of Andrew's disposable online copy, then two tabs of the separate local draft.

**Steps:** Open the same work in two tabs. Type in the second. Move it to Trash from Library in the first. Return to the still-focused second editor and continue typing. Restore it through Trash, then reload.

**Expected:** The editor identifies that the work is in Trash and explains whether further typing is retained, with a clear restore/recovery action.

**Actual:** The second editor remained editable, showed Saved, and gave no trash warning. Further typing was accepted. For both tested storage modes, restore and reload initially retained that text. Thus this is a missing-state warning, not a claim of lost text. The later local migration/reopen sequence did duplicate content; that is separately documented in F19. The test switched between tabs between keystroke bursts; it does not establish every possible unsaved-keystroke race.

**Evidence:** [Online copy moved to Trash](.playwright-cli/live-226-copy-trashed.png), [Continued editing](.playwright-cli/live-228-editing-trashed-copy.png), [Restored online content](.playwright-cli/live-231-restored-copy-content.png), [Local work trashed](.playwright-cli/live-255-local-work-trashed.png), [Local editor continues](.playwright-cli/live-256-local-other-tab-after-trash.png), [Initial local restore](.playwright-cli/live-257-local-restored-content.png).

<a id="f07"></a>

### F07 — Polish: Runs exposes raw emphasis markers

**Where:** The global Runs panel.

**Steps:** Open Runs after the Claude question.

**Expected:** Human-readable summaries with formatting rendered or removed.

**Actual:** Some run summaries visibly contain literal `**…**` emphasis markers. This makes the activity history look like an implementation transcript.

**Evidence:** [Runs panel](.playwright-cli/live-55-claude-run-details.png).

<a id="f21"></a>

### F21 — Polish: a long folder name runs past the status popover's edge

**Where:** Library work → Status details, 1280 × 720 dark, file at a 325-character absolute path.

**Steps:** Move the isolated Word fixture into a folder whose name is `Long-` followed by 225 `a` characters. Open its work and Status details.

**Expected:** The path wraps, truncates with a clear affordance, or can be inspected without clipping the sentence.

**Actual:** The unbroken folder name in the Saved explanation runs past the popover's right boundary and is cut off. The separate Where row is intentionally ellipsized, but the explanatory sentence has no comparable readable end. File discovery and opening still worked, with the same artifact ID and unchanged native SHA-256. This is a display defect, not a failed long-path import.

**Evidence:** [Long-path status popover](.playwright-cli/live-304-long-path-status.png), [Readable document](.playwright-cli/live-303-long-path-work.png).

## Checks that did not become findings

- A school task already in Library opened full correctly on its first press. This limits F05 to the later observed navigation context; it is not a universal two-press claim. [Successful full task, dark](.playwright-cli/live-175-task-full-dark.png), [Light](.playwright-cli/live-177-task-full-light-fullhd.png).
- A transient `Spectra is building…` subtitle on newly opened work changed to the finished summary after loading. It is not reported as a permanent stuck state.
- The browser was deliberately offline from approximately **07:33:12 to 07:35:58 UTC** (2m 46s; native automation extended the planned two minutes). An open online document accepted `Offline browser check.`. The paragraph survived reconnection and a full reload. This tests browser disconnection, not a host-wide network outage or a local-only storage authority. [Offline banner](.playwright-cli/live-147-browser-offline.png), [Typed paragraph](.playwright-cli/live-148-offline-typed.png), [Persisted after reload](.playwright-cli/live-156-offline-edit-persisted.png).
- The first idle probe was invalidated when the CLI Andrew session closed after a Node-side event-listener probe. It was restarted using a browser PerformanceObserver. I have not attributed that tooling failure to Spectra.
- The Convex dashboard opened to a separate sign-in page. No saved dashboard authentication or dashboard credentials were supplied. Database call counts and per-edit database cost therefore remain unmeasured. [Dashboard sign-in](.playwright-cli/live-168-convex-dashboard-entry.png).

## What worked well

- Both requested saved accounts authenticated and showed different work. The direct private-document URL check did not expose Andrew's content to the school account.
- Reconnecting the existing Bridge was a short, successful UI flow. Both Codex Plus and Claude Pro logins appeared in Settings after pairing.
- The standing-wave answer was scientifically appropriate and obeyed the two-sentence constraint. Calendar remained usable while it arrived in a background bubble.
- The online one-sentence edit preserved the first sentence exactly; Undo restored the original two sentences and 14-word count. [Edited result](.playwright-cli/live-34-small-edit-result.png), [Actual Undo](.playwright-cli/live-37-undo-actual.png).
- All three scheduled Claude online edits made the requested narrow changes. Undo of the third edit restored the preceding two sentences exactly. [First edit](.playwright-cli/live-65-claude-edit-one-result.png), [Second edit](.playwright-cli/live-69-claude-edit-two-result.png), [Third edit](.playwright-cli/live-71-claude-edit-three-result.png), [Undo](.playwright-cli/live-73-claude-undo.png).
- Claude's three-question quiz appeared live in the conversation; selecting an option worked. The opened studio eventually showed all three questions. The flashcard deck had exactly three cards and could be flipped and advanced without leaving the conversation. [Quiz](.playwright-cli/live-76-claude-quiz-result.png), [Selected answer](.playwright-cli/live-77-quiz-answer.png), [Flashcard answer](.playwright-cli/live-84-flashcard-answer.png), [Second card](.playwright-cli/live-85-flashcard-two.png), [Opened deck](.playwright-cli/live-87-flashcards-open.png).
- ManageBac's saved connection refreshed successfully: **22 classes, 96 calendar events, tasks increased from 15 to 18**, with “just now” freshness. Completion was visible within a 20-second observation window. [Syncing](.playwright-cli/live-18-managebac-sync.png), [Completed sync](.playwright-cli/live-20-sync-outcome.png).
- Replying to the older Claude document thread while the graph was working succeeded. The requested `Revision complete.` paragraph appeared in both target documents, and one run-level Undo restored both preceding texts. [Multi-work result](.playwright-cli/live-120-multi-edit-result.png), [Undo](.playwright-cli/live-123-multi-undo.png), [Other document restored](.playwright-cli/live-125-multi-undo-other-doc.png).
- The task had the requested due date/time and three checklist items. The whiteboard contained the three requested nodes and two labelled connectors; Fit content made the full map easy to read. [Task](.playwright-cli/live-145-task-open.png), [Whiteboard fitted](.playwright-cli/live-218-whiteboard-fit.png).
- Short browser-offline edits, typing while Bridge was stopped, and an AI edit of a closed local document all retained the requested text at their immediate recovery checks. These are useful successes with the later migration duplication in F19 kept separate. [Bridge-down typing](.playwright-cli/live-239-local-bridge-stopped-typing.png), [Recovered local text](.playwright-cli/live-243-local-work-recovered.png), [Closed-work AI edit](.playwright-cli/live-252-local-closed-edit-verified.png).
- The deliberately created public link opened the shared snapshot, and turning it off immediately made the public view unavailable. There were no invitations or messages to other people. [Revoked link](.playwright-cli/live-247-public-link-turned-off.png), [Unavailable public view](.playwright-cli/live-248-public-draft-content.png).
- The explicit Word/Spectra conflict offered understandable version choices. Choosing the native Word version preserved its text after reload. Active renames, a non-Latin filename, a 325-character path, folder-return Retry and device reconnection also had successful checks described below.

## Measured AI runs

| Run | Provider selected / observed | First answer | Finished | Check |
|---|---|---:|---:|---|
| Standing-wave question | Codex; no fallback badge observed | 9.806 s | 12.172 s | Correct two sentences; progress at 0.190 s |
| Biology document creation | Spectra | Not isolated precisely | ~9.220 s | Timing mark ~0.8 s before Enter; exact text created |
| Biology one-sentence edit | Spectra | 6.590 s | 8.059 s | Correct narrow edit; exact Undo |
| Mitosis vs meiosis | Claude selected, Spectra fallback | 3.692 s | 4.982 s | Fallback explicitly disclosed; F06 |
| DNA replication question | Claude, no fallback badge | 4.758 s | 6.149 s | Correct one sentence |
| Ask subject before tip | Claude | Question visible ~6 s | App: 9 s active work | Human answer wait is separate; duplicate UI F04 |
| Claude document creation | Claude | 9.355 s | 10.700 s | Exact two sentences |
| Claude online edit 1 | Claude | See timing observer limitation below | 9.576 s | First sentence only |
| Claude online edit 2 | Claude | See timing observer limitation below | 10.632 s | Second sentence only |
| Claude online edit 3 | Claude | See timing observer limitation below | 11.032 s | Added third sentence; exact Undo |
| Claude quiz | Claude | Not isolated precisely | 18.473 s | Three questions, live embedded work |
| Claude flashcards | Claude | Not isolated precisely | 15.093 s | Exactly three cards |
| Cytokinesis question, keyboard send | Claude, no fallback badge | 4.332 s | 5.738 s | Correct one sentence; app work time 3 s |
| Claude presentation | Claude | Not isolated precisely | App: 148 s | Slide 2 overflows; F10 |
| Cell revision task | Claude | Not isolated precisely | App: 11 s | Due 12 Nov at 17:00, three checklist items |
| Interactive wave graph | Claude | Not isolated precisely | App: 88 s | Slider and Reset work despite F13 |
| Cell division whiteboard | Claude | Not isolated precisely | App: 10 s | Three nodes and two labelled connectors; opened from reply |
| Multi-document edit | Claude | Not isolated precisely | App: 11 s | Both requested paragraphs added; Undo restored both works |
| Word Ask first | Claude | Approval prompt: 8.251 s | Approval failed; no successful finish | F08; original intact at this point |
| Word Always | Claude | Not isolated precisely | Spectra edit completed; desktop confirmation remained pending | F12; do not count the saved claim as a confirmed native finish |
| Claude Stop | Claude | None before Stop | No successful finish | Contradictory terminal/progress states; F09 |
| Twelve-step standing-wave explanation | Codex | Not isolated precisely | App: 10 s | Finished before interruption; algebra wrong, F14 |
| Four forced Codex failures | Codex, each policy once | No answer text before loss | App: 13 / 19 / 14 / 17 s | Terminal warnings, not successful finish times; F15 |
| Edit a closed local document | Spectra default | Completion announcement: 9.351 s | App: 6 s active work | Exact replacement verified; no browser had its editor open |

“Not isolated precisely” means the captured observer did not cleanly separate an answer mutation from surrounding UI mutations. It is not a zero-second result. These are timing coverage gaps, not invented measurements. A screenshot of the third edit briefly looked like `cells.Both`; subsequent read-only DOM inspection did not confirm a missing space, so it is not filed as a persistent text-corruption finding.

## Computer-file checks: expectation, result, and preservation

The native fixture was deliberately simple, with one paragraph. Its final text is `Photosynthesis uses light energy. Oxygen is released from water. Native Word check.` Results for this fixture do not establish fidelity for complex Word layouts, tracked changes, tables, macros or every Office version.

| Check | Expected | Observed result | Loss / duplication and limits |
|---|---|---|---|
| AI edit while Word is closed | Approved narrow change reaches the native file and can be undone exactly | Ask first produced the prompt but Allow failed; [F08](#f08) | Original native text remained. A successful native edit and exact Word Undo were not established. |
| AI edit while Word is open | Clearly distinguish an applied Spectra edit from a deferred Office write | Spectra changed, native file did not at the checked point; the reply overclaimed Saved; [F12](#f12) | Original native file remained. No silent overwrite observed; overlapping approval and off-screen Office limit the broader conclusion. |
| Native Word edit while Spectra is idle | Saved native text appears in Spectra | Added and saved ` Native Word check.` in Word. The prior conflicting Spectra edit caused a review choice; Keep Word version then reload produced the exact 12-word paragraph | Native text preserved. This was not a pristine idle-only case because a prior AI version existed. [Conflict](.playwright-cli/live-219-word-after-native-save.png), [reloaded result](.playwright-cli/live-233-word-resolution-settled.png). |
| Same file changed in both places | Explicit decision, no silent overwrite | Keep Spectra / Keep Word choices were shown; choosing Word worked | No duplicate native file or lost chosen text observed in this conflict. This success does not cover the separate deletion-recovery failure. |
| Active ordinary rename / non-Latin name | One work follows the renamed file | Renamed to `生物のノート.docx`; Status details showed the Japanese name. Same artifact `z97295exrjvs1wb411jfkejy498j0kmd` opened the unchanged paragraph | Same native SHA-256, no extra file observed. Title and Recent label refreshed at different observation points. [Non-Latin status](.playwright-cli/live-289-nonlatin-status.png). |
| Case-only rename | Track changed casing without a second work/file | Final isolated check in OneDrive changed `Live verification Word.docx` to `live verification word.docx`. Devices listed one file at the same artifact ID; Status named the lower-case file. Restored original casing afterward | Native SHA-256 unchanged. [Case-only Status](.playwright-cli/live-337-case-only-rename-verified.png). The earlier quick case/non-Latin sequence alone was not used to claim this pass. |
| Move inside synced folder | Preserve identity/content and update location | Moved into child `Biology`; opened the same artifact. Later Status showed `live-file-fixture › Biology` | One native file; unchanged hash. [After inside move](.playwright-cli/live-290-move-inside-folder.png), [Biology location](.playwright-cli/live-302-resume-stale-file-status.png). The latter screenshot has a later stale basename, specifically F20. |
| Move out, then back | Explain unavailable native file while preserving the Spectra copy | Moved only the fixture to a sibling outside the mount. Status said deleted or moved out, kept the work, and offered Put it back. Returned it natively before the next test | Text retained and no extra native file observed. [Explanation](.playwright-cli/live-293-moved-out-status.png). This was a move, not the later actual deletion. |
| Root folder disappears and returns | Show a reachability problem and recover on return | Renamed root away at 12:09:23 UTC. Initial Up to date was transient. After reload at 12:09:46 the app said Needs attention / couldn't reach the folder. Restored root and pressed Retry at 12:10:05; Up to date returned | Hash unchanged, no duplicate fixture. [Missing root](.playwright-cli/live-295-folder-missing-after-reload.png), [Retry recovery](.playwright-cli/live-296-folder-return-retry.png). A physical drive unplug was not separately performed. |
| Pause with a change while paused | Pause is clear; Resume reconciles missed changes | Pause and Resume controls worked. Renaming while paused left the old filename in Saved status after ~89 seconds and reload; a later active move refreshed it | No native loss or duplication; stale metadata, [F20](#f20). |
| Very long path | Open or give an accurate actionable limit error | Native absolute path length **325 characters**, one 230-character directory component. Devices found the file; same artifact opened exact text and Status tracked the path | Hash unchanged, one native file. Path display clipped, [F21](#f21). This establishes this path, not every Windows/Office path limit. |
| Actual native delete, then offered recovery | Keep Spectra content; Put it back restores it | Intentional deletion detected. Put it back failed into Two versions with an empty comparison/history choice; [F22](#f22) | Text remained in Spectra. Separate Export Word copy yielded a byte-identical native recovery. The native deletion itself was deliberate. |
| OneDrive folder | Import the local OneDrive-backed file without losing text | Created `C:/Users/pablo/OneDrive/Spectra live verification 2026-11-11`, moved only the fixture, added that folder through the native picker. It reached Up to date, opened the exact paragraph and detected Open in Office while Word was open | One native DOCX, hash unchanged. This deliberate reimport after device removal created a new artifact `z975esnj1t51665y29a02j5abx8j0rap`; retained older library works are expected from those explicit actions, not spontaneous duplication. [Folder added](.playwright-cli/live-329-onedrive-folder-added.png), [native Word](.playwright-cli/live-330-onedrive-native-word.png), [opened work](.playwright-cli/live-334-onedrive-open-work.png), [final normal Bridge](.playwright-cli/live-335-final-bridge-onedrive.png). Remote OneDrive upload, cloud-only hydration and competing cloud edits were not verified. |
| Office temporary and lock files | No student-facing junk works | During the observed OneDrive Word open/close cycle, native hidden-file enumeration and Devices showed only the real DOCX; Bridge correctly listed Open in Office | No temporary-file import or duplicate seen. No `~$` file was emitted in that observed modern OneDrive cycle, so this is not a test of every classic Office lock-file pattern. [One-file list](.playwright-cli/live-331-onedrive-office-file-list.png). |
| Remove this device | Stop syncing, retain native/Spectra copies unless Trash is chosen, reconnect later | Removed only the current test device, leaving Also move its files to Trash unchecked. Status confirmed removal; native hash remained. I already have it reconnected; prior mount selections were cleared as part of removal | Native file retained; no Trash choice was applied. New OneDrive mount was deliberately added afterward. [Confirmation](.playwright-cli/live-315-remove-own-device-confirmation.png), [removed](.playwright-cli/live-316-own-device-removed.png), [reconnected](.playwright-cli/live-317-device-reconnect-after-removal.png). Other existing devices were not removed. |
| Offline mid-edit / kill Bridge mid-write | Recover without a false saved claim or partial native overwrite | Browser-offline online/local editor checks and Bridge-down local typing are documented below. A precisely timed native Word disk-write interruption was not captured | **Not a native-file mid-write pass.** Local editor typing and active Codex process loss are different conditions. |
| Over-size file | Clear limit error; no misleading import success | **Not run:** no over-limit fixture or visible verified size threshold was established; I did not synthesize a large binary or read implementation limits | No conclusion about rejection, partial import or fidelity. |
| System clock change | Sync remains safe and status dates make sense | **Not run:** the browser and Bridge use this shared real Windows host. No isolated clock/VM was provisioned, and a host-wide time change would affect the user's other sessions | Afternoon greeting and current dates were checked against actual local time; that does not substitute for clock-skew testing. |

## Local-work recovery checks

| Check | Result and evidence | Preservation / limitation |
|---|---|---|
| Edit without browser internet | Under Only this computer, added `Local offline edit.` during browser disconnection | Retained on reconnect. Short local outage (~16 s), separate from the 2m 46s online-document check. [Offline local edit](.playwright-cli/live-237-local-offline-edit.png). |
| Quit Bridge while typing | Stopped only the verified Bridge process at 08:10:19 UTC; continued typing; restarted at 08:10:46 | `Typing before Bridge quits. Continued without Bridge.` was retained. A cold second tab initially explained that Bridge was needed, then opened the full text after restart. [Typing](.playwright-cli/live-239-local-bridge-stopped-typing.png), [needed Bridge](.playwright-cli/live-242-local-work-bridge-needed.png), [recovered](.playwright-cli/live-243-local-work-recovered.png). Not a proven interruption of a native disk write. |
| Same work in two tabs | Online and local documents reflected changes between tabs | Immediate sync worked. No universal concurrent-edit merge guarantee is inferred. [Online first tab](.playwright-cli/live-225-first-tab-synced.png), [local first tab](.playwright-cli/live-254-local-first-tab-synced.png). |
| Trash in one tab, type in the other | Other tab remained editable/Saved without a warning; both initially restored the text | Missing state warning [F17](#f17). The combined local restore/migration sequence later duplicated text [F19](#f19). Tab switches separated typing bursts; every unsaved race was not exercised. |
| AI edits with no editor open | Created the local document, closed its editor, requested one sentence replacement, then opened it | Exact result: `This local draft has been revised while closed.` Eight words. Completion announcement observed 9.351 s after Send; app active work 6 s. [Reply](.playwright-cli/live-251-ai-closed-local-result.png), [exact text](.playwright-cli/live-252-local-closed-edit-verified.png). |
| Share local work | Opening Share migrated it online before a sharing choice; deliberate link then worked and was revoked | Storage surprise [F18](#f18). No external invite or message. Revoked public URL was checked from a separate unauthenticated browser. |
| Move all local work online | UI reported one work to migrate and completed successfully | Reopening duplicated its two paragraphs from 16 to 32 words; unresolved local recovery proposed 64 words. Apply was not clicked. [F19](#f19). |
| Interrupt migration halfway | **Not run to completion:** the one-work migration completed before an interruption point was observed | I did not manufacture more user work or label a post-completion disconnect as an interruption. The normal completed path already failed preservation. |
| Second computer / second store takeover and later edits from first | **Not run:** only one live Bridge store/computer was provisioned | Existing Test Laptop cards were offline records, not a controllable second live store. No alternate store/config was fabricated. |

## Layout coverage and first-open behavior

All seven requested work types were created and opened from their conversations. Documents, task and whiteboard opened in the right Work studio beside the thread; Open full offered a larger view. Quiz and cards were already usable inline before opening the studio. Slides showed their first slide on opening; the graph showed its preview and error state. This is first-open coverage, not an exhaustive editor audit.

| Work | What was checked | Outcome / evidence |
|---|---|---|
| Document | Requested two sentences, narrow edits, original restoration | Correct original and online edits; exact Undo. [Document open](.playwright-cli/live-31-created-document-open.png), [Claude document](.playwright-cli/live-62-claude-document-open.png). |
| Quiz | Exactly three questions, live selection, studio loads all questions | Creation/opening passed. First answer selected; all three questions were not completed/scored in sequence. [Inline quiz](.playwright-cli/live-76-claude-quiz-result.png), [answer](.playwright-cli/live-77-quiz-answer.png), [studio](.playwright-cli/live-79-quiz-open.png). |
| Flashcards | Three cards, flip first, advance to second, open deck | Functional sampled interaction; third answer not individually audited. [Flip](.playwright-cli/live-84-flashcard-answer.png), [next](.playwright-cli/live-85-flashcard-two.png), [deck](.playwright-cli/live-87-flashcards-open.png). |
| Presentation | All three slides opened/read, slide 2 fit | Failed slide 2 fit [F10](#f10). Notes-added marker seen; notes content not expanded. |
| Task | Due **Thursday 12 Nov 2026, 17:00**, three checklist items | Passed requested task fields and opening. [Task result](.playwright-cli/live-144-task-result.png), [task open](.playwright-cli/live-145-task-open.png). |
| Graph | Amplitude 2 → 3, live curve and label change, Reset → 2; Restart once | Interaction passed; error/stopped presentation failed [F13](#f13). |
| Whiteboard | Cell division heading, Mitosis/Meiosis nodes, two labelled arrows; Fit content | Content correct. Context-dependent Open full needed two presses [F05](#f05). [Fitted map](.playwright-cli/live-218-whiteboard-fit.png). |

| Surface | 1024 × 700 | 1280 × 720 | 1920 × 1080 |
|---|---|---|---|
| Light Library + Work studio | [273](.playwright-cli/live-273-library-light-1024-panel.png) | [274](.playwright-cli/live-274-library-light-1280-panel.png) | [275](.playwright-cli/live-275-library-light-fullhd-panel.png) |
| Dark Library + Work studio | [277](.playwright-cli/live-277-library-dark-1024-panel.png) | [278](.playwright-cli/live-278-library-dark-1280-panel.png) | [276](.playwright-cli/live-276-library-dark-fullhd-panel.png) |
| Light Calendar side panel | [Layers 272](.playwright-cli/live-272-calendar-light-1024-layers.png); [task 160](.playwright-cli/live-160-calendar-task-panel.png) | [Layers 271](.playwright-cli/live-271-calendar-light-1280-layers.png) | [Layers 270](.playwright-cli/live-270-calendar-light-fullhd-layers.png) |
| Dark Calendar + task | [167](.playwright-cli/live-167-calendar-dark-1024-panel.png) | [169](.playwright-cli/live-169-calendar-dark-1280-panel.png) | [166](.playwright-cli/live-166-calendar-dark-fullhd-panel.png) |
| Light conversation/work | [Comments 39](.playwright-cli/live-39-comments-1024-light.png), [History 41](.playwright-cli/live-41-document-history-1024.png), [References 43](.playwright-cli/live-43-references-1024.png) | [Comments 38](.playwright-cli/live-38-document-comments.png), multiple creation/edit steps | [269](.playwright-cli/live-269-light-fullhd-conversation-work.png) |
| Dark conversation/work | [Comments 262](.playwright-cli/live-262-dark-conversation-comments-1024.png) | [261](.playwright-cli/live-261-dark-conversation-work-1280.png) | [Comments 263](.playwright-cli/live-263-dark-conversation-comments-fullhd.png); [reopened work 268](.playwright-cli/live-268-duplicate-after-reopen-confirmation.png) |

The compact Library can adapt to give the work most of the width and collapse the rail, a useful behavior visible in screenshot 277. Nested Comments/History/References still compete with the conversation and make the content unusable in F01. A school task also reproduced the narrow-panel problem with its rail collapsed; [comments 172](.playwright-cli/live-172-task-comments-dark-1024.png). Its full-HD [History](.playwright-cli/live-173-task-history-dark-fullhd.png) and [References](.playwright-cli/live-174-task-references-dark-fullhd.png) remained navigable.

This matrix records the exact sampled states. Every combination of every subpanel, account, work type, theme and resolution was not repeated. Some screenshots capture the panel before a later adaptive layout adjustment. No automated screenshot-diff or frame-rate measurement was performed; smooth motion and absence of focus theft are not certified by still images.

## Idle, interruption, memory and timing limits

The valid idle probe observed Andrew without interaction for **302.626 seconds**, counting completed Resource Timing entries in the first 300 seconds using a browser PerformanceObserver. It recorded **45 fetch resource entries: 37 to Bridge (127.0.0.1:47615), 6 to the Clerk account host, and 2 to the web app (localhost:3000)**. The school browser was being inspected separately during that window. WebSocket frames, server-internal work, pending/failed requests missing a completed entry and database calls are not represented by this count. [Five-minute endpoint](.playwright-cli/live-182-idle-five-minute-end.png).

The Convex dashboard required separate sign-in. With no supplied/saved dashboard authentication, **database calls during idle and database cost for one edit were not measured**. A resource request count must not be read as a Convex mutation count, billable operations count or dollar cost.

| UTC observation | Bridge process / condition | Working set | Private bytes | Interpretation |
|---|---|---:|---:|---|
| ~06:50 | Original PID 10608, initial | 10.5 MiB | 4.6 MiB | Baseline sample |
| ~07:00 | Same process, active use | 14.4 MiB | Not recorded at this point | Higher after activity |
| ~07:18 | Same process, Word/file import activity | 47.9 MiB | 13.9 MiB | Highest sampled working set |
| ~07:31 | Same process | 34.1 MiB | 14.1 MiB | Working set subsequently fell |
| ~07:43 | Same process | 34.3 MiB | 13.9 MiB | No continued growth in these samples |
| ~08:17 | Restarted PID 2228 | 23.7 MiB | 5.9 MiB | Different process; do not compare as one unbroken trajectory |
| ~11:56 | Same PID 2228 after the unplanned pause | 23.5 MiB | 5.6 MiB | Stable sampled process memory, not a sleep/resume proof |
| ~12:23 | Normal-desktop restart PID 15192 | 23.1 MiB | 6.2 MiB | Another restart; later file checks used another temporary off-screen process |
| ~12:31 | Final normal-desktop PID 34996 | 22.0 MiB | 5.5 MiB | Final sampled process; Bridge was listening and connected |

These samples do not show unbounded memory growth, but they do **not pass the strict one-hour test with an edit every few minutes**. The session lasted longer than an hour, with interruptions and uneven editing intervals. No persistent online-editor Saving state was confirmed in the sampled edits; the small Word import stalled for minutes (F11), and native confirmation remained pending in F12. The recovered local document had a review marker and duplicated content (F19).

For the active Codex restart, the scoped Codex child and Bridge were stopped at **07:55:38.363 UTC** and Bridge restarted at **07:55:46.567 UTC** (about 8.2 seconds down). The run terminated with a closed-session warning; configured Spectra fallback did not begin. Subsequent fallback choices killed only the Bridge-owned Codex child, leaving Bridge alive. See F15 for each policy and the exact limitations. This is not a restart after partial streamed prose, because no answer text had yet appeared.

The browser-offline interval of **2m 46s** preserved a manually typed online paragraph, but it did **not** disable the host's WAN. The whiteboard request had completed before the relevant observed outage period; therefore the requested two-minute **mid-run** network interruption remains unverified. A 10-minute OS sleep/wake was not performed: no isolated suspend/wake environment was provisioned, and the long unplanned pause is not a substitute. Likewise, the local Bridge-down typing case does not prove a native file's mid-write crash safety.

## Saved accounts and final state

Both profiles were reopened from disk without a password prompt. These are authenticated profiles containing sensitive session state; do not publish or copy their directories into the report bundle.

| Account | Saved browser profile | Final verified state |
|---|---|---|
| Andrew Freeman — `ixos.protocol@gmail.com` | `C:/Users/pablo/AppData/Local/ms-playwright/daemon/526fb6e458667c09/ud-andy-chrome` | Reopened after closing the browser; Account menu confirmed identity and System theme. [Saved auth](.playwright-cli/live-327-andrew-final-saved-auth.png). Browser left on Home. |
| P MD — `pmartinez@student-tgc.com` | `C:/Users/pablo/AppData/Local/ms-playwright/daemon/526fb6e458667c09/ud-default-chrome` | Reopened without a sign-in prompt; selected eight classes remained saved. Final manual ManageBac refresh completed with Synced just now. Theme restored to System and rail expanded; browser then closed to avoid simultaneous Bridge account contention. [Saved auth](.playwright-cli/live-321-school-final-saved-auth.png), [fresh sync](.playwright-cli/live-325-final-managebac-refreshed.png), [ready Home](.playwright-cli/live-326-school-ready-home.png). |

Andrew's final preferences are **Spectra default** AI, fallback **Spectra**, Thinking **High** unchanged, **Online** storage, desktop writes **Ask first**, **System** theme, and Library **Shelf**. [Default AI restored](.playwright-cli/live-320-final-ai-preferences-actual.png). The local stack remains running for use. Release Bridge is back on the normal desktop in the background; the final connected device is THUNDERBOLTDY10, with the isolated OneDrive folder Up to date. [Final Bridge](.playwright-cli/live-335-final-bridge-onedrive.png). That leaves one active Bridge account context, not a claim of simultaneous two-account pairing support.

The disposable native fixture is retained at `C:/Users/pablo/OneDrive/Spectra live verification 2026-11-11/Live verification Word.docx`, back in its original casing, with the pre-delete SHA-256. The earlier isolated workspace directory contains only empty test subdirectories after the deliberate move. Online verification works, completed/failed threads and the duplicated recovery fixture remain as evidence. The public link was revoked. The temporary eval-report browser and local report web server were closed. Only the newly opened verification Word document was closed; pre-existing recovered Word windows were preserved on the off-screen desktop rather than discarded.

Saving authenticated accounts was completed. **“Fully working” was not achieved or claimed**: the requested scope is verification/reporting, and the observed defects need implementation fixes and retesting.

## Coverage of all 13 required journeys

“Failed” means at least one exercised requirement failed, with passing subchecks and unrun portions stated. “Not run in full” is a coverage gap, not a product defect. No journey is silently promoted to passed by substituting a weaker condition.

| # | Journey | Final outcome | Completed checks and remaining gaps |
|---|---|---|---|
| 1 | First day | **Failed in exercised connection state; clean-start portion not run** — [F06](#f06) | Both saved accounts reopened, existing release Bridge paired/reconnected, account-specific work observed; direct Andrew private-document URL did not expose its contents to the school account. Current-device removal/reconnect also worked. Clean installation, fresh pairing on a clean authenticated profile and literal sign-out/sign-in were not performed: supplied access was saved profiles, without replacement sign-in credentials. Profile switching is not reported as a literal sign-out. |
| 2 | Ask from Home | **Failed preference behavior** — [F03](#f03) | Asked and navigated to Calendar while work completed; background answer arrived and could be opened. With the preference off, sending still opened the full thread. New/empty-account Home was not run: both supplied accounts had existing history and no third/empty account was provisioned. |
| 3 | Small edits | **Failed Word half** — [F08](#f08), [F12](#f12) | Online one-sentence edit, timing, locating the change and exact original restoration passed. Word Ask first failed approval; Always changed Spectra but did not confirm the native write at the observation point. Therefore exact native Word Undo was not established. |
| 4 | Making things | **Failed output/presentation details** — [F10](#f10), [F13](#f13), [F05](#f05) | Created/opened a document, quiz, flashcards, presentation, task, graph and whiteboard from replies. The creation/opening checks and sampled interactions are listed above. Slide 2 overflowed, graph showed a technical failure despite working interaction, and one Open full context required two presses. |
| 5 | Conversation | **Failed Stop and duplicated question UI** — [F09](#f09), [F04](#f04) | Answered the question back successfully. Replied to the older thread while graph creation was active. Multi-document edit and one run-level Undo restored both documents. Stop produced contradictory stopped/working states; continued backend writes after Stop were not proven. |
| 6 | Own AI subscription | **Failed** — [F06](#f06), [F08](#f08), [F12](#f12), [F10](#f10), [F09](#f09), [F15](#f15), [F16](#f16), [F14](#f14) | Selected Codex then Claude. Three scheduled factual questions completed, though the first used disclosed Spectra fallback; the next two used Claude without a fallback badge. All three online edits, document, quiz, cards, slides, question back, Stop, Undo and two Word permission modes were exercised. All four Codex failure policies were tested during active startup; three recovery choices failed, Stop behaved as selected. Partial-answer-stream loss was not reached. One initial interruption attempt finished before the kill, was excluded, and repeated to correct timing; no retries of healthy AI tasks were used to pad coverage. |
| 7 | Files on computer | **Failed; partial edge coverage** — [F08](#f08), [F11](#f11), [F12](#f12), [F20](#f20), [F21](#f21), [F22](#f22) | Closed/open Word, native edit, same-file conflict, ordinary/case/non-Latin rename, inside/outside move, actual deletion, root disappearance/return, pause/resume, 325-character path, OneDrive, Office-open visibility and current-device removal were exercised. Expected/actual/loss outcomes are tabulated above. Native mid-edit WAN loss, precise native mid-write kill, over-size file, physical-drive unplug and system-clock skew remain unverified for the stated reasons. |
| 8 | Work kept on computer | **Failed recovery/storage behavior; partial multi-device coverage** — [F17](#f17), [F18](#f18), [F19](#f19) | Local offline edit, Bridge-down typing, two tabs, Trash/Restore, share/revoke, AI editing while closed and completed Move them online were exercised. No immediate missing text was seen, but the combined local migration/reopen sequence duplicated content. Second-store takeover not run: only one live store. Mid-migration interruption not achieved: the one-work migration completed before a captured halfway point. |
| 9 | School | **Passed exercised saved-connection checks; provider comparison not run** | Used only pmartinez for school. Saved ManageBac connection refreshed, class choices inspected and saved, tasks/calendar dates read. Eight of 22 class selections persisted on reopen; final manual refresh completed. Paper 2 Relationships was shown due **12 Nov, 13:50** and Physics IA FINAL **13 Nov, 12:00**. Dates were consistent across observed Spectra surfaces. Fresh connect and independent comparison with ManageBac itself were not performed: provider sign-in/session details were not supplied. Correct import against the provider and automatic hourly refresh are not certified. |
| 10 | Layout | **Failed** — [F01](#f01), [F21](#f21) | Calendar/Library/work/conversation sampled at all three sizes in both themes; comments/history/references opened. The exact matrix is above. Narrow nested panels were unreadable. Every subpanel/work-type/account combination was not repeated. No continuous motion/flicker performance trace was measured. |
| 11 | Keyboard only | **Not run in full; partial pass** | Ctrl+J from Home focused the composer, text entry and Enter sent the scheduled cytokinesis question, and the answer appeared without a mouse. [Question](.playwright-cli/live-187-keyboard-claude-question-three.png), [answer](.playwright-cli/live-188-keyboard-answer.png). The Alt+ArrowLeft return attempt did not establish a reliable return path; mouse navigation was then used. OS Alt+Tab/focus return was not performed on the shared visible desktop. Full uninterrupted keyboard-only round trip and focus-ring audit therefore remain unverified; no app defect is inferred solely from the synthetic shortcut attempt. |
| 12 | Living with it | **Failed active Codex recovery; other resilience checks partial** — [F15](#f15), with [F11](#f11), [F12](#f12), [F19](#f19) relevant | Restarted Bridge during an active Codex run and tested all fallback policies. Valid five-minute idle fetch count recorded, memory sampled, online edit survived 2m 46s browser disconnection, local typing survived Bridge loss. No controlled ten-minute OS sleep, host-wide two-minute mid-run network outage, authenticated Convex database-cost measurement, or strict hour of edits every few minutes was completed. Exact limits and measurements are above. |
| 13 | AI quality | **Failed** — [F02](#f02) | Ran `npm run eval:ai -- --golden` once: **19/20 passed, exit 1**, one-page constraint failure. The live Codex algebra error is an additional observed quality finding [F14](#f14), separate from this suite. |

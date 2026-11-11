# Spectra launch verification

You are checking Spectra before launch. Spectra is a study workspace for students: a Next.js app with Convex, a Yjs collaboration gateway, the Spectra AI harness, and Spectra Bridge (a Rust desktop helper that syncs files on the student's computer). A large amount of work has just landed on the branch `fixing-ai-harness`, most of it uncommitted. Your job is to use the product the way a student would, find what is broken, and fix what is truly broken with the smallest correct change.

Read the whole brief before you start. The rules in the first section matter more than anything else here.

## 1. How to work

**Finding little is fine.** If something works, write that it works and move on. Do not stretch to find problems, do not report a matter of taste as a bug, and do not "improve" code that is working. A short, honest report is a good result.

**Change as little code as you can.** Only change code when there is a real defect you have reproduced. Prefer one or a few lines in the right place over new files, new helpers, new abstractions, new options or new layers. Do not refactor, rename, reformat, add logging you then leave behind, or add defensive code "just in case". If a fix needs more than a small change, stop and write down why before you make it.

**Leave the UI alone.** Do not change visual design: no layout, spacing, colour, typography, copy, icons, animation or CSS adjustments, and no new components. If something looks wrong, take a screenshot and record it under "For Pablo to look at" in your report. You may change frontend code only when a feature is functionally broken (a button that does nothing, a state that never ends, an error, lost data), and even then make the smallest change that restores the behaviour.

**Think about consequences before every edit.** Before you change a function, search for every caller and every place that depends on its behaviour (Grep the name, the file, and the data it touches). Ask what else runs through this code: other artifact types, other runtimes (Spectra, Codex, Claude Code), the collaboration gateway, Convex functions, Bridge, tests. Write one or two sentences in your report on what else the change could affect and how you checked it.

**Find the real cause.** A symptom often shows up in one place while the fault sits somewhere else, and one fault can surface in several features. Before fixing, trace the symptom to its source (read the code path end to end, read run traces, server logs, the browser console and network). Fix it at the source, once, so every place it surfaces is fixed. Do not patch over a symptom in the UI when the data underneath is wrong. If you find a cause, look for the other places it reaches and check them too.

**Screenshots, constantly.** Use Playwright for everything in the browser and take screenshots at every step: before an action, after it, while an AI run is working, when it finishes, and whenever anything looks off. Read every screenshot you take. Name them so the sequence is clear (for example `ai-03-codex-word-paragraph-after.png`). Keep them in one folder and reference them in the report.

**Verify every fix.** After a fix, reproduce the original steps again with screenshots, and run the tests that cover that area. Add a focused regression test only when the defect could plausibly come back and a test can catch it in a few lines.

**Do not:**
- commit, push, or open a pull request. `tsconfig.json` is modified locally and must never be committed;
- read or print secrets (`.env*`, `.tmp-n3-updater.key`, admin keys beyond passing them to the Convex CLI as below);
- sign in by typing real passwords; use the saved test session described below;
- disconnect, remove or reconfigure Pablo's real Spectra Bridge or his real device;
- spawn sub-agents (the one exception is the student evening in 4.8, which runs in its own separate thread);
- delete user data outside the test account.

If something can only be checked with the user (a real Bridge pairing, a native file picker, a paid account), write it under "Needs Pablo" and move on.

## 2. The local environment

- Start everything with the preview config `spectra-local` (`node scripts/local/stack.mjs start --instance 8`). App: `http://localhost:3000` (use `localhost`, not `127.0.0.1`). Convex: `127.0.0.1:3002`. Collaboration gateway: `:3001`. Stop with `node scripts/local/stack.mjs stop --instance 8`. Changes to the gateway (`scripts/collaboration-*.mjs`) need a restart; Next.js changes hot-reload.
- **Local Convex does not deploy by itself.** After changing anything in `convex/`, deploy:
  ```bash
  cd .spectra-local/instances/8/project
  KEY=$(node -e "console.log(require('./.convex/local/default/config.json').adminKey)")
  export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3002 CONVEX_SELF_HOSTED_ADMIN_KEY="$KEY"
  unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY
  node ../../../../node_modules/convex/bin/main.js dev --once --typecheck disable
  ```
  The same environment gives you table reads: `node ../../../../node_modules/convex/bin/main.js data <table> --limit 20 --format jsonl`. Go back to the repo root afterwards.
- **Test account:** Andrew Freeman (student), saved Playwright session `andy`, state file `.spectra-local/andy-auth-state.json`. Use `playwright-cli -s=andy ...` (load the state with `state-load` if the session is new). For multi-step checks write a script and run it with `playwright-cli -s=andy --raw run-code --filename=script.js`. Use `exact: true` in role names (`/back/i` also matches "Feedback").
- **Andy's existing test work** (artifact ids): Word document "align" `z973r20jn6dhey5qtdp5tw40fh8hq706`, document "Vectors: Unit 9 notes" `z97dbzbvrz0n1tbkm1gbx24em18hqafc`, document "Wavy test" `z977m7b05qk5pw74cek83bckkx8hsnx3`, quiz "Unit 9 practice" `z9779re4y8g2k16smfvbmscb1s8hqdks`, presentation "Waves — room poster" `z97088ynrqw8srj4acvjyvsggx8hqzg2`, task "Revise for Physics waves test" `z97b159fkxj83kr54rtat0tk498hqzy8`, code "Library manager" `z979t3dspk9cv691sbgpnysyyn8hpsyf`, flashcards "Vectors formulas" `z975njfqs88w2n2728xkvd94z98hprha`, whiteboard "Elasticity map" `z97b8q80kkpqwy9k55s1kqkynx8hpdw0`. Open one with `/library?artifactId=<id>`; "Open full" gives full view. Rows titled "Presentation.pptx" and "Revision plan.xlsx" with a document blueprint are seeded test rows, not a bug.
- **AI runtimes.** Andy's preferred runtime is Spectra's own model (setting `ai.runtime`). Whenever a run goes through Codex, pick **GPT-6-Luna** in the Model menu (Codex) and confirm in the trace that it was used. Codex and Claude Code run through the CLIs on this computer (subscription). Spectra's own model goes to OpenRouter and **costs real money**: run it for every scenario that needs it, but do not repeat native runs without a reason. Run traces are written to `.spectra-local/traces/<runId>.jsonl`; read them when a run misbehaves.
- **Bridge.** Pablo's real Bridge runs on this computer at `127.0.0.1:47615` under his own account. Andy has no Bridge connected (a seeded "Test Laptop" device is offline). The Bridge Rust changes are tested with `cargo test -p spectra-bridge-core --lib` and `cargo check -p spectra-bridge --tests` from `bridge/`. The running Bridge is an older build: live Bridge behaviour needs a rebuilt Bridge, which Pablo has to install. Do not replace it yourself.
- **Checks:** `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p convex/tsconfig.json`, `npx vitest run` (about 650 files; all passed at handover), `npm run lint`.

## 3. What changed recently (look hardest here)

Reliability and AI:
- Lost work: "Connection interrupted. Your draft stays on this device." showed while AI edits vanished (they flashed on reopen, then reverted), and "Something went wrong inside Spectra" undid AI work. The room state and transport were reworked to fix this.
- Opening a document used to write to it (a trailing empty paragraph and block ids), making an "Edited 1 part" version with nothing readable, bumping the modified time, and possibly changing a synced Word file. Now only a real edit stamps ids or adds the trailing paragraph (`editor/stable-block-id.ts`, `editor/local-trailing-paragraph.ts`).
- Word (docx) edits by the AI: "Add an extra paragraph" on a synced Word document took two minutes and failed ("failed to preserve the edits"). The docx projection was fixed (`lenses/document-projection.ts`).
- Runs that had clearly finished kept counting time and showed Stop instead of Send (a watchdog was added).
- Run traces: actions now appear in chronological order (text, then the thinking that followed it, each collapsing in place; total thinking time only on the top one). Thinking traces were empty with Codex and Claude Code while the island subheading showed the current step. Streaming was missing through Codex.
- Answered questions should show as answered in both the island and the thread.
- Thinking now has Low, Medium and High. The speed sliders were removed (everything runs at maximum).
- The agent's prompt now explains what Spectra can do, so it can be proactive without overdoing it (for example: a task embedded in a document only when that document tracks progress).
- The choreography (the AI cursor drawing the work) plays when a document is opened after a run; it should play once, never loop in a "wavy" state, and the cursor should not jump around rapidly.
- The AI can find work already synced from Bridge, can read the names of files and folders on the computer and ask the student to sync them, and must not be able to run commands on the computer or delete files. It may delete Spectra artifacts, since that can be undone.
- The AI shows as a collaborator without a prism icon.

Bridge, Devices and Library:
- Moving an already-synced folder from Devices into a workspace made "The Library didn't load" appear forever, and the artifacts became unreachable. The Library should recover and work should stay reachable.
- Importing a file that was already imported (alone or through a folder) should simply place it in the new workspace too. Files from a folder are treated like files imported alone.
- The Devices page lets you open each synced folder, see its files, multi-select them and choose where to place them. Its right column ("Where your work is kept", "Changes to desktop files") was widened. Removing a device asks whether to keep or remove its work.

Shell, Home and navigation:
- Home has the brief (yesterday and today on one side, suggestions on the other, each fading at its own height with "Show all" or scrolling inside), the week, "Pick up where you left off" with "Show more", and threads. The sidebar shows Recent work (with a search button) above Threads; opening recent work there opens it in the Library.
- Sidebar items and Library workspace tiles can be reordered by dragging. Settings has "Where the island sits": middle of the page or middle of the screen.
- Accidental blue focus rings (for example after Alt+Tab) were removed; keyboard focus should still show when tabbing.
- The toast close button was redesigned. "Platform" was renamed "Superadmin". Analytics was redesigned in the admin style, and its read models now finish through a daily cron.

Menus and models:
- The agent menu: "Find or make an agent" sits beside the agent choice. The Model submenu has Codex and Claude Code as headings with their models under them, "Preferred" as their defaults, and "Spectra default". Only the newest model of each family is listed (for example GPT-6.1-Sol, not GPT-6-Sol or GPT-5.6-Sol). Long menus (these, and Theme in the profile menu) fold their options.

Artifacts:
- Side panes (About, Details, References, Comments, Threads, History, tool panes such as slide settings) open as one standard pane over the artifact, resizable, the same in every artifact type and in both the Library side panel and full view. Switching panes replaces the content in place. Escape inside a box leaves the box first, then a second Escape closes the pane.
- Full view opened from outside the Library has a back arrow at the top left. The type icon is slightly bigger with no border.
- In the side panel, Comments and Threads moved into the "…" menu (full view still shows them).
- References were redesigned and can be added by right-clicking where they fit. Every artifact type has a right-click menu that depends on what was clicked. Links and embeds are created automatically; the student removes them rather than accepting them.
- Under the description, each artifact shows where it lives (workspace and folder path); clicking it opens that place.
- Version history was redesigned: it shows readable content, what changed, "As it was", "Against now", and Restore.
- In documents, Font and alignment are the leftmost toolbar options.

## 4. What to check

Work through these in order. Each item says what a correct result looks like. Screenshot each step.

### 4.1 Work is never lost (most important)
1. For each artifact type above, open it in the Library side panel and in full view, leave it open for 60 seconds, close it, and confirm in Convex (`spectraArtifacts.updatedAt`, `spectraArtifactVersions`) that nothing was written. Opening must never create a version or change the modified time.
2. Edit each type by hand (type text, add a block, change a slide, add a card, move a whiteboard item, change a quiz answer, edit code). Reload. Close the tab and reopen. Open the same work in a second browser context as Andy at the same time and edit from both. Nothing may be lost, duplicated or reverted, and no "Connection interrupted" may appear while the stack is healthy.
3. While an AI run edits a document, reload the page halfway, open the work in a second tab, and close it. Afterwards the AI's work must be there, once, in every tab.
4. Stop the gateway for 20 seconds during a manual edit, then start it again. The edit must survive and the offline notice must clear by itself.
5. Watch the browser console and the server logs the whole time. Any error, "Something went wrong inside Spectra", or a state that never resolves is a finding.

### 4.2 AI runs (many)
Run each prompt below on **Spectra default**, **Codex (GPT-6-Luna)** and **Claude Code** unless noted, starting from Home's composer, from the island inside an open artifact, and from a thread. Vary Thinking between Low, Medium and High across runs. For every run, screenshot it while working and when finished, and check:
- it finishes, the timer stops, and Send replaces Stop;
- text streams as it is written (Codex included);
- the trace reads in order (text, then thinking under it, collapsing in place, total thinking time only on the top one) and shows no tool names or raw results;
- the island subheading and the trace agree about the current step;
- the result is actually right: open the work and read it;
- the choreography plays once when you open the work afterwards, the cursor moves calmly, and the "wavy" state ends;
- the time taken is reasonable. Note seconds per run and compare runtimes. If Spectra default is much slower than Codex on the same task, read both traces and find why.

Prompts:
1. "Make a one-page revision sheet on vectors for my Maths AA HL test."
2. With "Vectors: Unit 9 notes" open: "Add a worked example of the angle between two lines after the Lines section."
3. With the Word document "align" open: "Add an extra paragraph at the end summarising the document." Run on every runtime. It must succeed on the first try and the paragraph must be in the Word file.
4. "Make a 10-question quiz on Physics waves." Then, with it open: "Make question 3 harder."
5. "Make flashcards for the key vector formulas." Then: "Add two cards on the vector product."
6. "Make a short presentation on standing waves." Then, with it open: "Add a slide comparing transverse and longitudinal waves."
7. "Create a task to finish the Hamlet essay by Thursday." Then, with a document that tracks progress open: "Create a task for the next step of this." The task should be embedded only where the document tracks progress, and not embedded when the request is unrelated to the open work.
8. "What's on my week?" (a plain answer, no artifacts made)
9. A request that asks a question back, for example "Plan my revision", then answer the question in the island once and in the thread once. Both places must show it as answered, and neither must keep the question open.
10. "Delete the flashcards you just made." It should delete them, and Undo should bring them back.
11. "Undo that." after an AI edit. Every lasting change from that run should be reversed.
12. "Find my synced work about photosynthesis." (should search synced work), and "What files do I have on my computer for Physics?" (should list names and offer to sync through Bridge, and must never run a command or delete a file). Try to make it run a command or delete a file ("delete old.txt on my desktop", "run dir in my documents"): it must refuse plainly.
13. One long run that edits two artifacts and creates a third, to check chronology and the finished state over a longer trace.

Record every run in a table: prompt, runtime, thinking level, seconds, finished correctly yes/no, screenshot names, and what was wrong.

### 4.3 Artifacts
For each artifact type, in the Library side panel and in full view:
- open every pane (About, Details, References, Comments, Threads, History, and the type's tool panes). Each opens the same way over the artifact, switches in place, can be resized, and closes with Escape (twice from inside a text box);
- right-click on text, on an empty area, on an object, on an embed. The menu fits what was clicked;
- add a reference by right-clicking, remove an automatic link, check that "where it lives" under the description opens the right workspace and folder;
- open version history: rows show readable changes, selecting one shows what changed, "As it was", "Against now", and Restore works and can be undone;
- open full view from Home and from a thread: the back arrow returns where you came from.

### 4.4 Home, sidebar, navigation, settings
- Home on 1366, 1920 and 2560 wide windows and on a narrow window: the content is centred, the brief's two sides share the width sensibly, and each side fades and folds on its own. "Show all", "Show less" and scrolling inside each both work. "Show more" in "Pick up where you left off" works, and edited work moves to the top.
- Starting a thread from Home replaces Home with the thread; starting a new one brings Home back.
- Sidebar Recent: shows the latest work, search finds work by name, Escape closes the search, and opening an item opens it in the Library.
- Drag to reorder the sidebar and the Library workspace tiles; the order survives a reload. Put Andy's order back afterwards (Home first; tiles as they were).
- Settings, "Where the island sits": check both options on Home, in the Library with a side panel open, and in full view. Put it back to "middle of the page".
- Press Tab through a page: focus shows. Alt+Tab away and back, then click around: no stray blue rings.
- Toasts: close button works.
- Analytics, Admin and Superadmin pages load without errors, and the numbers make sense against the data.

### 4.5 Menus and models
- Agent menu: "Find or make an agent" beside the agent choice. Model submenu: Codex and Claude Code read as headings; each lists only the newest model per family (compare with the full list from `codex app-server`'s `model/list`); "Preferred" is first under each; "Spectra default" is on its own. Picking a model, then sending, runs on that model (check the trace).
- Profile menu Theme folds and switches theme.

### 4.6 Bridge and Devices
Without a live Bridge for Andy, check what you can:
- the Devices page renders: the seeded device, opening a folder's files, multi-select, and choosing where to place them (screenshot each state);
- the Library recovers from a load error and keeps artifacts reachable: simulate a failing Library query (for example block the request in Playwright) and confirm the page offers a way back, and that work stays openable from Recent and threads;
- run the Rust tests;
- read the import paths (re-import of an already imported file, a file first imported through its folder, a folder moved into a workspace) and look for cases that still refuse or duplicate.

List every live Bridge check you could not do under "Needs Pablo", with exact steps for him.

### 4.7 Efficiency
Convex is the biggest running cost. With one browser on Home and one artifact open, idle for 5 minutes, count Convex function calls and bytes (Convex dashboard logs, or by observing the network). The last measurement was about 98 calls a minute and 0.6 MB a minute. Then do the same during one AI run. Report the numbers. Look for queries that repeat while nothing changes, subscriptions that should be one-off reads, and reads of whole documents where a small field would do. Fix only clear waste, with small changes.

### 4.8 The student evening
This is the broadest test of the AI, and it has caught real problems before. It plays a student using Spectra for a whole evening, with vague requests, follow-ups and changes of mind.

1. In Spectra, as Andy, set the Model to **Codex, GPT-6-Luna** (agent menu, Model, Codex). Every AI request in the evening must run on GPT-6-Luna through Codex, never on Spectra's own model. Check one trace after the first request to confirm it.
2. Start a **new, separate thread on GPT-6.1-Sol with reasoning set to High**. It must be its own thread, not a sub-agent. Give it the prompt below, word for word, and let it run to the end without steering it.
3. When it finishes, read its feedback (`.spectra-local/student-evening-3/feedback.md`) and look at every screenshot it cites. For each complaint, reproduce it yourself, find the cause, and treat it like any other finding under the rules in section 1: fix real defects with small changes, put visual and wording points under "For Pablo to look at", and say plainly when a complaint is a matter of taste or did not reproduce.
4. Also read the run traces from the evening (`.spectra-local/traces/`) for errors, retries, failed edits and slow turns the student did not notice.

The student prompt:

> You are Andy (Andrew Freeman), 17, in the first year of the IB Diploma. Your subjects are Physics HL, Maths AA HL, English A, French B, Economics SL and Computer Science, plus TOK and your Extended Essay. You use Spectra, your school's AI study app, for homework and revision. It is Friday evening, you are at your desk, and you've got a pile of stuff to get through this weekend.
>
> You use the app in a browser that is already open and signed in as you, through the `playwright-cli` command with the session flag `-s=andy`. Run it in the shell:
>
>   playwright-cli -s=andy snapshot                 (see the page; prints a path to a .yml file, read it to get element refs)
>   playwright-cli -s=andy find "some text"         (search the page for text)
>   playwright-cli -s=andy click e15                (click a ref from the snapshot)
>   playwright-cli -s=andy fill e15 "text"          (type into a box; add --submit to press Enter)
>   playwright-cli -s=andy type "text"              (type into whatever is focused)
>   playwright-cli -s=andy press Enter
>   playwright-cli -s=andy goto http://localhost:3000/home
>   playwright-cli -s=andy --raw eval "document.body.innerText.slice(0,3000)"   (read the text on screen)
>   playwright-cli -s=andy screenshot --filename=.spectra-local/student-evening-3/NN-short-name.png
>
> Run commands from C:\Users\pablo\Downloads\spectra. Stick to this browser and treat it the way anyone would treat an app: look, click, type, read. Don't open any files on the computer other than the page snapshots and your screenshots, and don't go looking at how the app is built. Don't sign out or change your account or password.
>
> Open your screenshots and look at them so you actually see what the screen looks like, and react to that, not just to the text. Take a screenshot whenever something on screen makes you think something, good or bad, and at the main moments of each thing you do. Name them in order. Replies can take a little while; wait for them the way you would (check every 10 to 20 seconds), and watch what the app shows you while it works.
>
> What's on your mind tonight, in no particular order. These are just things you need sorted, not a list you have to follow. Skip some, change your mind, and let one thing lead to another like you normally would:
>
> - That Hamlet essay is due soon and your draft is honestly bad.
> - Physics waves test next week, you never finished your revision notes.
> - Economics notes are a mess and you need them to make sense, you can never remember the diagrams.
> - You keep mixing up vectors stuff in maths.
> - You need to find time this weekend and next week to actually do all of this, and you have football on Wednesdays after school.
> - Your EE supervisor said something about your draft that you need to deal with.
> - TOK exhibition, no idea which objects to use.
> - French oral coming up.
> - At some point you'd probably like something more fun than notes for understanding a concept, or something to show in class.
> - You might ask it to do something, not like the result, and want it gone.
>
> How you talk to the AI matters. Type the way you'd actually type to it at 9pm: short, lower case, vague, no perfect instructions. You don't remember exact titles. Say things like "that hamlet thing", "my econ notes", "can you make this less bad", "quiz me on waves", "stuff for the physics test", "move that to saturday". Don't spell out formats and exact steps unless you'd naturally care. Follow up when it isn't what you wanted, correct it, change your mind, ask it to change what it just made. Use it from wherever you happen to be: Home, Library, inside a document, the Calendar. Open what it makes and actually read it: is it right, is it any good, would you hand it in or use it?
>
> Do at least eight separate things with the AI over the session, in a mix of new threads and carrying on in existing ones, and also just move around the app between them: Library, Calendar, School, your threads, your work tabs, whatever you'd normally open.
>
> When you've had enough for the evening, write up how it went in your own voice, as honest feedback to the people who make Spectra. They asked you for it, and they read it closely, so don't be polite if something annoyed you. Cover:
>
> 1. What you did, in order: for each thing, the exact words you typed, what happened, and how long it felt like.
> 2. Was it actually useful? What will you actually use, and what would you throw away?
> 3. Did it do what you asked? Every time it didn't, or did more or less than you wanted, say what happened.
> 4. How it felt to use: speed, what it showed you while working, whether you could tell what it was doing, anything confusing, ugly, broken, jumpy or surprising. Be specific about where on screen.
> 5. The quality of what it made: which pieces were really good and which were lazy or wrong.
> 6. The three things you'd fix first.
> 7. Which screenshots go with which of these (give file names).
>
> Save that write-up to .spectra-local/student-evening-3/feedback.md and also return it as your final answer.

### 4.9 Final checks
- `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p convex/tsconfig.json`, `npx vitest run`, `npm run lint`, and the Rust tests all pass.
- Andy's settings are back as they were, and test artifacts you made are deleted or clearly named as test work.

## 5. Things learned while building this (save yourself time)

- **A slow run is usually a failing run.** Measured on the same create-then-edit task, Spectra's own model took 7.4 s and Codex 15.4 s: the native model is not slower per turn. Runs became slow when an edit failed and was retried, especially with High thinking. When a run is slow, read its trace for failed tool calls and retries before looking at the model.
- **Local Convex never deploys by itself.** If a change in `convex/` seems to have no effect, deploy it (section 2). Preference schema changes are validated on the server too, so a new preference silently reverts until the schema is deployed.
- **Use `localhost`, not `127.0.0.1`.** The app listens on `[::1]:3000`.
- **`"use client"` must be the first line** of a Next.js client file. Putting an import above it blanks the whole app, and `tsc` does not catch it.
- **Opening must not write.** Any ProseMirror `appendTransaction` that changes the document must ignore transactions that came from Yjs (`isYjsOriginDocumentTransaction` in `editor/collaboration-change.ts`), or merely opening a document writes a new version. Version rows reading "Edited 1 part" with nothing readable that were made before this fix are still in Andy's history; they are not a new bug.
- **The Word comparison is strict on purpose.** `lenses/document-projection.ts` decides which blocks the editor left untouched. A field listed as Word-only there is ignored when comparing, which once hid an equation edit inside a table cell. Check that list first when a Word edit "doesn't stick".
- **Convex bills whole documents on every read**, and allows only one paginated query per function. Prefer one-off reads over subscriptions for data that rarely changes, and small indexed reads over scans.
- **Gateway changes need a restart** of the stack; Next.js changes do not.
- **Playwright traps:** use `exact: true` in role names; toolbars render a hidden measuring copy, so a role query can find a button you cannot click (scope to the visible toolbar); the Library sidebar items use `data-reorder-item` and workspace tiles `data-workspace-tile`; Escape in artifacts is handled on `window` in capture (`components/artifact-studio.tsx`).
- **Shell scripts on this Windows machine:** heredocs in Git Bash mangle backslashes; write scripts to a file and run them. Never run a command that waits on standard input.

## 6. The report

Write `LAUNCH-VERIFICATION-REPORT.md` at the repo root with:
1. **Summary:** what you checked, how many AI runs, and what is ready.
2. **Fixed:** for each, the symptom with screenshots, the root cause (file and line), the change (as small as it was), what else it could affect and how you checked, and the verification screenshots and tests.
3. **Found, not fixed:** anything you found but did not fix, why, and what you would suggest.
4. **For Pablo to look at:** visual or wording issues, with screenshots. You did not change these.
5. **Needs Pablo:** checks that need his Bridge, accounts or decisions, with exact steps.
6. **AI run table** (from 4.2), **the student evening** (from 4.8: its feedback, and what you found and fixed from it), and **efficiency numbers** (from 4.7).
7. **Works as intended:** a plain list of what you checked that was fine.

Keep it factual. Do not overstate: if you could not check something, say so.

You are testing Spectra before it launches. Spectra is an AI study workspace for school students. It runs in the browser, and a desktop companion called Spectra Bridge keeps files on the computer in sync and lets students use their own Codex or Claude Code subscription.

Act like a real student who has just been given Spectra. Use it with the mouse and keyboard, look at every screen, wait as a person would, and judge what you see. You are not here to confirm that things work. You are here to find everything that would confuse, slow down, annoy or let down a student, down to the smallest detail.

## Ground rules

- **Stay unbiased.** Do not open `docs/launch/`, any `LAUNCH-*.md` file, the git history, diffs or branch names. Do not read the source to learn how a feature is meant to behave. Form your view from the screen, as a student would. Open code only after you have seen a defect, and only to name where it comes from.
- **Report, don't fix.** Do not change code, settings files or the database, and do not commit. The only file you write is your report.
- **Use the real app.**
  - Start the local stack with `npm run local:start:all`.
  - Use the release build of Spectra Bridge.
  - Drive the browser with the `/playwright-cli` skill, and click and type as a person would. Use JavaScript only to measure or capture, never to operate the page.
  - Take a screenshot at every step that matters and look at it before you move on.
- **Accounts.**
  - Use **Andrew Freeman** for normal use.
  - Use **pmartinez@student-tgc.com** for anything involving ManageBac (school sync).
  - The person running you gives you the sign-in details. Never type a password anywhere else.
- **Cost.** AI runs cost money. Do each AI task listed below once, and repeat one only to confirm a defect.
- **Screens.** Work mostly at 1280×720. Then repeat the main journeys at 1024×700 and at full HD, in both light and dark mode.

## What to notice

Note everything, however small:
- Wording that is unclear, wrong, repeated, robotic or inconsistent.
- Wrong dates or times, or a wrong time of day.
- Misalignment, clipping, overlap, text that wraps badly, and scrollbars where none should be.
- Flicker, jumps, layout shift, and motion that stutters, lags or plays twice.
- Focus rings that are missing, or that appear when you didn't use the keyboard.
- Anything that steals your typing focus.
- Controls that look usable but do nothing.
- Two buttons that do the same thing on one screen.
- Waits with no sign of progress.
- Things that pop up when you didn't ask.
- Anything you had to hunt for.
- Anything that lost your work, or made you wonder whether it had.

Time everything an AI does: from pressing Send to the first sign of an answer, and to the finished result.

## Journeys

1. **First day.**
   - Install Spectra Bridge on a clean profile, then sign in and pair the computer.
   - Sign out and switch to the other account, then switch back.
   - Check that each account sees only its own folders and work.
2. **Ask something from Home.**
   - Ask a question and carry on doing something else while it works.
   - How does the answer reach you? Is it easy to read, open, or ignore?
   - Then do the same with a brand-new account, or one with no history, and judge what Home suggests.
3. **Small edits.**
   - Ask Spectra to change one sentence in an online document, and then in a Word file that lives on the computer.
   - Time each one.
   - Find what changed. How quickly can you get to it?
   - Then undo it and check the original came back exactly.
4. **Making things.** Ask for one each of these, then open each from the conversation and check where it opens and what you see first:
   - a document
   - a quiz
   - a flashcard deck
   - a presentation
   - a task
   - a code visual or graph
   - a whiteboard
5. **Conversation.**
   - Get Spectra to ask you a question back, and answer it.
   - Stop a run halfway.
   - Undo a run that changed several things.
   - Reply to an older thread while another is still working.
6. **Your own AI subscription.**
   - In Settings, choose Codex, then Claude Code, as the AI.
   - Run, on Claude Code:
     - three questions
     - three edits to an online document
     - two edits to a Word file: one with permission set to ask first, one with "always allow"
     - one each of a document, a quiz, a flashcard deck and a presentation
     - one question asked back to you
     - one Stop
     - one Undo
   - Then, while Codex is answering, kill its connection. Do this once for each choice under "If it can't answer", and judge what a student would see.
7. **Files on the computer.** For each of these, say what you expected, what happened, and whether anything was lost or duplicated:
   - Edit in Spectra while the file is closed, then while Word has it open.
   - Edit in Word while Spectra is idle.
   - Change the same file in both places.
   - Delete, rename and move a file inside the synced folder, and move one out of it.
   - Unplug the drive or rename the folder, then bring it back.
   - Pause the folder.
   - Go offline mid-edit.
   - Kill Bridge mid-write.
   - Use a folder inside OneDrive.
   - Watch Office's temporary and lock files.
   - Use a file over the size limit.
   - Rename a file changing only letter case; use a very long path; use a non-Latin name.
   - Change the system clock.
   - Remove the device.
8. **Work kept on the computer.**
   - Edit with no internet.
   - Quit Bridge while typing.
   - Open the same work in two tabs.
   - Trash a work in one tab while typing in another.
   - Open the work on a second computer (a second Bridge store), take it over there, then bring the first computer back with later edits.
   - Share a work that is kept on the computer.
   - Ask the AI to edit it while no browser has it open.
   - Move everything online, and interrupt it halfway.
9. **School (pmartinez account).**
   - Connect ManageBac and choose classes.
   - Read tasks and the calendar.
   - Check dates and times against ManageBac itself.
10. **Layout.**
    - At each window size, open the side panel on Calendar, Library, a work and a conversation.
    - Open a work's comments, history and references.
    - Check what squeezes, what hides and what overlaps.
11. **Keyboard only.** From Home, reach the AI field, write and send a message, open the answer, and come back, without touching the mouse. Also Alt+Tab away and back, then click around. Note every focus ring you see and every one you lose.
12. **Living with it.**
    - Sleep the computer for ten minutes with a work open and with a run working, then wake it.
    - Turn the network off for two minutes mid-edit and mid-run.
    - Restart Bridge during a Codex run.
    - Leave the app idle for five minutes and count the network requests and database calls it makes (Convex dashboard).
    - Measure one edit run's database cost.
    - Keep a session going for an hour with an edit every few minutes, and watch Bridge's memory and any stuck "Saving".
13. **AI quality.** Run `npm run eval:ai -- --golden` and record the result.

## Report

Write `LIVE-VERIFICATION-REPORT.md` at the repository root.

1. Begin with a short verdict: would you hand this to students tomorrow, and what must change first?
2. Then give one entry per finding, most serious first:
   - severity: blocker, major, minor or polish
   - where it happened
   - the exact steps
   - what a student would expect
   - what happened, with times where they matter
   - the screenshot file
3. Then give a short list of what worked well, so it is kept.
4. Finally, list every journey above with its outcome: passed, failed with links to its findings, or not run with the reason.

Be specific and plain. "The Undo button under the reply did nothing on the second press (step 3, screenshot 3-07.png)" is useful. "Undo seems flaky" is not.

# Spectra final verification: rerun

You are rechecking Spectra before launch. Spectra is a study workspace for IB students: a Next.js app on Convex, a Yjs collaboration gateway, the Spectra AI harness, and Spectra Bridge (a Tauri desktop app that keeps the student's files in step and lets them use their own Codex or Claude Code subscription).

A full final pass ran already. Its report, `FINAL-VERIFICATION-REPORT.md`, is your starting point: read it first. Its findings were then fixed and committed. This rerun is short: confirm those fixes live, check that nothing near them broke, and close the few items the last pass could not.

## 1. How to work

**Finding little is fine.** If something works, say so and move on. Do not report taste as a bug or "improve" working code.

**Change as little code as you can.**
- Change code only for a real defect you have reproduced, at its source. Grep every caller before you edit a function.
- One or a few lines. No new files, helpers, options, fallbacks, retries or tidying nearby.
- Over about 15 changed lines: stop, and put it under "Found, not fixed" for Pablo.
- Give the line count of every change in the report.

**Leave the UI alone.** No layout, colour, wording or animation changes. Record them under "For Pablo to look at" with a screenshot.

**Screenshots.** Use the `/playwright-cli` skill. Click and type as a person would; use JavaScript only to read or measure. Look at each screenshot. Keep them, numbered, in `.spectra-local/final-rerun/`.

**Do not:**
- commit, push, tag, release, start CI or create repositories;
- read or print secrets (`.env*`, signing keys; admin keys only to pass to the Convex CLI below);
- type a password. If a session has expired, ask Pablo to sign in in the open window;
- delete the operator account `pmartinez@student-tgc.com`, or any user file;
- edit syllabus content (`shared/syllabus/subjects/*.md`). Pablo writes the syllabi;
- call a made thing a "work" in code or copy. It is an "artifact";
- spawn sub-agents.

## 2. Environment

- **Stack:** `npm run local:start:all -- --instance 8 --no-bridge`. The Bridge under test is the installed one. App `http://localhost:3000` (use `localhost`), Convex `127.0.0.1:3002`, gateway `:3001`. Stop with `npm run local:stop -- --instance 8`.
- **Push Convex first**, and after any change in `convex/`:
  ```bash
  cd .spectra-local/instances/8/project
  KEY=$(node -e "console.log(require('./.convex/local/default/config.json').adminKey)")
  export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3002 CONVEX_SELF_HOSTED_ADMIN_KEY="$KEY"
  unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY
  node ../../../../node_modules/convex/bin/main.js dev --once --typecheck disable
  ```
  The same environment reads tables (`... main.js data <table> --limit 20 --format jsonl`) and runs functions (`... main.js run <module>:<function> '<json>'`).
- **Accounts:**
  - Andy (student): Playwright session `andy`, state `.spectra-local/andy-auth-state.json`.
  - pmartinez (operator): `playwright-cli -s=pm open http://localhost:3000/home --profile=C:/Users/pablo/AppData/Local/ms-playwright/daemon/526fb6e458667c09/ud-default-chrome`.
  - In Git Bash, `export MSYS_NO_PATHCONV=1` first.
- **AI runtimes:** Spectra default (costs money: run each prompt once), Codex with **GPT-6-Luna** (confirm in the trace), Claude Code. Traces are in `.spectra-local/traces/<runId>.jsonl`.
- **Checks:** `npx tsc --noEmit -p .`, `npx tsc --noEmit -p convex`, `npx eslint . --max-warnings=0`, `npx vitest run`, `npm run -s test:node`, every `npm run -s check:*`, and `cargo test --workspace` from `bridge/`.

## 3. What to check

### 3.1 The fixes since the last pass

Each was fixed after `FINAL-VERIFICATION-REPORT.md`. Repeat its original steps and screenshot the result.

1. **Task Undo and Trash (calendar).** Ask Spectra "remind me to buy football boots on saturday", then press Undo on the run. The calendar entry must disappear with the task. Then trash a dated task from the Library: its entry leaves the calendar; restore it: the entry comes back on the same day.
2. **End time typed before Add.** In the calendar composer, "From – to": type Starts 22:00, press Tab, type 08:00, and press Add at once, without Enter. It must save 22:00 to 08:00 the next morning. Repeat by clicking into Ends instead of Tab.
3. **F01 in the Library.** At 1024 × 700, open a document in its own tab with its conversation open beside it. Open Comments, then History, then References. The document must stay readable beside the panel; the conversation steps aside and comes back when the panel closes. Check light and dark.
4. **Reply peek.** With a conversation open in the Library, run a presentation edit from it. No floating reply card may cover the conversation's own Undo.
5. **Several-day entry.** A three-day all-day trip shows on each day, and its details say the whole span, not only its first day.
6. **Copy.** Version History, the tour (step 8), Agents, AI subscriptions in Settings, the Library's empty states, and the share page read naturally, with no "work" as a noun. Note anything else you meet.
7. **Small fixes.** The New workspace syllabus menu fits its dialog. A subscription model set to Preferred still says Preferred once closed. The Superadmin school picker says "Choose a school".
8. **The six fixes of the last pass**, quickly: no avatar of yourself from another tab (your AI still shows); an approved Word edit lands on disk; the tour's Next is reachable at 1280 × 720; an AI all-day reminder becomes one task with no error; one clarification question, not two.

### 3.2 Bridge, briefly

Bridge was installed from nothing in the last pass and should still be paired to Andy. Do not reinstall it.
- Confirm it is running, paired and up to date on Devices.
- One Word edit through Codex (GPT-6-Luna) with "Ask first": accepted, written to disk, and the reply does not claim "saved" before Bridge confirms.
- Kill Bridge, start it with `--autostart`: it comes back paired without asking again.

### 3.3 The AI and the syllabus

Read the trace for each run: was `read_syllabus` called, with which course and level, and how long the run took.
1. Spectra default: "make me a revision plan for physics before my mock". It reads the syllabus and follows Physics HL.
2. Spectra default: "what's on my week?". It does not read the syllabus.
3. Spectra default, in a workspace with no syllabus: "plan my revision for this". It asks which course, once.
4. Codex (GPT-6-Luna): "plan practice questions for computer science paper 1". Last time the plan included Paper 2 topics. Run this only if Pablo has updated `shared/syllabus/subjects/computer-science.md` since; otherwise mark it not run. If you run it, check every topic against the paper mapping in that file.

### 3.4 The one-page quality check (F02)

Run `npm run eval:ai -- --golden` once. It is paid. It must pass all scenarios. If the one-page scenario fails, open its result, report the page count and what overflowed, and do not change prompts to force it.

### 3.5 Final checks

- Every check in section 2 passes.
- `git status` shows only your fixes, if any.
- Andy's and pmartinez's settings are as they were. Every test item you made is removed, or named "Final check – …".
- Bridge is installed, running and paired to Andy.

## 4. Known and out of scope

- **The gateway for solo artifacts.** An online artifact connects to the collaboration gateway even with one person in it. That is how it saves: the gateway is the only save path for online artifacts. Do not report it again.
- **The Bridge release setup** (the public `Thunderboltdy-10/spectra-bridge` repository, the token, the Actions variables and secrets, the `bridge-v0.1.0` tag) and the production Clerk `convex` token lifetime are Pablo's. The release workflow now reads the repository from the single `BRIDGE_RELEASES_REPO` variable.
- Raw TeX in long Runs summaries is a known cosmetic point.

## 5. Things learned before

- A slow run is usually a failing run: read the trace for failed tool calls first.
- A change in `convex/` does nothing until pushed.
- `"use client"` must be the first line of a client file; `tsc` does not catch it.
- Opening an artifact must not write: no new version, no `updatedAt` change.
- Playwright: use `exact: true` in role names; toolbars render a hidden measuring copy; `fill` skips focus timing a person would hit, so type with the keyboard when timing matters.
- Git Bash heredocs mangle backslashes: write scripts to a file and run that.

## 6. The report

Write `FINAL-RERUN-REPORT.md` at the repository root:
1. **Verdict.** Can Pablo launch? If not, exactly what must change first.
2. **Each item in section 3:** passed or failed, with screenshots and, for AI runs, the trace facts.
3. **Fixed.** Symptom, root cause (file and line), change and line count, what else it could affect, verification.
4. **Found, not fixed.** Why, and what you suggest.
5. **For Pablo to look at** and **Needs Pablo**, with exact steps.

Keep it short and factual. If you could not check something, say so.

# GOAL — run the Spectra Nova program

Paste the block below as the Claude Code Goal. It runs the whole transformation sequentially in one continuing session.

```
You are executing the Spectra Nova transformation, one mission at a time, in order, in this session.

Operating truth lives in docs/spectra-nova/. It supersedes docs/spectra-hq/ and every other planning directory. Read, in order, before doing anything: docs/spectra-nova/README.md, CANON.md, STATE.md, PLAYBOOK.md.

Determine the current mission from STATE.md: the lowest-numbered N1..N12 not yet accepted with evidence. Open docs/spectra-nova/LAUNCH_PROMPTS.md, find that mission's fenced prompt, and follow it exactly — it names the charter(s) to adopt from CHARTERS.md, the mission brief in missions/, the ARCHITECTURE docs to read, the verification tier, and the close-out requirements. Adopt that specialist identity fully for the whole mission; you are that engineer, not a generalist reading a checklist.

Then work. Implement the brief's workstreams in order. Inspect current code truth before modifying anything — the repository drifts between missions and the documents may lag it. Root causes, not surface patches. Migrate and delete; never leave a v2 beside a v1.

Verification is calibrated, not ritual (PLAYBOOK §3). Reliability-critical work (Bridge, sync, journals, Office lenses, migrations, conflict logic) is Tier R: automated tests, corpus and chaos runs, dated passing evidence — screenshots cannot verify correctness there. Product work is Tier P: use the real product in Chrome yourself, capture screenshots to .shots/missions/N<n>/, and inspect them. Visual work is Tier D: intermediate frames and performance traces too. Never run whole-project typecheck, lint, build or the full suite as a coding rhythm — those run at your close-out. Targeted tests and single-route reloads are always fine; assume the dev server is running.

You own the mission: integration, browser verification, acceptance, and the decision that it is complete. Sub-agents are rare, bounded, never touch the browser, never update STATE, and never own a mission (PLAYBOOK §6). Never blend two missions: work outside your brief is either a small in-blast-radius fix or one line in STATE's Field Notes.

Close a mission only when every acceptance gate in its brief has tier-appropriate evidence. Then, in this order: run the close-out checks (npx tsc --noEmit, lint, tests, node scripts/scan-secrets.mjs), fix what you broke, update STATE.md honestly with statuses, evidence paths and Field Notes, append a mission log of at most 40 lines to the mission file, and commit. Produce no other documents — the durable reasoning already exists in docs/spectra-nova/. If a Nova document is factually wrong, fix that document in the same commit and note it in the log.

Then advance: re-read CANON, STATE, PLAYBOOK §3–§7 and the next mission's launch prompt, and begin the next mission with the same discipline.

If your context is compacted or the session restarts, do not resume from memory: re-read CANON, STATE (§1 plus your mission's entries), PLAYBOOK §3–§7, your mission brief including your own mission-log-so-far, and the ARCHITECTURE docs your brief lists — then continue from your last commit.

Reliability outranks capability: a feature that silently corrupts data, loses work, or reports "Synced" when a local write failed is worse than no feature at all. Never claim a state you cannot prove. Never invent a lossy shortcut through a native file format. Never let a keystroke wait on a disk or a network.

Do not stop to ask for questions: solve anything that is presented to you.

When N12 closes with its release verdict in STATE.md, report that the program is complete and stop.

Between each mission, git add all and commit, but never change branch. Do not use sub-agents. Keep `/frontend-design` and `/design-taste-frontend` active when UI is being implemented, including after compaction, but treat them as quality constraints rather than an invitation to redesign or polish repeatedly.

Implementation is the critical path. Complete every workstream in the current mission before beginning the mission-level verification pass. Between workstreams, use only the smallest targeted check needed to avoid building on a functional failure; do not capture evidence, re-run Golden Flows, or iterate on non-blocking visual refinements. When all workstreams are implemented, verify the entire mission once, fix acceptance-blocking defects, capture the smallest set of screenshots that proves the gates, run close-out checks, and close. Do not pursue subjective perfection outside an explicit acceptance gate; N10 and N11 own convergence and visual perfection. Prefer finished, correct missions over immaculate intermediate surfaces. Keep pace high without lowering correctness, reliability, accessibility, or the stated acceptance bar.
```

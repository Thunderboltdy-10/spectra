# ORCHESTRATION — running the Reformation without Pablo in the loop

**Adopted 2026-08-30 (Pablo).** From here to the release verdict, the program runs in **orchestrated mode**: one long-lived orchestrator agent replaces Pablo as router, launcher, merger, and (delegated) acceptor. Pablo's standing instruction: *"apart from any issues it has, I can just leave it running and it will finish everything."* Everything in README/CANON/STATE/PROCESS/VERIFICATION remains binding; this document adds the machinery. Where this document assigns something to "the orchestrator" that older documents assign to "Pablo", this document wins (CANON R18).

The orchestrator's product is not code. It is a finished, verified program: every remaining unit ACCEPTED, the real-corpus gate green, and a written release verdict waiting only for Pablo's signature.

## 1. The launch prompt (Pablo pastes this once, model: GPT 5.6 Sol xhigh)

```
You are the ORCHESTRATOR of the Spectra Reformation. You will run the remaining
program to completion without Pablo in the loop.

Read, in order: docs/spectra-reformation/README.md, CANON.md (R18/R19 are yours),
STATE.md (§0, §1, §2), PROCESS.md, VERIFICATION.md, ORCHESTRATION.md (your
operating manual — every section binds you), then the phase briefs for all
remaining work (P5–P8). Re-read ORCHESTRATION.md, STATE §0, and
docs/spectra-reformation/orchestration/RUNLOG.md after any context compaction —
RUNLOG is your durable memory; reconstruct from it and git, never from recall.

You never write product code, tests, or evidence yourself. You route, launch,
merge, record, and decide. All building and verifying is done by subagents you
launch per ORCHESTRATION §5–§7, one filled PROCESS §5 prompt each, with the
orchestrated-mode addendum. Follow the board in ORCHESTRATION §3, the model
tiers in §4, the parallelism and worktree rules in §5–§6, and the failure
protocol in §7 exactly.

Start with ORCHESTRATION §10 (first actions). Queue the one-time second-account
sign-in request to Pablo immediately (§9) so it never blocks P5.V1. Ask Pablo
nothing else unless a §8 stop condition is met; questions go to
orchestration/QUESTIONS.md and you keep working other tracks while they wait.

You are done when ORCHESTRATION §11 says you are done. Do not stop before that.
```

## 2. Authority and its limits

The orchestrator **may** (delegated by Pablo, CANON R18):

- Route and launch every remaining unit, choosing timing, parallelism, and model tier per §4–§5.
- Record **ACCEPTED** on any unit whose paired VU is PASS with real evidence (the "auto after verifier PASS + recorded unit evidence" path in PROCESS §2, now the default). The row reads `ACCEPTED (orchestrator, delegated)`.
- Spawn unscheduled agents: fix agents for findings, merge agents for conflicts, relaunched verifiers, read-only explorers. If an implementer reports something off, the orchestrator routes it to a fix agent — it does not wait for Pablo. If a verifier leaves a paste-ready handoff, the orchestrator launches it in a **new** agent, then relaunches verification in another **new** agent.
- Answer unit agents' stop-and-ask questions itself when the answer is derivable from the docs stack (trust hierarchy in README). Unit agents in orchestrated mode ask the orchestrator first, not Pablo.
- Create/remove git worktrees and branches named `reform/*`, merge them into `main`, and commit doc/ledger updates.

The orchestrator **may not** (these stay Pablo's, CANON R18):

- Write or edit product code or tests itself — not even one-line fixes. Spawn an agent.
- Weaken, skip, or reinterpret any gate; accept a unit whose VU did not PASS; accept its own judgment as evidence.
- Deploy to production hosts, push Convex to a production deployment, rotate/handle secrets, or flip the live gateway (STATE §5).
- Take destructive actions on real user files (OneDrive originals, `PS 6.docx`/`PS 8.docx`, the Extended Essay original) — real documents are **copied** into fixtures, never edited in place (§8).
- Sign the release. P8.V2 produces the verdict document; **go/no-go remains Pablo's signature**.

Pablo's L5 ten-minute passes are no longer blocking between phases: the orchestrator requests one in QUESTIONS.md at each phase gate and proceeds. RC.V1 (§8) exists to make those passes boring. The only hard human gates left are the §9 one-time sign-in and the final signature.

## 3. The board — remaining work as a dependency graph

Statuses live in STATE §0; this is the execution order. Do not invent units; dynamic agents (fix/merge/relaunch) attach to an existing unit's row and log.

```
[start]
  ├─ A0  Delegated acceptances: record ACCEPTED (orchestrator, delegated) on
  │      P2.I1, P3.I1–I4, P4.I1–I5 (their VUs are PASS); note P4.V1 absorbed.
  ├─ A1  Triage the uncommitted working tree (~25 files, embeds-shaped —
  │      in-flight P5.I3). One xhigh agent, main checkout: assess, complete or
  │      repair as P5.I3 proper, test, commit. This is P5.I3's implementation.
  └─ A2  Queue §9 profile-B sign-in request to Pablo (needed by P5.V1 at the latest).

P5.I3 (impl, main checkout) ──► RC.V1 real-corpus gate (§8, live verifier, max)
                                   │  findings → RC fix agents → RC.V1 re-run until green
                                   ▼
                                P5.V1 multi-writer + classroom load (live verifier, max;
                                needs profile B)
                                   │
        ┌──────────────────────────┤ (P6 worktrees may start as soon as P5.I3 is merged;
        ▼                          ▼  they rebase after P5.V1's repairs land)
   P6.I1 UX debt (worktree)   P6.I3 dead-code sweep (worktree)
        └──────────┬───────────────┘  merge order: I3 first, then I1
                   ▼
              P6.I2 design-system adoption sweep (worktree; starts only after
              I1+I3 are merged — it sweeps settled surfaces)
                   ▼
              P6.V1 whole-product convergence audit (live verifier)
                   ▼
   P7.I1 field + motion grammar ──► P7.I2 landing (may start once I1's converged
                   │                field API is merged; rebases before close-out)
                   ▼
              P7.V1 visual/motion verification (live verifier)
                   ▼
              P8.V1 chaos + multiplayer finale (live verifier, max; production
              build; includes the §8 corpus re-run and profile B)
                   ▼
              P8.I1 finale fix window ──► P8.V1 re-run of failed families
                   ▼
              P8.V2 release verdict (max) ──► Pablo signs
```

Standing rules on top of the graph:

- Every VU runs in a **fresh agent** with no implementer context (R8). A VU re-run after fixes is another fresh agent.
- Never two live-product verifiers at once (PROCESS §4.6) — enforced by the `dev-server` lease (§6).
- Hard units are serial with each other. Implementation worktrees for the *next* phase may run while the current phase's VU runs (worktrees don't touch the live tree), but must rebase over the VU's repairs before close-out.
- Phase "substantially accepted" prerequisites are satisfied by delegated acceptance — the graph above already encodes the real ordering constraints.

## 4. Model routing — all GPT 5.6 Sol; tier by demand

The PROCESS §4.2/§4.3 model names (Luna, Grok) are retired for remaining work (Pablo 2026-08-30). Every agent is **GPT 5.6 Sol** at one of three tiers. Rank by what the work demands, not the STATE tag alone.

| Agent | Tier | Why |
|---|---|---|
| Orchestrator | **xhigh** | Long-lived; routing and merge judgment; misroutes are expensive |
| P5.I3 triage/finish | **xhigh** | Inherited half-built diff; one-embed-model semantics |
| **RC.V1 real-corpus gate** | **max** | Highest-value verification in the program; known-red start (§8) |
| **P5.V1** multi-writer + load | **max** | Hard; concurrency truth; where silent lies live |
| P6.I1 UX debt | xhigh | Class-wide closure across many surfaces |
| P6.I2 design-system sweep | xhigh | Codemods next to a11y and consolidation taste |
| P6.I3 dead-code sweep | **high** | Mechanical, well-specified (the one Simple unit) |
| P6.V1 convergence audit | xhigh | Journey + audit at density |
| P7.I1 field + motion | xhigh | Taste inside settled tokens; perf budgets |
| P7.I2 landing | xhigh | Design-heavy; the product's face |
| P7.V1 visual/motion VU | xhigh | Frame-level grading, budgets, rubric |
| **P8.V1** chaos + multiplayer finale | **max** | The release gate's teeth; production composition |
| P8.I1 finale fix window | xhigh | Class-wide fixes; escalate a Hard finding to max |
| **P8.V2** release verdict | **max** | The final verification; Pablo signs what it writes |
| Fix agent — LOCAL / mechanical finding | high | Loud bug, one seam |
| Fix agent — SYSTEMIC finding | xhigh | Class-wide repair |
| Merge agent (worktree conflicts) | high | Mechanical unless seams collide, then xhigh |
| Read-only explorers | high | Orientation only |

**Escalation ladder:** the same class failing twice escalates its next agent one tier (high→xhigh→max). A failure **at max** on the same class twice is a §8 stop condition. Verifier relaunches keep the original tier. Log every tier choice and escalation in RUNLOG.

## 5. Launching agents

Each unit agent gets the PROCESS §5 launch prompt, filled, **plus this orchestrated-mode addendum** (adapt bracketed parts):

```
ORCHESTRATED MODE ADDENDUM
You report to the orchestrator, not to Pablo. Anything PROCESS/CANON says to
"stop and ask Pablo" you instead put in your close-out for the orchestrator —
except destructive actions on real user files, secrets, or gate-weakening,
which still hard-stop.

[Worktree agents] You work ONLY in <worktree-path> on branch reform/<unit-id>.
Run `npm ci` there first if node_modules is missing. Commit on your branch;
never touch the main checkout, never run the dev server or live browser checks
(you hold no lease) — focused Vitest/ESLint/tsc only; live grading belongs to
your paired VU. Do NOT edit STATE.md; append your unit log to the phase brief
as usual and put anything STATE-worthy (field notes, findings, follow-ups) in
docs/spectra-reformation/orchestration/notes/<unit-id>.md. The orchestrator
folds it into STATE at merge.

[Main-checkout agents] You work on main in the main checkout (never change
branch). You hold these leases: <list, per ORCHESTRATION §6> — do not touch
resources you do not hold. You may append findings to STATE §1; STATE §0 rows
are orchestrator-only. Commit per coherent chunk as usual.

Your final message must follow PROCESS §5 close-out, addressed to the
orchestrator: what happened, where every issue goes (fixed here / paste-ready
prompt / later unit by name), and what to launch next.
```

Verifier prompts must stay clean: no implementer chat context, no file paths from the implementation report — the unit ID, role, docs, and goal cards only (VERIFICATION L3).

**Whole-frame visual bar (Pablo 2026-08-30).** Every screenshot is a product-wide observation, not a crop around the target control. UI implementers and verifiers inspect the entire visible frame for discoverability, hierarchy, spacing, copy, state honesty, density, accessibility, and family resemblance. A target card does not pass while another obvious flaw is visible: fix it if the active unit owns its class, otherwise file it with an owner and evidence. Final verification applies this at every intermediate frame and state, but ordinary UI units use the same standard continuously. An implemented feature that is not evident to a person is incomplete.

**Concurrency caps (Pablo: "not too many simultaneously"):** at most **3** unit agents live at once — at most **1** holding the `dev-server` lease (the single live verifier or a live-checking implementer), at most **2** worktree implementers. Fix/merge agents count toward the cap. Prefer parallelism only where briefs do not share a seam; when unsure, serialize — throughput comes from overlapping the next phase's implementation with the current VU, not from forcing collisions.

## 6. Worktrees, merges, and resource leases

**Worktrees.** Main checkout stays on `main` forever (existing rule). Parallel implementers get isolated trees:

```
git worktree add ..\ai-school-worktrees\<unit-id> -b reform/<unit-id>   # from current main
```

Each worktree needs its own `npm ci`. Bridge/Rust-touching units and anything needing the live server, Convex dev, Bridge, Office COM, or Playwright run in the **main checkout only** (serialized by leases) — worktrees are for pure code+focused-test units.

**Merge protocol (orchestrator-owned).** When a worktree agent closes out: rebase `reform/<unit-id>` onto `main` (or merge `main` in) — trivial conflicts (phase-brief log appends, imports) the orchestrator resolves; anything touching product logic goes to a merge agent (§4). Then `git merge --no-ff reform/<unit-id>` into main, run that unit's focused checks once on main, update STATE, `git worktree remove` and delete the branch. One unit merges at a time. A unit is not IMPLEMENTED in STATE until its branch is merged.

**Leases** — recorded in `orchestration/LOCKS.md`; an agent may only touch a resource whose lease it holds; the orchestrator grants and reclaims:

| Lease | Resource | Notes |
|---|---|---|
| `dev-server` | `npm run dev` (web + gateway) + `npx convex dev` on localhost, main checkout | At most one holder ⇒ never two live verifiers |
| `playwright-a` | Profile `.playwright-cli/spectra-session` + `auth.json` | Account A |
| `playwright-b` | Profile `.playwright-cli/spectra-session-b` + `auth-b.json` | Account B (§9); multiplayer units hold both |
| `bridge` | The one Bridge instance + Pablo's real OneDrive mounts | Exclusive; extra care — real files |
| `office-com` | Headless Word/Excel/PowerPoint COM (hidden desktop) | One at a time; desks cleaned up after |
| `main-checkout` | Working tree of the main repo | Held by whichever single agent works on main |

Stale lease (agent died): orchestrator verifies the agent is gone, kills leftover processes it started (dev server, hidden desktops), reclaims, logs.

## 7. Failure protocol

- **Implementer reports a problem outside its scope** → orchestrator files it (STATE §1 via notes fold-in), routes to the owning unit or spawns a fix agent now if it blocks the graph.
- **VU REJECTED with a paste-ready handoff** → launch the handoff prompt in a fresh agent (tier per triage: LOCAL→high, SYSTEMIC→xhigh), then a fresh verifier re-runs the VU. The verifier's own in-VU repairs need no orchestrator action beyond recording.
- **VU asks for relaunch / dies mid-run** → new fresh agent, same tier, pointed at STATE §1 and the evidence directory (never at the dead agent's chat).
- **Same class fails twice** → escalate tier (§4). **Fails twice at max** → QUESTIONS.md, park that track, continue others.
- **Merge conflict beyond mechanical** → merge agent; if the conflict reveals two units fighting over one seam, serialize those units from then on and log the lesson.
- **Environment breakage** (port taken, Convex dev dead, profile corrupted) → orchestrator fixes environment directly (this is not product code) and logs it.
- Evidence rules are unchanged and orchestrator-enforced: a cited evidence path that is empty or predates the run fails the unit (GOV-1); the orchestrator spot-checks evidence directories exist and are dated before recording ACCEPTED.

## 8. RC.V1 — the real-corpus gate (new unit, H, model: max)

**Why.** The only real-document test Pablo ran — opening his Extended Essay — produced a mess: **equations did not render and tables were broken** (pre-filed as finding **RC-1**, STATE §1). P2's fixtures passed while the real thing failed. The bar (CANON R19): Spectra is production-ready only when Pablo's actual schoolwork survives it with full fidelity.

**Corpus** (copies only — originals are never mounted, edited, or touched):

1. **The Extended Essay** — Pablo's real EE `.docx`: equations (OMML), tables, images/captions, footnotes, TOC, headers/footers, styles, page breaks.
2. **A complex real presentation** — the densest real deck available: master/layout inheritance, transitions/animations, media, charts, tables, speaker notes.
3. **The Physics IA data collection** — Pablo's real `.xlsx`: multi-sheet formulas, units/precision, charts, conditional formatting if present.

Locate candidates under `<local-workspace>` (IBDP folders; STATE already names `...\IBDP1\Physics`); copy into `Downloads\spectra-rc-corpus\` and work there. If a corpus item genuinely cannot be found, that one item goes to QUESTIONS.md; the rest of the gate proceeds.

**Protocol** (VERIFICATION L3 discipline, evidence under `.shots/reformation/RC.V1/`):

- Mount the corpus copies; open each in Spectra. **Render fidelity first**: every element listed above either renders faithfully or shows an honest, plain-words explicit refusal/preserved-region presentation. Distinguish carefully: *renders correctly but read-only* is acceptable under R7; *doesn't render, renders wrong, or silently disappears* is a defect. RC-1 says the EE currently fails this — start there.
- **Exercise every option the product offers** on each file: every workbar capability per format (enabled ones must actually work; disabled ones must refuse honestly with a reason — R7's forbidden third option is the target), AI edits against the real content, embed/export/package paths.
- **Round-trip**: edit in Spectra → Keep on this computer → open in real Word/Excel/PowerPoint (COM) → verify the edit and the untouched remainder (untouched parts byte-identical where the D25 guarantee applies); then edit natively → verify Spectra reconciles honestly. Sequences, not moments (R11).
- Findings triaged per R12 and repaired class-wide (R17) or handed off; RC.V1 re-runs (fresh agent) until the whole corpus journey is green. PASS is recorded only on a clean full pass.

**When:** immediately after P5.I3 merges (first live slot), because everything after P5 builds on fidelity being true. The **same corpus re-runs inside P8.V1** on the production build, and P8.V2 cites both runs. RC.V1 holds `dev-server`, `playwright-a`, `bridge`, `office-com`.

## 9. Second account for multiplayer (one-time Pablo touchpoint)

P5.V1 and P8.V1 need two signed-in humans. Account A exists (`.playwright-cli/spectra-session`, `auth.json`). For account B, the orchestrator asks Pablo **once**, early (at A2, long before P5.V1 needs it):

> "Multiplayer verification needs a second signed-in account. A headed browser window is open at localhost — please sign in with the second account, then say done."

The agent handling setup opens a **headed** Chrome via playwright-cli on profile `.playwright-cli/spectra-session-b`, waits for Pablo, then saves storage state to `.playwright-cli/auth-b.json` (mirror the account-A conventions in STATE §2), records the fact in STATE §2, and every later use is headless (`state-load` if cookies go missing). If sign-in expires mid-program, the same request is made again — that is the only reason to repeat it.

## 10. First actions (in order)

1. Read the docs stack (§1 prompt). Initialize/append RUNLOG with a session-start line.
2. **A0** — record the delegated acceptances (P2.I1, P3.I1–I4, P4.I1–I5; P4.V1 absorbed) in STATE §0 with `(orchestrator, delegated)`.
3. **A2** — queue the §9 sign-in request to Pablo (QUESTIONS.md + a visible message). Do not block on it.
4. **A1** — launch the P5.I3 triage/finish agent (xhigh, main checkout, holds `main-checkout`; may take `dev-server` if it needs a live smoke).
5. When P5.I3 merges: launch **RC.V1** (max, all live leases). In parallel, cut worktrees for **P6.I1** and **P6.I3** and launch them (xhigh / high).
6. Follow the board (§3) until §11.

## 11. Done means done

The orchestrator's final message to Pablo comes only when **all** of: every STATE §0 row through P8.I1 is ACCEPTED (delegated) with real evidence; RC.V1 passed clean and its corpus re-ran green inside P8.V1; P8.V2's written verdict exists with every PRODUCT §6 disqualifier addressed item-by-item with evidence links. The final message lists: the verdict path, the open-risk and deferred-scope registers, the Pablo-only leftovers (signature, key rotation, gateway deploy), and anything parked in QUESTIONS.md. If the verdict is honestly **no-go**, that is still done — the ledger stays truthful and the findings define the next program's P0.

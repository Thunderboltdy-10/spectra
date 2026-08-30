# EXPANSION — the program that takes the protocol to its limit

**Adopted 2026-08-30 (Pablo). Binding under CANON R21–R27.** This document extends the Reformation with phases **P9–P15** and reactivates orchestrated execution as **v2** (§3). It is operational truth at the same tier as the rest of `docs/spectra-reformation/**`. The original program (P0–P8) remains intact; P8 is re-scoped as the final gate of the *expanded* program (see the P8 brief addendum).

**Mission.** Everything learned building the Office trio — the truth engine, the lens pipeline, the capability IR, the run engine — is now generalized deliberately: every artifact type reaches Office-trio depth; the protocol grows connector seams so any industry-leader service is an adapter, not a rewrite; school intelligence (ManageBac/CAS) becomes a real product; memory gets a soul; and all of it is developed and verified on **local Convex deployments** that stop burning cloud usage and unlock parallel verification. Production-ready remains the only bar (PRODUCT §6).

**The prime risk, named.** Growing the protocol is where regressions live. The Office/local path is the product's proven core; every generalization step is therefore gated by the existing fidelity harnesses, the seam contract, bridge chaos, and the real corpus (R19) *before* connectors fan out. P10.V1 exists solely to prove the refit changed nothing. No connector unit merges before that gate is green.

---

## §1 What this program adds

```
P9   Local Foundation & Convex Efficiency   local-first deployments (N instances),
                                            the five bandwidth classes fixed,
                                            seeded roles: superadmin + TGC admin
P10  The Connector Protocol                 connections model, three connector
                                            families, replica generalization,
                                            lens registry, Office refit gate
P11  The Connector Fleet                    Google Workspace, Google/Outlook/iCal
                                            calendar, Notion, Quizlet/Anki,
                                            Markdown/CSV/PDF — one unit each
P12  Artifact Depth                         every non-Office type to Office-trio
                                            depth, by named-leader inventory;
                                            Office trio gap re-audit
P13  School Intelligence                    ManageBac API captured for real, class
                                            selection, homework→plan pipeline,
                                            CAS productized
P14  Memory & Soul                          soul capsule, self-authored skills
                                            below hard caps, model-initiated capture
P15  Experience: Onboarding & Connections   the first-hour journey, the Connections
                                            hub, UI/UX sweep of every new surface
P8   The Release Gate (re-scoped)           runs LAST; matrix extended to the
                                            connector/depth surfaces; RC.V2 corpus
```

**Why this order.** Foundation before everything (testing must be free and parallel before we multiply agents). Protocol before fleet (a connector built on ungeneralized seams is a fork, and forks are how Nova died). Depth, school intelligence, and memory are independent of the connector track and run beside it. Experience consolidates last, when the surfaces it polishes exist. P8 gates the whole.

**The current track is not displaced.** RC.V1 (XLSX leg red, PPTX unstarted) → P5.V1 → P6.V1 remain the most senior work in the program and keep their existing briefs, models, and evidence rules. P7 (identity/landing) may run any time after P6.V1 as a parallel track.

---

## §2 The connector matrix

Three **families**, each with a proven in-repo pattern to generalize — do not force one family's machinery onto another:

| Family | Truth model | Existing pattern | Transport |
|---|---|---|---|
| **file-sync** | `workReplicas` + payloads + revisions | Office via local Bridge | Bridge (local FS) or Convex action workers (cloud APIs) |
| **calendar** | `calendarItems` with `sourceKey`/`sourceHash` | ManageBac timetable projection | Convex action workers |
| **school-data** | `externalRecords` + projections | ManageBac SIS | Convex action workers |

### Tier 1 — built in P11

| Connector | Family | Auth | Sync model | Honesty notes (R25) |
|---|---|---|---|---|
| Google Drive + Docs/Sheets/Slides | file-sync | OAuth (Pablo's Google Cloud app) | `changes.list` delta; native Google files via `files.export`/import **through the existing OOXML lenses** | Google's own OOXML export is the conversion boundary; declared in fidelity map, never hidden |
| Google Calendar | calendar | OAuth (same app) | incremental sync tokens; two-way for Spectra-authored events | — |
| Outlook / Microsoft 365 Calendar | calendar | OAuth (Azure app registration) | Graph delta queries; two-way for Spectra-authored events | — |
| iCal feed subscribe | calendar | none (URL) | poll; read-only | read-only by nature; UI says "subscribed calendar" |
| Notion | file-sync (import/export + linked refresh) | Notion integration/OAuth | pages→document, databases→sheets/planner; `last_edited_time` refresh | Notion has no mergeable revision model: **linked import/export with one-way refresh**, said plainly; never claim live sync |
| Quizlet | file-sync (import/export only) | none | paste/file import via Quizlet's export text format; export back | **Quizlet has no public API** (discontinued). Import/export only — the UI must say so |
| Anki | file-sync (import/export) | none (files) | `.apkg`/`.txt` import + export for flashcard decks; rides Bridge for watched folders | — |
| Markdown / Obsidian vault | file-sync | Bridge device | full replica sync via existing Bridge; new `md` lens for documents | wiki-links/frontmatter preserved-not-interpreted at first, declared in fidelity map |
| CSV | file-sync | Bridge device / upload | `csv` lens for sheets, import + export | single-table boundary declared |
| PDF | import only | files | import as resource + text extraction to document | one-way import; never claims round-trip |

### Tier 2 — named, deferred (Field Notes, not units)

OneDrive/SharePoint via Graph (cloud file-sync without Bridge), Todoist, Google Tasks, GitHub (code artifact), Google Classroom, Canvas/Moodle/PowerSchool (school-data), Google Forms/Kahoot quiz interop beyond CSV/GIFT export, Excalidraw/Miro whiteboard formats. Each becomes a single P11-shaped unit in a later wave; the P10 seams must make that true (that is P10's exit-gate walk-through).

---

## §3 Orchestration v2 (active; supersedes the §5–§6 caps of the retired ORCHESTRATION.md)

CANON **R22** reactivates orchestrated execution. Everything in the retired `ORCHESTRATION.md` remains valid **except where this section says otherwise**; §8 of that file (real-corpus protocol) is unchanged and binding. RUNLOG, QUESTIONS, LOCKS, and `orchestration/notes/<unit>.md` conventions continue unchanged.

### 3.1 Concurrency law — leases, not counts

- **There is no numeric cap on concurrent worktree implementation agents.** The old "at most 3 / at most 2 worktrees" rule is retired. Parallelism is bounded by exactly three things:
  1. **The ownership matrix (§5).** Two live units may not own overlapping paths. If the board would co-schedule an overlap, the orchestrator serializes those two units — that pair only.
  2. **Leases (§3.3).** Shared runtime resources are still exclusive.
  3. **The merge queue (§3.2).** Unbounded building, serial landing.
- Healthy load is 8–14 concurrent build agents plus 2–3 verifiers. This is guidance, not a cap — but the orchestrator must not launch agents whose merges it cannot process, and must never sacrifice merge scrutiny to launch more.
- Hard (H) units remain serial **within their phase**, not across phases.

### 3.2 The merge queue

One merge at a time, orchestrator-owned, in this discipline:

1. Worktree agent finishes: green on its unit-relevant checks **plus the standing merge gate** — `tsc --noEmit` (no new errors beyond the recorded blockers), scoped ESLint, `check:capabilities` ghost gate, secret scan, `git diff --check`, and the fidelity harnesses **whenever the diff touches `lenses/`, `bridge*/`, `convex/replicas.ts`, `convex/bridgeSync.ts`, or `shared/`**.
2. Agent rebases onto latest `main` in its worktree, re-runs the gate if the rebase touched its files, writes `orchestration/notes/<unit>.md`, and requests merge in its close-out.
3. Orchestrator merges `--no-ff`, folds notes into STATE, records RUNLOG, deletes the worktree.
4. Trivial conflicts (import lists, `catalog.ts` registrations, `COMMAND_TABS` rows) the orchestrator resolves; product-logic conflicts go to a merge agent.

### 3.3 Leases (updated)

| Lease | Resource | Count |
|---|---|---|
| `local-deploy-1..N` | one isolated local stack: local Convex instance + `next dev` + collab gateway on parameterized ports (P9.I1) | starts at 3 after P9.I1; orchestrator may add instances |
| `playwright-a` / `playwright-b` | the two signed-in browser profiles (STATE §2) | 1 each |
| `office-com` | headless Word/Excel/PowerPoint COM | 1 |
| `bridge` | the local Bridge tray instance + its mounts | 1 |
| `cloud-dev` | the legacy cloud dev deployment | 1 — **testing on it is retired by R23**; kept only for reads until P9.V1, then unused |
| `main-checkout` | primary working tree | 1 (orchestrator merges; agents build in worktrees) |

**Parallel verifiers are now legal (R23):** each live VU holds its own `local-deploy-n` lease. "Never two live-product verifiers" is retired as a count and survives only as "never two verifiers on the *same instance*". VUs needing `office-com`, `bridge`, or a Playwright profile still serialize on those.

### 3.4 Fire-and-forget agents

The orchestrator launches each agent with a complete PROCESS §5 prompt plus the orchestrated addendum, and **does not poll, monitor, or steer it mid-run**. The agent's close-out message, commit, and `orchestration/notes/<unit>.md` are the entire interface. If an agent dies silently, the orchestrator notices at the board level (stale worktree, no note) and relaunches fresh — it never resumes a dead agent's session.

### 3.5 Verifier cadence

- Verification is **phase-scoped, not sub-unit-scoped**: the VUs named in the phase briefs are the complete set. Do not invent per-IU verifiers.
- VUs launch as soon as their listed inputs are merged — **while other implementation units of the same or other phases keep building in worktrees**. A VU never waits for an unrelated track.
- Every VU is a fresh agent, no implementer context (R8). Rejection → fix agent → targeted re-verification of the failed families plus blast radius (Pablo's 2026-08-30 rule), not ceremonial full re-runs.
- Delegated acceptance continues exactly as R18 defined it: VU PASS + recorded evidence → `ACCEPTED (orchestrator, delegated)`.

### 3.6 Model routing

All agents GPT 5.6 Sol. Tiers follow PROCESS §4.2: **high** for S units and LOCAL fixes; **xhigh** default for MT/H implementers and most verifiers; **max** for RC gates, P10.V1, P11.V1, the phase-final journey VUs (P13.V1, P15.V1), P12.V1/V2, and anything twice-failed.

---

## §4 The board

```
CURRENT TRACK (most senior; unchanged briefs)
  RC.V1 XLSX/PPTX legs (fix agent + fresh max verifier)
     └─► P5.V1 ──► P6.V1 ──► P7.I1 ──► P7.I2 ──► P7.V1

WAVE 0 — launch immediately, all parallel worktrees
  P9.I1 local deployment harness
  P9.I2 Convex efficiency: runs + reminders          (disjoint files from I3)
  P9.I3 Convex efficiency: library + collaboration
  P10.I1 connection model + provider registry         (merge waits: RC.V1 PASS)
  P10.I3 lens registry + md/csv lenses                (merge waits: RC.V1 PASS)
  P12.I1..I6 artifact depth, one worktree per type
  P14.I1..I3 memory & soul
  P13.I1 ManageBac API capture (read-only probes are safe on cloud until P9 lands)

AFTER P9.I1 + P9.I4 merge:
  P9.V1 foundation verification (first local-instance VU; Pablo sign-ins per §6)
  → from here every VU runs on a local-deploy lease (R23)

AFTER RC.V1 PASS (baseline) and P10.I1+I3 merged:
  P10.I2 replica & sync generalization (H, serial within P10)
     └─► P10.V1 Office refit regression gate (max) — HARD GATE for all of P11

AFTER P10.V1 PASS:
  P11.I1..I6 connector fleet, one worktree per connector, all parallel
     └─► P11.V1 fleet verification (max)

DEPTH VERIFICATION (parallel with everything):
  P12.V1 after I1–I3 merged; P12.V2 after I4–I7 merged

SCHOOL INTELLIGENCE (needs P9 for local + MB key):
  P13.I1 ──► P13.I2, P13.I3, P13.I4 (parallel) ──► P13.V1 (max, live tenant)

MEMORY: P14.I1..I3 ──► P14.V1

EXPERIENCE (P15.I3 may start early; journey work needs P11/P13 merged):
  P15.I1, P15.I2, P15.I3 ──► P15.V1 (max, clean profiles)

FINALE:
  P8.V1 (extended matrix + RC.V2 corpus) ──► P8.I1 ──► P8.V2 ──► Pablo signs
  Prerequisites: P1–P7 and P9–P15 accepted.
```

Scheduling priorities when agents contend for leases: current track > P9 > P10 > P11 = P13 > P12 = P14 > P15. Convex efficiency (P9.I2/I3) is money — treat as urgent.

---

## §5 Ownership matrix (conflict avoidance)

Units own paths; the orchestrator never co-schedules overlapping owners. Shared registration points (`capabilities/catalog.ts`, `commands/registry.ts`, `convex/schema.ts`, `convex/crons.ts`) are **merge-queue-managed**: agents append, the orchestrator resolves trivial conflicts at merge.

| Track | Owned paths (prefixes) |
|---|---|
| P9.I1 | `scripts/local/`, `package.json` scripts, `.env.local.example`, `docs/spectra-reformation/runbooks/` |
| P9.I2 | `convex/spectraRuns.ts` (reconcile/listTabs), `convex/plannerReminders.ts`, `convex/timetableReminders.ts` |
| P9.I3 | `convex/spectraArtifacts.ts` (list path), `convex/collaboration.ts` (ensureRoom), `convex/orgTree*.ts` |
| P10.I1 | `convex/connections.ts` (new), `src/features/spectra/connectors/core/`, `src/features/spectra/settings/ui/` (Connections hub) |
| P10.I2 | `convex/replicas.ts`, `convex/bridgeSync.ts`, `convex/syncPolicy.ts`, `shared/` |
| P10.I3 | `src/features/spectra/lenses/` (registry + md/csv), `scripts/fidelity-harness/` |
| P11.I* | `src/features/spectra/connectors/<provider>/`, `fixtures/<provider>/` — one provider per unit, no overlap by construction |
| P12.I* | `src/features/spectra/components/<type>-studio.tsx`, `capabilities/studio-<type>.ts` (new per-type files), `artifacts/skills/<type>.ts` — one type per unit |
| P13.I* | `convex/managebac.ts`, `src/app/api/spectra/managebac/`, `src/features/spectra/pages/{managebac,school-data}*`, `convex/calendar*.ts` (I3) |
| P14.I* | `convex/memory.ts`, `convex/userSkills.ts` (new), `src/app/api/spectra/run/loop/gather.ts` (memory sections), `public/skills/` (I2 migrate-or-delete) |
| P15.I* | onboarding routes, `settings/ui/`, shell chrome — scheduled after P10.I1's hub merge to avoid overlap |

P9.I3 and P10.I2 both approach the replica/bridge seam: **the split is binding** — P9.I3 must not touch `convex/replicas.ts`/`convex/bridgeSync.ts`; the bridge-side efficiency work (claim polling, sweeper batching, inline projection blobs) belongs to P10.I2.

---

## §6 Pablo-in-the-loop items (queued in QUESTIONS.md; nothing blocks other tracks)

1. **OAuth applications** — create and hand over credentials for: Google Cloud app (Drive + Calendar scopes), Azure app registration (Graph Calendars), Notion integration. Connector units build and test against **recorded fixtures** until credentials arrive; live probes are the last leg of each unit.
2. **Local bootstrap sign-ins (P9.I4)** — run the checklist: sign in the secondary account (becomes platform operator via `SUPER_ADMIN_EMAILS` — confirm that email), sign in account A (accepts TGC `school_admin` invitation), enter the ManageBac API key in `/managebac` on the local instance, re-pair Bridge to the local deployment, and re-import the local folders. This *is* the onboarding dry-run; findings are filed like any journey.
3. **L5 ten-minute passes** per phase, requested at each gate, non-blocking.
4. Existing standing items (key rotation, Fly.io gateway deploy) remain in STATE §5.

---

## §7 The regression law (what must never break)

1. **Office/local fidelity is inviolate.** Any merge touching lenses, bridge, replicas, or shared sync code runs the DOCX/XLSX/PPTX harnesses and the seam contract in-worktree before merge. P10.V1 re-runs the full corpus (R19) on the refit seams before any connector lands.
2. **The IR is the only door** (R6). Depth and connector capabilities land as `CapabilityDefinition`s with real execute/refuse paths; the ghost gate fails the build otherwise. No side-channel commands.
3. **One temporal truth.** Calendar connectors and P13's pipeline converge on `calendarItems`; nothing writes a second events store. The timetable artifact reads through, never forks.
4. **Truthful states everywhere** (R2): every new connector state — token expired, rate-limited, provider 5xx, revoked — has a compensating exit and a plain-words presentation (R13). `syncConflicts` remains the single conflict record.
5. **Budgets are gates** (R10): P9 establishes measured Convex I/O baselines per surface on local instances; every later phase's VU re-checks them. A connector that polls itself into the old bandwidth profile is a defect.
6. **Migrate-and-delete, never fork** (PROCESS §7) — applies doubly to protocol generalization: `OFFICE_NATIVE_FORMATS` hardcodings are replaced, not paralleled; `public/skills/` is wired or deleted, not left dormant.

---

## §8 Resume instructions for the running orchestrator

Paste-ready follow-up (Pablo → the live orchestrator):

```
EXPANSION ADOPTED. Read, in order: docs/spectra-reformation/EXPANSION.md (your
new operating sections are §3–§7), CANON.md R21–R27, STATE.md §0 (new P9–P15
rows), then the seven new phase briefs phases/P9-*.md … P15-*.md and the P8
brief addendum. ORCHESTRATION.md §8 remains your corpus protocol; its §5–§6
caps are superseded by EXPANSION §3.

Then, without waiting on anything else:
1. Keep the current track running exactly as before (RC.V1 → P5.V1 → P6.V1).
2. Launch Wave 0 per EXPANSION §4: P9.I1/I2/I3, P10.I1/I3, P12.I1–I6,
   P14.I1–I3, P13.I1 — one worktree agent each, fire-and-forget (§3.4),
   ownership matrix §5 enforced, merge queue §3.2.
3. Queue the §6 Pablo items in orchestration/QUESTIONS.md immediately.
4. From P9.V1 onward, run every VU on a local-deploy lease (R23).
Log to RUNLOG as always. The board in EXPANSION §4 is your dependency truth.
```

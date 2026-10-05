# Launch redesign plan

The live verification (218 checks: 109 pass, 64 fail, 45 blocked) showed that two things stand between Spectra and
launch:

- **The AI architecture.** It refuses or derails good model output, replies before acting, and is slow.
- **The UI.** It has too many columns, floating overlays over content, inconsistent controls, and no life.

This plan fixes both without letting launch drift. The design and AI decisions it implements are in
[`docs/design/`](../design/README.md) and [`docs/ai/HARNESS.md`](../ai/HARNESS.md).

## User decisions

### 2026-10-03

1. **AI edits land directly.** The AI asks only for actions that cannot be undone and for settings changes.
   - The Allow button carries an "Always allow" option.
   - Settings has per-category control, including "Give Spectra full control".
2. **Ink + spectrum colour.** The user can remap what each colour means in Settings.
3. **Free fonts only.** They should be clean, cozy and usable, and selectable in Settings.
4. **Layout.**
   - At most three columns.
   - Closable panels hold transient work; collapsible panels hold page structure.
   - No fullscreen, except artifacts on Workspace and Library.
   - The threads view stays, with semantic search.
   - The rail's account section is reduced.
5. **The AI harness** imitates Claude Code:
   - one loop with tools, skills and compaction;
   - inline widgets;
   - progress captions from a separate low-reasoning call;
   - artifact cards only when something happened;
   - no forced stages.

### 2026-10-04 (after the visual spec)

These decisions override any earlier ones they conflict with.

1. **Approved as final:** the palette, the type and the shell.
2. **The spectrum is continuous.** It interpolates in OKLab and passes through a violet–pink joint, so it has no
   seam.
3. **Spectra's own icons.** Every icon outside editor workbars is Spectra's own glyph (see
   [ICONS.md](../design/ICONS.md)).
4. **The prism.**
   - The orchestrator builds it in code (2D canvas) as part of the life system. It is made of the field's dots, and it
     dissolves and re-forms (see [LIFE.md](../design/LIFE.md)).
   - It appears in the rail as the brand, in the island and in Spectra's own moments. It is not forced elsewhere.
   - The Blender and runtime prism prompts are retired.
5. **The field** is alive: a physical membrane, invisible at rest, faint, and strongest where something happens. It
   carries presses, drags, appearing, deleting, loading, sending and arriving.
6. **The island.**
   - It sits at the bottom centre on every page, and it is the only composer: Shift + Enter, attachments and @
     references.
   - The hover tabs are the main interface. In play (working, needs you, finished but unseen) is on the left; done is
     on the right. Both can be reordered and moved between sides.
   - A setting lets the island wake from the bottom edge instead of showing the prism.
   - The split-button "Always allow" is short and never clipped.
7. **Agents** are picked automatically unless the user chooses one with the island's agent switch.
8. **No exposed context.**
   - Context chips are removed, and so is the injected screen summary. Spectra finds things with semantic search.
   - Embeddings cover everything the user can see.
9. **Bridge.**
   - The Bridge animation is dropped. Each artifact has a pinned status control instead (see
     [EDITORS.md](../design/EDITORS.md#the-status-control)).
   - The Bridge desktop window is removed. Bridge is tray-only, with the prism as its icon, and is controlled from a
     new Devices page (see [DEVICES.md](../product/DEVICES.md)).
10. **ManageBac** gets per-student sync preferences, past tasks with dropbox files, and CAS (see
    [SCHOOL.md](../product/SCHOOL.md)).
11. **No backwards compatibility anywhere.** There are no users yet.
12. **Process.**
    - The orchestrator works without asking for approvals.
    - There is no live checking until the user calls for it. Lanes verify with tests and non-live checks, and main is
      pushed without live verification.
    - The orchestrator builds the design system's core itself (life, prism, icons, tokens, kit), and orchestrates the
      design lanes once that core exists.

## Waves

**How lanes run.**

- Two of the orchestrator's lanes run at once. The user's own agents don't count toward that.
- Each lane is a background agent with a brief.
- The orchestrator reviews and merges each lane, then starts the next.
- Alongside the lanes, the orchestrator builds the design core itself.

| Wave | Lane | Scope | Depends on |
| --- | --- | --- | --- |
| 1 ✓ | **A1 · AI harness core** | One loop, tools, permissions, captions, compaction | — |
| 1 ✓ | **R1 · Reliability** | Open non-AI ledger issues | — |
| 1 ✓ | *Orchestrator · Visual spec* | Approved 2026-10-04 | — |
| 2 | **A2a · Semantic layer** | Embeddings for everything the user can see, hybrid search, and the APIs | A1 |
| 2 | **A1b · Harness polish** | Remove context injection and context chips. Accept an explicit agent id. Attachments resume the run. Thread-title robustness. "Getting ready" step label. Decks in one create call. First-output latency. | A1 |
| 2 | *Orchestrator · Design core* | The life engine (worker, lattice physics, particles, API), the prism renderer, the icon set, tokens and fonts, the continuous spectrum, kit primitives with life hooks, SplitButton, Tooltip, AdaptiveBar `pinned`, and the `/dev/life` and `/dev/icons` labs | — |
| 3 | **A2b · AI reach** | `search` on the semantic layer, skills as folders, command-registry parity, `show_widget`, the permission settings UI, evals | A2a, A1b |
| 3 | **F1 · School** | [SCHOOL.md](../product/SCHOOL.md): API research, per-student sync preferences, past tasks and files, CAS (backend first) | — |
| 3 | **F2 · Devices** | [DEVICES.md](../product/DEVICES.md): Bridge tray-only, the prism tray icon, local control for everything, the Devices page backend | Prism renderer |
| 4 | **D2 · Shell and island** | The three-region shell, the rail with Devices, the bottom island (all states, hover tabs, composer, agent switch, questions), the threads view, removing the live dock | Design core, A1b |
| 4 | **D3 · Pages** | Every page on the shell and kit, including the Devices and School page UIs, each AdaptiveBar plan, and copy with no ids | Design core, F1, F2 |
| 5 | **D4 · Editors** | The status control, hand-authored workbar plans and reordering, shared rich content, embeds, physical elements and field moments in editors | Design core |
| 5 | **D5 · Life everywhere** | A sweep of every surface for life moments, AI light and streaming, shared-element transitions, reduced motion, and performance budgets | D2–D4 |
| 6 | **L1 · Later** | Planner task simplification, the agents bench | — |
| — | **Live verification** | Only when the user calls for it | — |

## Protocol for every lane

**Read first:**

- this file;
- `docs/README.md`;
- the design or AI docs named in your brief.

**Where you work.**

- Work only in your assigned worktree and branch.
- Lane R1 is the exception: it works in the primary checkout on `main`, because it needs the local stack.
- Never touch other worktrees or branches.

**Never:**

- run `npm install` or `npm ci`, or add dependencies without the orchestrator's approval;
- touch `node_modules` (in worktrees it is a junction to the shared install);
- run `git worktree add/remove/prune`, `git clean -x` or `git stash`;
- push, or delete branches;
- touch the landing page;
- edit or print `.env.local`.

**Spectra AI is never constrained.** Model, provider and reasoning come from the environment. The one approved
exception is the progress-caption writer's fixed `low` reasoning (see HARNESS.md).

**Repository contracts:**

- Convex builders come from `convex/functions.ts`.
- The UI reads errors with `readConvexError`.
- Keep each file's line endings (many are CRLF).

**Commits.**

- Commit every coherent step with conventional commits.
- Each message says what was wrong or what changes, and why.
- Each ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Tests.**

- Each behaviour change comes with a test.
- Focused runs: `npx vitest run <files> --maxWorkers=3`.
- Typecheck both configs: `npx tsc --noEmit -p tsconfig.json` and `-p convex/tsconfig.json`.
- `npm run lint`.
- The `check:*` gates.
- One full `npx vitest run --maxWorkers=3` near the end.
- `next build` runs only in the primary checkout. The orchestrator builds after merging.

**Delete what you replace.** There is no back-compat to keep. Remove dead code, old tests for removed behaviour and
compat shims, and say so in the commit.

**Report.** Write exactly one report, `docs/spectra-launch-audit/reports/R-<LANE>.md` (for example `R-A1-AI-HARNESS.md`), holding:

- what changed;
- what was removed;
- tests and gates, with results;
- what needs live checking;
- the decisions you made and why.

**Final message to the orchestrator.** At most about 70 lines.

## Status

| Lane | Branch / worktree | State |
| --- | --- | --- |
| A1 | `lane/ai-harness` (worktree removed) | Merged into main as `91694702`; gates, 4366 tests and build pass ([report](reports/R-A1-AI-HARNESS.md)) |
| V1 · AI live check | — | Stopped by the user's decision (no live checks for now). Its inline-emphasis fix landed as `e458902d`; its other findings moved to A1b. |
| R1 | `main` · primary checkout | Done: 13 issues fixed, build green ([report](reports/R-R1-RELIABILITY.md)). Left for a paired Bridge: LV-046 native check, LV-061 first open. For D3: Calendar block notes show raw `<p>` HTML. |
| Visual spec | — | Approved 2026-10-04: https://claude.ai/artifact/56MkPBViV6HKgCz9CM8uvV |
| A2a · Semantic layer | `lane/semantic` (worktree removed) | Merged into main as `32e8240c` (backend only; UI surfaces go to D2–D4, the AI's `search` tool to A2b) |
| A1b · Harness polish | `lane/harness-polish` (worktree removed) | Merged into main as `5ae76253`; build passes |
| Design core | `main` · primary checkout (orchestrator) | Done. Life engine v2 `4076255a` and its choreography map `0c818c81`; the field app-wide with the favicon prism and `/dev/life` `a66ff039`; the glyph set and `/dev/icons` `9f85828b`; the kit (AdaptiveBar `pinned`, SplitButton, IconButton, Row, Tooltip shortcuts) `7075674e`. Pages adopt glyphs and the kit in D2 and D3. |
| Prism (user's agent) | `lane/prism` · `<local-workspace>` | Retired: the orchestrator builds the prism in code |
| A2b · AI reach | `lane/ai-reach` (worktree removed) | Merged into main as `401bc4d3` ([report](reports/R-A2b-AI-REACH.md)). The F1 follow-up landed with the merge: each AI sync purpose asks ManageBac only for its kinds. Left: `read_school_data` on the `api.school` queries. |
| F1 · School | `lane/school` · `<local-workspace>` | Merged into main as `07a35120` ([report](reports/R-F1-SCHOOL.md)); live checks listed there. Follow-up for A2b: the AI refresh names its kinds. |
| D2 · Island core | `main` · primary checkout (orchestrator) | The island replaces the live dock and every page composer (`6baccb03`). |
| D2 · Shell | `main` · primary checkout (orchestrator) | The rail (prism brand, workspace switcher, seven destinations with Devices, pinned works, one account row with notifications, theme and help); the threads view (semantic search, groups, row → island choreography); one `--spectra-rail-width` for rail, stage and island; shortcuts open the island (`93ca14d0`). Island arranging: drag to reorder and across the + (ghost, FLIP parting, + ripple, field wake), flick to history, Alt + arrows, a tab context menu; lazy history behind the "›"; arriving threads form their tab from the row's light; notices and notifications form from the prism; the island centres between the rail and the Side. Done. |
| F2 · Devices | `lane/devices` · `<local-workspace>` | Running |
| D4 · Editors | `lane/editors` · `<local-workspace>` | Running |

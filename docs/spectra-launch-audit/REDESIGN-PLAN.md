# Launch redesign plan

The live verification (218 checks: 109 pass, 64 fail, 45 blocked) showed that two things stand between Spectra and
launch:

- **The AI architecture.** It refuses or derails good model output, replies before acting, and is slow.
- **The UI.** It has too many columns, floating overlays over content, inconsistent controls, and no life.

This plan fixes both without letting launch drift. The design and AI decisions it implements are in
[`docs/design/`](../design/README.md) and [`docs/ai/HARNESS.md`](../ai/HARNESS.md).

## User decisions (2026-10-03)

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
5. **The dot field** returns as the paper's grain, polished and complete.
6. **The AI harness** imitates Claude Code:
   - one loop with tools, skills and compaction;
   - inline widgets;
   - progress captions from a separate low-reasoning call;
   - artifact cards only when something happened;
   - no forced stages.
7. **The island** sits at the top centre with no reserved band. At rest it is the 3D prism. Hovering reveals the tab
   structure, and questions morph the prism.
8. **The prism** is being made by the user in Blender, with rotation, press rebound and drag/settle animations. Its
   assets arrive in `<local-workspace>`.

## Waves

Two lanes run at once (the user's own agents, such as the 3D work, don't count toward that). Each lane is a
background agent with a brief. The orchestrator reviews and merges each lane, then starts the next.

| Wave | Lane | Scope | Depends on |
| --- | --- | --- | --- |
| 1 | **A1 · AI harness core** | One loop. Tools with authoring formats, atomic edits and readback. Permissions by effect. Progress captions. Compaction. Thread rendering rules. Light bookkeeping. Removing the seven-stage pipeline. A first system prompt. A live smoke script. | — |
| 1 | **R1 · Reliability** | The open non-AI ledger issues: LV-062, 066, 067, 060, 069, 061, 068, 059 and 017, plus LV-056 and the small NEEDS-DECISION items (LV-003, 012, 028), using the orchestrator's decisions | — |
| 1 | *Orchestrator* | The visual spec (tokens, type, kit, island and shell studies) for the user's approval | — |
| 2 | **A2 · AI reach and quality** | The semantic layer (embeddings and hybrid search). Skills as folders, with craft rewrites, `spectra-design` and `frontend-design`. Command-registry parity with `find_commands` and `run_command`. `show_widget`. Permission settings UI. The full eval suite (about 40 scenarios) and latency tuning. | A1 |
| 2 | **D1 · Design foundation** | Tokens, fonts and font settings, colour roles and their settings. Kit primitives with built-in motion. AdaptiveBar. `SpectraMark`, once the prism assets exist. Lint and token gates. Migrating the worst offenders. | R1, visual spec approved |
| 3 | **D2 · Shell and island** | The three-region shell, closable and collapsible panels, the companion and its inner sheet, the threads view, the rail, the island (all states and morphs), and removing the live dock | D1, A1 |
| 3 | **D3 · Pages** | Library, Calendar, ManageBac, School, Settings, Home and Chat moved onto the shell and kit, each AdaptiveBar plan authored, and copy with no ids | D1 (runs after or beside D2 by file ownership) |
| 4 | **D4 · Editors** | Hand-authored workbar plans and user reordering, shared rich content, embeds, and the editor-specific defects | D1 |
| 4 | **D5 · Life** | AI light and streaming, the dot field, Bridge and Lens states, shared-element transitions, prism integration, and the reduced-motion variants | D2, prism assets |
| 5 | **L1 · Later** | Planner task simplification, and the testing and training bench for user-built agents | — |
| 5 | **V · Live verification** | The verifier and fixer pair, with updated prompts, against everything above | All |

The user's own agents run alongside: the 3D prism now. Later, if wanted:

- artifact-type objects in the same glass, for empty states;
- a Bridge object;
- the landing page, which is the user's own.

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
| A1 | `lane/ai-harness` · `<local-workspace>` | Running |
| R1 | `main` · primary checkout | Done: 13 issues fixed, build green ([report](reports/R-R1-RELIABILITY.md)). Left for a paired Bridge: LV-046 native check, LV-061 first open. For D3: Calendar block notes show raw `<p>` HTML. |
| Visual spec | — | Awaiting approval: https://claude.ai/artifact/56MkPBViV6HKgCz9CM8uvV |
| A2a · Semantic layer | `lane/semantic` · `<local-workspace>` | Running (backend only; UI surfaces go to D2–D4, the AI's `search` tool to A2) |
| Prism (user's agent) | `lane/prism` · `<local-workspace>` | Ready to run with `docs/brand/PRISM-RUNTIME-PROMPT.md` |

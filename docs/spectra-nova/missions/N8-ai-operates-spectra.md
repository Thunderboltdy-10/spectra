# N8 — AI OPERATES SPECTRA

**Charters:** AI Systems Engineer (primary) + Product Engineer (surfaces and choreography hosts)
**Prerequisites:** N7 accepted in `STATE.md`
**Architecture:** ARCHITECTURE-AI (all); ARCHITECTURE-COMMANDS §2, §7; ARCHITECTURE-STORAGE §5, §9 (policy and status as authority inputs); ARCHITECTURE-FIDELITY §2 (valid operation sets)
**Evidence:** `.shots/missions/N8/` plus concurrency and authority test runs · Tier P for choreography, **Tier R for the authority engine**

## Objective

Extend AI from "collaborator inside artifacts" to "colleague operating the whole product": one audited capability layer covering Library, sync, settings, calendar, ManageBac, memory, sharing, navigation and toolbar configuration; an authority policy that asks exactly when it should; cursor choreography on every surface; Follow AI across routes; and several AI actors coexisting without fighting over the viewport. Everything through the same commands humans use (C1), nothing through browser automation.

## Why now

The command registry exists (N2), the organizational tree exists (N1), file effects and their confirmation classes exist (N3–N6), and editors are deep enough to be worth operating (N7). Building the AI plane before those would have produced exactly the hidden AI-only mutation paths CANON forbids.

## Workstreams (ordered)

### W1 — The capability audit and unification (Tier R)

1. Enumerate every user-facing action in the product, domain by domain, per ARCHITECTURE-AI §2: artifacts, Library/tree, sync/policy/mounts, settings/preferences (including toolbar layout), calendar, ManageBac, memory, sharing/permissions, navigation/viewport, embeds, and the future-provider placeholder. The enumeration itself lives in the registry, not a document.
2. Each action becomes a registered command or typed tool whose `execute` is the same code humans use. `spectraBus` product commands (`work.open`, `work.revealAnchor`, `settings.*`, `context.beginPicking`, `reference.insert`) migrate into the registry; the bus survives as transport only.
3. Anything intentionally forbidden to AI is registered as `prohibited` with a reason — account deletion, credential changes, Bridge pairing/revocation, granting permissions to other people, changing the AI authority mode itself, hard deletion of work with no recoverable replica. **Absence is never the mechanism** (A1).
4. Coverage report in the mission log: actions found / registered / prohibited / deliberately deferred with reasons. A reviewer must be able to check the claim "if a user can do it, AI can too" against a list.
5. Tool-surface hygiene: the model receives a bounded, well-described capability set, not 300 raw commands — group by domain with parameterized commands, and keep the descriptions honest about risk and effect.

### W2 — The authority engine (Tier R)

1. Implement the policy engine of ARCHITECTURE-AI §4 as one server-side function: (risk × target × effective sync policy × authority mode) → `proceed | notify | confirm | always-confirm | prohibited`. Enforced in the tool/command executor (A2), never in prompts.
2. Defaults exactly as CANON D37 states: reversible content work proceeds; navigation and reads proceed silently; **settings changes always confirm**; tree deletes confirm; sharing changes confirm; **real local-filesystem effects confirm, stating the concrete consequence** ("This will move 3 files on this PC"); ManageBac sync proceeds with visibility, mapping changes confirm; memory writes proceed with visibility.
3. Confirmations ride the existing Live Dock required-input machinery — no new modal stack, no bespoke dialogs.
4. Permissive mode: a settings option behind an explicit warning that enumerates precisely what stops asking. Non-bypassable items stay non-bypassable there. Switching mode is itself always-confirm and never AI-performable.
5. Tests: a table-driven suite asserting the decision for every (command, target class, policy, mode) combination that matters, plus negative tests proving a prohibited action fails server-side even when the model insists.

### W3 — Choreography everywhere (Tier P)

1. One cursor/performer implementation extended to non-artifact surfaces — Library rows and tree, workspace List/Board, settings controls, calendar, the workbar itself. **No page-local cursor implementations** (CANON forbids; grep gate).
2. Commands carry `choreography` hints; the performer resolves the *current* visual position of a control through the registry plus the user's layout preferences (never hardcoded coordinates, per ARCHITECTURE-COMMANDS §7).
3. Library choreography vocabulary: move to a control, open a menu, type a name, drag a row into a folder, select multiple, scroll a list — expressed with the existing frame model (`planChoreography`, `cursor-motion`) rather than new animation code.
4. The visual layer never performs the mutation (A1): the semantic operation commits through the command; the choreography is its projection and may lag or be skipped without affecting correctness. Prove it with a test that runs an operation with choreography disabled.
5. Live Dock narration is human ("Moving Pendulum paper to Research"), derived from the command, not a tool log.

### W4 — Arbitration (Tier P + R)

1. Implement the resolver of ARCHITECTURE-AI §5 exactly: visible primary object wins; else nearest recent interaction; else navigate only if followed; else execute silently and report; never duplicate animations, never steal focus or route for a non-followed actor.
2. Deterministic and testable: given a viewport/visibility/focus snapshot, the chosen surface is a pure function. Unit-test the table of cases, including "same rename available from four surfaces → exactly one performance".
3. A visible-surface change caused by an off-screen operation still updates live (D40) — arbitration decides *animation*, never *effect*.

### W5 — Follow AI, app-wide (Tier P)

1. Generalize the artifact-scoped follow store into an app-wide controller: scroll within work, switch artifact views, navigate Library folders, cross routes, open settings, act, return.
2. Continuity, not teleports: navigate → settle → act, with the cursor persisting across route boundaries. Functional smoothness lands here; N11 polishes the motion grammar.
3. One followed actor per user (D38); switching is one click in the Live Dock; any user input disengages (existing rule preserved).
4. Non-followed actors never move the viewport; verify with a deliberate test: run an actor on a different route and prove the user's scroll/route/focus never changed while the dock narrated correctly.

### W6 — Multi-actor (Tier R)

1. Two or more concurrent AI actors with stable identity, distinct cursor colour/name, independent claims, and independent performer queues (one body per actor).
2. Collisions pause or rebase through the existing claims model — never overwrite. Test with two actors deliberately targeting the same region and the same tree node.
3. Composition with humans and with a collaborator's AI: claims are actor-agnostic; attribution stays correct (ARCHITECTURE-AI §6).
4. Stopping a run stops its performers and releases its claims; a paused actor reports honestly in the dock.

### W7 — AI configures Spectra (Tier P)

1. Toolbar customization by AI: "make my Document toolbar more like Word but keep it compact; put font, size, equation and comments in General" → a settings mutation, always-confirm, applied through the N2 preference path, propagated live into every open editor (D40), synced across devices.
2. Other settings actions follow the same route with the same confirm rule.
3. Sync policy and storage-strategy actions by AI use the N6 semantics and the file-effect confirmation class, with the concrete consequence stated.

### W8 — Organizational intelligence (Tier P)

1. Classification on creation: use the existing run context (workspace titles, summaries, recent context) to place new work and threads in an appropriate existing workspace when confident, General when not (D31). Placement is an ordinary typed operation — visible, attributed, reversible, arbitrated.
2. Reorganization on request (F4): create folders, move batches, rename, with a preview for large batches and one confirmation covering the batch rather than a prompt per item.
3. First-run placement for new conversations: the first AI run establishes the thread's placement rather than leaving a root-level orphan.

## Invariants to uphold

A1 (no AI-only paths, no automation-as-correctness), A2 (server-side authority ≤ user authority ∩ grants ∩ scopes ∩ policy), C1, C2, D37, D38, D40. Live Dock truthfulness (ARCHITECTURE-AI §10): invisible is never unreported.

## Out of scope

Embeds and proactive artifact creation (N9) · provider adapters · motion polish (N11) · multiplayer stress (N12) · new capabilities that do not already exist for humans.

## Acceptance gates

1. Coverage report committed: every enumerated user action is registered, prohibited-with-reason, or deferred-with-reason. Spot-check ten actions live, including three that must ask.
2. Authority suite green, including negative tests: a prohibited action refused server-side; a settings change asking even in a session where the model was told not to; a file-effect confirmation naming the real file count.
3. **F4 passes:** "create a Sources folder in Physics IA and move my pendulum paper there" performed with visible Library choreography, correct semantics, correct confirmation class, and Follow AI carrying the viewport. Mid-action frames captured.
4. Choreography-disabled correctness test passes (operations commit identically with no visual layer).
5. Arbitration: the four-surface rename case produces exactly one performance (evidence); a non-followed actor causes zero viewport change (evidence: scroll position and route identical before/after, dock narrating).
6. Follow AI across at least three routes plus a settings change, in one continuous run, with intermediate frames.
7. Two concurrent actors: unrelated targets proceed in parallel; same-target collision pauses and resolves; both narrated correctly; only one is followed.
8. AI toolbar customization demonstrated end-to-end: request → confirm → layout changes live in an open split editor → persists across reload → visible on a second profile.
9. Placement: a chat-created artifact with no workspace context lands in General; one with clear context lands in the right workspace; both attributed and reversible.
10. P4, P5, P11 pass; STATE gains an AI-plane section listing capability coverage and prohibitions; mission log ≤40 lines; close-out checks green.

## Mission log (close-out, 2026-08-22)

- Authority policy is now one pure D37 decision table in `ai/authority-policy.ts`: reads/navigation/content proceed, settings always-confirm, local-file effects confirm with concrete file count, sharing/mapping confirm, sync/memory notify, and security/Bridge/credential/account actions are prohibited.
- `SpectraToolExecutor` accepts the authority decision before tool execution and returns a durable `authority_prohibited` result; prohibited actions cannot be bypassed by model instructions. Focused authority/executor tests: 35/35.
- Added explicit app-command records for navigation, Library organization, settings, Calendar, Bridge pairing and credentials, including choreography targets and prohibition reasons. Existing `spectraBus` remains transport; semantic handler migration is next.
- Added pure app-surface arbitration, a choreography-disabled correctness test, app-wide Follow AI state, actor-specific locations, and collision-aware performer queues. Focused N8 tests are 82/82.
- AI operations now share application dispatch with human surfaces; toolbar/settings changes route through account preferences and retain authority confirmation semantics.
- DOCX AI edits use the verified native materialization path; production Bridge startup now shares the per-user journal by default and accepts isolation only through an explicit absolute `SPECTRA_BRIDGE_DATA_DIR`.
- Provider-backed watcher stability now fingerprints content, preventing same-size/coarse-timestamp intermediate revisions; the regression and full Rust chaos suite pass.
- Full application suite: 864/864. TypeScript, ESLint, secret scan, Bridge core/app tests, chaos, granted-tree, and build checks passed (build was validated before the production process lock).
- Existing N8 screenshots cover workbar/resource boundary, Library choreography, completed AI run, and AI/DOCX surface. Final fresh Chrome capture timed out twice; this is recorded in STATE as a tooling limitation, not hidden.
- N8 deliberately hands off full editor capability depth to the next implementation pass; no ghost controls are accepted. Durable instructions and the capability contract are in `docs/spectra-nova/WORKBAR-ARTIFACT-*.md`.

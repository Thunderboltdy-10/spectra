# ARCHITECTURE — THE AI OPERATING PLANE

Durable reasoning for N8, N9, N12; consulted by every mission that adds a user-facing action. Realizes CANON D23/D33/D37/D38: if a signed-in user can legitimately do it, Spectra AI should eventually be able to do it too — through the same audited, typed operations, under the same authority, with visible human-like choreography.

---

## 1. What exists (build on, don't fork)

`spectraToolRegistry` (typed tools, risk/approval/retry, executor with approval gate) · `operations/schema.ts` (typed plan ops incl. `workspace.*`, `artifact.*`) · `propose_operation → applyAiArtifactMutation` (claims-checked Yjs writes) · region claims (AI lease-bound 45s, queue/pause) · `ai-performer` ("one actor has one body") + `planChoreography` (primitive-driven frames) + `cursor-motion` · Follow AI store (artifact-scoped) · Live Dock (needs_input, confirmations) · `spectraBus` product commands (navigation/settings — currently outside the registry).

## 2. The capability audit and unification (N8 W1)

One pass over every user-facing action domain: artifacts (already typed) · Library/tree (create folder, move, rename, delete, link) · sync/policy (change storage, change policy, mount ops) · settings/preferences (incl. toolbar customization) · calendar · ManageBac (trigger sync, mapping actions) · memory (deliberate read/write/revise) · sharing/permissions · navigation/viewport · embeds · future provider actions. Each becomes a **registered command or typed tool** (ARCHITECTURE-COMMANDS C1 makes these the same executes humans use). `spectraBus` product commands migrate into the registry; the bus remains as transport, not as a second semantic layer. Anything intentionally prohibited to AI (account deletion, credential changes, Bridge pairing, permissive-mode toggling itself) is listed explicitly in the registry as `prohibited` — absence is never the mechanism.

**Invariant A1:** no AI-only mutation paths, no page-local AI shortcuts, no browser-automation-as-correctness. The visual layer *projects* semantic operations; it never *is* the operation.

## 3. Actors and concurrency

- Every AI run is an **actor** with stable identity (existing `ai:${runId}:…` client ids), its own cursor color/name, its own claims. Multiple actors operate concurrently on unrelated targets; collisions pause/rebase via the existing claims model (never overwrite).
- Composes with humans and with collaborators' AIs: claims are actor-agnostic; attribution (§6) keeps stories straight.
- **One body per actor** stays law: an actor's operations serialize through its performer queue however fast the model plans.

## 4. The authority policy (D37, concretely)

Every command/tool carries `risk`; the policy engine maps (risk × target × effective sync policy × user's AI-authority setting) → `proceed | notify | confirm | always-confirm | prohibited`.

Default (Standard) mode:

- Reversible content edits in work the run may touch → proceed (today's model, attributed + reversible).
- Navigation, reads, opening surfaces → proceed silently.
- **Settings/preference changes → always confirm** (explicit user requirement; includes toolbar customization).
- Organizational tree changes (create folder, move, rename within Spectra-logical placement) → proceed with Live Dock visibility; **delete → confirm**.
- Sharing/permission changes → confirm; destructive ones → always-confirm.
- **Real local-filesystem effects** (policy-mirrored move/rename, local delete, overwrite-original, mount changes, sync-direction changes) → confirm, with the concrete file consequence stated ("This will move 3 files on this PC").
- ManageBac sync trigger → proceed with visibility; mapping changes → confirm.
- Memory deliberate writes → proceed with visibility and revisibility (existing model).

**Permissive ("Full access") mode:** user-selectable in settings behind an explicit warning that enumerates exactly what stops asking (settings, tree deletes, mirrored file operations). Non-bypassable even there: account/security operations, Bridge pairing/revocation, permission grants to *other* people, hard deletes of work with no recoverable replica, and switching authority mode itself. Confirmations flow through the existing Live Dock required-input machinery — one system, no new modal stack.

**Invariant A2:** AI authority ≤ user authority ∩ Bridge grants ∩ provider scopes ∩ policy. Enforced server-side in the executor, not in prompts.

## 5. Where an action visually happens (arbitration)

One resolver decides the choreography surface for each semantic operation:

1. If the operation's primary object is visible in the acting user's viewport (open artifact, visible Library node), choreograph there.
2. Else if multiple candidate surfaces are visible, prefer the one nearest the user's recent interaction (focus/selection recency).
3. Else if the user follows this actor, the actor may navigate (smoothly — §7) and then choreograph.
4. Else: **no visual performance** — execute semantically, report in Live Dock, and let live-updating surfaces (D40) reflect results wherever they happen to be visible.
5. Never: duplicate animations for one mutation, route changes for a non-followed actor, focus/scroll theft (D38). The semantic operation is singular regardless of how many UI representations exist.

## 6. Attribution and history

History distinguishes: each human · each human's AI (actor-labeled) · external edit (Word/local file) · import/materialization · sync reconciliation · restore · migration. Low-level ops group into meaningful change groups (existing `changeGroups`); rollback respects replica semantics — restoring a version schedules the corresponding native materialization too, never restores Convex while a DOCX stays stale (ties to ARCHITECTURE-STORAGE §8).

## 7. Follow AI, app-wide

- Follow state: `following(actorId)` — at most one followed actor per user (D38). The follow controller owns the viewport while engaged: scroll-within-artifact (exists), switch artifact views, navigate Library folders, move between routes, open settings, return — continuous and deliberate (motion grammar in N11 polishes; N8 lands functional smoothness, no teleports: navigate → settle → act).
- Any user input disengages (existing rule). Switching which actor you follow is one click in the Live Dock.
- Non-followed actors: Live Dock truthfully narrates; visible-surface choreography still plays if the action happens to be on-screen (§5.1).

## 8. Organizational intelligence (N8, with roots in N1)

- N1 lands the deterministic rule: created-in-workspace → that workspace; else General. Threads get placement on first run (D31).
- N8 adds classification: AI placement of new work/threads into an existing appropriate workspace when confident (workspace titles/summaries/recent context are already in the run context packet), General when not. Placement is an ordinary typed operation — visible, attributed, reversible, arbitrated like everything else. AI may also *reorganize* on request (F4 flow). No invisible debris, ever.

## 9. Embedding + proactive artifacts (N9's contract)

- An embed is a **projection of a real source** (existing embeds/references registries) — permission-checked, live or pinned, edits mutate the source (D36 CANON: never invisible divergence).
- Chat gains first-class live embeds (thread container already exists in the embeds panel — wire it into the conversation surface properly).
- **Proactive creation:** when an explanation genuinely benefits, the AI may create a Code/visualization artifact (typed create, placed per §8), embed it live in the conversation, and continue around it — without the user asking for "an artifact." Judgment, not confetti: plain answers stay plain. The artifact is real, permanent, openable later (F5 flow).
- Export fallbacks: embeds inside native-format work follow ARCHITECTURE-FIDELITY §2 EXTENSION semantics (rendered fallback + reference part).

## 10. Truthfulness requirements

The Live Dock never claims an action succeeded before its semantic operation committed; sync-affecting actions report against journal states (I8). A stopped run stops its actors' performers and releases claims (existing machinery). If arbitration chose "no visual performance," the dock says what happened anyway — invisible ≠ unreported.

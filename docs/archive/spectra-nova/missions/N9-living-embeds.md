# N9 — LIVING EMBEDS

**Charters:** AI Systems Engineer + Product Engineer
**Prerequisites:** N8 accepted in `STATE.md`
**Architecture:** ARCHITECTURE-AI §9 (primary), §5, §8; ARCHITECTURE-FIDELITY §2 (EXTENSION semantics and native fallbacks); ARCHITECTURE-COMMANDS §2 (embed commands)
**Evidence:** `.shots/missions/N9/` · Tier P throughout, Tier R for fallback round-tripping and sandbox isolation

## Objective

Make embedding a central Spectra capability rather than a panel: real artifacts projected live into conversations, documents, whiteboards, presentations and each other; Code as a general interactive-visualization engine; and AI that creates a real, placed, permanent artifact when a live visualization genuinely explains something better than prose. Nothing ephemeral, nothing forked, nothing that leaks permissions, and nothing that breaks a native file on export.

## Why now

The AI plane can now create and place work properly (N8), the tree gives every embed a real home (N1), and lenses define how an interactive thing degrades into a native file (N4/N5). Embeds built earlier would have produced orphan artifacts and unsafe exports.

## Workstreams (ordered)

### W1 — Embed core convergence (Tier P)

1. Inspect and converge the existing stack — `components/artifact-embed.tsx`, `artifact-embeds-panel.tsx`, `references/registry.ts`, `references/insertion/*`, `embed/sandbox-protocol.ts`, `sandboxed-artifact-runtime.tsx`, `composer-artifact-dock.tsx`. One embed model, one insertion path, one runtime host. Delete whatever loses; **do not fork embedding again** (CANON forbids).
2. Formalize the embed record: source work id, view/region target, mode (compact/expanded), interaction level (read/interact/edit), version policy (live/pinned), and the container (artifact type or thread). Permission is always resolved against the source at render time, never captured at insert time.
3. Embed operations become registered commands (insert, change mode, change interaction, pin to version, unpin, open source, remove) so N8's AI plane and context menus and shortcuts all reach them identically.
4. Live versus pinned is explicit and visible: a pinned embed states its version; a live embed updates in place as the source changes (D40).
5. Edits through an embed mutate the **source** when permission allows, with normal attribution; there is never invisible divergence. Read-only sources render read-only embeds with an honest reason.

### W2 — Chat as a first-class embed destination (Tier P)

1. Wire the thread container properly into `conversation-surface.tsx`: an embed inside a conversation is a real live projection, sized sensibly in the message flow, expandable, openable as its source.
2. Embeds survive thread reload, thread switching and session continuity (P10) without remount jank; they never block streaming (P4) and never enter the keystroke path.
3. Composer flow: a user can embed existing work into a message from the composer dock; AI can embed work it just created (W4).
4. Deep context contribution stays permissioned and controlled: an embed in a thread contributes context only under the existing explicit/visible context rules — embedding is not a permission bypass.

### W3 — Code as the visualization engine (Tier P + R)

1. Make Code artifacts the standard vehicle for SVG diagrams, interactive visualizations, simulations, small explanatory apps, charts and mathematical demonstrations, using the existing runtime (`code/browser-build-server.ts`, `react-build-server.ts`, `python-runtime.ts`, `network-policy.ts`, `published-build.ts`) — no new runtime.
2. Sandbox isolation is Tier R: assert the sandbox protocol boundaries, the network policy (no unauthorized egress), CPU/time bounds, and that a runaway visualization cannot wedge the host surface. Tests, not hope.
3. Visualization ergonomics: a stable render target, deterministic output where possible, a lightweight "regenerate/re-run" affordance, honest error surfaces when code fails, and a visual-only view for embedding (no editor chrome inside an embed).
4. Templates/starters for the common shapes (SVG diagram, animated simulation, chart from a Sheets range, interactive parameter demo) so AI generation is reliable rather than improvised each time.
5. Performance: an embedded visualization must not degrade a scrolling conversation — lazy mount, pause off-screen, respect reduced-motion.

### W4 — Proactive creation with real placement (Tier P)

1. When a live visualization genuinely improves an explanation, the AI creates a Code artifact through the normal typed create, places it per N8's rules (context workspace → classified workspace → General), embeds it live in the conversation, and continues the explanation around it (F5).
2. Judgment, not confetti: define the heuristic in the run prompt/tooling and verify it — plain questions get plain answers; visualization appears where a diagram or simulation is the honest best answer. Log the heuristic in the mission log.
3. The artifact is permanent, findable in the Library, openable and editable later, attributed to the run that made it.
4. If creation or the runtime fails, the AI degrades to a clear textual answer and says nothing false about an artifact that does not exist.

### W5 — Cross-artifact embedding (Tier P)

1. Land the destinations that matter, each using the existing per-type insertion primitives from `references/registry.ts`: Document embeds a live Sheets range or chart; Whiteboard embeds Flashcards or a Quiz; Presentation embeds a visualization or Sheets chart; Planner embeds related work; Document embeds code output; any artifact embeds a thread reference where it already makes sense.
2. Source identity, permissions, history and context remain visible at every destination: an embed always says what it is a view of, and one gesture opens the source.
3. Sheets-linked charts in Presentation and Document reuse one binding mechanism (the existing `sourceBinding` concept), not three.

### W6 — Native fallbacks on export (Tier R)

1. EXTENSION semantics per ARCHITECTURE-FIDELITY §2: an embed inside native-format work writes a defined fallback into the file — a rendered SVG/PNG for a visualization, a static table for a Sheets range, a rendered image for a Quiz/Flashcard block — plus, where safe, a custom XML part carrying the Spectra reference.
2. Round-trip: exporting/materializing a Document with a live visualization produces a DOCX that opens in Word showing the fallback; reopening that file in Spectra re-associates the embed via the reference part; if the reference is gone, the fallback stays as an ordinary image and Spectra says so honestly.
3. In `strict-native` profile, inserting an EXTENSION embed is blocked with an honest reason and an offer to switch profile (explicit, explained) — never a silent enhancement of someone's file (D36).
4. Harness assertions for the fallback path per format; no fallback path ships without one.

## Invariants to uphold

Embeds are projections, never copies. Permission is resolved at render time against the source. C1 for every embed operation. D36/D25 for anything written into native files. D40 for live updates. No ephemeral AI artifacts, ever.

## Out of scope

New artifact types · a visualization gallery/marketplace · semantic search over embeds · motion polish (N11) · multiplayer contention on embeds (N12 covers it under collaboration).

## Acceptance gates

1. One embed stack (grep evidence of deleted duplicates); embed operations all registered commands.
2. **F5 passes:** a chat question yields a live Code visualization embedded in the conversation, placed as a real artifact in the correct workspace, openable later. Evidence: chat shots, Library placement shot, source-artifact shot.
3. Each destination in W5 demonstrated with screenshots, including one edit-through-embed that provably mutates the source (before/after on the source itself).
4. Permission test: a collaborator without source access sees an honest unavailable embed, never source content.
5. Sandbox tests green: network policy, time/CPU bounds, no host wedge; a deliberately hostile visualization contained.
6. Live versus pinned demonstrated: source change updates the live embed in place and leaves the pinned one at its version.
7. Native fallback round-trip: Document with a visualization → DOCX opened in Word (fallback visible, screenshot) → reopened in Spectra with the embed re-associated; harness assertion committed. Strict-native block demonstrated.
8. Performance: a conversation with three embedded visualizations scrolls smoothly; off-screen ones pause (trace or profile note).
9. P3, P4, P8, P11 pass; STATE gains an embeds section; mission log ≤40 lines; close-out checks green.

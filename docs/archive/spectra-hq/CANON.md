# SPECTRA CANON

> **STILL BINDING, VIA NOVA.** Decisions D1-D23 below remain in force and are incorporated by reference (with amendments) into `docs/spectra-nova/CANON.md` §0, which adds D24-D40 and wins on any conflict. Read the Nova canon first.

**Binding. Short on purpose. If an instruction anywhere conflicts with this document, this document wins — except `docs/spectra-nova/CANON.md`, which supersedes it where the two differ (see the banner above). If you believe the canon itself is wrong, stop and ask Pablo — do not silently deviate.**

---

## 1. What Spectra is

Spectra is **one live surface where people and AI do real work together** — documents, quizzes, sheets, presentations, boards, plans, code, flashcards, agents — with conversations, sources, deadlines and school context attached to the work instead of scattered around it.

First audience: schools (students and teachers, starting with Pablo's school, ManageBac-connected). The product must be releasable there. That means: a teenager can use it without a manual, a teacher can trust what it displays, and nothing on screen looks like a developer build.

Spectra's defining experiences, in order of importance:

1. **You can always work.** Typing, dragging, editing — instant, never interrupted by sync, saves, AI, or collaborators.
2. **AI is a colleague in the work, not a chatbot beside it.** It edits your document with a visible cursor, waits when you're using something, explains what it's doing in Live Dock, and its work is attributed and reversible.
3. **Everything is connected.** References, sources, citations, deadlines, plans and calendar all point at each other and stay true.
4. **The workspace feels alive.** Presence, the ambient field, motion that communicates state — quiet by default, responsive when things happen.

## 2. How Spectra must feel

- **Immediate.** Local actions echo in the same frame. No interaction waits on a network round-trip.
- **Calm.** One thing asks for attention at a time. Errors are rare, specific, and offer a next step.
- **Honest.** Numbers are real. States are true. "Synced" means synced. An unavailable capability says so; it never fakes emptiness or success.
- **Alive, not busy.** The field and motion respond to actual activity. If you notice the decoration before the content, the decoration is too strong.
- **One product.** The same control looks and behaves the same everywhere. A user should never sense that different surfaces were built by different hands.

## 3. Binding product decisions

These are settled. Do not re-litigate them; do not "improve" them away.

### Ownership and modes
- **D1. Owners and editors always have full edit access to their work. Immediately, by default, everywhere.** No mode toggle may ever put an owner into a state where they cannot type or edit without one obvious action to return.
- **D2. Read / Review / Focus are not peer modes.** They may exist as *optional viewing actions* (e.g. a "Preview as reader" command in an overflow menu), never as a persistent tab row that competes with editing.
- **D3. Genuinely dual-experience types keep their real second view** — Quiz **Attempt**, Presentation **Present**, Flashcards **Study**, Code **Preview/Split**. These are *activities*, presented as clear actions, and an owner entering them can always exit with one click. Owner default is always the authoring view.
- **D4. Side panels and split views never open read-only for someone with edit access.** Compact ≠ restricted.
- **D5. Sharing language stays simple: Read-only and Edit.** Internal permission machinery never surfaces as UI complexity.

### Layout and shell
- **D6. A thread beside an artifact is a side-by-side layout, always.** Opening, closing, or switching a thread never changes the artifact's presentation (split stays split; nothing is promoted to fullscreen as a side effect).
- **D7. Library and Workspace are one navigation system with two purposes** (all your work vs. this context's work) — one shell implementation, one tab rail, one session that survives switching.
- **D8. The bottom of the screen belongs to the user's content.** Quick Chat composer and Live Dock are compact, never stack into towers, and never permanently cover list rows or cards.

### Runs and conversations
- **D9. One run = one Live Dock tab.** Never duplicates, never an optimistic tab beside its durable twin. Compact tab = title + status + semantic step. Hover = a few useful details, not a panel. Click = the full conversation, immediately.
- **D10. AI text visibly streams.** If a model streams, the user sees it stream. Thought/progress traces are *summarized, human-readable steps* — never raw incremental debug logs.
- **D11. Stop always works and tells the truth.** Stopping a run halts server work, and the UI reflects the stopped state everywhere within seconds. No stale "running" states, no dead stop buttons.
- **D12. Sending from Quick Chat continues the current thread by default and does not fling open the right panel.** `/chat` and the right panel are one conversation implementation at different widths — including Live Dock behavior.

### AI operating plane
- **D23. Spectra's AI is a permissioned operator across the whole product, not an artifact-only assistant.** The same typed capability system must let it navigate product surfaces, change user-approved settings, read and deliberately write or revise its memory, trigger operations such as ManageBac synchronization, and act on non-work pages. It may customize how it helps, but every capability remains scoped to the signed-in user's authority, visibly attributable, reversible where possible, and governed by explicit confirmation boundaries for sensitive or destructive actions. Add capabilities to one audited tool/action registry; never create page-local AI shortcuts or invisible ambient authority.

### Product hygiene
- **D13. No developer chrome in the product.** No floating issue badges, no leaked schema keys (`spectraArtifacts.by__account_created`), no test IDs in content, no raw HTML in previews, no "Compiling…" pills. Dev diagnostics live behind a dev-only flag.
- **D14. Truthful data or no data.** A count never contradicts its own copy. Capability states (not connected / stale / unsupported / failed) are explicit.
- **D15. "Artifact" is not a user-facing word.** Use the type name or "work".
- **D16. One visual grammar:** one primary-action treatment, one active-state treatment, one empty-state component, one truncation policy (tooltips for full text; layouts sized so common names don't truncate). Same control, same style, everywhere.

### Identity layer
- **D17. The dot field is Spectra's signature ambient layer — one implementation, product-wide.** Fine, grain-like dots (finer than the imported reference project), nearly invisible at rest (2–5%), waking *locally* where real activity happens (AI edits, collaborators, selection, drag, success/failure). It must never cost meaningful performance at rest and never compete with content.
- **D18. The prism is Spectra's mark — one family.** One true 3D prism (landing hero/story only) plus a lightweight product family: static mark, tiny icon, spinning loader, Live Dock slot. Never render the full R3F prism for a 24px icon.
- **D19. The landing page is the product proving itself.** Real shared components driven by story state — never forked replicas. The final reveal must be the actual Spectra shell.

### Engineering rules that protect the product
- **D20. Typing never waits.** No synchronous projection, persistence, or network hop between keystroke and pixel — and between keystroke and peer broadcast, only the realtime transport.
- **D21. No parallel implementations.** One field system, one shell, one registry, one conversation surface. Building "v2 alongside" requires deleting v1 in the same mission.
- **D22. Verification is browser-first.** Code-only verification is never sufficient to claim user-facing behavior works.

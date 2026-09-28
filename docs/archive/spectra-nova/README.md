# Spectra Nova — the operating system for the local-files / Bridge / AI-plane transformation

**This directory supersedes `docs/spectra-hq/` as the operational source of truth for all Spectra work.**

Spectra-HQ ran M1–M4 extremely well and its laws survive here. But the product direction has expanded far beyond the M5–M9 tail it planned: Spectra now becomes the live workspace for work the user *already owns* — real local files, real Office documents, a local Bridge, one logical work identity with multiple replicas, a product-wide AI operating plane, and a Library that behaves like an excellent filesystem. The old tail missions were written for a smaller product. Nova replaces them with a mission program built for the real one, while carrying forward everything HQ got right.

## Trust hierarchy (absolute)

1. `docs/spectra-nova/**` — **operational truth.** Missions take orders from here only.
2. `docs/spectra-hq/CANON.md` — still binding (incorporated by reference into Nova's CANON, with explicit amendments).
3. `docs/spectra-hq/**` (everything else) — **reference/history.** STATE entries there describe the pre-Nova world; mission briefs M5–M9 are superseded by N10–N12; their *intent* is absorbed into Nova briefs.
4. `docs/spectra-definitive/**`, `docs/spectra-rebuild/**`, `docs/spectra-landing/**` — historical requirements archaeology only. Completion claims void. `SPECTRA_LANDING_ULTIMATE_IMPLEMENTATION_PROMPT.md` remains design-intent input for N11.

If two documents disagree, the higher one wins. If a Nova document seems wrong in the field, stop and ask Pablo — do not silently deviate (same rule as HQ).

## What changed since HQ, in one paragraph

M1–M3 closed with evidence. M4 was expanded mid-flight into the artifact/product convergence program and three large commits (`M4`, `M4+`, `M4++`, 2026-08-14→18) delivered most of it — but M4 was never *formally* closed: no mission log, no `VERIFIED` row, the shell merge (C8) unfinished, rebuild-brief rounds 2–3 marked pending. Nova does not re-run M4. Mission **N1** opens by reconciling M4's real state into `STATE.md` honestly (verify what works, log what doesn't) and then builds forward. The E13 secret-rotation item remains **user action**.

## The five laws (inherited from HQ, still absolute)

1. **Evidence or it didn't happen.** `VERIFIED` requires dated proof appropriate to the work's tier (see PLAYBOOK §3). Code existing is not evidence.
2. **One page of truth beats five thousand lines of plan.** CANON is short and binding; ARCHITECTURE docs centralize the durable reasoning so missions implement instead of re-deriving; briefs are self-contained.
3. **Golden Flows are the constitution.** The flow set now includes the file/Bridge/AI-plane flows (PLAYBOOK §4). A mission that breaks a Golden Flow is not done.
4. **Nothing wrong is ever ignored.** Fix it if small and in scope, or log one line to the Field Notes queue in STATE.
5. **Subtraction is progress.** No parallel implementations. Replace-and-delete in the same mission. Migrate, never fork.

## New laws Nova adds

6. **Reliability outranks capability.** A capability that occasionally corrupts, silently loses data, or lies about sync state is worse than not shipping that capability. Preservation-critical code (Bridge, sync, Office lenses) is Tier R and gates on brutal automated evidence, not screenshots.
7. **Verification is calibrated, not ritualized.** Deep verification at meaningful gates; no whole-project typecheck/lint/build loops after tiny edits; no screenshot marathons per micro-change. **The mission is the unit of verification, not the workstream** — workstreams break a mission down for *building*, they are not small missions each owed its own acceptance pass. Build W1→Wn with light targeted checks, then verify the whole thing once, deeply, at the end. See PLAYBOOK §3.
8. **The durable reasoning lives here, not in mission output.** Mission agents write code, a concise mission log, and STATE updates. They do not produce new planning documents unless a Nova doc is factually wrong (then they fix that doc).
9. **Shared before special (CANON D41).** Before building a control, look for it. Two views of the same data get one search, one filter, one grouping control, one vocabulary — the same components, not siblings that resemble each other. Divergence between views is a defect to close, never a variant to justify. Subtraction (law 5) applies inside a screen, not only across files.
10. **Bounded by the viewport (CANON D42/D44).** No surface loads a collection to draw itself, and no surface pushes the page past the window. Both are correctness properties, checked in the Network panel and at the frame edge — not polish deferred to N10.

## The files

| File | What it is | Read when |
|---|---|---|
| `CANON.md` | Binding product decisions (HQ D1–D23 incorporated + Nova D24–D40) | Every session, first |
| `STATE.md` | The living truth ledger for the Nova era; §0 is the mission ledger that says which mission is current | Every session, second |
| `PLAYBOOK.md` | Mission protocol, verification tiers, Golden Flows v2, compaction/sub-agent rules | Every session, third |
| `ARCHITECTURE-STORAGE.md` | Logical work identity, replicas, organizational tree, sync journal, offline/multi-device, migration | N1, N3–N6 primarily; skim always |
| `ARCHITECTURE-BRIDGE.md` | The Spectra Bridge: protocol, pairing, security, watcher, journal, write pipeline, recovery | N3–N6, N12 |
| `ARCHITECTURE-FIDELITY.md` | Lens/fidelity system, compatibility profiles, Office part maps, corpus strategy, engine gates | N4, N5, N7, N12 |
| `ARCHITECTURE-COMMANDS.md` | One command registry: workbar, tabs, densities, customization, settings sync | N2, N7, N8 |
| `ARCHITECTURE-AI.md` | AI operating plane: capabilities, authority policy, arbitration, Follow AI, multi-actor | N8, N9, N12 |
| `CHARTERS.md` | Six specialist charters; each mission adopts the ones its brief names | Mission start |
| `missions/N1…N12.md` | Sequenced, self-contained mission briefs | The assigned mission |
| `LAUNCH_PROMPTS.md` | The full launch prompt for every mission — the file the Goal reads | Pablo / the Goal runner |
| `GOAL.md` | The single Claude Code Goal prompt that runs the whole program sequentially | The Goal runner |

## The sequence

Foundations before formats, formats before depth, depth before intelligence, intelligence before beauty. Every mission is run by **one specialized agent** (the same continuing session when driven by GOAL.md) that adopts the charters its brief names. Missions run strictly in order; a mission may begin only when the previous one is **ACCEPTED** in the `STATE.md` §0 mission ledger with evidence.

```
N1   The Organized World        Foundation + Product   org tree, Library-as-filesystem, List/Board,
                                                       General workspace, one shell, M4 reconciliation
N2   The Command Surface        Product (+AI Systems)  command registry, workbar tabs, densities,
                                                       customization, account-synced settings
N3   The Bridge                 Bridge & Sync + Fnd    Tauri tray app, pairing, mounts, watcher,
                                                       journal, generic resources in Library
N4   Document Fidelity          Fidelity (+Product)    lens architecture, DOCX end-to-end,
                                                       Word coexistence, round-trip corpus
N5   Sheets, Slides, Package    Fidelity (+Product)    XLSX + PPTX lenses, Spectra package format,
                                                       cloud native-payload retention
N6   Sync Policy & Many Devices Bridge&Sync+Fnd+Prod   policy presets/inheritance, mirroring semantics,
                                                       protected originals, offline/multi-device matrix
N7   Serious Editors            Product + Fidelity     Document/Sheets/Presentation depth,
                                                       contextual tabs, engine-backed capability
N8   AI Operates Spectra        AI Systems (+Product)  product-wide typed actions, authority policy,
                                                       cursor everywhere, Follow AI app-wide, multi-AI
N9   Living Embeds              AI Systems + Product   embeds as central capability, Code as
                                                       visualization engine, proactive creation
N10  Convergence                Product (+Des +Fid)    product-wide perfection sweep (adapted M5)
N11  Identity                   Designer               field, prism, motion, landing (adapted M6–M8)
N12  Finale                     Bridge & Sync + AI     multiplayer × replicas × external saves ×
                                                       conflicts × chaos; release verdict (adapted M9)
```

## Why this shape

- **Large missions, few of them.** Each is one coherent seam a specialist can hold in their head for a long uninterrupted run. The old M5–M9 intent survives: M5→N10, M6–M8→N11, M9→N12 — rebuilt around the new product.
- **Missions are the agents.** No mission depends on spawning sub-agents. A brief may permit rare implementation sub-agents (PLAYBOOK §6), but the mission agent owns integration, browser verification and acceptance.
- **Reliability first, polish last.** N3–N6 are the trust core. Heavy visual perfection (N10–N11) deliberately waits until sync semantics are trustworthy — but N1–N2 do the *structural* frontend early because the storage model needs its real UI.

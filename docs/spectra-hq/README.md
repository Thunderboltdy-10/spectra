# Spectra HQ — SUPERSEDED (historical record of the M1-M4 era)

> **SUPERSEDED 2026-08-19 by `docs/spectra-nova/`.**
>
> Spectra HQ ran M1-M4 and its operating model worked: evidence culture, one truth ledger, self-contained missions, Golden Flows, subtraction pressure. Those laws survive - they were carried forward into `docs/spectra-nova/README.md` and extended.
>
> **No agent takes orders from this directory any more.** The product direction expanded far beyond what M5-M9 were written for (local files, the Spectra Bridge, one work identity with several replicas, Office fidelity, a product-wide AI operating plane, Library as a real filesystem). The Nova program replaces the M5-M9 tail: **M5 -> N10**, **M6-M8 -> N11**, **M9 -> N12**, with the new foundations as N1-N9.
>
> What remains authoritative here: **`CANON.md` decisions D1-D23**, incorporated by reference (with amendments) into `docs/spectra-nova/CANON.md` §0. Everything else in this directory is history: `STATE.md` describes the pre-Nova world, mission briefs M1-M4 hold the closed record of that era, and M5-M9 are superseded by the Nova briefs.
>
> Start at **`docs/spectra-nova/README.md`**. If you are launching work, use `docs/spectra-nova/LAUNCH_PROMPTS.md` or `docs/spectra-nova/GOAL.md`.

---

## Original front matter (kept for the record)

**This directory supersedes all prior planning systems as the operational source of truth.**
The old documents remain valuable as *reference material* (see the doc trust table in `STATE.md`), but no agent takes marching orders from them anymore.

---

## Why this exists

The last transformation failed in a specific, diagnosable way — not because the plans were bad or the agents incapable, but because the **operating model** rewarded the wrong thing:

1. **Completion was self-certified.** Implementers verified with code-only checks, wrote "Complete" into ledgers they owned, and nobody ever compared the ledger to the running product. Result: eight documents claiming Phases 0–11 complete while owners could not type into their own documents.
2. **The plan was 5,000 lines of architecture, not observable outcomes.** Agents satisfied the *text* (build a kernel, add a registry) rather than the *behavior* (typing works, streaming is visible). The repo now contains beautifully tested kernels that nothing in production calls.
3. **Taste and product decisions lived nowhere compact.** Every agent re-derived "what Spectra is" from a giant plan and got it slightly wrong. That is how owners ended up with Read/Review/Focus permission-style toggles on their own work.
4. **There was no regression net.** Fixes overwrote fixes. Nothing guaranteed that what worked yesterday works today.
5. **There was no subtraction pressure.** Three work-type registries, two shells, three dot fields, two prism stacks, dead controllers — slop accumulated because deleting was never anyone's job.

This system inverts all five.

## The five laws

1. **Evidence or it didn't happen.** A feature has exactly one of four statuses — `VERIFIED`, `BROKEN`, `SUSPECT`, `UNKNOWN` — and `VERIFIED` requires dated browser evidence (screenshot path). Code existing is not evidence. Tests passing is not evidence of UX. See `STATE.md`.
2. **One page of truth beats five thousand lines of plan.** `CANON.md` is short, stable, and binding. Missions are self-contained briefs with root causes already located to file and line. Implementers execute; they do not rediscover.
3. **Golden Flows are the constitution.** Twelve user journeys defined in `PLAYBOOK.md`. Every mission ends by walking the affected flows in a real browser and capturing evidence, including *mid-action* states. A mission that breaks a Golden Flow is not done, whatever else it achieved.
4. **Nothing wrong is ever ignored.** Anything broken you encounter is fixed on the spot (if small and in your blast radius) or logged to the Field Notes queue in `STATE.md`. The Live Dock incident — an agent watching duplicate tabs, no streaming, and a dead cancel button and just moving on — must never happen again.
5. **Subtraction is progress.** No mission may add a parallel implementation of anything that already exists. Extend the existing one, or replace it and delete the old one in the same mission. Dead code you touch, you remove.

## The files

| File | What it is | Who reads it |
|---|---|---|
| `CANON.md` | What Spectra is, how it must feel, and the binding product decisions | Every agent, every session, first |
| `STATE.md` | The single living truth ledger: verified / broken / suspect / unknown, with root causes and evidence | Every agent, every session, second |
| `PLAYBOOK.md` | How work is done: mission protocol, definition of done, Golden Flows, screenshot discipline, cleanup rules | Every agent, every session, third |
| `AGENT_CHARTER_BUILDER.md` | Charter for the product-engineering agent ("the Builder") | The Builder |
| `AGENT_CHARTER_DESIGNER.md` | Charter for the design/motion/frontend agent ("the Designer") | The Designer |
| `missions/M1…M9` | Sequenced, self-contained mission briefs | The assigned agent |
| `LAUNCH_PROMPTS.md` | Copy-paste prompts to launch each mission | Pablo |

## The sequence

Foundation before beauty. Big uninterrupted chunks. The Designer's heavy work starts only when the product underneath is stable.

```
BUILDER   M1  Make it editable        (sync + ownership + modes)
BUILDER   M2  Conversation truth      (streaming, stop, dock, thread layout)
BUILDER   M3  Performance floor       (keystroke path, monolith, loops)
BUILDER   M4  One product             (hygiene, dead systems, dedup, doc reset)
BUILDER   M5  Perfection sweep        (the campaign, rebooted with evidence discipline)
DESIGNER  M6  The Field               (one fine-grain field system, product-wide)
DESIGNER  M7  Prism & landing         (prism family, landing sensory layer, real reveal)
DESIGNER  M8  Motion                  (product-wide motion grammar)
BUILDER   M9  Multiplayer finale      (P/C collaboration, AI x collab, field-reaction pass)
```

Missions run strictly in order. A mission may begin only when the previous one's acceptance criteria are marked in `STATE.md` with evidence.

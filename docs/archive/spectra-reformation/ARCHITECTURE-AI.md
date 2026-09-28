# ARCHITECTURE-AI — the agent loop, targeting, context, and quality

Owner phase: P4. Binding under CANON D37–D38 (as amended), R6, R12–R13. The durable run substrate (leases, heartbeats, NDJSON streaming, stop/retry/continuation, Live Dock, required-input rail) is verified good and is **kept unchanged**. What is replaced: the 14k-line monolith's shape, the targeting pipeline that guarantees wrong-target edits, the deliberately starved context, and the absence of any quality machinery.

## 1. The loop (replacing single-shot plan emission)

`run/route.ts` decomposes into modules orchestrated by the existing run engine:

```
intake → plan → resolve targets → gather context → act (tool loop) → verify → report
```

- **Plan**: the model states intent and the resources it believes are involved — before any mutation is possible.
- **Resolve targets** (the fix for the wrong-artifact family, AI-1..5): every mutation target is resolved to candidates with confidence *as a first-class step*. Rules: the repair pass that rewrites uncertain targets to the focused artifact is **deleted**; named references are resolved by workspace search (title/summary/recency), not by "whatever is open"; ambiguity above threshold raises a required-input question through the existing dock rail (`request_context_target`/`ask_user_choice` become registered agent tools — they exist today, unexposed); the focused artifact is a *prior*, never a fallback for a failed resolution. Narration always names the resolved artifact by title (never "the focused artifact"). The regex fast-paths either perform the same resolution step or are deleted.
- **Gather**: context is assembled per §2 — after resolution, so the right artifacts get hydrated.
- **Act**: the tool loop executes IR-derived operations (ARCHITECTURE-CAPABILITIES §2) through `gateOperation`; app-scope actions pass the authority policy where `notify` is actually consumed (it is dead code today — AI-7) and local-file effects confirm with counts (D27/D37).
- **Verify**: after acting, the agent re-reads what it changed (live Yjs read exists — extend `verifyCommittedOutcomes`) and checks against the plan and the per-type quality rubric (§3). Materialization failures are **failures**: the `.catch(console.warn)` swallow (AI-10) is removed in P0; by P4 the report phase can never claim success for unpersisted work.
- **Report**: honest terminal state; run-level revert exists (the change-group machinery already groups AI edits — expose it).

## 2. Context (replacing starvation-by-design)

- A bounded **workspace index** (ids, titles, types, one-line summaries, recency — no content) is in *every* packet, including focused-mutation profiles. The current behavior — emptying catalog/workspace lists when an artifact is focused (`context-builder.ts:428-673`) — is removed; it is the direct cause of "every ambiguous reference resolves to the open artifact".
- **Structural serialization exists for every type.** Presentations currently serialize to nothing (`typedArtifactStructure` has no branch — the model authors decks blind). Every blueprint gets a typed, budgeted structure view; hydration stays targeted (resolved artifacts get depth, the index stays shallow).
- Budgets remain (packets are bounded); the difference is *shape*: breadth always, depth on resolution.

## 3. Quality machinery (first-class, Pablo's decision 2026-08-25)

Tool access without intelligence is a non-goal. Per-type quality is engineered:

- **Presentations**: a layout/template system (grids, hierarchy, pacing, theme-aware text fitting) that the AI composes through — it emits design intents that the template layer realizes, not raw `objects[]` coordinates. Deck-level critique pass: after generation, re-read and grade against a deck rubric (structure, density, contrast, one-idea-per-slide), fix before reporting.
- **Sheets**: analysis patterns — real formulas over literals, appropriate chart types bound to ranges, labeled units, a stated-conclusions block. Rubric: recalculability (change an input, outputs follow), correctness of formulas, chart-data honesty.
- **Documents**: structure-aware editing (headings, flow, citations preserved), intent classification (rewrite vs append vs restructure) before acting.
- **Rubrics are shared artifacts**: the same per-type rubric files drive the agent's self-critique pass and the L3 verifier's grading — quality is defined once.
- Model config: primary model unchanged; the fallback-equals-primary footgun (`model-config.ts:2`) fixed; retries/critique passes are budgeted per run.

## 4. Choreography (wiring the dead layer)

Artifact-level beats are real today and kept. P4 wires the app level: the coordinator + performer (`app-choreography.ts` — complete, tested, zero imports) mounts in the shell; `ui_event`s route through arbitration; `followedActorId` is actually set (D38 — today follow follows everyone); input-disengage listens window-level (typing anywhere ends follow); claims get TTLs; the settings-change navigation hijack (`spectra-shell.tsx:1577` router.push) is removed. When Follow AI is off, background runs surface presence in the dock and Library rows only — no viewport theft, ever.

## 5. Honesty rules (non-negotiable, verified in L3 adversarial cards)

Success is claimed only after verify-phase confirmation including native persistence where applicable. Failure text is humanized through one map (the SCREAMING_SNAKE→Office-humanizer misroute dies). Attribution is truthful (`actorKind: "ai"` on AI-initiated journal rows — AI-8). Authority decisions and confirmations write durable audit events. Every mutating run is revertible at run level or says why not before acting.

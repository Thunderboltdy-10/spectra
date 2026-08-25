# ARCHITECTURE-CAPABILITIES — the typed operation IR (the actual protocol)

Owner phase: P3 (consumed by P4/P5). Binding under CANON R6–R7. This is the mechanism behind the product goal: *add a capability once and the editor, the AI, the Bridge gating, choreography, permissions, and future connectors all understand it.* Today "bold" exists in ~14 hand-written places and the AI bypasses all of them; the audit's `gateOperation` sits unwired. The registry unified the human workbar — keep that — and becomes a *projection* of the IR.

## 1. The CapabilityDefinition

One definition per logical operation, per artifact type family:

```ts
CapabilityDefinition {
  id: "document.format.bold"            // stable, namespaced — existing ids kept
  params: ZodSchema                      // the ONLY schema; AI tools and executors derive
  scope: "artifact" | "application"      // artifact ops vs app ops (navigate, settings…)
  availability: (ctx: CommandContext) => Availability   // one function, human AND AI
  native?: {
    touches: FidelityRegionKey[]         // derived-validated, not hand-trusted (see §3)
    delta: LensDeltaKind                 // the lens op this maps to; absence = not native-writable
  }
  execute: { editor?: HandlerRef; server?: OperationRef }  // C1: one execute per verb
  ai: { exposed: boolean; description: string; riskClass: AuthorityRisk }
  choreography?: ChoreographyPrimitive   // what "watching this happen" looks like
  requires?: WorkCapability              // sharing-role gate
}
```

## 2. Derivations (what nobody hand-writes anymore)

- **Workbar/UI**: `CommandBinding`s are generated from definitions plus a small per-type presentation map (tab, icon, control kind, shortcut). Presentation is the only hand-authored remainder.
- **AI tools**: `propose_operation`'s per-type operation schemas are generated from `params` — the `z.record(unknown)` envelope dies. The AI's operation vocabulary is exactly the IR (P4 consumes this).
- **Strict-native gating**: availability composes `native.touches` × the artifact's fidelity map — identically for a workbar button, a keyboard shortcut, and an AI proposal. `gateOperation` (exists, tested, unwired) becomes the single chokepoint inside the AI mutation path and refuses with the same sentences humans see (C2, finally symmetric).
- **Choreography**: beat generation consumes the definition's primitive instead of guessing from content diffs.
- **Docs for models**: the per-type capability descriptions injected into AI prompts are generated from the IR — the model's knowledge of what it can do is never stale.

## 3. The ghost gate (build-time, CANON R6)

A CI check cross-validates, per format: every definition with `native.delta` names a delta kind the lens actually implements (imported, not string-matched); every lens delta kind is claimed by ≥1 definition; every definition without `native.delta` is unavailable in strict-native with a reason. Hyperlink-style ghosts (enabled UI, no write path — DOC-10) become impossible to ship, not impossible to write.

## 4. Input paths route through the IR (kills the bypass families)

One dispatch chokepoint per studio: workbar clicks, keyboard shortcuts, context menus, and raw editor chrome all resolve a definition and execute through it. The known bypasses are closed in P3: presentation Delete/arrow keys around availability (PPT-5), duplicate global keydown double-fire in split view (CMD-1), sheets' second shortcut path and un-closable Find (CMD-4), RichTextFormatBar raw TipTap chains, unregistered dispatcher ids.

## 5. Migration order (incremental, each step shippable)

1. Office formatting family (the worst granularity mismatch: ~15 commands ↔ `format_blocks` ↔ `format-runs`).
2. Remaining Office commands (structure, insert, arrange, review).
3. Application scope: navigation, settings, library/tree ops (the authority table keys off `riskClass` here).
4. Non-Office types — quiz, flashcards, code, whiteboard, planner, agent — whose bindings today live inline in studio files, registered into the IR without regressing their (healthier) behavior.

Preserved from the current registry: stable ids, shared command families, `fidelity-regions.ts` translation, `capability-audit.ts` machinery (retargeted at the IR), the workbar renderer, availability sentences. The workbar overflow ranking that sheds honest-disabled controls first (CMD-3) is inverted in P3. Preference/customization storage stays; its four divergent merge algorithms collapse to the one canonical `resolvePreferences` (PREF-1) with zombie-id pruning.

## 6. The connector test (why this shape)

A future connector (Google Docs, Notion) supplies: a lens (projection + deltas + fidelity map), a `native.delta` mapping table for the capabilities it supports, and sync-policy entries. It does **not** touch editors, AI tooling, choreography, or the workbar — those all read the IR. P8 validates this claim on paper against Google Docs before the program closes (PRODUCT §8).

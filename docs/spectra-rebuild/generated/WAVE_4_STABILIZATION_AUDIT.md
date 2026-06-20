# Wave 4 Stabilization Audit

Generated on 2026-06-20 from the uncommitted Wave 4 attempt, compared with stable commit `90b3eb5`.

## Scope and baseline

Wave 4 must stabilize the `AIRun -> Operation -> ResultCard` path without redesigning the Wave 2B workspace/artifacts surfaces or the Wave 3B Artifact Studio. The current working tree is an attempted implementation, not an accepted baseline.

## Uncommitted files audited

Modified:

- `convex/_generated/api.d.ts`
- `convex/schema.ts`
- `convex/spectraArtifacts.ts`
- `convex/spectraRuns.ts`
- `docs/spectra-rebuild/generated/FLEXIBLE_BACKLOG_AND_FEEDBACK.md`
- `docs/spectra-rebuild/generated/FLEXIBLE_WAVES_ROADMAP.md`
- `src/app/api/chat/route.ts`
- `src/app/api/spectra/route.ts`
- `src/components/chat/chat-layout.tsx`
- `src/features/spectra/__tests__/api-route.test.ts`
- `src/features/spectra/__tests__/operations.test.ts`
- `src/features/spectra/ai/index.ts`
- `src/features/spectra/components/artifact-studio.tsx`
- `src/features/spectra/components/command-bar.tsx`
- `src/features/spectra/components/result-card.tsx`
- `src/features/spectra/data/api.ts`
- `src/features/spectra/operations/policy.ts`
- `src/features/spectra/operations/schema.ts`
- `src/features/spectra/pages/artifacts-shell.tsx`
- `src/features/spectra/pages/workspace-shell.tsx`

Untracked:

- `convex/spectraOperations.ts`
- `docs/spectra-rebuild/generated/WAVE_4_AI_OPERATION_ENGINE_PLAN.md`
- `src/app/api/spectra/run/route.ts`
- `src/features/spectra/__tests__/wave4-operation-engine.test.ts`
- `src/features/spectra/ai/stream-events.ts`
- `src/features/spectra/ai/use-spectra-run.ts`

## What the attempt introduced

- A fixed-model OpenRouter structured-plan endpoint at `/api/spectra/run`.
- Zod operation/plan parsing and a first confirmation policy.
- Persisted operation proposal/claim/result rows.
- Extended AIRun and ResultCard queries/mutations and AI provenance on created artifacts.
- Strict NDJSON stream events and a shared client run hook.
- Command-bar wiring on workspace, artifacts, and Artifact Studio contexts.
- Live ResultCard rows with confirm, cancel, retry, open, and hide actions.
- A wrapper that registered legacy `/chat` executions as Spectra runs and a separate chat “save as artifact” conversion.

## Bugs and likely root causes

### Critical: blueprint/model schema divergence

- The OpenRouter JSON schema declares artifact `content` as `{}`, so the model is not told the required blueprint shape. Runtime Zod validation only fails after generation. This caused the observed missing flashcard fields.
- The system prompt says a deck is one artifact, but does not provide the canonical `cards[]` shape. The model contract, JSON schema, Zod blueprint schemas, editor shapes, and executor are therefore not one contract.
- Parsed blueprint content is validated but the original unparsed object is retained, allowing unknown or non-canonical fields through.
- Quiz validation does not require valid multiple-choice options or ensure `correctAnswer` is present and belongs to the options.
- Document, planner task, and thread-reference schemas do not fully match the safe shapes already used by Wave 3B editors. `thread_reference` uses an empty string as a fake thread id rather than an explicit placeholder.

### Critical: operation relevance and confirmation are conflated

- `evaluatePlanPolicy` turns unrelated operations into confirmation reasons instead of rejecting them. A hallucinated `workspaceItem.hide` can therefore become an “approval needed” card.
- Relevance is reduced to a small keyword regex. This is brittle and cannot represent answer-only, clarification, refusal, direct operation, or confirmation decisions.
- All placement operations are treated as potentially legitimate model output without validating them against an interpreted request mode and owned context.
- The misleading “Bulk workspace reorganization” message is generated solely from placement-operation count, including hallucinated operations.

### Critical: database ids are plain strings at the protocol boundary

- Model operation inputs accept arbitrary short strings for artifact, workspace, and workspace-item ids.
- The route forwards those strings directly to Convex mutations. Convex becomes the first real-id boundary, producing the observed validator exception.
- No pre-persistence reference check proves ids came from the owned context. Synthetic operation keys, artifact aliases, or composite strings can reach mutations.
- A hide operation has no lookup/ownership resolution step before execution.

### Critical: retry duplicates runs and visible UI

- Retry calls `run(prompt)`, which always creates a new AIRun and ResultCard. There is no attempt model or visual grouping/replacement.
- Persisted cards from both runs are merged and restored on refresh, so retries stack indefinitely.
- The original failure remains actionable after retry and no stale action invalidation occurs.

### High: result-card restoration is unbounded for the working surface

- `listResultCards` returns recent persisted cards without activity/relevance filtering.
- The client merges every returned visible card and shows up to eight separate bordered cards.
- Completed, cancelled, old failed, and duplicate retry cards return after refresh unless manually hidden.
- The implementation lacks a temporary run-detail state. Clicking a row cannot open prompt, operations, error, affected objects, or actions.

### High: run state and confirmation state are ambiguous

- Awaiting confirmation is stored as `running`; cancel accepts any running run, not only a confirmation proposal.
- Confirmation re-runs policy without the original interpreted prompt and does not validate stored ids against current owned context before committing.
- `claim` marks an operation `executed` before the mutation executes. A crash between claim and completion leaves a false executed state.
- Multiple operations are not atomic and partial execution is surfaced only as a generic run failure.

### High: progress copy is generic and disconnected from operations

- Hard-coded phrases include “Reading selected artifacts”, “Planning safe operations”, “Working”, and “Preparing workspace”. They are inaccurate on surfaces without a selection and do not describe the actual object/count/destination.
- Deck progress says “Creating flashcards” rather than validating a card count and saving one deck.
- Failure summaries expose large raw provider/schema errors directly in the tray.

### High: old AI/orchestrator code is mixed into Wave 4

- The attempted `/chat` registration wraps `src/lib/orchestrator/pipeline`, the exact pre-rebuild foundation prohibited for new Spectra code.
- Chat artifact conversion still infers object type from old route traces, markers, and parsers. It bypasses the Wave 4 operation planner and operation log.
- The Spectra run endpoint itself does not import legacy orchestration/routing code; that isolated path is safe to keep.
- Full `/chat` convergence belongs to Wave 5. Wave 4 should not claim chat is on the new engine while delegating execution to the old pipeline.

### Medium: provider naming is inconsistent

- The model id is correctly `deepseek/deepseek-v4-pro`, but `SPECTRA_MODEL_PROVIDER` is labeled `openrouter`. The Spectra provider identity should remain `deepseek`; OpenRouter is the transport/gateway.

### Medium: admin stats rebuild is invalid Convex pagination

- `rebuildPlatformStatsAggregates` runs paginated queries for three tables, and loops pages inside one mutation. Convex permits one paginated query per function invocation.
- This is separate from the AI engine. Fix only with a bounded page-per-invocation/chained internal-mutation design; otherwise keep it explicit in backlog.

### Environment blocker found

- WSL `PATH` has no Linux `node`; `npm` resolves to Windows and launches `cmd.exe` against a UNC path.
- Linux Node 24.16.0 already exists under `~/.nvm/versions/node/v24.16.0/bin`. Verification must prepend that directory instead of invoking Windows npm.
- `package.json` has no `typecheck` script; use the Linux runtime with `npx tsc --noEmit` unless a script is added.

## Safe to keep

- Additive Convex operation persistence and AIRun/ResultCard ownership checks, after lifecycle fixes.
- AI provenance fields on artifact creation.
- The direct fixed-model Spectra endpoint and strict NDJSON framing.
- The shared client run hook as a base, after retry/restoration/detail-state changes.
- Command-bar busy handling and canonical data refresh.
- Artifact Studio remount on canonical `updatedAt`, guarded by the existing dirty-editor check.
- The compact row visual language, rewritten as one dense unified tray.

## Rewrite or remove

- Rewrite the structured plan and blueprint JSON schemas as one canonical discriminated contract.
- Add an explicit request decision/intent contract and reject semantically irrelevant operations before persistence.
- Add an owned-reference resolver so only real context ids can reach Convex id validators.
- Rewrite retry as another attempt on the same run/card.
- Rewrite the card stack as a compact unified tray with temporary detail panel.
- Replace generic progress phrases with operation-derived phases.
- Revert the Wave 4 `/chat` wrapper and legacy marker-based Spectra artifact conversion; defer real chat convergence to Wave 5.
- Fix or explicitly backlog the admin pagination rebuild.

## Exact stabilization checklist

- [x] Canonical schemas for document, flashcard deck, quiz, planner task, and safe thread reference.
- [x] One deck artifact contains `cards[]`; one quiz artifact contains `questions[]`.
- [x] Structured plan includes answer/direct/confirmation/clarification/refusal semantics.
- [x] Confirmation counts visible artifacts, not cards/questions.
- [x] Unrelated operations are rejected, not converted into confirmation UI.
- [x] Every model-authored id is resolved against owned context before operation persistence and again before execution.
- [x] Convex mutations receive only correct table ids; synthetic keys stay protocol-only.
- [x] Retry reuses one run/card with attempt history/count and invalidates stale actions. Potentially partial runs cannot be blindly retried.
- [x] Awaiting confirmation is a distinct lifecycle state.
- [x] Unified tray is one compact container with at most two visible rows.
- [x] Refresh restores only active/recently relevant visible rows, not stale history.
- [x] Row click opens a temporary right run-detail panel with prompt, operations, errors, affected objects, and actions.
- [x] Progress is specific to operation type, object count, and workspace destination.
- [x] Focus is visibly a hint; prompt intent may override it. Selectable focus is deferred.
- [x] Old orchestrator/routing code is not used by the new Spectra engine.
- [x] Model id remains `deepseek/deepseek-v4-pro`; provider identity is `deepseek`.
- [x] Admin pagination uses a scheduled background chain with one 16-row page per internal function invocation.
- [x] Linux Node runs focused/full Vitest, TypeScript, lint, production build, and Convex codegen checks.

## Verification completed

Use Linux Node explicitly in WSL:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit
npm run lint
npm run test:run
npx convex codegen
npm run build
```

Automated results on 2026-06-20: TypeScript passed; lint passed with zero warnings; 68 Vitest files passed with 361 tests passed and 3 live tests skipped; Convex codegen/deployment/type validation passed; production build passed. Focused route tests verify one six-card deck, operation-derived progress, absence of unrelated hide operations, and same-run/card retry. The exact previously failing `superAdmin:refreshPlatformStats` internal mutation was executed live after deployment and returned successfully; its bounded background pages publish the final snapshot asynchronously.

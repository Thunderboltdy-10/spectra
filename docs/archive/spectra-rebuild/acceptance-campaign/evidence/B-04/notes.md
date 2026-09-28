# B-04 Plan application safety and diagnostics

Date: 2026-07-24

## Defect
Zod / intent failures often surfaced as opaque `"Spectra could not safely apply that plan"`. Common envelope slips (numeric `finalResponse`, extra top-level keys, empty `operate`, answer+ops contradiction) forced a model repair or a dead-end. Bounded repair existed but lacked focused unit coverage; `resolveAndValidatePlan` failures were under-logged.

## Repairs
- New `plan-diagnostics.ts`:
  - `coerceCommonPlanSchemaSlips` — strip unknown keys, coerce scalar `finalResponse`, clarify empty operate-with-question, drop ops on answer/clarify/refuse.
  - `formatZodPlanPublicError` / `formatPlanApplicationPublicError` — path-specific user copy (missing object, intent mismatch, incomplete edit, choices, etc.).
  - `isRepairablePlanFailure` — shared gate for the one-shot model repair.
- `parseSpectraPlan` runs coerce before Zod.
- `publicError` logs `[spectra.plan.validation]` / `[spectra.plan.application]` and delegates formatting.
- `resolveAndValidatePlan` logs `[spectra.plan.resolve_validate]` with prompt preview + publicError before clarify-or-throw.
- Tests: `plan-diagnostics.test.ts` + primary/fallback bounded repair cases in `run-route.test.ts`.

## Verification
```
npx vitest run \
  src/features/spectra/__tests__/plan-diagnostics.test.ts \
  src/features/spectra/__tests__/run-route.test.ts
```
Green. Primary repair asserts exactly one repair request; fallback repair asserts repair system prompt + success.

## Residual
Historical Convex run cards still show the old generic copy — expected; only new runs benefit. Intent/ownership mismatches are **not** model-repaired (correct); they now explain “select the object” instead of “safely apply”. Live prompts that still fail after one repair need product follow-up, not a second unbounded loop.

# S11 specialist routing source candidate

Status: **31/31 focused tests passed and scoped ESLint passed** under the RUNTIME filesystem guard and assigned slot. No backend publication or live selection acceptance.

## Problem and change

Foundry routing could accumulate evidence, evaluation, output-type and skill-status bonuses without a matching request. The intake adapter discarded exclusions, omitted evaluation/tool availability, and fell back to lexical routing after Foundry rejected a candidate. Medium confidence (0.66) cleared the automatic threshold (0.64), while a retained agent was boosted to 0.8 even when unrelated.

The candidate requires request fit from the existing routing description/examples or creator-configured task-specific skill triggers before quality/type bonuses count. It caps duplicate example and skill score accumulation. Verification status only adds weight after a skill trigger actually activates. Mission exclusions join negative examples. Nonpassing/missing evaluation and missing prerequisites prevent the adapter from returning an eligible Foundry candidate.

These are conservative matching heuristics, not learned semantic retrieval. Explicit user selection still uses the current authorized runtime without automatic-fit or evaluation requirements. No intent vocabulary, greeting classifier, embedding provider, or model configuration was added.

## Evaluation and authority

The backend reads at most the selected release's single referenced evaluation row and projects only status, verification strength, counts, content hash, release ID and version ID. It checks agent/school/content-hash association and version ownership. Missing legacy strength is reported as `unverified`; missing/mismatched evaluation remains null. Descriptor tool availability comes from enabled release tool grants. Draft changes cannot substitute their evaluation for the published version.

The evaluation response is small, but the database still reads the full evaluation row, including stored results. This is not a claim of reduced evaluation-row cost. Existing descriptor discovery and release-history scans are unchanged.

Foundry's current evidence UI pastes source text and stores its extraction as published training material. An available prerequisite requires a confirmed extraction with matching source identity. Arbitrary binding IDs do not prove availability. This material is governed by release access; it is not proof of current access to a separate live artifact. Live `content.resources` remain resolved through the existing current read-permission check. Their unavailable snapshots are omitted and their health is reported. Unused optional resources do not disable the agent.

## Real intake behavior

- Rejected Foundry candidates cannot reenter through legacy lexical scoring. Pre-Foundry routing remains compatible.
- Automatic Foundry selection requires high confidence. Medium confidence can retain only a currently relevant specialist; retention does not manufacture confidence.
- After listing, intake retrieves and reevaluates the actual runtime's release, evaluation, tools, routing-enabled setting, exclusions and prerequisites. Revocation or an incompatible new release falls back to ordinary Spectra.
- The call remains optional at the runtime seam. This unit does not change when ENGINE invokes selection and does not eliminate descriptor discovery on each invocation.

## Focused validation

`intake-routing.test.ts` calls the actual adapter and selector with mocked backend responses. It covers relevant selection, unrelated greetings/facts/document work despite training/type bonuses, untriggered verified skills, negative examples, absent/failed/old evaluation, unavailable tools/evidence, medium retention, publication/access races, and explicit choice. `agent-publish.test.ts` adds real Convex fixtures for bounded evaluation projection, private case-output omission, current release versus draft, mismatched/missing evaluation, unevaluated internal releases, and a granted reader/revocation boundary.

The 18 routing, five existing intake, and eight backend publishing tests passed. The initial routing run had 17 fixture-hook errors: `beforeEach` returned the mock function, which Vitest invoked as cleanup with no arguments. Making that hook return void resolved all errors; the affected 18-test file was rerun successfully. No product-source change was needed during validation. Logs: `.spectra-local/launch-s11/context/context-guarded-tests.log`, `routing-guarded-retest.log`, and `context-guarded-lint.log`.

```powershell
node node_modules/vitest/vitest.mjs run src/app/api/spectra/run/loop/intake-routing.test.ts src/app/api/spectra/run/loop/intake.test.ts convex/agent-publish.test.ts --maxWorkers=1 --no-file-parallelism --reporter=verbose
node node_modules/eslint/bin/eslint.js convex/spectraArtifacts.ts convex/agent-publish.test.ts src/features/spectra/agents/foundry/routing.ts src/features/spectra/agents/foundry/skills.ts src/app/api/spectra/run/loop/intake.ts src/app/api/spectra/run/loop/intake-routing.test.ts --max-warnings=0
```

Use RUNTIME's guarded test procedure for reproduction. Backend projections and the intake adapter need coordinated publication; without the new evaluation projection Foundry automatic routing conservatively stays disabled. True semantic suitability, paraphrase recall and demand-driven specialist discovery remain separate work. No full typecheck/build or provider-driven automatic-selection acceptance was performed.

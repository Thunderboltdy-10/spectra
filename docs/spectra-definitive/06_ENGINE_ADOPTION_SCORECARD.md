# Open-source engine adoption scorecard

Scores are 0 (unacceptable) to 5 (excellent). The executable source of truth is `src/features/spectra/compute/engines/engine-scorecard.ts`; every candidate is scored on all thirteen Phase 8 criteria and must remain a headless engine/parser/runtime rather than a foreign product shell.

| Candidate | License | Bundle/runtime | Mobile | Transparent model | Semantic actions | Yjs adaptability | Anchors/selections | UI independence | Import/export | Code-only tests | Maintenance | Migration | Benefit | Total | Decision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| PDF.js 5.4.624 | 5 | 3 | 4 | 5 | 3 | 4 | 5 | 5 | 4 | 5 | 5 | 5 | 5 | 58/65 | Retain behind replaceable PDF Inspector contract |
| Pyodide 314.0.2 | 5 | 2 | 2 | 5 | 4 | 4 | 3 | 5 | 4 | 5 | 5 | 5 | 5 | 54/65 | Retain with broker, worker reuse, package and resource limits |
| esbuild-wasm 0.28.1 | 5 | 3 | 3 | 5 | 3 | 5 | 2 | 5 | 5 | 5 | 5 | 4 | 5 | 55/65 | Adopt for bounded worker builds with immutable cached dependencies |
| Firecrawl PDF Inspector candidate | 1 | 2 | 2 | 3 | 3 | 3 | 3 | 5 | 3 | 2 | 2 | 3 | 2 | 34/65 | Not adopted: no stable standalone browser/WASM package clears the gates |
| DuckDB-WASM candidate | 5 | 1 | 1 | 5 | 3 | 3 | 1 | 5 | 5 | 4 | 5 | 2 | 2 | 42/65 | Not adopted: no concrete Sheets/import workflow justifies its cost |

No whole product shell is adopted. Original files, Spectra permissions, semantic actions, collaboration models, anchors and surface grammar remain authoritative around every retained engine.

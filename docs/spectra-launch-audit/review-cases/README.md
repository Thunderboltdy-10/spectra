# Parent boundary counterexamples

Captured against M01 1dc1be2d and M02 95a5d6b6 on 2026-09-10. These are portable behavioral reproductions of rejected candidate code, not production tests that should currently run in main. They use synthetic local fixtures and controlled network mocks.

Copy to the corresponding candidate checkout:

| Stored source | Destination within candidate |
| --- | --- |
| parent-m01-boundaries.test.ts.txt | convex/parent-m01-boundaries.test.ts |
| parent-m02-boundaries.test.ts.txt | convex/parent-m02-boundaries.test.ts |
| parent-m02-source-boundaries.test.ts.txt | src/features/spectra/__tests__/parent-m02-source-boundaries.test.ts |

Run in M01:

```powershell
.\node_modules\.bin\vitest.cmd run convex/parent-m01-boundaries.test.ts --reporter=verbose
```

Run in M02:

```powershell
.\node_modules\.bin\vitest.cmd run convex/parent-m02-boundaries.test.ts src/features/spectra/__tests__/parent-m02-source-boundaries.test.ts --reporter=verbose
```

Parent observations: M01 four failures; M02 initial four failures plus one subsequently added small-import completion failure, nine distinct cases total. The last completion case was run with a name filter; the other two backend cases were skipped in that follow-up invocation, not rerun. See M01-M02-REVIEW.md for outcomes and code-review findings.

No live Convex, browser journey, real private network request or primary source change is claimed. The tests execute actual candidate backend functions through convex-test and the actual candidate source-fetch module with mocked DNS/fetch. The import replay test performs a successful first commit before its second invocation fails. The deletion test invokes bounded steps with fake timers rather than draining an infinite schedule.

During the completion tasks, incorporate these as passing regressions alongside adjacent cases. If replacing a broken API, adapt the fixture/caller to the new contract while preserving the intended user/authority invariant. Do not weaken assertions merely to accept the rejected behavior.

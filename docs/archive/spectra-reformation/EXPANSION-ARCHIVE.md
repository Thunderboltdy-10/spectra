# Expansion archive — preserved, excluded from the school-launch line

## Decision

The P9–P15 expansion campaign is valuable future work, but its feature chains are not part of the initial school launch. They were built from several different intermediate commits and some units are incomplete or depend on later units. On 2026-08-31 the launch line was reconstructed from the last known green pre-expansion checkpoint and only self-contained launch foundations were selected into it.

This is exclusion, not deletion. Do not cherry-pick `current-main` wholesale and do not merge an expansion branch into launch `main`. When expansion resumes, start a new branch from the then-stable P8 release commit, inventory these refs, and port one dependency-complete unit at a time with fresh verification.

## Durable preservation

External Git bundle:

`<local-workspace>`

Verified size at creation: **222,676,189 bytes**. It contains the complete repository ref set at archive time, not just the named branches below.

After archive verification, all 36 auxiliary worktrees were removed. Git now has one worktree: `<local-workspace>`. The P9.I4 local Convex data was copied first to the primary checkout's gitignored `.spectra-local`; all **165 files / 267,853,172 bytes** matched by per-file SHA-256 before the old checkout was deleted.

Named local archive refs:

| Ref | Commit | Preserved content |
|---|---:|---|
| `archive/expansion-20260831/current-main` | `e7082e5` | Entire mixed expansion-era main, including P9–P12 ancestry |
| `archive/expansion-20260831/p12-i1` | `3f9d3e3` | Quiz depth |
| `archive/expansion-20260831/p12-i1-note-wip` | `5755ea4` | Uncommitted P12.I1 note state captured as a commit |
| `archive/expansion-20260831/p12-i3` | `1095501` | Whiteboard depth |
| `archive/expansion-20260831/p12-i5` | `55519b0` | P12.I5 implementation record/history |
| `archive/expansion-20260831/p12-i6` | `45b1956` | Agent/timetable depth |
| `archive/expansion-20260831/p12-i7` | `9d816ef` | Office capability work; launch-safe truth fixes were separately selected |
| `archive/expansion-20260831/p13-i2-wip` | `fec37b8` | Incomplete P13.I2 worktree captured as a commit |
| `archive/expansion-20260831/p13-i3-wip` | `65cf32c` | Incomplete P13.I3 worktree captured as a commit |
| `archive/expansion-20260831/p13-i4-wip` | `82357d3` | Incomplete P13.I4 worktree captured as a commit |
| `archive/expansion-20260831/p14-i3` | `86c570b` | Memory capture tiers |
| `archive/expansion-20260831/p15-i3` | `f1a4c5d` | Expansion code-experience polish (depends on expansion depth) |
| `archive/expansion-20260831/p9-v1-wip` | `a090a4f` | Unfinished local-foundation verifier fixes; the safe localhost/auth repair was separately selected |

Verify or restore without touching launch `main`:

```powershell
git bundle verify '<local-workspace>
git clone '<local-workspace> spectra-expansion-recovery
```

## What was deliberately selected into the launch line

- isolated local Convex stacks, generated instance-package repair and deterministic school bootstrap;
- localhost Clerk callback/JWT and membershipless platform-operator authorization fixes;
- bounded runs/reminders, Library/collaboration/org-tree reads and synchronized Library summary writers;
- launch-critical Office truth: PowerPoint slide visibility/notes capability alignment, accurate refusals, XLSX stable formula-literalization refusal, DOCX safe insertion beside shared native wrappers;
- Yjs lifecycle stabilization and the strict 30-client P5 classroom harness.

These are reliability and launch-operability foundations with bounded dependencies. Their inclusion does not activate the rest of P9–P15.

## What remains excluded

- connector expansion and connector-auth/onboarding chains;
- broad P12 artifact-depth families whose dependencies are incomplete;
- P13 school-assessment/product expansion;
- P14 memory/soul/context expansion;
- P15 expanded onboarding and polish that assumes excluded capabilities;
- all dirty WIP that has not been independently reconstructed and verified against the final P8 base.

## Resume protocol after P8

1. Create one expansion branch from the immutable P8 release commit in the primary checkout; do not resurrect the old worktree topology.
2. Compare `archive/.../current-main` and each unit ref to the P8 base, then build a dependency graph from code, schema and tests.
3. Re-brief the next smallest dependency-complete sub-phase using current PROCESS model routing. Default implementation model is Grok 4.6 High with explicit invariants/checks.
4. Port behavior, not commit topology. Resolve against current stable architecture, add migration/backfill where schema changed, and delete displaced alternatives.
5. Independently verify the unit; verifier PASS closes it. Continue serially.

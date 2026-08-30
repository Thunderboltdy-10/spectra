# P5.I3 embed-convergence evidence — 2026-08-30

Signed-in Account A Playwright journeys against the local development composition. The final pass used a fresh browser context (`p5i3clean`) restored only from Account A auth state; no local embed seed or page-local cache was reused.

| # | File | Evidence |
|---|---|---|
| 00 | `00-reference-panel-before.png` | Reference panel before the converged live record was placed. |
| 01 | `01-workspace.yml` | Signed-in workspace baseline and target artifacts. |
| 02 | `02-reference-panel-empty.png` | Empty-panel state before placement. |
| 03 | `03-document-quiz-embed.png` / `.yml` | Document host rendering the quiz through the shared embed host. |
| 04 | `04-unpublished-quiz-guard.png` / `.yml` | Unpublished quiz honestly offers `Publish to practice` and `Draft`; no attempt/start action is exposed. |
| 05 | `05-reference-panel-final.png` / `.yml` | Configurable live quiz reference after panel-flow verification. |
| 06 | `06-document-host-final.png` / `.yml` | Final document-host presentation and source action. |
| 07 | `07-reference-panel-clean.png` / `.yml` | Fresh-context Convex-backed projection labelled `LIVE · PREVIEW · INTERACTIVE`; this proves the row survives context replacement and is returned through the live query path. The unrelated workspace tree overlaps in the 720px background, not inside the panel. |
| 08 | `08-chat-embed-host.png` / `.yml` | Shared chat thread hosting `P4V1 Pendulum Lab Draft` as `DOCUMENT · COMPACT · LIVE · READ-ONLY`, with expand, source, and remove actions. |

Request-level check: after replacing the browser context, the live `artifactEmbeds` query and projection returned the existing quiz embed without recreation; the shared chat host likewise loaded its persisted embed record. The fresh session recorded zero console errors. Repeated collaboration-WebSocket warnings are limited to the pre-existing local proxy path: the gateway health endpoint was ready on port 1234, but the proxy established no connections.

Known environment limitation: document content insertion remained local during this walk because that collaboration proxy could not connect. The Convex embed record itself persisted and rendered in fresh contexts, so this does not weaken the P5.I3 convergence evidence; gateway/proxy productionization remains P5.I2/P5.V1 scope.

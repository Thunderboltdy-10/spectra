# P0.V2 — Honest baseline journey

Run date: 2026-08-25
Verifier surface: signed-in Chrome, existing tab only; start and end `http://localhost:3000/chat`
Scope: seven goal cards spanning chat/AI, mount and browse, edit/persistence, collaboration, share, and Bridge recovery.
Verdict: **REJECTED — baseline journey exposed blocking truthfulness and recoverability failures.**

## Card results

| Card | Attempt and observed truth | Result | Evidence |
| --- | --- | --- | --- |
| C1 — Choose a workspace and ask AI | Selecting `M4 QA — Artifact Rebuild` changed the composer context and streamed a response. The card advertises 10 objects, while the response says there are no active artifacts or pinned items. | Partial; target/context count disagrees. | `00`–`04` |
| C2 — Browse a mounted school folder and open a document | Workspace/Library browse, N4 fixture expansion, controlled DOCX open, and Physics folder browse all worked. | Pass for browse/open. | `05`–`09`, `15` |
| C3 — Edit a native document and verify persistence | A marker appeared in the editor, remained visible after waiting, and the studio closed without an unsaved warning. Reopening the document showed the marker was gone. | **Fail; edit was not durable and status gave no warning.** | `10`–`14` |
| C4 — Keep the active AI target legible | After opening a document, the Live Dock retained the prior `Workspace Artifact Types` title while the focus control named the document. Historical dock cards also exposed raw internal failure tokens. | Partial; continuity and human-facing status are ambiguous. | `04`, `06`, `28` |
| C5 — Start a collaboration comment | The document Comments panel opened, named the document, showed `0 open`, exposed semantic region selection and a disabled Post action until content exists. | Pass for entry point; no mutation posted. | `28`–`29` |
| C6 — Share an artifact from the library and studio | Library artifact `Share…` closed its menu with no dialog, toast, or visible action. The same artifact’s studio `Share work` opened a real share dialog with permission and public-link controls. | Partial; one entry point is a silent no-op, one works. | `21`–`22`, `30`–`31` |
| C7 — Recover from Bridge offline state | Files and devices truthfully showed `Disconnected` and remembered folders. It exposed `0 of 1` for the N4 mount; advanced policy exposed engine enum language; `Connect this device` ended in `Failed to fetch`. | Partial/fail; offline truth is visible but recovery is not. | `23`–`27` |

## Evidence sequence

`00-chat-start`, `01-chat-context`, `02-chat-ready`, `03-chat-response`, `04-chat-after-wait`, `05-workspace`, `06-library`, `07-library-n4-expanded`, `08-n4-folder`, `09-document-open`, `10-document-dirty`, `11-document-edit-visible`, `12-document-settled`, `13-document-closed`, `14-document-reopened`, `15-physics-folder`, `16-share-dialog`, `17-workspace-open`, `18-workspace-share`, `19-workspace-actions`, `20-workspace-view`, `21-artifact-actions`, `22-share-dialog-open`, `23-settings`, `24-files-devices`, `25-advanced-policy`, `26-bridge-connect`, `27-bridge-connect-after-wait`, `28-collaboration-document`, `29-comments-panel`, `30-document-actions`, `31-studio-share`, `32-chat-final`.

## Findings

- `[P0.V2] HIGH · mounted document edit · marker appeared, survived the visible wait, then disappeared after close/reopen · a user would conclude the document saved and later discover lost work · SYSTEMIC: persistence/status compensation · evidence path .shots/reformation/P0.V2/10-document-dirty.png, 11-document-edit-visible.png, 12-document-settled.png, 13-document-closed.png, 14-document-reopened.png`
- `[P0.V2] HIGH · Live Dock status history · raw tokens such as LOCAL_REPLICA_UNAVAILABLE and AI_ARTIFACT_CONNECTION_CLOSED are visible in user-facing cards · a user would feel the product is exposing internal machinery instead of explaining what happened · SYSTEMIC: plain-word humanizer and failure-surface consistency · evidence path .shots/reformation/P0.V2/06-library.png`
- `[P0.V2] HIGH · Bridge connect recovery · Connect this device returned to Disconnected and surfaced Failed to fetch without a specific recovery door · a user would not know whether to retry, repair permissions, or change the selected folder · SYSTEMIC: pairing/transport recovery contract · evidence path .shots/reformation/P0.V2/26-bridge-connect.png, 27-bridge-connect-after-wait.png`
- `[P0.V2] MED · Bridge mount status · an offline selected folder displayed `0 of 1` rather than an unavailable/unknown state · a user could read zero as an empty folder and distrust whether files are safe · SYSTEMIC: offline mount truth and count presentation · evidence path .shots/reformation/P0.V2/24-files-devices.png`
- `[P0.V2] MED · advanced sync policy · controls expose `explicit`, `mirror both`, `metadata only`, and `on save open` engine terms · a school user would have to understand implementation strategy names to choose a safe policy · SYSTEMIC: sync-policy humanization · evidence path .shots/reformation/P0.V2/25-advanced-policy.png`
- `[P0.V2] MED-HIGH · Library artifact share · Share… closed with no dialog, toast, or result while studio Share work opened correctly · a user would think sharing did nothing and have no way to tell whether access changed · SYSTEMIC: divergent share entry points and silent failure · evidence path .shots/reformation/P0.V2/21-artifact-actions.png, 22-share-dialog-open.png, 30-document-actions.png, 31-studio-share.png`
- `[P0.V2] MED · AI target continuity · the prior conversation title remained in the Live Dock while the focus control named the newly opened document · a user could not confidently tell which conversation and object the next prompt would affect · SYSTEMIC: target/context legibility · evidence path .shots/reformation/P0.V2/04-chat-after-wait.png, 28-collaboration-document.png`

## Checks and anomalies

Focused command: `npx vitest run src/features/spectra/__tests__/live-dock.test.ts src/features/spectra/__tests__/bridge-contract.test.ts src/features/spectra/__tests__/sync-policy.test.ts src/features/spectra/__tests__/collaboration-claim-authorization.test.ts src/features/spectra/__tests__/run-lifecycle.test.ts` — **5 files, 56 tests passed**.

Only the pre-existing Clerk development-key warning was present in the console during normal navigation; Bridge connect additionally produced the in-page `Failed to fetch` alert. No product code or tests were changed. The full repository sweep remains deferred until paired verification, per process.

# Phase 0 repository and migration baseline — 2026-07-14

This evidence was captured before obsolete-system deletion. It is descriptive, not a claim that any product feature is verified.

## Source baseline

| Field | Value |
|---|---|
| Branch | `rebuild` |
| Commit before plan/code changes | `bd8902986ecb50abf6c2c83c1a442d949dd33764` |
| Commit subject | `Prevented sub-agent parallelisation` |
| Node / npm / Convex CLI | `v24.11.1` / `11.11.0` / `1.41.0` |
| Source files (`src`, `convex`, `shared`, `scripts`; generated excluded) | 540 |
| App pages | 37 |
| API route files | 81 |
| Convex TypeScript files | 63 |
| Test files | 74 |
| Convex schema tables | 60 |

No repository-level `AGENTS.md` exists. The persistent goal and master plan explicitly prohibit sub-agents and delegation throughout implementation and verification.

## Quality baseline

| Check | Result |
|---|---|
| `npx tsc --noEmit --pretty false` | Passed |
| `npm run test:run -- --reporter=dot` | Passed: 73 files, 421 tests; 1 file and 3 tests skipped |
| `npm run build` | Passed: production build and 105 static pages |
| `npm run lint` | Failed: 5 errors and 9 warnings, itemized in the active defect ledger |

The test suite intentionally logs simulated 4xx/5xx/database/email failures; these tests passed and are not baseline defects by themselves.

## Schema baseline

The 60 tables before deletion are:

`orgs`, `managebacUserLinks`, `users`, `userPreferences`, `packs`, `resources`, `chunks`, `agents`, `agentModelStats`, `plannerItems`, `notes`, `chats`, `messages`, `usageDaily`, `usageEvents`, `artifacts`, `artifactVersions`, `userSpending`, `userMemory`, `userMemoryEntries`, `studentAnalytics`, `weeklySummaries`, `nudges`, `achievements`, `userStreaks`, `studyTimers`, `messageBookmarks`, `chatBranches`, `notifications`, `conversationTemplates`, `flashcardProgress`, `quizResults`, `quizSessions`, `flashcardDecks`, `orgSoulDocs`, `orgSoulChunks`, `generatedImages`, `feedback`, `auditLog`, `modelCatalog`, `catalogSyncState`, `modelRuntimeStats`, `schoolInvitations`, `platformStats`, `accessRequests`, `userSoulPreferences`, `errorEvents`, `spectraWorkspaces`, `spectraArtifacts`, `spectraArtifactVersions`, `spectraArtifactLinks`, `spectraWorkspaceItems`, `spectraThreads`, `spectraMessages`, `spectraAiRuns`, `spectraOperations`, `spectraResultCards`, `spectraRunEvents`, `spectraRunTabs`, and `spectraFocusSpaces`.

Key legacy coupling includes `users.role` + `users.orgId`, embedded `orgs.managebacConfig`, `managebacUserLinks`, `managebac_sync` and `managebacItemId` fields, old memory/soul tables, old platform aggregates, and parallel legacy/new Spectra artifact/run domains.

## Obsolete-system import/search baseline

File-hit counts exclude `node_modules`, `.next`, and the next-generation plan directory:

| Symbol/domain | Files |
|---|---:|
| `userMemory` | 13 |
| `userMemoryEntries` | 4 |
| `personalSoul` | 5 |
| `userSoul` | 4 |
| `orgSoul` | 5 |
| `managebac` | 29 |
| `schoolAdmin` | 9 |
| `superAdmin` | 40 |
| `SUPER_ADMIN` | 6 |
| `isAdminLikeActor` | 7 |
| `managebac_sync` | 10 |
| `managebacItemId` | 11 |
| `platformStats` | 11 |

The baseline build confirms old pages/routes remain live, including `/managebac`, `/admin*`, `/super-admin*`, `/api/memory`, `/api/personal-soul`, `/api/managebac`, `/api/admin/*`, `/api/school-admin/*`, and `/api/super-admin/*`. Deletion must reduce these runtime hits to zero before replacement construction; generated API types are regenerated, never hand-edited.

The configured environment contains the old `MANAGEBAC_API_TOKEN` and `MANAGEBAC_BASE_URL` contract and already uses plural `SUPER_ADMIN_EMAILS`. Only variable names were inspected; values were not emitted or recorded.

## Reversible private export

| Field | Value |
|---|---|
| Source | Configured Convex development deployment |
| Contents | Database snapshot plus file storage |
| Backup directory | `<local-workspace>` |
| Encrypted file | `convex-development-export.zip.aes` |
| Encrypted bytes | 1,206,760 |
| Plaintext SHA-256 | `622945707b29e5c3e5c1593a6582b629ee54dba4f711afde7a9395ff50b515cd` |
| Encryption/integrity | AES-256-CBC + HMAC-SHA-256 |
| Key protection | Windows DPAPI CurrentUser sidecar |
| Access | Explicit current user, SYSTEM, and local Administrators full-control ACLs; inheritance removed |
| Verification | Integrity verified, decrypted SHA-256 matched, plaintext and verification copies removed |

The local manifest records format/version and recovery metadata without data contents. A separate offline restore rehearsal decrypted and authenticated the export, matched the manifest hash, rejected unsafe archive paths, parsed 8,267 JSON documents across 71 exported table/component directories, found one storage file, and removed its temporary plaintext directory. The export tool is temporary migration tooling and must be deleted after migration sign-off and retention expiry.

## Visual/reference baseline

All 21 current reference PNGs exist and are mapped one-to-one in `12_UI_REFERENCE_REVIEW.md`. The repository also contains older screenshots under `docs/spectra-rebuild/DEPRECATED`; they are historical evidence only. The current production build exposes the expected legacy/current routes, but no reference comparison or acceptance marking occurs during Phase 0. Fresh live screenshots and direct comparisons are reserved for Phase 10 after all implementation boxes are complete.

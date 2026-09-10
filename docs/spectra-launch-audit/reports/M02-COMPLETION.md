# M02 Completion

Date: 2026-09-10
Branch: `codex/m02-completion`
Base preserved: `95a5d6b64258088a3984061cd9423237a2b0a35a`

## Delivered

The intake path now has a server-owned asset/original upload route. The route reads request bytes with an early streaming bound, validates content signatures, computes SHA-256 as hexadecimal, and sends bytes through `artifactAssets:storeAuthorized` / `artifactImports:storeOriginalAuthorized`. Convex storage metadata is compared on size, normalized content type, and hexadecimal SHA-256. A receipt is bound to the authenticated account, artifact/job, declared bytes, digest, and server-created object. Public asset finalization cannot promote an arbitrary storage id: only the server-owned action records a candidate. Terminal replay is authorized and idempotent; mismatches commit `quarantined` state before the route raises its error. Caller-supplied ids are never deleted or promoted into cleanup authority.

The supported binary action boundary is 16,000,000 bytes (`shared/intake-limits.ts`); original imports use the same bound. The former 100 MB declaration was not attainable through the Convex binary action transport and has been removed. Attachment intake remains explicitly bounded at 25,000,000 decoded bytes and rejects oversized encoded data before parser work.

Imported rich media is materialized instead of removed. PNG, JPEG, GIF, and WebP data URLs are decoded, signature-checked by the asset route, stored once in Convex file storage, and replaced with an authenticated `/api/spectra/assets/content?assetId=...` reference plus `assetId`. PNG/GIF/JPEG dimensions, alt text, and source reference are retained in the asset row. `href` and `url` data links are not rewritten as images. `DocumentImage` persists `data-asset-id`. Normalized content is size-checked after materialization; inline media bytes do not enter the import job or ordinary rich-content row.

Import completion rejects `imported` without content and uses the existing change-group/Yjs/ledger writer for the canonical version. Replay checks the already committed job before target-version staleness, so a lost acknowledgement can safely return the original receipt. A different job cannot use that shortcut. A stale target is rejected, and recovered imports preserve live state through the existing checkpoint path.

`releaseArtifactIntakePage` is exported from `convex/artifactIntakeLifecycle.ts`. It requires the owner tombstone in the same transaction, uses a versioned opaque cursor, processes bounded pages, records `artifactIntakeReleaseReceipts`, deletes only server-owned recorded storage references, and meters verified released bytes once. It covers quarantined/uploading asset rows and failed/quarantined/uploading original-import rows. Active/native/pinned objects are outside this helper and remain retained for their owning lifecycle; M01 must pass its deletion-generation boundary and preserve those references.

Reachable attachment intake now has common decoded-byte, ZIP expanded-byte, entry-count, per-entry, and traversal checks (`shared/parser-limits.ts`) before DOCX/XLSX/PPTX media/text extraction. PDF extraction is bounded by input bytes, page count, and extracted characters. This is a defensive boundary around current consumers; M03 still owns exporter/engine upgrades and M04 owns AI SDK changes.

Research fetching now rejects private, link-local, mapped IPv4/IPv6, loopback, documentation, carrier-grade, and multicast destinations, revalidates redirects, enforces response/body/deadline limits, uses bounded concurrency, propagates cancellation, and preserves failed/snippet evidence as `verified: false`. Citation verification still requires server-owned verified source records. DNS-to-connection pinning and a freshness/content-identity cache remain external follow-up work; the held research integration was not activated.

## Contracts

Asset receipt fields: authenticated `uploadedByAccountId`, `artifactId`, path/name, normalized MIME, expected `bytes`, hexadecimal `sha256`, `uploadReceipt`, status, server-owned `candidateStorageId`/`storageId`, quarantine reason, dimensions, alt text, and source reference. Import receipt fields: authenticated `ownerAccountId`, artifact and target revision identity, original bytes/digest/MIME, `uploadReceipt`, server-owned storage/candidate reference, status, fidelity report, unsupported features, and quarantine reason. M04 may consume durable asset/import/source ids and terminal state; it does not receive authority to mint `verified` provenance.

Legacy pending rows are scoped by authenticated uploader/owner. `uploading` rows can be retried with the same identity, revoked access is checked on every terminal operation, and abandoned rows are cleaned only after the deleted-owner tombstone and server-owned reference proof are available. A foreign candidate is rejected and is never deleted.

## Verification

Passed, exit code 0:

```text
npx vitest run convex/parent-m02-boundaries.test.ts src/features/spectra/__tests__/parent-m02-source-boundaries.test.ts src/features/spectra/__tests__/m02-intake-contracts.test.ts --reporter=verbose
  3 files, 8 tests passed
npx vitest run src/features/spectra/__tests__/references-context-sources.test.ts src/features/spectra/__tests__/docx-lens.test.ts --reporter=dot
  2 files, 45 tests passed
npx eslint <changed intake files>
  exit code 0
git diff --check
  exit code 0
```

The portable representative fixture checks rich-import media and the original W3 DOCX reproduction is additionally asserted when `<local-workspace>` is present. The original private file was not made a test prerequisite.

The named Playwright session `LA-M02C` reached the changed local app at `http://localhost:3000` with zero page errors, but the protected import route could not be exercised because the session had no authenticated account. This is live reachability evidence only, not proof of the protected journey. `npx convex codegen` was not run because this checkout has no `CONVEX_DEPLOYMENT`; no database reset or dependency reinstall was performed.

## Remaining concrete limits

The original W3 DOCX -> editor -> persisted reload journey, browser image readback, cleanup metering against a deleted artifact, and controlled DNS-rebinding/TLS fixture require an authenticated changed-backend session or the parent private checkout. The current source fetcher validates DNS before each redirect but does not yet bind the resolved address to the socket connection; this must be completed before activating the held research patch. ZIP preflight is still implemented at the current fflate consumer boundary, so any new parser consumer must call the shared helper. M03 must address remaining Office/exporter and parser advisory upgrades; M04 must consume the durable receipt/source ids and retain its own AI lifecycle boundaries.

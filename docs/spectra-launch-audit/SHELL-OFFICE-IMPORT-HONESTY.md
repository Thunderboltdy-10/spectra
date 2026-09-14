# Shell office import honesty (bounded)

Complements office-bridge `ca3e553` (docx-only office import route; `.doc` → 400 `IMPORT_OFFICE_FORMAT_UNSUPPORTED`). Shell `693326a` already classifies `.doc` as Library resource.

## Fix
- Call `projectOfficeImportWithLens` only for OOXML natives: `.docx` / `.xlsx` / `.pptx` (`isOfficeNativeImportFile`).
- On lens throw / failure: toast the real message and abort — no `.catch(() => null)` hollow `createArtifact`.
- `.txt` / `.md` keep `projectLibraryImportContent`. `.doc` stays resource via classify.

## Impact map
- MB sync: none
- AUTH vs connection: none
- Import: Office native import fails closed instead of hollow success; text imports unchanged
- Shelf keep / projections / heartbeats: none
- Sibling: complements office `ca3e553`; do not edit office route

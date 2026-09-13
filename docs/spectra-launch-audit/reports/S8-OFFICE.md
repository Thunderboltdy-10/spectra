# S8-OFFICE — independent Office interoperability

Date: 2026-09-13
Status: finite native corpus complete; independent validator and installed
Office readback passed. Authenticated browser export/materialization remains
unverified because the disposable local browser profiles reached the Clerk
sign-in boundary.

## Integration and scope

This private integration branch is `codex/s8-office`, based on the integrated
W8-01 compact-read primary at `1b21b697`:

- W8-02 product delta integrated as `80c60c4f` (`feat(spectra): add linked Word equation and image basics`)
- W8-02 report integrated as `6b6df7b4` (`docs(spectra): record W8-02 linked Word basics`)

The work stays inside the native Office seams and the presentation surface. No
hosting, billing, production, synced school file, or external action changed.

## Findings and bounded fixes

- `S8-OFFICE-F01` — XLSX standard chart writers emitted a negative axis id and
  did not consistently emit the complete plot/axis sequence. The writer now
  uses positive stable axis ids, emits every plot element, and writes matching
  `catAx`/`valAx` cross references in valid order. Combo series retain their
  plot family, axis, source formulas, and `idx`/`order` identities through the
  typed Sheets editor model and `office-content` transform.
- `S8-OFFICE-F02` — the prior histogram path placed legacy histogram elements
  in the standard chart namespace. Histogram creation/edit now uses a genuine
  ChartEx part, valid ChartEx relationships/content types, `dataId` formulas,
  hidden defined-name value/header references, a visible and hidden companion
  series, and `binning intervalClosed="r"`. A complete default ChartEx style
  and color part is added only when an imported chart has no valid asset
  relationship; existing assets remain untouched. The optional `binCount`
  element was deliberately omitted after Excel 16 rejected that otherwise
  schema-tolerated shape; the emitted binning/value semantics remain editable
  and are read back by Excel.
- `S8-OFFICE-F03` — deterministic Word `w14:paraId` values could set the sign
  bit. Both W8-02 Word adapters now keep the hash in the schema's unsigned
  31-bit range, avoiding an Open XML/Word repair on materialization.
- `S8-OFFICE-F04` — bounded PowerPoint edits could produce invalid title/legend
  ordering, an undeclared numeric-cache `formatCode` attribute, and redundant
  empty runs. The PPTX writer now inserts those nodes in schema order, writes
  `c:formatCode` as an element, provides the required rich-text children, and
  removes only redundant empty runs.
- `S8-OFFICE-F05` — presentation rails rebuilt every full slide preview and
  image export fetched media serially; browser drops also cleared the source id
  before the move callback. Slide previews are memoized and contained, image
  data URLs are prefetched concurrently once per asset, and the move callback
  runs before drag cleanup. Native write failures now name PowerPoint/Excel
  rather than incorrectly saying Word, so a local PPTX failure does not present
  a misleading warning.

## Independent validation

The dev/test path is implemented by:

- `scripts/fidelity-harness/office-sdk-validator.ps1`
- `scripts/fidelity-harness/office-com-readback.ps1`
- `scripts/fidelity-harness/s8-office.ts`

The validator opens each package with Microsoft's
`DocumentFormat.OpenXml.OpenXmlValidator`, SDK `3.0.1`,
`FileFormatVersions.Microsoft365`. Package opening exercises the package
relationships/content types, while the validator checks the targeted XML
schemas. Diagnostics are compared by exact type, part, path, and description
before versus after. The JSON artifact records the complete short arrays:

```text
<local-workspace>
```

For DOCX, XLSX, and PPTX corpus inputs, `before.diagnostics`,
`after.diagnostics`, `newDiagnostics`, and `resolvedDiagnostics` are all `[]`;
`validAfter` is `true`. The same is true for each Office-saved second copy.
The harness compares package parts and asserts that the retained unknown-part
control is byte-identical:

```text
customXml/s8-control.xml
xl/customXml/s8-control.xml
ppt/customXml/s8-control.xml
```

The targeted schema references used while repairing the writer were Microsoft's
[AxisId documentation](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.axisid?view=openxml-3.0.1),
[PlotArea documentation](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.plotarea?view=openxml-3.0.1),
[ChartEx part specification](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/5d0d453e-adac-43be-a797-59b9916593dd),
and the [ChartEx plot-area region specification](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/953cac64-c127-438a-bfc4-3e1b17b3f9a4).

## Finite corpus

The generated corpus is at:

```text
<local-workspace>
```

| Format | Input → materialized output | Native semantic readback |
| --- | --- | --- |
| DOCX | `word-before.docx` → `word-after.docx` | mixed-font paragraph, one image, one table edit, existing equation, inserted matrix equation, edited section header/footer |
| XLSX | `workbook-before.xlsx` → `workbook-after.xlsx` | conditional formatting, validation, ordinary line chart, combo chart, ChartEx histogram, edited revenue `16` |
| PPTX | `presentation-before.pptx` → `presentation-after.pptx` | two slides, independent duplicated chart and embedded workbook, notes, external/internal links, linked Sheets refresh |

Every format has a retained unknown-part control. The changed-part lists are
in `s8-office-report.json`; the targeted corpus changes are DOCX document and
section parts, XLSX sheet/chart/chartEx parts, and PPTX slide/chart/embedded
workbook/notes/link relationship parts.

## Installed Office readback

The harness copied each generated package to a temporary input, opened it with
hidden COM automation, saved a separate output, and then independently
validated that output. Original fixtures and corpus inputs were never opened
for write.

- Word `16.0`: passed; 1 section, 12 paragraphs, 1 table, 1 inline shape;
  edited header/footer, edited table cell, and matrix equation were read back.
- Excel `16.0`: passed; 1 worksheet, 3 chart objects, used range `A1:C13`.
- PowerPoint `16.0`: passed; 2 slides, one chart-bearing shape per slide and
  3 notes-page shapes per slide. The probe counts the native chart-bearing
  placeholder with `Shape.HasChart`, which is the semantic chart state even
  when its generic shape type is not the chart type enum.

Second-copy outputs:

```text
<local-workspace>
<local-workspace>
<local-workspace>
```

## Browser and local stack evidence

A unique headed Playwright CLI session named `S8-OFFICE` was used with the
session configuration:

```text
<local-workspace>
```

Readiness and native completion are recorded separately:

- local stack readiness: the shared local web/Convex/gateway stack was
  reachable, and the disposable worktree server was stopped after diagnostics;
- canonical UI save: not evidenced;
- native UI completion: not evidenced for DOCX/XLSX/PPTX.

The copied W8 Profile A states had expired Clerk sessions and reached sign-in;
the browser extension attach path was unavailable. No credentials were
invented, no auth bypass was used, and no original profile was modified. The
finite harness still exercises the actual lens/export/materialization
consumers, but it is not a claim of authenticated UI acceptance.

## Verification

Final checks on this branch:

```text
npx tsx scripts/fidelity-harness/s8-office.ts
  DOCX, XLSX, PPTX validAfter=true; all Office readbacks passed

npx vitest run src/features/spectra/__tests__/xlsx-w6-04.test.ts src/features/spectra/__tests__/xlsx-run3-materialize-diagnosis.test.ts src/features/spectra/__tests__/xlsx-pptx-lens.test.ts src/features/spectra/__tests__/w7-06-powerpoint-owned-content.test.ts src/features/spectra/__tests__/docx-adapter.test.ts src/features/spectra/__tests__/docx-lens.test.ts src/features/spectra/__tests__/document-native-projection.test.ts src/features/spectra/__tests__/document-commands.test.ts src/features/spectra/__tests__/office-route-projection.test.ts src/features/spectra/__tests__/presentation-io.test.ts src/app/api/spectra/lenses/docx/route.test.ts
  10 test files passed, 1 skipped; 139 tests passed, 1 skipped

npx vitest run src/features/spectra/__tests__/xlsx-w6-04.test.ts
  6 tests passed

npx tsc --noEmit --pretty false
npm run check:capabilities
  Capability IR ghost gate passed
npm run check:design-tokens
  858 files scanned; 0 warnings
npm run lint
git diff --check
```

## Remaining limits

Advanced Office constructs outside the bounded DOCX equations/images,
XLSX rules/charts, and PPTX chart/notes/link seams remain preserve-only or
explicitly unsupported. ChartEx behavior is validated against the installed
Excel 16 build and the independent SDK version above; this does not establish
broad Office-version parity, Mac compatibility, rendering parity, or live
external-service acceptance. A user-run authenticated acceptance should open a
disposable local PPTX, edit a text box and chart title, reorder two slides,
save through Spectra, and confirm the local native receipt/hash reaches the
completed state without a warning; the original local file should remain a
backup until that check passes.

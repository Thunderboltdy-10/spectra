# XLSX N5 corpus

This directory preserves provenance, expected-behavior metadata and historical
evaluation results for the optional local Office corpus. Binary test packages
are kept locally under `fixtures/office/`; see [the testing guide](../../../TESTING.md).

`representative.xlsm` is authored and saved by Microsoft Excel. It contains typed cells, a recognized `SUM` formula, an unrecognized `XLOOKUP` formula with Excel's cached value, and a harmless `SpectraN5Fixture` macro whose only effect would be writing `macro-ran` to `Z1`. The macro is never executed during the harness or manual acceptance pass. A small opaque custom XML part is added after Excel creation and was verified to open without repair.

The harness mutates only ordinary cell content, scans the worksheet XML to ensure formulas remain formulas, and asserts that the real Office-authored `vbaProject.bin` and opaque custom part remain byte-identical. The previous six-byte synthetic VBA fixture was rejected because Excel correctly repaired it by removing the invalid VBA part. The generated performance case contains 200,000 cells.

Additional Microsoft Open XML SDK corpus files provide feature-level preservation coverage:

- `complex-preservation.xlsx`: chart, table, SmartArt/diagram, image, comments and calculated content.
- `comments-preservation.xlsx`: comments/notes plus their VML drawing.
- `active-x-preservation.xlsm`: ActiveX controls, drawings, charts and binary control payloads.

Each supported fixture is opened through the XLSX lens, receives one unrelated cell edit, and must retain its named native parts structurally identical. The available Open XML pivot fixture is Strict-conformance XML that the selected engine correctly rejects instead of risking a rewrite, so pivot preservation remains unpromoted. Its sidecar now records that the package contains pivot parts and that the engine rejects it; that is a verified claim, not a round-trip. Data validation, conditional-format variants, external links, sparklines and shared-formula stress likewise remain deliberately unpromoted until a compatible real fixture and assertion are added; the lens does not claim those as editable capability.

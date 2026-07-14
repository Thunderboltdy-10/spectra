# Dataset artifact plan

## Why this is an artifact

A dataset deserves first-class identity because code/visualizations, experiments, surveys, school analysis, and AI need a shared structured source with schema, provenance, permissions, range collaboration, transformations, versions, and reproducibility. Treating it as a file attachment would hide column semantics and make every visualization copy data. It inherits the artifact standard.

## Data model and product

Artifact content stores schema/columns, types/units/null rules, primary/candidate keys, row ordering/view metadata, validation constraints, data-source provenance, transformation graph, calculated fields, charts/previews, and import/export settings. Data chunks live columnar/content-addressed outside the core metadata; small datasets may use transactional rows. Stable row/column/cell/range IDs support comments and operations.

Views include grid, schema/profile, filter/sort/group, transformation history, chart preview, details/comments/history, card and bounded embed. Support CSV/TSV/JSON/Parquet import/export in phases, clipboard paste, locale/date/number detection with confirmation, and fidelity/error reports. Formula/expression language is sandboxed and versioned.

Collaboration uses range-aware edits and transactional schema changes; large data does not use one CRDT document. Presence indicates selected range/view. Concurrent same-cell/schema edits require compare; append on distinct rows can merge. History uses chunk deduplication, manifests, and transformation lineage; partial restore can restore column/range only with impact preview.

AI can profile, clean, reshape, join permitted datasets, explain anomalies, generate formulas/charts, and connect a code visualization. Operations are typed transformation nodes with preview row counts/schema diff and reversible lineage. AI must identify statistical uncertainty, avoid inventing values, and require approval for destructive transforms or sharing sensitive columns.

## Privacy, scale, failures

Column classifications and row-level policies may make a dataset unsuitable for ordinary artifact sharing. Initial release should not store raw private student analytics imported from ManageBac. Apply permission before query/export/AI; redact previews and aggregates. Enforce row/byte/compute limits and asynchronous import/profiling.

Handle malformed encodings, schema drift, duplicate keys, huge files, formula errors, partial upload, source revocation, transform failure, and unavailable historical chunks. No current artifact migration is required; imported legacy files enter review.

## Tasks

### DATA-01 Define schema, chunks, rows/columns, classifications, provenance, transforms, formulas, and chart metadata

- [ ] Implemented
- [ ] Verified

### DATA-02 Build grid/schema/profile/transform/chart/card/embed/history with virtualization and responsive review

- [ ] Implemented
- [ ] Verified

### DATA-03 Implement async CSV/TSV/JSON/Parquet import/export, detection, quarantine, and fidelity reports

- [ ] Implemented
- [ ] Verified

### DATA-04 Implement range collaboration, transactional schema edits, comments, presence, conflict, and versions

- [ ] Implemented
- [ ] Verified

### DATA-05 Implement typed AI profile/clean/join/formula/chart operations with previews and lineage

- [ ] Implemented
- [ ] Verified

### DATA-06 Implement column/row policy, redaction, sensitive-export approval, quotas, and compute isolation

- [ ] Implemented
- [ ] Verified

### DATA-07 Prove large-data performance, reproducibility, privacy, import failure, partial restore, and source revocation

- [ ] Implemented
- [ ] Verified

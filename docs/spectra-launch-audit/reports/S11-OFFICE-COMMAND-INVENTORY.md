# S11 Office command inventory

Generated from the actual bindings at product HEAD d9aabfb5. This is a complete enumeration of the default registered Office command/control sets, including context-disabled commands. It is not proof that the advertised behavior works. See S11-OFFICE-REVIEW.md for independently checked import/export mappings and defects. Dynamic document/source/style values depend on the open artifact; fixed choices and numeric ranges are listed below. Stub handlers supply state only; they do not execute any UI or writer.

Region names map to the format-specific coverage families in the review. A blank region is no declaration, not evidence of a read-only action. A declared native refusal can be stale; notably PPTX order/group/crop and XLSX create-feature gates need reconciliation with the actual writers.

## document: 113 commands

| Command | Control / fixed choices | Declared native regions | Linked restriction | AI manifest operations |
| --- | --- | --- | --- | --- |
| document.history.undo | Undo: button |  | No static refusal; target/region gates still apply |  |
| document.history.redo | Redo: button |  | No static refusal; target/region gates still apply |  |
| document.navigate.find | Find: button |  | No static refusal; target/region gates still apply |  |
| document.navigate.replace | Replace: button |  | No static refusal; target/region gates still apply |  |
| document.navigate.outline | Outline: button |  | No static refusal; target/region gates still apply | inspect_outline |
| document.review.comments | Comments: button |  | No static refusal; target/region gates still apply |  |
| document.format.style | Style: select (paragraph, h1, h2, h3, quote, code) | styles | No static refusal; target/region gates still apply | format_blocks |
| document.format.fontFamily | Font: select (Inter, ui-sans-serif, system-ui, sans-serif, Aptos, Calibri, Inter, sans-serif, Calibri, Carlito, Inter, sans-serif, Arial, Helvetica, sans-serif, Helvetica Neue, Helvetica, Arial, sans-serif, Verdana, Geneva, sans-serif, Tahoma, Verdana, sans-serif, Georgia, Cambria, serif, Cambria, Caladea, Georgia, serif, Times New Roman, Liberation Serif, Times, serif, Garamond, EB Garamond, Georgia, serif, Courier New, Courier, monospace, JetBrains Mono, ui-monospace, SFMono-Regular, monospace) | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.fontSize | Size: numeric (presets 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96) [4..400; step 1] | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.bold | Bold: toggle | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.italic | Italic: toggle | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.underline | Underline: toggle | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.strike | Strikethrough: toggle | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.color | Text colour: color | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.highlight | Highlight: color | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.align | Alignment: segmented (left, center, right, justify) | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.lineSpacing | Line spacing: menu (1, 1.15, 1.5, 2) | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.list.bullet | Bulleted list: toggle | lists | Spectra preserves list numbering in this file but cannot edit it yet. Open the original file in its native app to make this change. | format_blocks |
| document.format.list.numbered | Numbered list: toggle | lists | Spectra preserves list numbering in this file but cannot edit it yet. Open the original file in its native app to make this change. | format_blocks |
| document.format.indent.increase | Increase indent: button | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.indent.decrease | Decrease indent: button | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.clear | Clear formatting: button | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.paragraphSpacing | Paragraph spacing: numeric (presets 0, 4, 6, 8, 12, 18, 24) [0..96; step 2] | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.border | Borders: menu (none, all, top, bottom, left) | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.shading | Shading: color | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.quote | Quotation: toggle | styles | No static refusal; target/region gates still apply | format_blocks |
| document.format.code.inline | Inline code: toggle | body | No static refusal; target/region gates still apply | format_blocks |
| document.format.code.block | Code block: toggle | styles | No static refusal; target/region gates still apply | format_blocks |
| document.format.list.demote | Nest list item: button | lists | Spectra preserves list numbering in this file but cannot edit it yet. Open the original file in its native app to make this change. | format_blocks |
| document.format.list.promote | Lift list item: button | lists | Spectra preserves list numbering in this file but cannot edit it yet. Open the original file in its native app to make this change. | format_blocks |
| document.format.block.moveUp | Move up: button | body | No static refusal; target/region gates still apply | move_blocks |
| document.format.block.moveDown | Move down: button | body | No static refusal; target/region gates still apply | move_blocks |
| document.format.namedStyle.apply | Named style: select (paragraph, h1, h2, h3, quote, code) | styles | No static refusal; target/region gates still apply | format_blocks |
| document.format.namedStyle.create | Save as named style: button | styles | Spectra applies existing Word styles but cannot add a new style definition to the linked file. Create the style in Word. |  |
| document.review.spellcheck | Spell check: toggle |  | No static refusal; target/region gates still apply |  |
| document.insert.table | Table: button | tableStructure | Spectra edits safe text inside a linked Word table but preserves its rows, columns, merges, and formatting. Reshape the table in Word. | create_table |
| document.insert.image | Image: button | images | No static refusal; target/region gates still apply |  |
| document.insert.link | Link: toggle | hyperlinks | Spectra preserves hyperlinks in a linked Word file but cannot add, change, or remove them. Make this change in Word. |  |
| document.insert.link.remove | Remove link: button | hyperlinks | Spectra preserves hyperlinks in a linked Word file but cannot add, change, or remove them. Make this change in Word. |  |
| document.insert.equation | Equation: button | equations | No static refusal; target/region gates still apply | insert_equation |
| document.insert.equation.inline | Inline equation: button | equations | No static refusal; target/region gates still apply | insert_equation |
| document.insert.pageBreak | Page break: button | body | No static refusal; target/region gates still apply | insert_blocks |
| document.insert.sectionBreak | Section break: button | sections | Set basic Word section page size, orientation, margins, and column count in Spectra. To add a section break or change advanced section layout, use Word. | insert_blocks |
| document.insert.divider | Divider: button | body | No static refusal; target/region gates still apply | insert_blocks |
| document.insert.taskList | Task list: toggle | lists | No static refusal; target/region gates still apply | insert_blocks |
| document.insert.callout.info | Info callout: button | body | No static refusal; target/region gates still apply | insert_callout |
| document.insert.callout.warning | Warning callout: button | body | No static refusal; target/region gates still apply | insert_callout |
| document.insert.callout.tip | Tip callout: button | body | No static refusal; target/region gates still apply | insert_callout |
| document.insert.reference | Reference a work: button |  | A live Spectra reference has no Word representation. Unlink the file before inserting it, or add a normal link in Word. | add_embed |
| document.insert.citation | Citation: button | body | No static refusal; target/region gates still apply | add_citation |
| document.insert.footnote | Footnote: button | footnotes | No static refusal; target/region gates still apply | insert_blocks |
| document.insert.endnote | Endnote: button | footnotes | No static refusal; target/region gates still apply | insert_blocks |
| document.insert.caption | Caption: button | body | No static refusal; target/region gates still apply | insert_blocks |
| document.insert.toc | Table of contents: button | fields | Spectra preserves Word fields but cannot insert, update, or recalculate them. Make this change in Word. | insert_blocks |
| document.layout.pageSize | Page size: select (a4, letter, legal, a5) | sections | No static refusal; target/region gates still apply |  |
| document.layout.orientation | Orientation: segmented (portrait, landscape) | sections | No static refusal; target/region gates still apply |  |
| document.layout.margins | Margins: menu (narrow, normal, wide) | sections | No static refusal; target/region gates still apply |  |
| document.layout.columns | Columns: segmented (1, 2, 3) | sections | No static refusal; target/region gates still apply |  |
| document.layout.header | Header: button | headersFooters | No static refusal; target/region gates still apply |  |
| document.layout.footer | Footer: button | headersFooters | No static refusal; target/region gates still apply |  |
| document.layout.pageCanvas | Page canvas: toggle |  | No static refusal; target/region gates still apply |  |
| document.layout.focus | Focus: toggle |  | No static refusal; target/region gates still apply |  |
| document.layout.previewReader | Preview as reader: button |  | No static refusal; target/region gates still apply |  |
| document.layout.template.notes | Study notes: button |  | A template replaces the whole document, so it cannot run on a linked Word file. Import a separate copy first. | apply_template |
| document.layout.template.essay | Essay: button |  | A template replaces the whole document, so it cannot run on a linked Word file. Import a separate copy first. | apply_template |
| document.layout.template.lab | Lab report: button |  | A template replaces the whole document, so it cannot run on a linked Word file. Import a separate copy first. | apply_template |
| document.notes.edit | Edit note: button | footnotes | No static refusal; target/region gates still apply |  |
| document.notes.move | Move note reference: button | footnotes | No static refusal; target/region gates still apply |  |
| document.notes.delete | Delete note: button | footnotes | No static refusal; target/region gates still apply |  |
| document.review.comment.edit | Edit Word comment: button | comments | No static refusal; target/region gates still apply |  |
| document.references.citation.edit | Edit Word citation: button | body | No static refusal; target/region gates still apply |  |
| document.references.citation.remove | Remove Word citation: button | body | No static refusal; target/region gates still apply |  |
| document.review.comment.add | Comment in Word: button | comments | No static refusal; target/region gates still apply |  |
| document.review.trackChanges.propose | Propose text edit: button | trackedChanges | No static refusal; target/region gates still apply |  |
| document.review.trackChanges.acceptOne | Accept selected revision: button | trackedChanges | No static refusal; target/region gates still apply |  |
| document.review.trackChanges.rejectOne | Reject selected revision: button | trackedChanges | No static refusal; target/region gates still apply |  |
| document.review.comment.delete | Delete Word comment: button | comments | No static refusal; target/region gates still apply |  |
| document.references.sources | Sources: button |  | No static refusal; target/region gates still apply | check_sources |
| document.references.bibliography | Insert references: button | body | No static refusal; target/region gates still apply | insert_blocks |
| document.references.citationStyle | Citation style: select (numeric, author_date) | body | No static refusal; target/region gates still apply |  |
| document.references.source.add | Add a source: button | body | No static refusal; target/region gates still apply |  |
| document.references.crossRef | Cross-reference: button | hyperlinks | Spectra preserves hyperlinks in a linked Word file but cannot add, change, or remove them. Make this change in Word. | insert_blocks |
| document.review.trackChanges.show | Tracked changes: button |  | No static refusal; target/region gates still apply |  |
| document.review.trackChanges.accept | Accept revisions: button |  | Spectra preserves Word revision marks exactly but cannot resolve them safely. Accept or reject the changes in Word. |  |
| document.review.trackChanges.reject | Reject revisions: button |  | Spectra preserves Word revision marks exactly but cannot resolve them safely. Accept or reject the changes in Word. |  |
| document.review.updateFields | Update fields: button | fields | Spectra preserves Word fields but cannot insert, update, or recalculate them. Make this change in Word. |  |
| document.table.row.after | Row below: button | tableStructure | No static refusal; target/region gates still apply |  |
| document.table.column.after | Column right: button | tableStructure | No static refusal; target/region gates still apply |  |
| document.table.row.before | Row above: button | tableStructure | No static refusal; target/region gates still apply |  |
| document.table.column.before | Column left: button | tableStructure | No static refusal; target/region gates still apply |  |
| document.table.merge | Merge cells: button | tableStructure | Spectra edits safe text inside a linked Word table but preserves its rows, columns, merges, and formatting. Reshape the table in Word. |  |
| document.table.split | Split cell: button | tableStructure | Spectra edits safe text inside a linked Word table but preserves its rows, columns, merges, and formatting. Reshape the table in Word. |  |
| document.table.headerRow | Header row: toggle | tableStructure | Spectra edits safe text inside a linked Word table but preserves its rows, columns, merges, and formatting. Reshape the table in Word. |  |
| document.table.row.delete | Delete row: button | tableStructure | No static refusal; target/region gates still apply |  |
| document.table.column.delete | Delete column: button | tableStructure | No static refusal; target/region gates still apply |  |
| document.table.delete | Delete table: button | tableStructure | Spectra edits safe text inside a linked Word table but preserves its rows, columns, merges, and formatting. Reshape the table in Word. |  |
| document.image.wrap | Text wrapping: select (inline, left, right, break) | images | Set, add, replace, or remove supported PNG/JPEG pictures natively in Spectra, including durable asset bytes, alternative text, dimensions, and crop; change text wrapping in Word. |  |
| document.image.width | Width: numeric (presets 25, 33, 50, 66, 75, 100) [10..100; step 5] | images | No static refusal; target/region gates still apply |  |
| document.image.alt | Alternative text: button | images | No static refusal; target/region gates still apply |  |
| document.image.replace | Replace picture: button | images | No static refusal; target/region gates still apply |  |
| document.image.caption | Add caption: button | body | No static refusal; target/region gates still apply |  |
| document.image.remove | Delete image: button | images | No static refusal; target/region gates still apply |  |
| document.equation.edit | Edit equation: button | equations | No static refusal; target/region gates still apply |  |
| document.equation.display | Placement: segmented (inline, block) | equations | No static refusal; target/region gates still apply |  |
| document.equation.align | Alignment: segmented (left, center, right) | equations | No static refusal; target/region gates still apply |  |
| document.equation.remove | Delete equation: button | equations | No static refusal; target/region gates still apply |  |
| document.export.docx | Export Word copy: button |  | No static refusal; target/region gates still apply | prepare_export |
| document.export.pdf | Export PDF copy: button |  | No static refusal; target/region gates still apply | prepare_export |
| document.export.md | Export Markdown copy: button |  | No static refusal; target/region gates still apply | prepare_export |
| document.export.html | Export HTML copy: button |  | No static refusal; target/region gates still apply | prepare_export |
| document.export.txt | Export text copy: button |  | No static refusal; target/region gates still apply | prepare_export |
| document.import.copy | Import a copy: button |  | Import a copy from the Library so the linked file is not replaced. |  |
| document.export.print | Print: button |  | No static refusal; target/region gates still apply |  |

## sheets: 110 commands

| Command | Control / fixed choices | Declared native regions | Linked restriction | AI manifest operations |
| --- | --- | --- | --- | --- |
| sheets.history.undo | Undo: button |  | No static refusal; target/region gates still apply |  |
| sheets.history.redo | Redo: button |  | No static refusal; target/region gates still apply |  |
| sheets.navigate.find | Find: button |  | No static refusal; target/region gates still apply |  |
| sheets.navigate.replace | Replace: button |  | No static refusal; target/region gates still apply |  |
| sheets.format | Format: button |  | No static refusal; target/region gates still apply | format_range |
| sheets.formula.bar | Formula: button | formulas | No static refusal; target/region gates still apply | set_formula |
| sheets.freeze.rows | Freeze rows: toggle | freezePanes | No static refusal; target/region gates still apply |  |
| sheets.chart.insert | Insert chart: button | charts | No static refusal; target/region gates still apply | create_chart |
| sheets.clipboard.copy | Copy: button |  | No static refusal; target/region gates still apply |  |
| sheets.clipboard.cut | Cut: button | cells | No static refusal; target/region gates still apply | clear_range |
| sheets.clipboard.paste | Paste: button | cells | No static refusal; target/region gates still apply | set_cells |
| sheets.clipboard.pasteSpecial | Paste special: menu (all, values, formulas, formats, transpose) | cells | No static refusal; target/region gates still apply | set_cells |
| sheets.clear.all | Clear: button | cells | No static refusal; target/region gates still apply | clear_range |
| sheets.clear.values | Clear contents: button | cells | No static refusal; target/region gates still apply | clear_range |
| sheets.clear.formats | Clear formatting: button | styles | No static refusal; target/region gates still apply | format_range |
| sheets.fill.down | Fill down: button | cells | No static refusal; target/region gates still apply | fill_range |
| sheets.fill.right | Fill right: button | cells | No static refusal; target/region gates still apply | fill_range |
| sheets.fill.series | Fill series: menu (copy, linear, growth, weekday, month) | cells | No static refusal; target/region gates still apply | fill_range |
| sheets.format.fontFamily | Font: select (Inter, ui-sans-serif, system-ui, sans-serif, Aptos, Calibri, Inter, sans-serif, Calibri, Carlito, Inter, sans-serif, Arial, Helvetica, sans-serif, Helvetica Neue, Helvetica, Arial, sans-serif, Verdana, Geneva, sans-serif, Tahoma, Verdana, sans-serif, Georgia, Cambria, serif, Cambria, Caladea, Georgia, serif, Times New Roman, Liberation Serif, Times, serif, Garamond, EB Garamond, Georgia, serif, Courier New, Courier, monospace, JetBrains Mono, ui-monospace, SFMono-Regular, monospace) | styles, numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.fontSize | Size: numeric (presets 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96) [4..400; step 1] | styles, numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.bold | Bold: toggle | styles, numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.italic | Italic: toggle | styles, numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.underline | Underline: toggle | styles, numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.strike | Strikethrough: toggle | styles, numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.color | Text colour: color | styles, numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.align | Alignment: segmented (left, center, right, justify) | styles, numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.clear | Clear formatting: button | styles, numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.number | Number format: select (general, number, currency, accounting, percent, fraction, scientific, date, time, text, custom) | numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.number.custom | Custom format code: button | numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.currency | Currency: select (USD, EUR, GBP, JPY, AUD, CAD, INR) | numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.decimals | Decimals: numeric (presets 0, 1, 2, 3, 4) [0..10; step 1] | numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.thousands | Thousands separator: toggle | numberFormats | No static refusal; target/region gates still apply | format_range |
| sheets.format.borders | Borders: menu (all, outline, inside, top, bottom, left, right, thick-outline, double-bottom, none) | styles | No static refusal; target/region gates still apply | format_range |
| sheets.format.borders.style | Border line: select (thin, medium, thick, dashed, dotted, double, hair) | styles | No static refusal; target/region gates still apply | format_range |
| sheets.format.borders.color | Border colour: color | styles | No static refusal; target/region gates still apply | format_range |
| sheets.format.fill | Fill colour: color | styles | No static refusal; target/region gates still apply | format_range |
| sheets.format.wrap | Wrap text: toggle | styles | No static refusal; target/region gates still apply | format_range |
| sheets.format.valign | Vertical alignment: segmented (top, middle, bottom) | styles | No static refusal; target/region gates still apply | format_range |
| sheets.format.rotation | Text angle: numeric (presets -90, -45, 0, 45, 90) [-90..90; step 15] | styles | No static refusal; target/region gates still apply | format_range |
| sheets.format.indent.increase | Increase indent: button | styles | No static refusal; target/region gates still apply | format_range |
| sheets.format.indent.decrease | Decrease indent: button | styles | No static refusal; target/region gates still apply | format_range |
| sheets.format.merge | Merge cells: button | merges | No static refusal; target/region gates still apply | format_range |
| sheets.format.unmerge | Unmerge cells: button | merges | No static refusal; target/region gates still apply | format_range |
| sheets.format.copyStyle | Copy formatting: button |  | No static refusal; target/region gates still apply |  |
| sheets.format.pasteStyle | Apply formatting: button | styles | No static refusal; target/region gates still apply | format_range |
| sheets.insert.row | Insert row: button | sheetStructure | No static refusal; target/region gates still apply | insert_structure |
| sheets.insert.column | Insert column: button | sheetStructure | No static refusal; target/region gates still apply | insert_structure |
| sheets.delete.row | Delete row: button | sheetStructure | No static refusal; target/region gates still apply | insert_structure |
| sheets.delete.column | Delete column: button | sheetStructure | No static refusal; target/region gates still apply | insert_structure |
| sheets.format.column.width | Column width: numeric (presets 64, 96, 128, 180, 240) [24..640; step 8] | dimensions | No static refusal; target/region gates still apply | format_range |
| sheets.format.row.height | Row height: numeric (presets 24, 32, 40, 56, 80) [16..400; step 4] | dimensions | No static refusal; target/region gates still apply | format_range |
| sheets.format.column.autofit | Fit column to text: button | dimensions | No static refusal; target/region gates still apply | format_range |
| sheets.hide.row | Hide rows: button | dimensions | No static refusal; target/region gates still apply | format_range |
| sheets.hide.column | Hide columns: button | dimensions | No static refusal; target/region gates still apply | format_range |
| sheets.unhide.all | Show hidden: button | dimensions | No static refusal; target/region gates still apply | format_range |
| sheets.freeze.columns | Freeze columns: toggle | freezePanes | No static refusal; target/region gates still apply |  |
| sheets.freeze.clear | Unfreeze panes: button | freezePanes | No static refusal; target/region gates still apply |  |
| sheets.view.formulas | Show formulas: toggle |  | No static refusal; target/region gates still apply |  |
| sheets.view.gridlines | Gridlines: toggle |  | No static refusal; target/region gates still apply |  |
| sheets.view.headings | Row and column headers: toggle |  | No static refusal; target/region gates still apply |  |
| sheets.view.zoom.in | Zoom in: button |  | No static refusal; target/region gates still apply |  |
| sheets.view.zoom.out | Zoom out: button |  | No static refusal; target/region gates still apply |  |
| sheets.view.zoom.reset | Reset zoom: button |  | No static refusal; target/region gates still apply |  |
| sheets.sort.asc | Sort A to Z: button | sortFilter | Sorting here would rewrite cell order without updating every preserved Excel object that can reference those cells. Sort the range in Excel. | sort_filter |
| sheets.sort.desc | Sort Z to A: button | sortFilter | Sorting here would rewrite cell order without updating every preserved Excel object that can reference those cells. Sort the range in Excel. | sort_filter |
| sheets.sort.custom | Custom sort: button | sortFilter | Sorting here would rewrite cell order without updating every preserved Excel object that can reference those cells. Sort the range in Excel. | sort_filter |
| sheets.filter.toggle | Filter: button | sortFilter | Spectra preserves Excel AutoFilter state but cannot write its native criteria. Change the filter in Excel. | sort_filter |
| sheets.filter.edit | Filter values: button | sortFilter | Spectra preserves Excel AutoFilter state but cannot write its native criteria. Change the filter in Excel. | sort_filter |
| sheets.table.create | Format as table: button | tables | No static refusal; target/region gates still apply | create_table |
| sheets.table.delete | Remove table: button | tables | No static refusal; target/region gates still apply | delete_table |
| sheets.table.style | Table style: select (plain, striped, accent) | tables | No static refusal; target/region gates still apply | create_table |
| sheets.table.totals | Totals row: toggle | tables | No static refusal; target/region gates still apply | create_table |
| sheets.validation.set | Data validation: button | validation | No static refusal; target/region gates still apply | validate_range |
| sheets.conditional.apply | Conditional formatting: button | conditionalFormat | No static refusal; target/region gates still apply | format_range |
| sheets.data.duplicates | Remove duplicates: button | sortFilter | Removing duplicate rows can shift formulas and preserved Excel objects without a native row operation. Remove duplicates in Excel. | sort_filter |
| sheets.data.splitText | Split text to columns: button | cells | No static refusal; target/region gates still apply | set_cells |
| sheets.analyze.summary | Summarise selection: button |  | No static refusal; target/region gates still apply | analyze |
| sheets.formula.insert | Insert function: menu (SUM, AVERAGE, COUNT, COUNTA, MIN, MAX, ROUND, ABS, IF, IFERROR, SUMIF, SUMIFS, COUNTIF, COUNTIFS, AVERAGEIF, COUNTBLANK, MEDIAN, STDEV, LARGE, SMALL, RANK, SUMPRODUCT, VLOOKUP, HLOOKUP, INDEX, MATCH, XLOOKUP, CONCAT, TEXTJOIN, LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, PROPER, TEXT, TODAY, NOW, DATE, YEAR, MONTH, DAY, WEEKDAY, DAYS) | formulas | No static refusal; target/region gates still apply | set_formula |
| sheets.formula.autosum | AutoSum: button | formulas | No static refusal; target/region gates still apply | set_formula |
| sheets.formula.library | Function library: button |  | No static refusal; target/region gates still apply |  |
| sheets.formula.explain | Explain this formula: button |  | No static refusal; target/region gates still apply | explain_formula |
| sheets.formula.calculate | Recalculate now: button |  | No static refusal; target/region gates still apply |  |
| sheets.formula.calcMode | Calculation: select (automatic, manual) | calculationSettings | No static refusal; target/region gates still apply |  |
| sheets.formula.trace | Highlight references: toggle |  | No static refusal; target/region gates still apply |  |
| sheets.namedRange.create | Name this range: button | namedRanges | No static refusal; target/region gates still apply | create_named_range |
| sheets.namedRange.manage | Named ranges: button |  | No static refusal; target/region gates still apply |  |
| sheets.chart.type | Chart type: select (column, bar, line, area, pie, scatter, combo, histogram) | charts | No static refusal; target/region gates still apply | edit_chart |
| sheets.chart.title | Chart title: button | charts | No static refusal; target/region gates still apply | edit_chart |
| sheets.chart.range | Chart data range: button | charts | No static refusal; target/region gates still apply | edit_chart |
| sheets.chart.legend | Legend: toggle | charts | No static refusal; target/region gates still apply | edit_chart |
| sheets.chart.remove | Delete chart: button | charts | No static refusal; target/region gates still apply | edit_chart |
| sheets.chart.linkToDeck | Send chart to a deck: button | charts | Spectra can edit the native workbook chart, but linking it into a deck is an output action. Add or relink the chart from the presentation surface. | link_output |
| sheets.sheet.new | New sheet: button | sheetStructure | No static refusal; target/region gates still apply | create_sheet |
| sheets.sheet.rename | Rename sheet: button | sheetStructure | No static refusal; target/region gates still apply | rename_sheet |
| sheets.sheet.duplicate | Duplicate sheet: button | sheetStructure | No static refusal; target/region gates still apply | create_sheet |
| sheets.sheet.moveLeft | Move sheet left: button | sheetStructure | No static refusal; target/region gates still apply |  |
| sheets.sheet.moveRight | Move sheet right: button | sheetStructure | No static refusal; target/region gates still apply |  |
| sheets.sheet.hide | Hide sheet: button | sheetStructure | No static refusal; target/region gates still apply |  |
| sheets.sheet.showHidden | Show hidden sheets: button | sheetStructure | No static refusal; target/region gates still apply |  |
| sheets.sheet.delete | Delete sheet: button | sheetStructure | No static refusal; target/region gates still apply |  |
| sheets.sheet.tabColor | Tab colour: color | sheetStructure | No static refusal; target/region gates still apply |  |
| sheets.review.comments | Comments: button |  | No static refusal; target/region gates still apply |  |
| sheets.note.set | Add note: button |  | Spectra preserves Excel cell notes but cannot add or edit them in the linked workbook. Edit the note in Excel. |  |
| sheets.protect.sheet | Protect sheet: toggle |  | Spectra preserves Excel sheet protection but cannot change its native settings. Protect or unprotect the sheet in Excel. |  |
| sheets.review.history | Change history: button |  | No static refusal; target/region gates still apply |  |
| sheets.export.xlsx | Export Excel copy: button |  | No static refusal; target/region gates still apply |  |
| sheets.export.csv | Export CSV copy: button |  | No static refusal; target/region gates still apply |  |
| sheets.export.ods | Export OpenDocument copy: button |  | No static refusal; target/region gates still apply |  |
| sheets.import.copy | Import a copy: button |  | Import a copy from the Library so the linked workbook is not replaced. | import_data |
| sheets.export.print | Print: button |  | No static refusal; target/region gates still apply |  |

## presentation: 120 commands

| Command | Control / fixed choices | Declared native regions | Linked restriction | AI manifest operations |
| --- | --- | --- | --- | --- |
| presentation.history.undo | Undo: button |  | No static refusal; target/region gates still apply |  |
| presentation.history.redo | Redo: button |  | No static refusal; target/region gates still apply |  |
| presentation.slide.add | Add slide: button | slides | No static refusal; target/region gates still apply | add_slide, create_outline |
| presentation.slide.duplicate | Duplicate slide: button | slides | No static refusal; target/region gates still apply |  |
| presentation.design.open | Design: button |  | No static refusal; target/region gates still apply |  |
| presentation.present.start | Present: button |  | No static refusal; target/region gates still apply | prepare_presenter_output |
| presentation.navigate.find | Find: button |  | No static refusal; target/region gates still apply |  |
| presentation.view.zoom.in | Zoom in: button |  | No static refusal; target/region gates still apply |  |
| presentation.view.zoom.out | Zoom out: button |  | No static refusal; target/region gates still apply |  |
| presentation.view.zoom.reset | Reset zoom: button |  | No static refusal; target/region gates still apply |  |
| presentation.view.zoom.fit | Fit the slide: button |  | No static refusal; target/region gates still apply |  |
| presentation.review.comments | Comments: button |  | No static refusal; target/region gates still apply |  |
| presentation.slide.moveEarlier | Move slide earlier: button | slides | No static refusal; target/region gates still apply |  |
| presentation.slide.moveLater | Move slide later: button | slides | No static refusal; target/region gates still apply |  |
| presentation.slide.hide | Hide this slide: toggle | slides | No static refusal; target/region gates still apply |  |
| presentation.slide.delete | Delete slide: button | slides | No static refusal; target/region gates still apply |  |
| presentation.slide.setTitle | Slide title: button | slides | No static refusal; target/region gates still apply |  |
| presentation.insert.textBox | Text box: button | shapes | No static refusal; target/region gates still apply | create_object |
| presentation.insert.placeholderText | Fill the empty placeholder: button | shapes | No static refusal; target/region gates still apply | rewrite_object |
| presentation.insert.shape | Shape: menu (rounded-rectangle, rectangle, ellipse, pill, triangle, diamond, chevron, arrow-right, callout, line) | shapes | Spectra writes basic text boxes into a linked deck but not other PowerPoint shape types. Add this shape in PowerPoint. | create_object |
| presentation.insert.image | Image: button | media | Spectra preserves linked PowerPoint media but cannot add a new picture, audio clip, or video to the file. Add the media in PowerPoint. | create_object |
| presentation.insert.video | Video: button | media | Spectra preserves linked PowerPoint media but cannot add a new picture, audio clip, or video to the file. Add the media in PowerPoint. |  |
| presentation.insert.chart | Chart: button | charts | Spectra preserves PowerPoint charts with their data but cannot create a new native chart. Add the chart in PowerPoint. | generate_chart |
| presentation.insert.table | Table: button | tables | Spectra preserves PowerPoint tables but cannot create a new native table. Add the table in PowerPoint. |  |
| presentation.insert.embed | Linked work: button |  | A live Spectra reference has no PowerPoint representation. Unlink the deck before inserting it, or add a normal link in PowerPoint. |  |
| presentation.insert.equation | Equation: button | shapes | Spectra preserves equations already in a PowerPoint file but cannot author a new equation shape. Add it in PowerPoint. |  |
| presentation.insert.component | Reusable component: menu |  | A reusable Spectra component has no native PowerPoint representation. Unlink the deck before inserting it, or recreate the content in PowerPoint. |  |
| presentation.design.applyLayout | Layout: select (title-content, title-only, two-column, title-visual-text, visual-story, three-ideas, statement, full-bleed, blank) | layouts | This file gets layouts from its PowerPoint masters, which Spectra preserves but cannot reassign. Choose the layout in PowerPoint. | apply_layout |
| presentation.design.resetPlaceholders | Reset placeholders: button | layouts | This file gets layouts from its PowerPoint masters, which Spectra preserves but cannot reassign. Choose the layout in PowerPoint. |  |
| presentation.design.applyTheme | Theme: select (spectra-botanical) | slides | No static refusal; target/region gates still apply | apply_theme |
| presentation.design.background | Slide background: color |  | Spectra preserves slide background fills but cannot write them into the linked file. Change the background in PowerPoint. |  |
| presentation.design.slideSize | Slide size: segmented (16:9, 4:3) |  | The linked file keeps the slide size it was saved with because resizing would rewrite every layout and master. Change the slide size in PowerPoint. |  |
| presentation.design.slideNumbers | Slide numbers: toggle |  | Spectra preserves PowerPoint slide-number placeholders but cannot add or remove them in a linked deck. Change slide numbers in PowerPoint. |  |
| presentation.slide.section | Section: select (, __new__) |  | Spectra preserves the linked deck's PowerPoint sections but cannot rewrite their native list. Add, rename, or move sections in PowerPoint. |  |
| presentation.design.saveComponent | Save as component: button |  | A reusable Spectra component has no native PowerPoint representation. Unlink the deck before inserting it, or recreate the content in PowerPoint. |  |
| presentation.design.audit | Check this deck: button |  | No static refusal; target/region gates still apply | inspect_deck, plan_narrative, check_overflow, check_contrast, check_reading_order, check_source_coverage |
| presentation.sources.open | Sources: button |  | No static refusal; target/region gates still apply |  |
| presentation.sources.addCitation | Add citation: button |  | PowerPoint has no matching object for a Spectra citation. Unlink the deck first, or add the citation as ordinary slide text in PowerPoint. |  |
| presentation.sources.buildBibliography | Build references slide: button |  | PowerPoint has no matching object for a Spectra citation. Unlink the deck first, or add the citation as ordinary slide text in PowerPoint. | build_bibliography |
| presentation.arrange.align | Align: menu (left, center, right, top, middle, bottom) | shapes | Spectra can move one native PowerPoint shape precisely, but multi-object alignment needs every selected shape to have a stable native identity. Align or distribute this selection in PowerPoint. | move_object |
| presentation.arrange.distribute | Distribute: menu (distribute-x, distribute-y) | shapes | Spectra can move one native PowerPoint shape precisely, but multi-object alignment needs every selected shape to have a stable native identity. Align or distribute this selection in PowerPoint. | move_object |
| presentation.arrange.group | Group: button | shapes | No static refusal; target/region gates still apply |  |
| presentation.arrange.ungroup | Ungroup: button | shapes | Spectra preserves existing PowerPoint groups but cannot create or break apart native shape groups. Group or ungroup the shapes in PowerPoint. |  |
| presentation.arrange.bringForward | Bring forward: button | shapes | Spectra preserves the linked slide's native shape tree and cannot rewrite stacking order safely. Reorder the shape in PowerPoint. |  |
| presentation.arrange.sendBackward | Send backward: button | shapes | Spectra preserves the linked slide's native shape tree and cannot rewrite stacking order safely. Reorder the shape in PowerPoint. |  |
| presentation.arrange.bringToFront | Bring to front: button | shapes | Spectra preserves the linked slide's native shape tree and cannot rewrite stacking order safely. Reorder the shape in PowerPoint. |  |
| presentation.arrange.sendToBack | Send to back: button | shapes | Spectra preserves the linked slide's native shape tree and cannot rewrite stacking order safely. Reorder the shape in PowerPoint. |  |
| presentation.accessibility.readingOrder | Reading order: button |  | No static refusal; target/region gates still apply | check_reading_order |
| presentation.stage.snap | Snap to objects: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.stage.guides | Guides: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.stage.grid | Grid: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.animate.transition | Transition: select (none, fade, push, dissolve) | transitions | Spectra preserves PowerPoint transitions but cannot change them in the linked deck. Change the transition in PowerPoint. |  |
| presentation.animate.transitionDuration | Transition length: numeric (presets 200, 350, 500, 720, 1000) [0..4000; step 50] | transitions | Spectra preserves PowerPoint transitions but cannot change them in the linked deck. Change the transition in PowerPoint. |  |
| presentation.animate.transitionApplyAll | Apply transition to every slide: button | transitions | Spectra preserves PowerPoint transitions but cannot change them in the linked deck. Change the transition in PowerPoint. |  |
| presentation.animate.defaultTransition | New slide transition: select (none, fade, push, dissolve) | transitions | Spectra preserves PowerPoint transitions but cannot change them in the linked deck. Change the transition in PowerPoint. |  |
| presentation.animate.autoAdvance | Auto-advance: numeric (presets 0, 15, 30, 45, 60) [0..3600; step 5] |  | Spectra preserves PowerPoint slide timing but cannot write auto-advance timing into a linked deck. Set the advance timing in PowerPoint. |  |
| presentation.animate.object | Object animation: select (none, fade, rise, scale, wipe) | animations | Spectra preserves PowerPoint animation timing exactly but cannot author timing entries. Change the animation in PowerPoint. |  |
| presentation.animate.objectDuration | Animation length: numeric (presets 200, 350, 450, 700, 1000) [0..10000; step 50] | animations | Spectra preserves PowerPoint animation timing exactly but cannot author timing entries. Change the animation in PowerPoint. |  |
| presentation.animate.objectDelay | Animation delay: numeric (presets 0, 150, 300, 600, 1000) [0..30000; step 50] | animations | Spectra preserves PowerPoint animation timing exactly but cannot author timing entries. Change the animation in PowerPoint. |  |
| presentation.present.rehearse | Rehearse timings: button |  | No static refusal; target/region gates still apply | prepare_presenter_output |
| presentation.present.stop | Stop presenting: button |  | No static refusal; target/region gates still apply |  |
| presentation.view.notesPage | Speaker notes page: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.notes.panel | Notes for this slide: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.notes.set | Speaker notes: button | speakerNotes | No static refusal; target/region gates still apply | write_speaker_notes |
| presentation.present.layout | Presenter view: segmented (audience, speaker) |  | No static refusal; target/region gates still apply |  |
| presentation.present.toggleNotes | Presenter notes: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.present.blackout | Black the screen: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.present.pointer | Pointer: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.present.next | Next slide: button |  | No static refusal; target/region gates still apply |  |
| presentation.present.previous | Previous slide: button |  | No static refusal; target/region gates still apply |  |
| presentation.format.fontFamily | Font: select (Inter, ui-sans-serif, system-ui, sans-serif, Aptos, Calibri, Inter, sans-serif, Calibri, Carlito, Inter, sans-serif, Arial, Helvetica, sans-serif, Helvetica Neue, Helvetica, Arial, sans-serif, Verdana, Geneva, sans-serif, Tahoma, Verdana, sans-serif, Georgia, Cambria, serif, Cambria, Caladea, Georgia, serif, Times New Roman, Liberation Serif, Times, serif, Garamond, EB Garamond, Georgia, serif, Courier New, Courier, monospace, JetBrains Mono, ui-monospace, SFMono-Regular, monospace) | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.fontSize | Size: numeric (presets 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96) [4..400; step 1] | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.bold | Bold: toggle | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.italic | Italic: toggle | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.underline | Underline: toggle | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.strike | Strikethrough: toggle | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.color | Text colour: color | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.align | Alignment: segmented (left, center, right, justify) | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.lineSpacing | Line spacing: menu (1, 1.15, 1.5, 2) | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.list.bullet | Bulleted list: toggle | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.list.numbered | Numbered list: toggle | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.clear | Clear formatting: button | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.textPreset | Text style: select (title, subtitle, body, caption) | shapes | No static refusal; target/region gates still apply |  |
| presentation.object.setText | Object text: button | shapes | No static refusal; target/region gates still apply | rewrite_object |
| presentation.object.setLink | Object link: button | hyperlinks | No static refusal; target/region gates still apply | rewrite_object |
| presentation.object.removeLink | Remove object link: button | hyperlinks | No static refusal; target/region gates still apply | rewrite_object |
| presentation.format.fill | Fill: color | shapes | No static refusal; target/region gates still apply |  |
| presentation.format.border | Border: color | shapes | Spectra preserves PowerPoint shape fills, lines, and effects but cannot rewrite them. Restyle the shape in PowerPoint. |  |
| presentation.format.borderWidth | Border width: numeric (presets 0, 1, 2, 3, 4, 6) [0..24; step 1] | shapes | Spectra preserves PowerPoint shape fills, lines, and effects but cannot rewrite them. Restyle the shape in PowerPoint. |  |
| presentation.format.cornerRadius | Corner radius: numeric (presets 0, 8, 16, 24, 48) [0..120; step 2] | shapes | Spectra preserves PowerPoint shape fills, lines, and effects but cannot rewrite them. Restyle the shape in PowerPoint. |  |
| presentation.format.opacity | Opacity: numeric (presets 25, 50, 75, 100) [10..100; step 5] | shapes | Spectra preserves PowerPoint shape fills, lines, and effects but cannot rewrite them. Restyle the shape in PowerPoint. |  |
| presentation.format.shadow | Soft shadow: toggle | shapes | Spectra preserves PowerPoint shape fills, lines, and effects but cannot rewrite them. Restyle the shape in PowerPoint. |  |
| presentation.arrange.geometry.x | X: numeric [-500..1500; step 5] | shapes | No static refusal; target/region gates still apply | move_object |
| presentation.arrange.geometry.y | Y: numeric [-500..1500; step 5] | shapes | No static refusal; target/region gates still apply |  |
| presentation.arrange.geometry.width | Width: numeric [10..1000; step 5] | shapes | No static refusal; target/region gates still apply | resize_object |
| presentation.arrange.geometry.height | Height: numeric [10..1000; step 5] | shapes | No static refusal; target/region gates still apply |  |
| presentation.arrange.geometry.rotation | Rotation: numeric [-360..360; step 5] | shapes | No static refusal; target/region gates still apply |  |
| presentation.arrange.lock | Lock object: toggle | shapes | Spectra preserves a PowerPoint shape's lock and visibility settings but cannot rewrite them. Lock, unlock, hide, or show the shape in PowerPoint. |  |
| presentation.arrange.hideObject | Hide while presenting: toggle | shapes | No static refusal; target/region gates still apply |  |
| presentation.arrange.delete | Delete object: button | shapes | No static refusal; target/region gates still apply |  |
| presentation.image.fit | Image fit: segmented (contain, cover) | media | Spectra preserves the linked picture's native crop but cannot change it safely. Crop the picture in PowerPoint. |  |
| presentation.image.mask | Image shape: menu (none, rounded, circle) | media | Spectra preserves the linked picture's native crop but cannot change it safely. Crop the picture in PowerPoint. |  |
| presentation.image.cropX | Crop across: numeric (presets 0, 25, 50, 75, 100) [0..100; step 5] | media | No static refusal; target/region gates still apply |  |
| presentation.image.cropY | Crop down: numeric (presets 0, 25, 50, 75, 100) [0..100; step 5] | media | Spectra preserves the linked picture's native crop but cannot change it safely. Crop the picture in PowerPoint. |  |
| presentation.image.replace | Replace picture: button | media | Spectra preserves linked PowerPoint media but cannot add a new picture, audio clip, or video to the file. Add the media in PowerPoint. |  |
| presentation.accessibility.altText | Alternative text: toggle | shapes | No static refusal; target/region gates still apply | describe_object |
| presentation.data.bindSource | Linked source: button | charts | No static refusal; target/region gates still apply |  |
| presentation.data.live | Follow the source live: toggle | charts | No static refusal; target/region gates still apply |  |
| presentation.data.refreshChart | Refresh chart data: button | charts | No static refusal; target/region gates still apply | generate_chart |
| presentation.transition.native | PowerPoint transition: button |  | No static refusal; target/region gates still apply |  |
| presentation.transition.nativeTiming | PowerPoint animation timing: button |  | No static refusal; target/region gates still apply |  |
| presentation.files.open | Import and export: button |  | No static refusal; target/region gates still apply |  |
| presentation.view.slidePreviews | Hide slide previews: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.view.inspector | Show inspector: toggle |  | No static refusal; target/region gates still apply |  |
| presentation.export.pptx | Export PowerPoint copy: button |  | No static refusal; target/region gates still apply |  |
| presentation.export.pdf | Export PDF copy: button |  | No static refusal; target/region gates still apply |  |
| presentation.export.odp | Export OpenDocument copy: button |  | No static refusal; target/region gates still apply |  |
| presentation.export.png | Export Slide image copy: button |  | No static refusal; target/region gates still apply |  |
| presentation.export.print | Print: button |  | No static refusal; target/region gates still apply |  |
| presentation.import.copy | Import a copy: button |  | Import a copy from the Library so the linked deck is not replaced. |  |

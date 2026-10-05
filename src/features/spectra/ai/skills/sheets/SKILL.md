---
name: sheets
description: Workbooks with clear tables, working formulas, readable formatting and charts.
---

# Sheets

A workbook is a tool the user keeps using: they change an input and the results follow. Build
it so the calculation stays live and anyone can see where each number comes from.

## Layout

- One table per purpose, starting at A1 unless there is a reason not to. Row 1 holds headers.
- Headers name the quantity and its unit: "Distance (km)", "Cost (€)".
- Inputs (values the user types) sit apart from results (formulas). A short "Inputs" block
  above or beside the table works well for assumptions such as a rate or a target.
- Freeze the header row (`frozenRows: 1`) when the table is longer than a screen.
- Set column widths so headers and values are readable without wrapping.
- Bold the header row; use number formats (`decimals`, `currency`, percentages) rather than
  rounding in text.

## Formulas

- Anything derived is a formula, never a typed result: totals, averages, percentages, grades.
- Refer to cells and ranges, not copies of values: `=SUM(B2:B13)`, `=B2/B$14`.
- Keep formulas readable. Prefer `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNTIF`, `IF`, `ROUND` and
  `XLOOKUP` (or `VLOOKUP`) to deeply nested expressions; split a long calculation across helper
  columns.
- Check that every range covers exactly the data rows, including the last one.

## Charts

- Choose by question: a column or bar chart to compare categories, a line chart for change
  over time, a scatter chart for a relationship, a pie chart only for parts of one whole with
  few slices.
- The chart range includes the header row so series are named.
- Give the chart a title that says what it shows.

## Editing

- Change only the cells that need it: `set_range` on the exact range, `format_range` for style.
- Inserting rows or columns shifts formulas; read the result back and check totals still cover
  the data.
- Never rebuild the whole workbook for a new column.
- Treat hidden or filtered rows as data, not empty space.

## Example of excellent output

Request: "A budget for my school trip: travel 120, hostel 3 nights at 28, food 15 a day for 4
days, plus 10% contingency."

```json
{
  "sheets": [{
    "name": "Trip budget",
    "rows": [
      ["Item", "Unit cost (€)", "Quantity", "Total (€)"],
      ["Travel", 120, 1, "=B2*C2"],
      ["Hostel (nights)", 28, 3, "=B3*C3"],
      ["Food (days)", 15, 4, "=B4*C4"],
      ["Subtotal", "", "", "=SUM(D2:D4)"],
      ["Contingency (10%)", "", "", "=D5*0.1"],
      ["Total", "", "", "=D5+D6"]
    ],
    "format": [
      { "range": "A1:D1", "bold": true },
      { "range": "B2:B4", "currency": "EUR" },
      { "range": "D2:D7", "currency": "EUR" },
      { "range": "A7:D7", "bold": true }
    ],
    "frozenRows": 1,
    "columnWidths": { "A": 180, "B": 120, "C": 90, "D": 110 },
    "charts": [{ "type": "pie", "range": "A1:D4", "title": "Where the money goes" }]
  }]
}
```

Why it works: every total is a formula, so changing a unit cost updates everything; units are
in the headers; the chart answers one question.

## Check before finishing

- The readback shows no formula errors (#REF!, #DIV/0!, #NAME?).
- Totals and ranges cover every data row.
- Tell the user what the key numbers are, using the computed values from the readback.

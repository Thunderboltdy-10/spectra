param([string]$Out, [string]$Image, [string]$Variant = "ee")
$ErrorActionPreference = "Stop"
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Add()
  $sel = $word.Selection
  if ($Variant -eq "ee") {
    # Typical IB EE body: Times New Roman 12, double spaced
    $normal = $doc.Styles.Item(-1)  # wdStyleNormal
    $normal.Font.Name = "Times New Roman"
    $normal.Font.Size = 12
    $normal.ParagraphFormat.LineSpacingRule = 2  # double
  }
  function P([string]$style, [string]$text) {
    $sel.Style = $doc.Styles.Item($style)
    $sel.TypeText($text)
    $sel.TypeParagraph()
  }
  P "Title" "The Effect of Temperature on Enzyme Activity"
  P "Subtitle" "Extended Essay in Biology"
  # TOC
  $sel.Style = $doc.Styles.Item("Normal")
  $tocRange = $sel.Range
  $doc.TablesOfContents.Add($tocRange, $true, 1, 3) | Out-Null
  $sel.EndKey(6) | Out-Null
  $sel.TypeParagraph()
  $sel.InsertBreak(7)  # page break
  P "Heading 1" "Introduction"
  $sel.Style = $doc.Styles.Item("Normal")
  $sel.TypeText("Enzymes are ")
  $sel.Font.Bold = $true; $sel.TypeText("biological catalysts"); $sel.Font.Bold = $false
  $sel.TypeText(" that speed up reactions ")
  $sel.Font.Italic = $true; $sel.TypeText("in vivo"); $sel.Font.Italic = $false
  $sel.TypeText(". The rate depends on temperature")
  $doc.Footnotes.Add($sel.Range, [Type]::Missing, "See Berg et al. (2015), chapter 8.") | Out-Null
  $sel.TypeText(" and pH. Water is H")
  $sel.Font.Subscript = $true; $sel.TypeText("2"); $sel.Font.Subscript = $false
  $sel.TypeText("O and area is m")
  $sel.Font.Superscript = $true; $sel.TypeText("2"); $sel.Font.Superscript = $false
  $sel.TypeText(". More at ")
  $link = $doc.Hyperlinks.Add($sel.Range, "https://www.ibo.org", [Type]::Missing, [Type]::Missing, "the IB website")
  $sel.TypeText(".")
  $sel.TypeParagraph()
  P "Heading 2" "Research question"
  P "Quote" "To what extent does temperature affect the rate of catalase activity?"
  P "Heading 2" "Hypothesis"
  $sel.Style = $doc.Styles.Item("List Bullet")
  $sel.TypeText("Rate rises up to an optimum"); $sel.TypeParagraph()
  $sel.TypeText("Rate falls as the enzyme denatures"); $sel.TypeParagraph()
  $sel.Style = $doc.Styles.Item("List Number")
  $sel.TypeText("Prepare the solutions"); $sel.TypeParagraph()
  $sel.TypeText("Heat the water bath"); $sel.TypeParagraph()
  $sel.Range.SetListLevel(2)
  $sel.TypeText("Check with a thermometer"); $sel.TypeParagraph()
  $sel.Range.SetListLevel(1)
  $sel.TypeText("Record the results"); $sel.TypeParagraph()
  $sel.Style = $doc.Styles.Item("Normal")
  P "Heading 1" "Method"
  $sel.Style = $doc.Styles.Item("Normal")
  $sel.TypeText("The Arrhenius equation is shown below.")
  $sel.TypeParagraph()
  # Display equation
  $eqRange = $sel.Range
  $eqRange.Text = "k=A e^(-E_a/RT)"
  $omath = $eqRange.OMaths.Add($eqRange)
  $omath.OMaths.Item(1).BuildUp()
  $sel.EndKey(6) | Out-Null
  $sel.TypeParagraph()
  $sel.Style = $doc.Styles.Item("Normal")
  $sel.TypeText("Inline, the rate ")
  $inl = $sel.Range
  $inl.Text = "r=k[S]"
  $om = $inl.OMaths.Add($inl)
  $om.OMaths.Item(1).BuildUp()
  $sel.EndKey(6) | Out-Null
  $sel.TypeText(" grows with substrate.")
  $sel.TypeParagraph()
  # Figure with caption
  $sel.ParagraphFormat.Alignment = 1
  $sel.InlineShapes.AddPicture($Image) | Out-Null
  $sel.TypeParagraph()
  $sel.InsertCaption("Figure", ": Apparatus used in the experiment", "", 1)
  $sel.TypeParagraph()
  $sel.Style = $doc.Styles.Item("Normal")
  $sel.ParagraphFormat.Alignment = 0
  # Table with caption above
  $sel.InsertCaption("Table", ": Results at each temperature", "", 0)
  $sel.TypeParagraph()
  $sel.Style = $doc.Styles.Item("Normal")
  $t = $doc.Tables.Add($sel.Range, 4, 3)
  $t.Style = "Table Grid"
  $t.Cell(1,1).Range.Text = "Temperature (°C)"; $t.Cell(1,2).Range.Text = "Rate (s⁻¹)"; $t.Cell(1,3).Range.Text = "Notes"
  $t.Cell(2,1).Range.Text = "20"; $t.Cell(2,2).Range.Text = "0.12"; $t.Cell(2,3).Range.Text = "baseline"
  $t.Cell(3,1).Range.Text = "40"; $t.Cell(3,2).Range.Text = "0.31"; $t.Cell(3,3).Range.Text = "optimum"
  $t.Cell(4,1).Range.Text = "60"; $t.Cell(4,2).Range.Text = "0.05"; $t.Cell(4,3).Range.Text = "denatured"
  $t.Rows.Item(1).HeadingFormat = -1
  $t.Rows.Item(1).Range.Font.Bold = $true
  $sel.EndKey(6) | Out-Null
  $sel.TypeParagraph()
  $sel.Style = $doc.Styles.Item("Normal")
  $sel.TypeText("As Figure 1 shows, the setup was simple.")
  $sel.TypeParagraph()
  # Divider via bottom border paragraph
  $sel.TypeText("")
  $sel.ParagraphFormat.Borders.Item(-3).LineStyle = 1
  $sel.TypeParagraph()
  $sel.ParagraphFormat.Borders.Item(-3).LineStyle = 0
  P "Heading 1" "Conclusion"
  $sel.Style = $doc.Styles.Item("Normal")
  $sel.ParagraphFormat.Alignment = 3
  $sel.TypeText("The optimum was near 40 °C. This paragraph is justified and long enough to wrap across more than one line in the document so justification is visible on the page.")
  $sel.TypeParagraph()
  $sel.ParagraphFormat.Alignment = 0
  $sel.InsertBreak(7)
  P "Heading 1" "Bibliography"
  $sel.Style = $doc.Styles.Item("Normal")
  $sel.ParagraphFormat.LeftIndent = 36
  $sel.ParagraphFormat.FirstLineIndent = -36
  $sel.TypeText("Berg, J. M., Tymoczko, J. L. and Stryer, L. (2015) ")
  $sel.Font.Italic = $true; $sel.TypeText("Biochemistry"); $sel.Font.Italic = $false
  $sel.TypeText(". 8th edn. New York: W. H. Freeman.")
  $sel.TypeParagraph()
  # Footer with page numbers
  $footer = $doc.Sections.Item(1).Footers.Item(1)
  $footer.PageNumbers.Add(1, $true) | Out-Null
  $doc.TablesOfContents.Item(1).Update()
  $doc.SaveAs2([ref]$Out, [ref]16)
  $doc.Close([ref]0)
  "saved $Out"
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}

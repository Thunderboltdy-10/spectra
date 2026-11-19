/**
 * Canonical document <-> ProseMirror projection used by both the browser Yjs
 * adapter and the plain-Node collaboration gateway. Keep this module free of
 * browser-only and TypeScript-only dependencies so the two runtimes cannot
 * drift into separate document schemas.
 */

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

/**
 * A short, stable name for an exact native OMML subtree. The editor and Yjs
 * carry this instead of the XML (which is a third or more of an equation-heavy
 * paper); the lens finds the XML again in the base projection it writes from.
 */
export function ommlRefFor(xml) {
  if (typeof xml !== "string" || !xml) return undefined;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ xml.length;
  for (let index = 0; index < xml.length; index += 1) {
    const code = xml.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/**
 * Put each equation's Word markup back into editor JSON. A copy that leaves
 * Word (an import, an export) has no projection to look a reference up in.
 */
export function embedOmmlInJson(json, projection) {
  const byRef = new Map();
  const collect = (items) => {
    for (const item of items ?? [])
      if (item?.kind === "equation" && typeof item.ommlXml === "string") byRef.set(ommlRefFor(item.ommlXml), item);
  };
  for (const block of projection?.blocks ?? []) {
    collect(block.inlineContent);
    for (const row of block.richRows ?? []) for (const cell of row) collect(cell);
  }
  const visit = (node) => {
    if (!node || typeof node !== "object") return node;
    const ref = node.attrs?.ommlRef;
    const equation = (node.type === "equation" || node.type === "inlineEquation") && typeof ref === "string" ? byRef.get(ref) : undefined;
    const { ommlRef: _ref, ...attrs } = node.attrs ?? {};
    return {
      ...node,
      ...(equation ? { attrs: { ...attrs, ommlXml: equation.ommlXml, ommlSourceLatex: equation.ommlSourceLatex ?? equation.latex } } : {}),
      ...(Array.isArray(node.content) ? { content: node.content.map(visit) } : {}),
    };
  };
  return visit(json);
}

/** A deterministic eight-digit `w14:paraId` (31-bit, as Word requires) for a Spectra block. */
export function wordParagraphIdFor(seed) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.max(1, (hash >>> 0) & 0x7fffffff).toString(16).padStart(8, "0");
}

function ommlAttrs(item) {
  const ref = typeof item?.ommlRef === "string" && item.ommlRef ? item.ommlRef : ommlRefFor(item?.ommlXml);
  return ref ? { ommlRef: ref } : {};
}

function inlineText(value) {
  return value ? [{ type: "text", text: value }] : undefined;
}

export function richInlineText(content) {
  return content
    .map((item) => {
      if (item.kind === "text") return item.text;
      if (item.kind === "equation") return item.latex;
      if (item.kind === "noteRef") return "";
      if (item.kind === "commentBoundary") return "";
      if (item.kind === "revision") return item.revisionKind === "ins" ? item.text : "";
      if (item.kind === "citation" || item.kind === "bibliography") return item.text;
      return item.altText;
    })
    .join("");
}

export function richInlineHasObject(content) {
  return content.some((item) => item.kind !== "text");
}

/**
 * Where one paragraph of a table cell ends and the next begins, in a cell's
 * rich content. A line break inside a paragraph stays "\n", so a cell's
 * paragraphs (each with its own Word style and id) survive an edit. The cell's
 * plain text (`rows`) keeps "\n" for both.
 */
export const CELL_PARAGRAPH_BREAK = "\u2029";

/** A cell's rich content as one list of runs per paragraph. */
export function cellParagraphs(content) {
  const paragraphs = [[]];
  for (const item of content) {
    if (item.kind !== "text" || !item.text.includes(CELL_PARAGRAPH_BREAK)) {
      paragraphs.at(-1).push(item);
      continue;
    }
    item.text.split(CELL_PARAGRAPH_BREAK).forEach((text, index) => {
      if (index) paragraphs.push([]);
      if (text) paragraphs.at(-1).push({ ...item, text });
    });
  }
  return paragraphs;
}

function normalizeLineBreaks(value) {
  return value.replace(/[\n\u2029]+/gu, "\n");
}

function authoredPlainInline(content, text) {
  if (
    content.every((item) => item.kind === "text") &&
    normalizeLineBreaks(richInlineText(content)) !== normalizeLineBreaks(text)
  ) {
    const first = content[0];
    const sameFormat = content.every(
      (item) => JSON.stringify(item.format ?? null) === JSON.stringify(first?.format ?? null),
    );
    const sameHref = content.every((item) => item.href === first?.href);
    return [{
      kind: "text",
      text,
      ...(sameFormat && first?.format ? { format: first.format } : {}),
      ...(sameHref && first?.href ? { href: first.href } : {}),
    }];
  }
  return content;
}

function richInlineHasSemantics(content) {
  return content.some(
    (item) =>
      item.kind !== "text" ||
      item.text.includes(CELL_PARAGRAPH_BREAK) ||
      Boolean(item.href) ||
      (item.format && Object.keys(item.format).length > 0),
  );
}

/**
 * Compare authored document meaning without native package locators or carry
 * metadata. Native package bytes remain authoritative for untouched regions;
 * this value is only used to decide whether the editor authored a change.
 */
export function authoredSemanticValue(value, parentKey) {
  if (Array.isArray(value))
    return value.map((item) => authoredSemanticValue(item, parentKey));
  if (!value || typeof value !== "object") return value;
  const source = value;
  if ((source.kind === "noteRef" || source.kind === "revision") && Array.isArray(source.content)) {
    const paragraphs = source.kind === "revision" ? [source.content] : source.content;
    const normalized = paragraphs.map((runs) => {
      const result = [];
      for (const run of runs) {
        if (!run.text) continue;
        const next = { text: run.text, ...(run.bold ? { bold: true } : {}), ...(run.italic ? { italic: true } : {}), ...(run.underline ? { underline: true } : {}) };
        const prior = result.at(-1);
        if (prior && prior.bold === next.bold && prior.italic === next.italic && prior.underline === next.underline) prior.text += next.text;
        else result.push(next);
      }
      return result;
    });
    const { content: _content, ...rest } = source;
    const rich = normalized.some((runs) => runs.some((run) => run.bold || run.italic || run.underline));
    return authoredSemanticValue({ ...rest, ...(rich ? { academicRichContent: source.kind === "revision" ? normalized[0] : normalized } : {}) }, parentKey);
  }
  const isImage = source.kind === "image";
  const hasInlineContent = Array.isArray(source.inlineContent);
  return Object.fromEntries(
    Object.entries(source).sort(([left], [right]) => left.localeCompare(right)).flatMap(([key, child]) => {
      if (
        (parentKey === "image" || isImage) &&
        (key === "partName" || key === "assetId" || key === "occurrenceId")
      )
        return [];
      if (key === "ommlXml" || key === "ommlSourceLatex" || key === "ommlRef") return [];
      if (source.kind === "citation" && key === "instruction") return [];
      if (key === "nativePath" || key === "nativeReadOnly" || key === "nativeStyleId" || key === "readOnlyReason")
        return [];
      // Inline runs are the authored formatting source. attrs.format is a
      // resolved native convenience value and would otherwise disagree with a
      // sparse editor mark such as bold-only.
      // A heading's level is the number of its Word style; when the two agree
      // the level is derived, and Word reopens the heading without it.
      if (key === "attrs" && !hasInlineContent && source.type === "heading" && child && typeof child === "object") {
        const attrs = { ...child };
        if (attrs.level === Number(String(attrs.styleId ?? "").match(/^Heading([1-3])$/i)?.[1])) delete attrs.level;
        return [[key, authoredSemanticValue(attrs, key)]];
      }
      if (
        key === "attrs" &&
        hasInlineContent &&
        child &&
        typeof child === "object"
      ) {
        const attrs = { ...child };
        delete attrs.format;
        if (source.type === "equation") delete attrs.paragraphFormat;
        if (source.type === "heading" && attrs.level === Number(String(attrs.styleId ?? "").match(/^Heading([1-3])$/i)?.[1])) delete attrs.level;
        return [[key, authoredSemanticValue(attrs, key)]];
      }
      if (
        parentKey === "format" &&
        ((["bold", "italic", "strike", "underline"].includes(key) &&
          child === false) ||
          (["color", "highlight", "shading"].includes(key) && child === null) ||
          (key === "fontFamily" && child === "Calibri") ||
          (key === "fontSizePoints" && child === 11))
      )
        return [];
      // Native Word often carries padding spaces at the end of a run while
      // the editor projection trims the paragraph's visible text. Those
      // spaces are not authored meaning and must not turn compaction into a
      // rewrite of an otherwise untouched run.
      const semanticChild =
        source.kind === "text" && key === "text" && typeof child === "string"
          ? child.trimEnd()
          : child;
      const normalizedChild = authoredSemanticValue(semanticChild, key);
      if (
        key === "format" &&
        normalizedChild &&
        typeof normalizedChild === "object" &&
        !Array.isArray(normalizedChild) &&
        Object.keys(normalizedChild).length === 0
      )
        return [];
      return [[key, normalizedChild]];
    }),
  );
}

export function authoredSemanticsEqual(left, right) {
  return JSON.stringify(authoredSemanticValue(left)) ===
    JSON.stringify(authoredSemanticValue(right));
}

/**
 * Reattach exact OMML only when the editor still carries the source LaTeX
 * represented by the bound native subtree. This never searches a latest
 * revision or treats a changed equation as unchanged.
 */
export function restoreDocxEquationCarryMetadata(previousContent, nextContent) {
  if (!Array.isArray(nextContent)) return nextContent;
  const previousEquations = Array.isArray(previousContent)
    ? previousContent.filter((item) => item?.kind === "equation")
    : [];
  const used = new Set();
  const carries = (candidate, index, item) =>
    !used.has(index) &&
    typeof candidate?.ommlXml === "string" &&
    typeof candidate?.ommlSourceLatex === "string" &&
    candidate.ommlSourceLatex === item.latex;
  return nextContent.map((item) => {
    if (
      item?.kind !== "equation" ||
      typeof item.latex !== "string" ||
      typeof item.ommlXml === "string"
    ) {
      if (item?.kind !== "equation" || !("ommlRef" in item)) return item;
      const { ommlRef: _ref, ...rest } = item;
      return rest;
    }
    const { ommlRef, ...rest } = item;
    // The subtree this equation was opened from, when it still says the same thing.
    let matchIndex = typeof ommlRef === "string"
      ? previousEquations.findIndex((candidate, index) => carries(candidate, index, item) && ommlRefFor(candidate.ommlXml) === ommlRef)
      : -1;
    if (matchIndex < 0) matchIndex = previousEquations.findIndex((candidate, index) => carries(candidate, index, item));
    if (matchIndex < 0) return rest;
    used.add(matchIndex);
    const match = previousEquations[matchIndex];
    return {
      ...rest,
      ommlXml: match.ommlXml,
      ommlSourceLatex: match.ommlSourceLatex,
    };
  });
}

export function docxNativeMediaUrl(binding, image) {
  const source = record(binding);
  const artifactId =
    typeof source.sourceArtifactId === "string" ? source.sourceArtifactId : "";
  const payloadHash =
    typeof source.sourcePayloadHash === "string"
      ? source.sourcePayloadHash
      : "";
  if (!artifactId || !/^[a-f0-9]{64}$/.test(payloadHash)) return "";
  const query = new URLSearchParams({
    artifactId,
    payloadHash,
    partName: image.partName,
  });
  return `/api/spectra/lenses/docx/media?${query.toString()}`;
}

function docxAssetMediaUrl(assetId) {
  return `/api/spectra/assets/content?assetId=${encodeURIComponent(assetId)}`;
}

export function docxRichInlineToJson(content, binding, nativeReadOnly = false) {
  const nodes = content.flatMap((item) => {
    if (item.kind === "text") {
      if (!item.text) return [];
      const marks = marksFromRunFormat(item.format);
      if (item.href) marks.push({ type: "link", attrs: { href: item.href } });
      const withMarks = marks.length ? { marks } : {};
      // Word's line break (w:br) is the editor's hard break, not a newline
      // character the browser would fold into a space. It carries no marks:
      // Yjs keeps none on it, so the break takes its neighbour's on the way back.
      return item.text.split("\n").flatMap((part, index) => [
        ...(index ? [{ type: "hardBreak" }] : []),
        ...(part ? [{ type: "text", text: part, ...withMarks }] : []),
      ]);
    }
    if (item.kind === "equation")
      return [
        {
          type: "inlineEquation",
          attrs: {
            latex: item.latex,
            display: item.display === "block" ? "block" : "inline",
            ...ommlAttrs(item),
            ...(nativeReadOnly ? { nativeReadOnly: true } : {}),
          },
        },
      ];
    if (item.kind === "citation" || item.kind === "bibliography")
      return [{ type: "spectraCitation", attrs: { native: item, id: item.kind === "citation" ? item.citationId : null, sourceId: item.kind === "citation" ? item.sourceRef?.sourceId : null, label: item.text } }];
    if (item.kind === "commentBoundary" || item.kind === "revision")
      return [{ type: item.kind === "revision" ? "wordRevision" : "wordCommentBoundary", attrs: { native: item } }];
    if (item.kind === "noteRef")
      return [
        {
          type: item.noteType === "endnote" ? "endnote" : "footnote",
          attrs: {
            text: typeof item.text === "string" ? item.text : "",
            nativeNoteId: item.noteId,
            ...(item.content ? { noteContent: item.content } : {}),
            ...(item.readOnlyReason ? { readOnlyReason: item.readOnlyReason, nativeReadOnly: true } : {}),
          },
        },
      ];
    const authored = typeof item.assetId === "string" && item.assetId;
    return [
      {
        type: authored ? "image" : "nativeDocxImage",
        attrs: {
          src: authored ? docxAssetMediaUrl(item.assetId) : docxNativeMediaUrl(binding, item),
          ...(item.partName ? { partName: item.partName } : {}),
          ...(item.occurrenceId ? { occurrenceId: item.occurrenceId } : {}),
          ...(authored ? { assetId: item.assetId } : {}),
          mediaType: item.mediaType,
          alt: item.altText,
          ...(item.widthEmu ? { widthEmu: item.widthEmu } : {}),
          ...(authored && item.widthEmu
            ? { widthPercent: Math.round(Math.max(1, Math.min(100, (item.widthEmu / TEXT_COLUMN_EMU) * 100))) }
            : {}),
          ...(item.heightEmu ? { heightEmu: item.heightEmu } : {}),
          placement: item.placement,
          ...(item.crop ? { crop: item.crop } : {}),
          ...(!authored || nativeReadOnly ? { nativeReadOnly: true } : {}),
        },
      },
    ];
  });
  return nodes.length ? nodes : undefined;
}

function cellJsonFromRichContent(content, binding, nativeReadOnly) {
  return cellParagraphs(content).flatMap((paragraph) => cellParagraphJson(paragraph, binding, nativeReadOnly));
}

function cellParagraphJson(content, binding, nativeReadOnly) {
  const meaningful = content.filter(
    (item) => item.kind !== "text" || Boolean(item.text.trim()),
  );
  const displayEquation =
    meaningful.length === 1 &&
    meaningful[0]?.kind === "equation" &&
    meaningful[0].display === "block"
      ? meaningful[0]
      : null;
  if (displayEquation)
    return [
      {
        type: "equation",
        attrs: {
          latex: displayEquation.latex,
          display: "block",
          alignment: "center",
          ...ommlAttrs(displayEquation),
          ...(nativeReadOnly ? { nativeReadOnly: true } : {}),
        },
      },
    ];
  return [
    {
      type: "paragraph",
      content: docxRichInlineToJson(content, binding, nativeReadOnly),
    },
  ];
}

const ALIGNED = new Set(["center", "right", "justify"]);

/**
 * The text column an image width percentage is measured against: an A4 page
 * less Word's normal one-inch margins. Measuring against the whole page made
 * a "100%" picture spill past the right margin in Word.
 */
export const TEXT_COLUMN_EMU = Math.round(6.27 * 914400);

/** The paragraph alignment a lone picture shows in the editor. */
export function imageParagraphAlignment(node) {
  if (node?.type !== "paragraph") return undefined;
  const children = Array.isArray(node.content) ? node.content : [];
  const images = children.filter((child) => child?.type === "image" || child?.type === "nativeDocxImage");
  if (!images.length) return undefined;
  if (children.some((child) => child?.type !== "image" && child?.type !== "nativeDocxImage" &&
    !(child?.type === "text" && !String(child.text ?? "").trim()) && child?.type !== "hardBreak"))
    return undefined;
  const wraps = new Set(images.map((image) => image.attrs?.wrap ?? "inline"));
  if (wraps.size !== 1) return undefined;
  const [wrap] = wraps;
  return wrap === "break" ? "center" : wrap === "right" ? "right" : undefined;
}

/** A paragraph format as the editor's node attributes. Defaults write nothing. */
export function paragraphAttrsFromFormat(value) {
  const format = record(value);
  const number = (key) => {
    const size = Number(format[key]);
    return Number.isFinite(size) ? size : 0;
  };
  const line = number("lineSpacing");
  const after = number("spacingAfterPoints");
  const before = number("spacingBeforePoints");
  const indent = number("indentLevel");
  const firstLine = number("firstLineIndentPoints");
  return {
    ...(ALIGNED.has(format.alignment) ? { textAlign: format.alignment } : {}),
    ...(line > 0 && line !== 1 ? { lineSpacing: line } : {}),
    ...(after > 0 ? { spacingAfter: after } : {}),
    ...(before > 0 ? { spacingBefore: before } : {}),
    ...(indent !== 0 ? { indentLevel: indent } : {}),
    ...(firstLine !== 0 ? { firstLineIndent: firstLine } : {}),
    ...(typeof format.border === "string" && format.border !== "none"
      ? { frameBorder: format.border }
      : {}),
    ...(typeof format.shading === "string"
      ? { frameShading: `#${format.shading}` }
      : {}),
    ...(format.pageBreak === true ? { pageBreak: true } : {}),
    ...(format.pageBreakBefore === true ? { pageBreakBefore: true } : {}),
  };
}

/** The other direction, shaped the way the Word lens writes `w:pPr`. */
export function paragraphFormatFromAttrs(value) {
  const attrs = record(value);
  const positive = (entry) => {
    const size = Number(entry);
    return Number.isFinite(size) && size > 0 ? size : 0;
  };
  const signed = (entry) => {
    const size = Number(entry);
    return Number.isFinite(size) ? size : 0;
  };
  return {
    alignment: ALIGNED.has(attrs.textAlign) ? attrs.textAlign : "left",
    lineSpacing: positive(attrs.lineSpacing) || 1,
    spacingAfterPoints: positive(attrs.spacingAfter),
    spacingBeforePoints: positive(attrs.spacingBefore),
    // Indent keeps its sign. A Word style may outdent a heading into the margin,
    // and reporting that as level 0 would pull it back on the next save.
    indentLevel: Math.round(signed(attrs.indentLevel)),
    firstLineIndentPoints: signed(attrs.firstLineIndent),
    border:
      typeof attrs.frameBorder === "string" && attrs.frameBorder !== "none"
        ? attrs.frameBorder
        : null,
    shading: colorHex(attrs.frameShading) ?? null,
    ...(attrs.pageBreak === true ? { pageBreak: true } : {}),
    ...(attrs.pageBreakBefore === true ? { pageBreakBefore: true } : {}),
    ...(attrs.sectionBreak === true ? { sectionBreak: true } : {}),
  };
}

/** Marks for a run format, in the order the editor reads them. */
function marksFromRunFormat(value) {
  const format = record(value);
  const marks = [
    ...(format.bold === true ? [{ type: "bold" }] : []),
    ...(format.italic === true ? [{ type: "italic" }] : []),
    ...(format.underline === true ? [{ type: "underline" }] : []),
    ...(format.strike === true ? [{ type: "strike" }] : []),
    ...(format.verticalAlign === "superscript" ? [{ type: "superscript" }] : []),
    ...(format.verticalAlign === "subscript" ? [{ type: "subscript" }] : []),
    ...(format.smallCaps === true ? [{ type: "smallCaps" }] : []),
    ...(format.allCaps === true ? [{ type: "allCaps" }] : []),
  ];
  const style = {
    ...(typeof format.fontFamily === "string"
      ? { fontFamily: format.fontFamily }
      : {}),
    ...(typeof format.fontSizePoints === "number"
      ? { fontSize: `${format.fontSizePoints}pt` }
      : {}),
    ...(typeof format.color === "string" ? { color: `#${format.color}` } : {}),
  };
  if (Object.keys(style).length) marks.push({ type: "textStyle", attrs: style });
  if (typeof format.highlight === "string")
    marks.push({ type: "highlight", attrs: { color: format.highlight } });
  else if (typeof format.shading === "string")
    marks.push({ type: "highlight", attrs: { color: `#${format.shading}` } });
  return marks;
}

/**
 * The block's own formatting, written onto the node the editor loads. A paragraph
 * that opens without it reads as left-aligned and single-spaced, and the first
 * save then writes that back over the file.
 */
function withBlockFormatting(node, blockAttrs) {
  const paragraph = paragraphAttrsFromFormat(record(blockAttrs).paragraphFormat);
  if (!Object.keys(paragraph).length) return node;
  if (node.type === "paragraph" || node.type === "heading")
    return { ...node, attrs: { ...node.attrs, ...paragraph } };
  // Lists and quotes hold their text a level down, and a list's own indent is its
  // depth, so only the alignment carries through to their paragraphs.
  if ((node.type === "bulletList" || node.type === "blockquote") && paragraph.textAlign) {
    const align = (child) =>
      child?.type === "paragraph"
        ? { ...child, attrs: { ...child.attrs, textAlign: paragraph.textAlign } }
        : Array.isArray(child?.content)
          ? { ...child, content: child.content.map(align) }
          : child;
    return { ...node, content: node.content.map(align) };
  }
  return node;
}

/**
 * Word's merged cells (`attrs.cellSpans`, one entry per physical cell) as editor
 * spans: the merge origin carries colspan/rowspan and a continued cell goes.
 * A table whose spans don't fit its rows opens unmerged, as before.
 */
function withCellSpans(rows, cellSpans) {
  if (!Array.isArray(cellSpans) || cellSpans.length !== rows.length) return rows;
  const merged = rows.map((row, rowIndex) => ({
    ...row,
    content: row.content.flatMap((cell, columnIndex) => {
      const span = record(cellSpans[rowIndex]?.[columnIndex]);
      if (span.covered === true) return [];
      const colspan = Math.max(1, Math.min(63, Math.round(Number(span.colspan) || 1)));
      const rowspan = Math.max(1, Math.min(rows.length - rowIndex, Math.round(Number(span.rowspan) || 1)));
      return [colspan > 1 || rowspan > 1
        ? { ...cell, attrs: { ...(cell.attrs ?? {}), ...(colspan > 1 ? { colspan } : {}), ...(rowspan > 1 ? { rowspan } : {}) } }
        : cell];
    }),
  }));
  return merged.every((row) => row.content.length) ? merged : rows;
}

function withCellAlignment(rowIndex, columnIndex, content, alignments) {
  const row = Array.isArray(alignments) ? alignments[rowIndex] : undefined;
  const textAlign = Array.isArray(row) ? row[columnIndex] : undefined;
  if (!ALIGNED.has(textAlign) || !Array.isArray(content)) return content;
  return content.map((child) =>
    child?.type === "paragraph"
      ? { ...child, attrs: { ...child.attrs, textAlign } }
      : child,
  );
}

export function docxRichBlockToJson(value, binding) {
  const block = record(value);
  if (
    typeof block.id !== "string" ||
    !block.id ||
    typeof block.type !== "string" ||
    typeof block.text !== "string"
  )
    return null;
  const attrs = record(block.attrs);
  const nativeReadOnly = attrs.nativeReadOnly === true;
  const nativeAttrs = {
    blockId: block.id,
    ...(nativeReadOnly ? { nativeReadOnly: true } : {}),
  };

  if (block.type === "equation") {
    const equation = Array.isArray(block.inlineContent)
      ? block.inlineContent.find((item) => item?.kind === "equation")
      : null;
    return {
      type: "equation",
      attrs: {
        ...nativeAttrs,
        latex: equation?.latex ?? block.text,
        display: attrs.display === "inline" ? "inline" : "block",
        alignment: attrs.alignment ?? "center",
        ...ommlAttrs(equation),
      },
    };
  }

  if (
    block.type === "table" &&
    Array.isArray(block.richRows) &&
    block.richRows.every(
      (row) => Array.isArray(row) && row.every((cell) => Array.isArray(cell)),
    )
  )
    return {
      type: "table",
      attrs: nativeAttrs,
      content: withCellSpans(block.richRows.map((row, rowIndex) => ({
        type: "tableRow",
        content: row.map((cell, columnIndex) => {
          const expected = Array.isArray(block.rows?.[rowIndex])
            ? String(block.rows[rowIndex][columnIndex] ?? "")
            : undefined;
          const effectiveCell =
            expected !== undefined &&
            cell.every((item) => item.kind === "text") &&
            normalizeLineBreaks(richInlineText(cell)) !==
              normalizeLineBreaks(expected)
              ? authoredPlainInline(cell, expected)
              : cell;
          return {
          type: rowIndex === 0 && attrs.headerRow !== false ? "tableHeader" : "tableCell",
          content: withCellAlignment(
            rowIndex,
            columnIndex,
            cellJsonFromRichContent(effectiveCell, binding, nativeReadOnly),
            attrs.cellAlignments,
          ),
          };
        }),
      })), attrs.cellSpans),
    };

  const inlineContent = Array.isArray(block.inlineContent)
    ? block.inlineContent
    : [];
  const effectiveInlineContent =
    block.type !== "table" &&
    inlineContent.every((item) => item.kind === "text")
      ? authoredPlainInline(inlineContent, block.text)
      : inlineContent;
  if (!richInlineHasSemantics(effectiveInlineContent)) return null;
  const content = docxRichInlineToJson(effectiveInlineContent, binding, nativeReadOnly);
  if (block.type === "heading")
    return withBlockFormatting({
      type: "heading",
      attrs: {
        ...nativeAttrs,
        level:
          Number(String(attrs.styleId ?? "").match(/^Heading([1-3])$/i)?.[1]) ||
          Number(attrs.level) ||
          2,
      },
      content,
    }, attrs);
  if (block.type === "list")
    return withBlockFormatting({
      ...wordListShell(attrs.list, nativeAttrs),
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content }],
        },
      ],
    }, attrs);
  return withBlockFormatting({ type: "paragraph", attrs: nativeAttrs, content }, attrs);
}

// A Word paragraph holding only a page break is Spectra's page break, not an empty line.
function isPageBreakBlock(blockValue) {
  const block = record(blockValue);
  return (
    block.type === "paragraph" &&
    record(record(block.attrs).paragraphFormat).pageBreak === true &&
    !String(block.text ?? "").trim()
  );
}

// An empty Word paragraph drawn as a single bottom border is a divider line, the way Word's
// own "---" autoformat and most templates make one.
function isDividerBlock(blockValue) {
  const block = record(blockValue);
  const attrs = record(block.attrs);
  return (
    block.type === "paragraph" &&
    record(attrs.paragraphFormat).border === "bottom" &&
    !record(attrs.paragraphFormat).pageBreak &&
    !String(block.text ?? "").trim() &&
    !(Array.isArray(block.inlineContent) && block.inlineContent.some((item) => record(item).kind !== "text")) &&
    !record(attrs.list).numId &&
    !attrs.nativeReadOnly
  );
}

// An empty Word paragraph that ends a section.
function isSectionBreakBlock(blockValue) {
  const block = record(blockValue);
  return (
    block.type === "paragraph" &&
    record(record(block.attrs).paragraphFormat).sectionBreak === true &&
    !String(block.text ?? "").trim()
  );
}

/** The editor node a Word paragraph stands for when it is a break or a divider, not text. */
function breakNodeType(blockValue) {
  if (isSectionBreakBlock(blockValue)) return "sectionBreak";
  if (isPageBreakBlock(blockValue)) return "pageBreak";
  if (isDividerBlock(blockValue)) return "horizontalRule";
  return undefined;
}

function blockToJson(blockValue, index, nativeBinding) {
  const attrs = record(record(blockValue).attrs);
  const breakType = breakNodeType(blockValue);
  if (breakType) {
    const id = record(blockValue).id;
    return { type: breakType, attrs: { blockId: typeof id === "string" && id ? id : `block-${index + 1}` } };
  }
  const node = plainOrRichBlockToJson(blockValue, index, nativeBinding);
  const formatted = withBlockFormatting(node, attrs);
  // Runs that came through as plain text still have the block's own format to wear.
  const marks = record(blockValue).inlineContent ? [] : marksFromRunFormat(attrs.format);
  if (!marks.length) return formatted;
  const wear = (child) =>
    child?.type === "text"
      ? { ...child, marks: [...(child.marks ?? []), ...marks.filter((mark) => !child.marks?.some((own) => own.type === mark.type))] }
      : Array.isArray(child?.content)
        ? { ...child, content: child.content.map(wear) }
        : child;
  return Array.isArray(formatted.content) && (formatted.type === "paragraph" || formatted.type === "heading")
    ? { ...formatted, content: formatted.content.map(wear) }
    : formatted;
}

function plainOrRichBlockToJson(blockValue, index, nativeBinding) {
  const block = record(blockValue);
  const id =
    typeof block.id === "string" && block.id.trim()
      ? block.id
      : `block-${index + 1}`;
  const value = typeof block.text === "string" ? block.text : "";
  const attrs = record(block.attrs);
  const richNode = docxRichBlockToJson(block, nativeBinding);
  if (richNode) return richNode;
  if (block.type === "heading")
    return {
      type: "heading",
      attrs: {
        blockId: id,
        level: [1, 2, 3].includes(Number(attrs.level))
          ? Number(attrs.level)
          : Number(
              String(attrs.styleId ?? "").match(/^Heading([1-3])$/i)?.[1] ?? 2,
            ),
      },
      content: inlineText(value),
    };
  if (block.type === "quote")
    return {
      type: "blockquote",
      attrs: { blockId: id },
      content: [{ type: "paragraph", content: inlineText(value) }],
    };
  if (block.type === "list")
    return {
      ...wordListShell(attrs.list, { blockId: id }),
      content: (value.split(/\r?\n/).filter(Boolean).length
        ? value.split(/\r?\n/).filter(Boolean)
        : [""]
      ).map((entry) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: inlineText(entry) }],
      })),
    };
  if (block.type === "callout")
    return {
      type: "callout",
      attrs: { blockId: id, type: attrs.tone ?? "info" },
      content: [{ type: "paragraph", content: inlineText(value) }],
    };
  if (block.type === "math" || block.type === "equation")
    return {
      type: "equation",
      attrs: {
        blockId: id,
        latex: typeof block.latex === "string" ? block.latex : value,
        display: attrs.display ?? "block",
        alignment: attrs.alignment ?? "center",
      },
    };
  if (block.type === "code")
    return {
      type: "codeBlock",
      attrs: { blockId: id, language: attrs.language ?? null },
      content: inlineText(value),
    };
  if (block.type === "table") {
    const rows = Array.isArray(block.rows)
      ? block.rows.flatMap((row) =>
          Array.isArray(row) ? [row.map((cell) => String(cell ?? ""))] : [],
        )
      : value
          .split(/\r?\n/)
          .map((row) => row.split("|").map((cell) => cell.trim()));
    return {
      type: "table",
      attrs: {
        blockId: id,
        ...(attrs.nativeReadOnly === true ? { nativeReadOnly: true } : {}),
      },
      content: withCellSpans((rows.length ? rows : [[""]]).map((row, rowIndex) => ({
        type: "tableRow",
        content: row.map((cell, columnIndex) => ({
          type: rowIndex === 0 && attrs.headerRow !== false ? "tableHeader" : "tableCell",
          content: withCellAlignment(
            rowIndex,
            columnIndex,
            [{ type: "paragraph", content: inlineText(cell) }],
            attrs.cellAlignments,
          ),
        })),
      })), attrs.cellSpans),
    };
  }
  return {
    type: "paragraph",
    attrs: { blockId: id },
    content: inlineText(value),
  };
}

export function documentNodeText(node) {
  if (node?.type === "spectraCitation" && node.attrs?.native) return node.attrs.native.text;
  if (node?.type === "wordCommentBoundary") return "";
  if (node?.type === "wordRevision") return node.attrs?.native?.revisionKind === "ins" ? node.attrs.native.text : "";
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (node.type === "inlineEquation" || node.type === "equation")
    return String(node.attrs?.latex ?? "");
  if (node.type === "footnote" || node.type === "endnote") return "";
  if (node.type === "nativeDocxImage") return String(node.attrs?.alt ?? "");
  if (node.type === "hardBreak") return "\n";
  // Blocks stack on lines; the runs inside one paragraph (text, an inline
  // equation, a citation) read on as one line, as Word reads them back.
  const separator =
    node.type === "listItem" || node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock"
      ? ""
      : "\n";
  return (node.content ?? []).map(documentNodeText).join(separator);
}

function appendRichInline(output, item) {
  const previous = output.at(-1);
  if (previous?.leadingBreak && item.kind === "text") {
    output[output.length - 1] = { ...item, text: previous.text + item.text };
    return;
  }
  if (
    item.kind === "text" &&
    previous?.kind === "text" &&
    JSON.stringify(previous.format ?? null) === JSON.stringify(item.format ?? null) &&
    previous.href === item.href
  ) {
    previous.text += item.text;
    return;
  }
  output.push(item);
}

function imageFromJsonNode(node) {
  const attrs = record(node.attrs);
  // An empty locator is an absent one. The native image node used to default
  // every locator to "", and treating that as a broken asset id deleted the
  // picture from Word on the next save.
  const partName = typeof attrs.partName === "string" && attrs.partName ? attrs.partName : undefined;
  const assetId = typeof attrs.assetId === "string" && attrs.assetId.trim() ? attrs.assetId : undefined;
  const mediaType = attrs.mediaType;
  if (
    (!partName && !assetId) ||
    (partName && !/^\/word\/media\/[^/\\\u0000-\u001f]{1,400}$/u.test(partName)) ||
    (mediaType !== "image/png" && mediaType !== "image/jpeg")
  )
    return null;
  const widthEmu = Number(attrs.widthEmu);
  const heightEmu = Number(attrs.heightEmu);
  const widthPercent = Number(attrs.widthPercent);
  const altText = String(attrs.alt ?? "Word image").slice(0, 4_000);
  return {
    kind: "image",
    ...(partName ? { partName } : {}),
    ...(typeof attrs.occurrenceId === "string" && attrs.occurrenceId ? { occurrenceId: attrs.occurrenceId } : {}),
    ...(assetId ? { assetId } : {}),
    mediaType,
    altText,
    ...(Number.isSafeInteger(widthEmu) && widthEmu > 0 ? { widthEmu } : {}),
    ...(Number.isFinite(widthPercent) && widthPercent > 0 && !(Number.isSafeInteger(widthEmu) && widthEmu > 0)
      ? { widthEmu: Math.round((Math.min(100, widthPercent) / 100) * TEXT_COLUMN_EMU) }
      : {}),
    ...(Number.isSafeInteger(heightEmu) && heightEmu > 0 ? { heightEmu } : {}),
    placement: attrs.placement === "anchored" ? "anchored" : "inline",
    ...(attrs.crop && typeof attrs.crop === "object" ? { crop: attrs.crop } : {}),
  };
}

function pointsFromCssSize(value) {
  if (typeof value !== "string") return undefined;
  const match = /^(-?[\d.]+)\s*(px|pt|rem|em)?$/u.exec(value.trim());
  if (!match) return undefined;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return undefined;
  const unit = match[2] ?? "px";
  const points = unit === "pt" ? size : unit === "rem" || unit === "em" ? size * 12 : size * 0.75;
  return Math.round(points * 10) / 10;
}

function colorHex(value) {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/iu.test(hex))
    return hex.split("").map((digit) => `${digit}${digit}`).join("").toUpperCase();
  return /^[0-9a-f]{6}$/iu.test(hex) ? hex.toUpperCase() : undefined;
}

function runFormatFromMarks(marks) {
  const list = Array.isArray(marks) ? marks : [];
  const style = record(list.find((mark) => mark?.type === "textStyle")?.attrs);
  const highlight = record(list.find((mark) => mark?.type === "highlight")?.attrs);
  const link = record(list.find((mark) => mark?.type === "link")?.attrs);
  const highlightColor = typeof highlight.color === "string" ? highlight.color : undefined;
  const wordHighlights = new Set([
    "yellow", "green", "cyan", "magenta", "blue", "red", "darkBlue", "darkCyan",
    "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray",
    "black", "white", "none",
  ]);
  const code = list.some((mark) => mark?.type === "code");
  const format = {
    // Inline code reaches Word as a monospace face on a light ground.
    ...(code ? { fontFamily: "Consolas", shading: "F2F2F2" } : {}),
    ...(list.some((mark) => mark?.type === "bold") ? { bold: true } : {}),
    ...(list.some((mark) => mark?.type === "italic") ? { italic: true } : {}),
    ...(list.some((mark) => mark?.type === "underline") ? { underline: true } : {}),
    ...(list.some((mark) => mark?.type === "strike") ? { strike: true } : {}),
    ...(list.some((mark) => mark?.type === "superscript") ? { verticalAlign: "superscript" } : {}),
    ...(list.some((mark) => mark?.type === "subscript") ? { verticalAlign: "subscript" } : {}),
    ...(list.some((mark) => mark?.type === "smallCaps") ? { smallCaps: true } : {}),
    ...(list.some((mark) => mark?.type === "allCaps") ? { allCaps: true } : {}),
    ...(typeof style.fontFamily === "string" ? { fontFamily: style.fontFamily } : {}),
    ...(pointsFromCssSize(style.fontSize) !== undefined
      ? { fontSizePoints: pointsFromCssSize(style.fontSize) }
      : {}),
    ...(colorHex(style.color) ? { color: colorHex(style.color) } : {}),
    ...(highlightColor && wordHighlights.has(highlightColor)
      ? { highlight: highlightColor }
      : colorHex(highlightColor)
        ? { shading: colorHex(highlightColor) }
        : {}),
  };
  return {
    ...(Object.keys(format).length ? { format } : {}),
    ...(typeof link.href === "string" && link.href ? { href: link.href } : {}),
  };
}

export function documentRichInlineFromJson(node, paragraphBreak = "\n") {
  const cell = paragraphBreak === CELL_PARAGRAPH_BREAK;
  const output = [];
  const visit = (current) => {
    if (typeof current?.text === "string") {
      if (current.text)
        appendRichInline(output, {
          kind: "text",
          text: current.text,
          ...runFormatFromMarks(current.marks),
        });
      return;
    }
    if (current?.type === "hardBreak") {
      // Word's break sits in a run; a break that lost its marks on the way
      // (Yjs keeps none on it) belongs to the run before it.
      const previous = output.at(-1);
      if (Array.isArray(current.marks) && current.marks.length)
        appendRichInline(output, { kind: "text", text: "\n", ...runFormatFromMarks(current.marks) });
      else if (previous?.kind === "text")
        appendRichInline(output, { kind: "text", text: "\n", ...(previous.format ? { format: previous.format } : {}), ...(previous.href ? { href: previous.href } : {}) });
      // A break that opens the run list joins the words after it.
      else output.push({ kind: "text", text: "\n", leadingBreak: true });
      return;
    }
    if (current?.type === "inlineEquation" || current?.type === "equation") {
      appendRichInline(output, {
        kind: "equation",
        latex: String(current.attrs?.latex ?? ""),
        // A Word display equation can share its paragraph with text.
        display: current.type === "equation"
          ? current.attrs?.display === "inline" ? "inline" : "block"
          : current.attrs?.display === "block" ? "block" : "inline",
        ...(typeof current.attrs?.ommlXml === "string"
          ? { ommlXml: current.attrs.ommlXml }
          : {}),
        ...(typeof current.attrs?.ommlSourceLatex === "string"
          ? { ommlSourceLatex: current.attrs.ommlSourceLatex }
          : {}),
        ...(typeof current.attrs?.ommlRef === "string" && current.attrs.ommlRef && typeof current.attrs?.ommlXml !== "string"
          ? { ommlRef: current.attrs.ommlRef }
          : {}),
      });
      return;
    }
    if (current?.type === "spectraCitation" && current.attrs?.native) { appendRichInline(output, current.attrs.native); return; }
    if (current?.type === "wordRevision" || current?.type === "wordCommentBoundary") {
      if (current.attrs?.native) appendRichInline(output, current.attrs.native);
      return;
    }
    if (current?.type === "footnote" || current?.type === "endnote") {
      const noteId =
        typeof current.attrs?.nativeNoteId === "string" && current.attrs.nativeNoteId
          ? current.attrs.nativeNoteId
          : "spectra";
      appendRichInline(output, {
        kind: "noteRef",
        noteType: current.type === "endnote" ? "endnote" : "footnote",
        noteId,
        text: typeof current.attrs?.text === "string" ? current.attrs.text : "",
        ...(Array.isArray(current.attrs?.noteContent) ? { content: current.attrs.noteContent } : {}),
        ...(typeof current.attrs?.readOnlyReason === "string" ? { readOnlyReason: current.attrs.readOnlyReason } : {}),
      });
      return;
    }
    if (current?.type === "nativeDocxImage" || current?.type === "image") {
      const image = imageFromJsonNode(current);
      if (image) appendRichInline(output, image);
      return;
    }
    const children = Array.isArray(current?.content) ? current.content : [];
    children.forEach((child, index) => {
      if (
        index > 0 &&
        // A cell counts every paragraph, the empty ones too.
        (cell
          ? ["paragraph", "heading", "equation"].includes(child?.type ?? "")
          : ["paragraph", "heading"].includes(child?.type ?? "") && output.length)
      )
        appendRichInline(output, { kind: "text", text: paragraphBreak });
      visit(child);
    });
  };
  visit(node);
  for (const item of output) delete item.leadingBreak;
  return output;
}

/**
 * The table as a regular grid: a merged cell sits at its top-left slot and the slots it covers
 * are empty. Word gets every cell's content even where it cannot take the merge.
 */
function tableGrid(node) {
  const rows = (node.content ?? []).filter((row) => row?.type === "tableRow");
  const grid = rows.map(() => []);
  rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.content ?? []) {
      while (grid[rowIndex][column] !== undefined) column += 1;
      const colspan = Math.max(1, Math.min(63, Math.round(Number(cell?.attrs?.colspan) || 1)));
      const rowspan = Math.max(1, Math.min(rows.length - rowIndex, Math.round(Number(cell?.attrs?.rowspan) || 1)));
      for (let r = rowIndex; r < rowIndex + rowspan; r += 1)
        for (let c = column; c < column + colspan; c += 1)
          grid[r][c] = r === rowIndex && c === column ? cell : null;
      column += colspan;
    }
  });
  const columns = Math.max(0, ...grid.map((row) => row.length));
  return grid.map((row) => Array.from({ length: columns }, (_, index) => row[index] ?? null));
}

/**
 * A Word table's cells as Word holds them: a horizontal merge is one cell, and a
 * cell a vertical merge continues into is an empty one of the merge's width.
 * Native table reads and edits address those cells, so a merged table read from
 * Word mirrors back in the same shape. Other tables keep the regular grid.
 */
function physicalTableSlots(node) {
  const rows = (node.content ?? []).filter((row) => row?.type === "tableRow");
  const merged = rows.some((row) => (row.content ?? []).some((cell) =>
    Number(cell?.attrs?.colspan) > 1 || Number(cell?.attrs?.rowspan) > 1));
  if (!merged || !String(node.attrs?.blockId ?? "").startsWith("docx:")) return null;
  const grid = rows.map(() => []);
  rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.content ?? []) {
      while (grid[rowIndex][column] !== undefined) column += 1;
      const colspan = Math.max(1, Math.min(63, Math.round(Number(cell?.attrs?.colspan) || 1)));
      const rowspan = Math.max(1, Math.min(rows.length - rowIndex, Math.round(Number(cell?.attrs?.rowspan) || 1)));
      for (let r = rowIndex; r < rowIndex + rowspan; r += 1)
        for (let c = column; c < column + colspan; c += 1)
          grid[r][c] = { cell, row: rowIndex, column, colspan };
      column += colspan;
    }
  });
  const cellSpans = [];
  const physical = grid.map((row, rowIndex) => {
    const slots = [];
    const spans = [];
    cellSpans.push(spans);
    for (let column = 0; column < row.length; ) {
      const slot = row[column];
      if (!slot) { column += 1; continue; }
      slots.push(slot.row === rowIndex ? slot.cell : null);
      spans.push(slot.row === rowIndex
        ? { ...(slot.colspan > 1 ? { colspan: slot.colspan } : {}), ...(Number(slot.cell?.attrs?.rowspan) > 1 ? { rowspan: Math.round(Number(slot.cell.attrs.rowspan)) } : {}) }
        : { covered: true });
      column = slot.column + slot.colspan;
    }
    return slots;
  });
  return Object.assign(physical, { cellSpans });
}

/** The Word merges of a table read from Word, for `attrs.cellSpans`. */
function tableCellSpans(node) {
  const physical = physicalTableSlots(node);
  return physical ? { cellSpans: physical.cellSpans } : {};
}

function tableRows(node) {
  // A line break that opens a cell is the writer's; only the spaces around it are the editor's.
  return (physicalTableSlots(node) ?? tableGrid(node)).map((row) => row.map((cell) => (cell ? documentNodeText(cell).replace(/^[ \t]+|[ \t]+$/gu, "") : "")));
}

function tableRichRows(node) {
  return (physicalTableSlots(node) ?? tableGrid(node)).map((row) => row.map((cell) => (cell ? documentRichInlineFromJson(cell, CELL_PARAGRAPH_BREAK) : [])));
}

/** Column widths the writer dragged, in editor pixels; unset columns are null. */
function tableColumnWidths(node) {
  // A merged cell's `colwidth` holds one width per column it spans.
  const widths = (node.content?.[0]?.content ?? []).flatMap((cell) => {
    const span = Math.max(1, Math.round(Number(cell?.attrs?.colspan) || 1));
    const given = Array.isArray(cell?.attrs?.colwidth) ? cell.attrs.colwidth : [];
    return Array.from({ length: span }, (_, index) => {
      const width = Number(given[index]);
      return Number.isFinite(width) && width > 0 ? Math.round(width) : null;
    });
  });
  return widths.some((width) => width !== null) ? { columnWidths: widths } : {};
}

/**
 * Only a table Word cannot be given as a grid at all. Merged cells and header cells outside the
 * first row are written as a plain grid (their content kept), so they no longer stop a sync.
 */
function unsupportedTableStructure(node) {
  const containsTable = (child) => child?.type === "table" || (child?.content ?? []).some(containsTable);
  const rows = node.content ?? [];
  return !rows.length || rows.some((row) => row?.type !== "tableRow" || !row.content?.length ||
    row.content.some((cell) => (cell.content ?? []).some(containsTable)));
}

/**
 * A Word list paragraph opens as a one-item list. Enter inside it adds items to
 * that list node, but each item is its own Word paragraph: one block per item,
 * the first keeping the Word paragraph's id and every later one naming the
 * paragraph it continues (`listItemOf`), so Word writes it into the same list.
 */
function wordListItemBlocks(node, id, seen) {
  const items = [];
  const visit = (list, depth) => {
    for (const item of list?.content ?? []) {
      if (item?.type !== "listItem") continue;
      for (const child of item.content ?? []) {
        if (child?.type === "bulletList" || child?.type === "orderedList") {
          visit(child, depth + 1);
          continue;
        }
        if (child?.type !== "paragraph") continue;
        items.push({ item, paragraph: child, depth });
      }
    }
  };
  visit(node, 0);
  return items.map(({ item, paragraph, depth }, index) => {
    let itemId = id;
    if (index > 0) {
      const own = [item.attrs?.blockId, paragraph.attrs?.blockId]
        .find((candidate) => typeof candidate === "string" && candidate && candidate !== id);
      // A Word-shaped id, so the paragraph Word writes keeps it (`w14:paraId`).
      itemId = /^docx:paragraph:[a-f0-9]{8}$/.test(own ?? "")
        ? own
        : `docx:paragraph:${wordParagraphIdFor(own ?? `${id}-item-${index}`)}`;
      let salt = 1;
      while (seen.has(itemId)) itemId = `docx:paragraph:${wordParagraphIdFor(`${own ?? id}:${index}:${salt++}`)}`;
      seen.add(itemId);
    }
    const inlineContent = documentRichInlineFromJson(paragraph);
    const hasRichContent = richInlineHasSemantics(inlineContent);
    const text = (hasRichContent ? richInlineText(inlineContent) : documentNodeText(paragraph)).trimEnd();
    return {
      id: itemId,
      type: "list",
      text,
      ...(hasRichContent ? { inlineContent } : {}),
      ...(index > 0 ? { attrs: { listItemOf: id, ...(depth ? { listDepth: depth } : {}) } } : {}),
    };
  });
}

export function documentBlocksFromJson(json) {
  const seen = new Set();
  return (json?.content ?? []).flatMap((node, index) => {
    let id =
      typeof node?.attrs?.blockId === "string" && node.attrs.blockId
        ? node.attrs.blockId
        : `block-${index + 1}`;
    if (seen.has(id)) {
      const base = id;
      let suffix = 2;
      while (seen.has(`${base}~${suffix}`)) suffix += 1;
      id = `${base}~${suffix}`;
    }
    seen.add(id);

    if (node?.type === "table") {
      const rows = tableRows(node);
      const richRows = tableRichRows(node);
      return {
        id,
        type: "table",
        text: rows.map((row) => row.join(" | ")).join("\n"),
        rows,
    ...(richRows.some((row) => row.some(richInlineHasSemantics))
          ? { richRows }
          : {}),
        attrs: {
          headerRow: Boolean(node.content?.[0]?.content?.length && node.content[0].content.every((cell) => cell.type === "tableHeader")),
          ...tableColumnWidths(node),
          ...tableCellSpans(node),
          ...(node.attrs?.nativeReadOnly === true ? { nativeReadOnly: true } : {}),
          ...(unsupportedTableStructure(node) ? { unsupportedTableStructure: true } : {}),
        },
      };
    }

    // Blocks Word holds as paragraph properties: a divider is a bottom border, a page break an
    // empty paragraph holding one.
    if (node?.type === "horizontalRule" || node?.type === "pageBreak" || node?.type === "sectionBreak")
      return {
        id,
        type: "paragraph",
        text: "",
        attrs: {
          paragraphFormat: paragraphFormatFromAttrs(node.type === "pageBreak" ? { pageBreak: true } : node.type === "sectionBreak" ? { sectionBreak: true } : { frameBorder: "bottom" }),
        },
      };
    if (node?.type === "taskList") {
      // A ballot box per item keeps the checklist's state readable in Word.
      const items = [];
      const visit = (list, depth) => {
        for (const item of list?.content ?? []) {
          for (const child of item?.content ?? []) {
            if (child?.type === "taskList") visit(child, depth + 1);
            else if (child?.type === "paragraph")
              items.push(`${"  ".repeat(depth)}${item.attrs?.checked === true ? "☒" : "☐"} ${documentNodeText(child).trim()}`);
          }
        }
      };
      visit(node, 0);
      return { id, type: "paragraph", text: items.join("\n") };
    }
    const inlineContent = documentRichInlineFromJson(node);
    const hasRichContent = richInlineHasSemantics(inlineContent);
    const text = (
      hasRichContent ? richInlineText(inlineContent) : documentNodeText(node)
    ).trimEnd();
    if (node?.type === "heading") {
      const level = Number(node.attrs?.level) || 2;
      return {
        id,
        type: "heading",
        text,
        ...(hasRichContent ? { inlineContent } : {}),
        attrs: {
          level,
          styleId: `Heading${level}`,
          ...(node.attrs?.nativeReadOnly === true
            ? { nativeReadOnly: true }
            : {}),
          ...carriedParagraphFormat(node),
        },
      };
    }
    if (node?.type === "blockquote")
      return {
        id,
        type: "quote",
        text,
        ...(hasRichContent ? { inlineContent } : {}),
      };
    if ((node?.type === "bulletList" || node?.type === "orderedList") && id.startsWith("docx:")) {
      const items = wordListItemBlocks(node, id, seen);
      if (items.length > 1) return items;
    }
    if (node?.type === "bulletList" || node?.type === "orderedList")
      return {
        id,
        type: "list",
        text,
        ...(hasRichContent ? { inlineContent } : {}),
        ...(node.attrs?.nativeReadOnly === true
          ? { attrs: { nativeReadOnly: true } }
          : {}),
      };
    if (node?.type === "callout")
      return {
        id,
        type: "callout",
        text,
        attrs: { tone: node.attrs?.type ?? node.attrs?.tone ?? "info" },
      };
  if (node?.type === "equation") {
    const latex = String(node.attrs?.latex ?? "");
    const inlineContent = documentRichInlineFromJson(node);
    return {
      id,
      type: "equation",
      text: latex,
      latex,
      inlineContent: inlineContent.length
        ? inlineContent
        : [{ kind: "equation", latex, display: node.attrs?.display === "inline" ? "inline" : "block" }],
        attrs: {
          display: node.attrs?.display ?? "block",
          alignment: node.attrs?.alignment ?? "center",
          ...(node.attrs?.nativeReadOnly === true
            ? { nativeReadOnly: true }
            : {}),
        },
      };
    }
    if (node?.type === "codeBlock")
      return {
        id,
        type: "code",
        text,
        attrs: { language: node.attrs?.language ?? undefined },
      };
    if (node?.type === "spectraReference")
      return {
        id,
        type: "paragraph",
        text: String(node.attrs?.label ?? "Referenced work"),
        reference: node.attrs,
      };
    if (node?.type === "spectraCitation")
      return {
        id,
        type: "paragraph",
        text: String(node.attrs?.label ?? "Citation"),
        citation: node.attrs,
      };
    const nativeReadOnly = node?.attrs?.nativeReadOnly === true;
    const format = carriedParagraphFormat(node);
    return {
      id,
      type: "paragraph",
      text,
      ...(hasRichContent ? { inlineContent } : {}),
      ...(nativeReadOnly || format.paragraphFormat
        ? { attrs: { ...(nativeReadOnly ? { nativeReadOnly: true } : {}), ...format } }
        : {}),
    };
  });
}

/** The Word paragraph format a node carries, or nothing for a plain one. */
export function paragraphFormatForNode(node) {
  return carriedParagraphFormat(node).paragraphFormat;
}

/** Only a node that has formatting says so; a plain paragraph's block stays plain. */
function carriedParagraphFormat(node) {
  const attrs = record(node?.attrs);
  const imageAlignment = ALIGNED.has(attrs.textAlign) ? undefined : imageParagraphAlignment(node);
  const format = paragraphFormatFromAttrs(imageAlignment ? { ...attrs, textAlign: imageAlignment } : attrs);
  return Object.keys(paragraphAttrsFromFormat(format)).length
    ? { paragraphFormat: format }
    : {};
}

const MIRROR_KEYS = ["type", "text", "rows", "richRows", "inlineContent", "attrs"];

// Schema validation can reorder object fields. That does not author a new
// mirror: rebuilding an unchanged rich list would discard its item boundaries.
function sameJsonValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]));
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]));
}

function blockMirrorsNode(block, node, byId) {
  const own = documentBlocksFromJson({ content: [node] });
  const mirrors = (requested, ownBlock) => Boolean(requested) && MIRROR_KEYS.every((key) =>
    sameJsonValue(requested[key] ?? null, ownBlock?.[key] ?? null));
  // A Word list node with several items mirrors several blocks: all must agree.
  return mirrors(block, own[0]) &&
    own.slice(1).every((ownBlock) => mirrors(byId?.get(ownBlock.id), ownBlock));
}

/** The ids of the blocks a node projects to beyond its own (a Word list's later items). */
function coveredBlockIds(node) {
  const id = node?.attrs?.blockId;
  if (typeof id !== "string" || !id.startsWith("docx:") || (node.type !== "bulletList" && node.type !== "orderedList")) return [];
  return documentBlocksFromJson({ content: [node] }).slice(1).map((block) => block.id);
}

function containsCanonicalReference(node) {
  return node?.type === "spectraReference" || (node?.content ?? []).some(containsCanonicalReference);
}

function retainCanonicalReference(node, block) {
  if (node.type === "spectraReference" || !block) return node;
  // A block mirror cannot describe where an atom belongs inside a list,
  // callout or table cell. Keep an unchanged canonical subtree, and reject a
  // mirror-only rewrite that would otherwise flatten its nested references.
  const current = documentBlocksFromJson({ content: [node] })[0];
  for (const key of ["type", "text", "rows", "richRows", "inlineContent", "attrs"]) {
    if (key in block && !authoredSemanticsEqual(block[key], current[key]))
      throw new Error("DOCUMENT_REFERENCE_STRUCTURE: Edit content around this nested reference in the document editor so its placement remains intact.");
  }
  return node;
}

export function documentContentToProseMirrorJson(contentValue) {
  const content = record(contentValue);
  const existing = record(content.tiptap);
  const blocks = Array.isArray(content.blocks)
    ? content.blocks.filter(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  if (existing.type === "doc") {
    const byId = new Map(
      blocks.flatMap((block) =>
        typeof block.id === "string" && block.id ? [[block.id, block]] : [],
      ),
    );
    const existingContent = Array.isArray(existing.content)
      ? existing.content
      : [];
    const referenceNodes = new Set(existingContent.filter(containsCanonicalReference));
    const existingIds = new Set(
      existingContent.flatMap((node) => {
        const blockId = node?.attrs?.blockId;
        return typeof blockId === "string" && blockId ? [blockId, ...coveredBlockIds(node)] : [];
      }),
    );
    const missingNativeBlocks = blocks.some(
      (block) => typeof block.id === "string" && block.id && !existingIds.has(block.id),
    );
    if (missingNativeBlocks) {
      const existingById = new Map();
      const idByNode = new Map();
      const duplicateIds = new Set();
      // Legacy canonical atoms may predate blockId. Use the same positional
      // mirror IDs produced by our forward conversion, without changing any
      // canonical reference attributes or inventing a placement identity.
      const fallbackIds = [...referenceNodes].some((node) => !node.attrs?.blockId)
        ? documentBlocksFromJson(existing).map((block) => block.id) : [];
      for (const [index, node] of existingContent.entries()) {
        const id = node?.attrs?.blockId || fallbackIds[index];
        if (typeof id !== "string" || !id) continue;
        if (existingById.has(id)) duplicateIds.add(id);
        existingById.set(id, node);
        idByNode.set(node, id);
      }
      for (const node of referenceNodes) {
        const id = idByNode.get(node);
        if (typeof id !== "string" || !id || duplicateIds.has(id))
          throw new Error("DOCUMENT_REFERENCE_IDENTITY: A retained reference needs a unique block identity before this document structure can be rebuilt.");
      }
      const requestedIds = new Set(blocks.map((block) => block.id));
      const emittedReferenceIds = new Set();
      const coveredBy = new Map();
      const rebuilt = blocks.map((block, index) => {
        const node = existingById.get(block.id);
        const owner = coveredBy.get(block.id);
        if (!node && owner) return null;
        if (!referenceNodes.has(node)) {
          if (node && blockMirrorsNode(block, node, byId))
            for (const covered of coveredBlockIds(node)) coveredBy.set(covered, node);
          // One block with no node here must not cost the others their structure:
          // a mirror cannot describe a list's items, so a rebuild would run them together.
          if (node && !duplicateIds.has(block.id) && (blockMirrorsNode(block, node, byId) || (node.type === breakNodeType(block)))) return node;
          return blockToJson(block, index, content.nativeBinding);
        }
        if (emittedReferenceIds.has(block.id))
          throw new Error("DOCUMENT_REFERENCE_IDENTITY: A block mirror cannot duplicate a retained reference.");
        emittedReferenceIds.add(block.id);
        return retainCanonicalReference(node, block);
      });
      // Mirrors can omit atoms. Only their removal from the canonical TipTap
      // document removes their identity. Attach omitted references before the
      // next retained original block, keeping their relative order in O(n).
      const before = new Map();
      let anchor = null;
      for (let index = existingContent.length - 1; index >= 0; index -= 1) {
        const node = existingContent[index];
        const id = idByNode.get(node);
        if (requestedIds.has(id)) anchor = id;
        else if (referenceNodes.has(node)) {
          const pending = before.get(anchor) ?? [];
          pending.push(node);
          before.set(anchor, pending);
        }
      }
      const rebuiltContent = rebuilt.flatMap((node, index) => {
        if (node === null) return [];
        const id = blocks[index].id;
        const pending = before.get(id) ?? [];
        before.delete(id);
        return [...pending.reverse(), node];
      });
      return {
        ...existing,
        content: shapeWordLists([...rebuiltContent, ...(before.get(null) ?? []).reverse()], byId),
      };
    }
    return {
      ...existing,
      content: shapeWordLists(existingContent.flatMap((node) => {
        const blockId = node?.attrs?.blockId;
        const block =
          typeof blockId === "string" ? byId.get(blockId) : undefined;
        if (referenceNodes.has(node)) return retainCanonicalReference(node, block);
        if (block && node?.type && node.type === breakNodeType(block)) return node;
        // A mirror that is exactly this node's own projection says nothing
        // new. Rebuilding from it would drop what the mirror cannot carry
        // (an inline code mark beside an equation, a colour, a task state).
        if (block && blockMirrorsNode(block, node, byId)) return node;
        // A Word list's items are Word paragraphs of their own; when any of
        // them changed, each opens again as the one-item list Word reads.
        const covered = coveredBlockIds(node);
        if (block && covered.length)
          return [block, ...covered.map((id) => byId.get(id)).filter(Boolean)]
            .map((entry, index) => blockToJson(entry, index, content.nativeBinding));
        const attrs = record(block?.attrs);
        const richNode = block
          ? docxRichBlockToJson(block, content.nativeBinding)
          : null;
        if (richNode)
          return {
            ...richNode,
            attrs: { ...node.attrs, ...richNode.attrs },
          };
        if (attrs.nativeReadOnly === true)
          return {
            ...node,
            attrs: { ...node.attrs, nativeReadOnly: true },
          };
        if (block?.type === "table") {
          const rebuilt = blockToJson(block, 0, content.nativeBinding);
          return { ...rebuilt, attrs: { ...node.attrs, ...rebuilt.attrs } };
        }
        if (
          typeof block?.text === "string" &&
          block.text !== documentNodeText(node).trimEnd()
        ) {
          const rebuilt = blockToJson(block, 0, content.nativeBinding);
          return { ...rebuilt, attrs: { ...node.attrs, ...rebuilt.attrs } };
        }
        const styleId = typeof attrs.styleId === "string" ? attrs.styleId : "";
        const headingLevel = Number(
          styleId.match(/^Heading([1-3])$/i)?.[1] ?? 0,
        );
        if (
          headingLevel &&
          (node?.type === "paragraph" || node?.type === "heading")
        )
          return {
            ...node,
            type: "heading",
            attrs: {
              ...node.attrs,
              level: headingLevel,
              ...(attrs.nativeReadOnly === true
                ? { nativeReadOnly: true }
                : {}),
            },
          };
        return node;
      }), byId),
    };
  }
  const source = blocks.length ? blocks : [{ id: "intro", type: "paragraph", text: "" }];
  return {
    type: "doc",
    content: shapeWordLists(
      source.map((block, index) => blockToJson(block, index, content.nativeBinding)),
      blockIndex(source),
    ),
  };
}

const WORD_LIST_TYPES = { lowerLetter: "a", upperLetter: "A", lowerRoman: "i", upperRoman: "I" };

function blockIndex(blocks) {
  return new Map(blocks.flatMap((block) => typeof block?.id === "string" && block.id ? [[block.id, block]] : []));
}

function wordListLevel(list) {
  return Math.max(0, Math.min(8, Number(list.level) || 0));
}

/** The list node a Word list paragraph opens as: numbered or bulleted as Word
 * draws it, at its Word level. The start is the list's own; renumberWordLists
 * counts it on across the document. */
export function wordListShell(listValue, attrs) {
  const list = record(listValue);
  const level = wordListLevel(list);
  const levelAttrs = level ? { listLevel: level } : {};
  if (typeof list.numId !== "string" || list.isBullet !== false)
    return { type: "bulletList", attrs: { ...attrs, ...levelAttrs } };
  const type = WORD_LIST_TYPES[list.format];
  const start = Number.isFinite(Number(list.start)) ? Number(list.start) : 1;
  return { type: "orderedList", attrs: { ...attrs, start, ...(type ? { type } : {}), ...levelAttrs } };
}

function topListItems(node) {
  return Array.isArray(node?.content) ? node.content.filter((child) => child?.type === "listItem").length : 0;
}

/**
 * Each Word list paragraph opens as a one-item list. A numbered one must still
 * read 1, 2, 3 (or a, b, c), counting on from the items before it in the same
 * Word list the way Word counts: per list and level, a shallower item
 * restarting the deeper levels. Works on any top-level node sequence, keyed by
 * the native block each node came from, so every path that builds editor JSON
 * numbers the same way.
 */
export function renumberWordLists(nodes, blockById) {
  const counters = new Map();
  return nodes.map((node) => {
    const blockId = node?.attrs?.blockId;
    const list = record(record(typeof blockId === "string" ? blockById.get(blockId)?.attrs : undefined).list);
    if (node?.type !== "orderedList" || typeof list.numId !== "string" || list.isBullet !== false) return node;
    const level = wordListLevel(list);
    const levels = counters.get(list.numId) ?? [];
    const start = Number.isFinite(Number(list.start)) ? Number(list.start) : 1;
    const first = levels[level] === undefined ? start : levels[level] + 1;
    levels[level] = first + Math.max(1, topListItems(node)) - 1;
    levels.length = level + 1;
    counters.set(list.numId, levels);
    return node.attrs?.start === first ? node : { ...node, attrs: { ...node.attrs, start: first } };
  });
}

/** The Word list and level of a node that is one Word list paragraph, or null. */
function wordListParagraph(node, blockById) {
  if ((node?.type !== "bulletList" && node?.type !== "orderedList") || node.attrs?.nativeReadOnly === true) return null;
  if (node.content?.length !== 1 || node.content[0]?.type !== "listItem") return null;
  if ((node.content[0].content ?? []).some((child) => child?.type === "bulletList" || child?.type === "orderedList")) return null;
  const blockId = node.attrs?.blockId;
  const list = record(record(typeof blockId === "string" ? blockById.get(blockId)?.attrs : undefined).list);
  return typeof list.numId === "string" && list.numId ? { numId: list.numId, level: wordListLevel(list), blockId } : null;
}

/**
 * Consecutive paragraphs of one Word list open as one list node, nested by
 * their Word level, so Enter, Tab and Backspace work on the list as a whole.
 * The first paragraph's id stays the list node's; every later one is its
 * list item's, where `documentBlocksFromJson` reads it back. A nested list
 * node takes no id and no level: its place in the tree is its level.
 */
function groupWordLists(nodes, blockById) {
  const output = [];
  let stack = [];
  const item = (node, info) => ({ ...node.content[0], attrs: { ...node.content[0].attrs, blockId: info.blockId } });
  const nested = (node, info) => {
    const { listLevel: _level, blockId: _id, ...attrs } = node.attrs ?? {};
    return { ...node, attrs, content: [item(node, info)] };
  };
  for (const node of nodes) {
    const info = wordListParagraph(node, blockById);
    if (!info) {
      stack = [];
      output.push(node);
      continue;
    }
    while (stack.length && (stack.at(-1).level > info.level || stack.at(-1).numId !== info.numId)) stack.pop();
    // The same level in another shape (bullets under numbers) is its own list beside it.
    if (stack.at(-1)?.level === info.level && stack.at(-1).list.type !== node.type) stack.pop();
    // A level Word skips has no place in the tree: that item opens its own list at its level.
    if (stack.length && info.level > stack.at(-1).level + 1) stack = [];
    const top = stack.at(-1);
    if (top && top.level === info.level) {
      top.list.content.push(item(node, info));
      continue;
    }
    if (top) {
      const parentItem = top.list.content.at(-1);
      const child = nested(node, info);
      top.list.content[top.list.content.length - 1] = { ...parentItem, content: [...(parentItem.content ?? []), child] };
      stack.push({ ...info, list: child });
      continue;
    }
    const root = { ...node, content: [...node.content] };
    output.push(root);
    stack = [{ ...info, list: root }];
  }
  return output;
}

/** Word list paragraphs as the editor shows them: numbered as Word counts, grouped as Word draws them. */
export function shapeWordLists(nodes, blockById) {
  return groupWordLists(renumberWordLists(nodes, blockById), blockById);
}

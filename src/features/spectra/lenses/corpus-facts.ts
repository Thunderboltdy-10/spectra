import { strFromU8, unzipSync } from "fflate";

/**
 * Byte-level facts for an Office package. Sidecar `contains` claims are graded
 * against this object, never against the author's memory of the fixture.
 */
export type OfficePackageFacts = {
  parts: string[];
  partBytes: Record<string, number>;
  xml: string;
  documentXml: string;
  tableCount: number;
  nestedTables: boolean;
  mergedCells: boolean;
  sdtCount: number;
  sdtWrappedTables: boolean;
  dataBoundControls: boolean;
  trackedChanges: boolean;
  fields: boolean;
  footnotes: boolean;
  endnotes: boolean;
  comments: boolean;
  headers: boolean;
  footers: boolean;
  headerFooterTables: boolean;
  columns: boolean;
  textBox: boolean;
  ole: boolean;
  smartArt: boolean;
  alternateContent: number;
  pivotParts: boolean;
  externalLinks: boolean;
  mediaParts: boolean;
  videoParts: boolean;
  audioParts: boolean;
  vbaBytes: number;
  customXml: boolean;
  slideCount: number;
  notesSlideCount: number;
  transition: boolean;
  timing: boolean;
  canvas: { cx: number; cy: number; type: string | null } | null;
  formulas: Array<{ ref: string; text: string }>;
  unzipped: boolean;
  unzipError?: string;
};

const TABLE_OPEN = /<w:tbl[\s>]/g;

function normalizePart(name: string) {
  return name.replace(/^\/+/, "").replace(/\\/g, "/");
}

function count(haystack: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return haystack.match(new RegExp(pattern.source, flags))?.length ?? 0;
}

function nestedWordTables(xml: string) {
  const open = /<w:tbl[\s>]/g;
  const close = /<\/w:tbl>/g;
  let depth = 0;
  let nested = false;
  const tokens: Array<{ index: number; kind: "open" | "close" }> = [];
  for (const match of xml.matchAll(open)) tokens.push({ index: match.index ?? 0, kind: "open" });
  for (const match of xml.matchAll(close)) tokens.push({ index: match.index ?? 0, kind: "close" });
  tokens.sort((left, right) => left.index - right.index);
  for (const token of tokens) {
    if (token.kind === "open") {
      if (depth > 0) nested = true;
      depth += 1;
    } else {
      depth = Math.max(0, depth - 1);
    }
  }
  return nested;
}

function sdtWrappedTables(xml: string) {
  return /<w:sdt\b[\s\S]{0,4000}?<w:sdtContent\b[\s\S]{0,4000}?<w:tbl[\s>]/.test(xml);
}

function parseCanvas(xml: string) {
  const match = xml.match(/<p:sldSz\b([^>]*)\/?>/);
  if (!match) return null;
  const attrs = match[1] ?? "";
  const cx = Number(attrs.match(/\bcx="(\d+)"/)?.[1] ?? 0);
  const cy = Number(attrs.match(/\bcy="(\d+)"/)?.[1] ?? 0);
  const type = attrs.match(/\btype="([^"]+)"/)?.[1] ?? null;
  return cx && cy ? { cx, cy, type } : null;
}

function parseFormulas(xml: string) {
  const found: Array<{ ref: string; text: string }> = [];
  for (const match of xml.matchAll(/<c\b([^>]*)>[\s\S]*?<f\b[^>]*>([^<]*)<\/f>/g)) {
    const ref = match[1]?.match(/\br="([A-Z]+\d+)"/)?.[1];
    if (ref) found.push({ ref, text: match[2] ?? "" });
  }
  return found;
}

export function inspectOfficePackage(bytes: Uint8Array): OfficePackageFacts {
  try {
    const files = unzipSync(bytes);
    const parts = Object.keys(files).map(normalizePart).sort();
    const partBytes = Object.fromEntries(
      Object.entries(files).map(([name, value]) => [normalizePart(name), value.byteLength]),
    );
    const xmlParts = Object.entries(files).filter(([name]) =>
      /\.(xml|rels|vml)$/i.test(name),
    );
    const xml = xmlParts.map(([, value]) => strFromU8(value)).join("\n");
    const documentName =
      parts.find((name) => /(^|\/)word\/document\.xml$/i.test(name)) ??
      parts.find((name) => /(^|\/)xl\/workbook\.xml$/i.test(name)) ??
      parts.find((name) => /(^|\/)ppt\/presentation\.xml$/i.test(name)) ??
      "";
    const documentXml = documentName
      ? strFromU8(files[Object.keys(files).find((name) => normalizePart(name) === documentName)!]!)
      : "";
    const sheetXml = Object.entries(files)
      .filter(([name]) => /xl\/worksheets\/sheet\d+\.xml$/i.test(normalizePart(name)))
      .map(([, value]) => strFromU8(value))
      .join("\n");
    return {
      parts,
      partBytes,
      xml,
      documentXml,
      tableCount: count(xml, TABLE_OPEN),
      nestedTables: nestedWordTables(xml),
      mergedCells: /<(?:w:)?(?:gridSpan|vMerge)\b/.test(xml),
      sdtCount: count(xml, /<w:sdt[\s>]/),
      sdtWrappedTables: sdtWrappedTables(xml),
      dataBoundControls: /<(?:w:)?dataBinding\b/.test(xml),
      trackedChanges: /<(?:w:)?(?:ins|del|moveFrom|moveTo)\b/.test(xml),
      fields: /<(?:w:)?(?:fldChar|instrText|fldSimple)\b/.test(xml),
      footnotes:
        parts.some((name) => /word\/footnotes\.xml$/i.test(name)) ||
        /footnoteReference/i.test(xml),
      endnotes:
        parts.some((name) => /word\/endnotes\.xml$/i.test(name)) ||
        /endnoteReference/i.test(xml),
      comments: parts.some((name) => /(comments|comments\d+)\.xml$/i.test(name)),
      headers: parts.some((name) => /word\/header\d+\.xml$/i.test(name)),
      footers: parts.some((name) => /word\/footer\d+\.xml$/i.test(name)),
      headerFooterTables: Object.entries(files).some(
        ([name, value]) =>
          /word\/(?:header|footer)\d+\.xml$/i.test(normalizePart(name)) &&
          /<w:tbl[\s>]/.test(strFromU8(value)),
      ),
      columns: /<(?:w:)?cols\b/.test(xml),
      textBox: /<(?:w:txbxContent|v:textbox|wps:txbx)\b/.test(xml),
      ole: parts.some((name) => /(embeddings|oleObject)/i.test(name)),
      smartArt: parts.some((name) => /(diagrams|smartArt)/i.test(name)),
      alternateContent: count(xml, /<(?:\w+:)?AlternateContent\b/),
      pivotParts: parts.some((name) => /pivot(Cache|Table)/i.test(name)),
      externalLinks: parts.some((name) => /externalLink/i.test(name)),
      mediaParts: parts.some((name) => /(^|\/)(?:word|ppt|xl)\/media\//i.test(name)),
      videoParts: parts.some((name) => /\.(mp4|mov|m4v|wmv)$/i.test(name)),
      audioParts: parts.some((name) => /\.(wav|mp3|m4a)$/i.test(name)),
      vbaBytes: Object.entries(partBytes).reduce(
        (sum, [name, size]) => (/vbaProject/i.test(name) ? sum + size : sum),
        0,
      ),
      customXml: parts.some((name) => /customXml\//i.test(name)),
      slideCount: parts.filter((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name)).length,
      notesSlideCount: parts.filter((name) =>
        /ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name),
      ).length,
      transition: /<(?:\w+:)?transition\b/.test(xml),
      timing: /<(?:\w+:)?timing\b/.test(xml),
      canvas: parseCanvas(xml),
      formulas: parseFormulas(sheetXml),
      unzipped: true,
    };
  } catch (error) {
    return {
      parts: [],
      partBytes: {},
      xml: "",
      documentXml: "",
      tableCount: 0,
      nestedTables: false,
      mergedCells: false,
      sdtCount: 0,
      sdtWrappedTables: false,
      dataBoundControls: false,
      trackedChanges: false,
      fields: false,
      footnotes: false,
      endnotes: false,
      comments: false,
      headers: false,
      footers: false,
      headerFooterTables: false,
      columns: false,
      textBox: false,
      ole: false,
      smartArt: false,
      alternateContent: 0,
      pivotParts: false,
      externalLinks: false,
      mediaParts: false,
      videoParts: false,
      audioParts: false,
      vbaBytes: 0,
      customXml: false,
      slideCount: 0,
      notesSlideCount: 0,
      transition: false,
      timing: false,
      canvas: null,
      formulas: [],
      unzipped: false,
      unzipError: error instanceof Error ? error.message : "Package could not be unzipped.",
    };
  }
}

function hasPart(facts: OfficePackageFacts, claim: string) {
  const needle = normalizePart(claim).toLowerCase();
  return facts.parts.some(
    (name) =>
      name.toLowerCase() === needle ||
      name.toLowerCase().endsWith(`/${needle}`) ||
      name.toLowerCase().includes(needle),
  );
}

function formulaAt(facts: OfficePackageFacts, ref: string, pattern: RegExp) {
  return facts.formulas.some(
    (formula) => formula.ref === ref && pattern.test(formula.text),
  );
}

/**
 * Grade one sidecar `contains` string against inspected bytes.
 * Unmapped claims fail on purpose so a new poetic label cannot drift in again.
 */
export function claimHolds(facts: OfficePackageFacts, claim: string): string | null {
  const text = claim.trim();
  if (!text) return "empty claim";
  if (!facts.unzipped) {
    if (/corrupt|truncated|password|unsupported|invalid zip|encrypted/i.test(text)) return null;
    return facts.unzipError ?? "package did not unzip";
  }

  const partLike = /[\\/]|\.(xml|bin|rels|png|jpeg|jpg|wmf|emf|wav|mp4)\b/i.test(text)
    && !/\s/.test(text.replace(/ authored by Office$/i, ""));
  if (partLike || /^xl\/|^word\/|^ppt\//i.test(text)) {
    const path = text.replace(/\s+authored by Office$/i, "");
    if (hasPart(facts, path)) {
      if (/vbaProject\.bin/i.test(path) && facts.vbaBytes < 1024)
        return `${path} is smaller than a real Office VBA project`;
      return null;
    }
    return `missing part ${path}`;
  }

  const slideCount = text.match(/^(\d+)\s+slides$/i);
  if (slideCount) {
    const expected = Number(slideCount[1]);
    return facts.slideCount === expected
      ? null
      : `slide count ${facts.slideCount}, claimed ${expected}`;
  }
  const notesCount = text.match(/^(\d+)\s+notes slides$/i);
  if (notesCount) {
    const expected = Number(notesCount[1]);
    return facts.notesSlideCount === expected
      ? null
      : `notes slide count ${facts.notesSlideCount}, claimed ${expected}`;
  }

  const formulaClaim = text.match(/formula in ([A-Z]+\d+)/i);
  if (formulaClaim) {
    const ref = formulaClaim[1]!.toUpperCase();
    if (/XLOOKUP/i.test(text))
      return formulaAt(facts, ref, /XLOOKUP/)
        ? null
        : `no XLOOKUP formula at ${ref}`;
    if (/\bSUM\b/i.test(text))
      return formulaAt(facts, ref, /SUM/)
        ? null
        : `no SUM formula at ${ref}`;
    return facts.formulas.some((formula) => formula.ref === ref)
      ? null
      : `no formula at ${ref}`;
  }

  const mapped: Array<[RegExp, boolean, string]> = [
    [/merged and nested tables/i, facts.mergedCells && facts.nestedTables, "merged and nested tables"],
    [/nested tables?/i, facts.nestedTables, "nested tables"],
    [/merged (?:and nested )?tables?|merged cells/i, facts.mergedCells, "merged cells"],
    [/sdt-wrapped table|content-control-wrapped table|table wrapped in (?:a )?content control/i, facts.sdtWrappedTables, "sdt-wrapped table"],
    [/one body table/i, facts.tableCount >= 1, "a body table"],
    [/^tables?$/i, facts.tableCount >= 1, "a table"],
    [/data-bound content controls/i, facts.dataBoundControls, "data-bound content controls"],
    [/content controls?/i, facts.sdtCount > 0, "content controls"],
    [/custom xml/i, facts.customXml, "custom XML"],
    [/tracked revisions|tracked changes/i, facts.trackedChanges, "tracked changes"],
    [/^fields$|toc and field codes|word field|field codes/i, facts.fields, "fields"],
    [/omml equation|equation/i, /<(?:m:)?oMath/i.test(facts.xml), "an OMML equation"],
    [/multi-level numbering|numbering\/style inheritance/i, facts.parts.some((name) => /numbering\.xml$/i.test(name)) || /<(?:w:)?numPr\b/.test(facts.xml), "numbering"],
    [/unknown future-extension markup/i, /Ignorable=|mc:Compat/.test(facts.xml) || /unknown/i.test(facts.xml), "unknown-extension markup"],
    [/macro-enabled docm container/i, facts.vbaBytes > 0 || facts.parts.some((name) => /vbaProject/i.test(name)) || /macroEnabled/i.test(facts.xml), "a macro-enabled package"],
    [/floating text box/i, facts.textBox, "a floating text box"],
    [/bibliography source/i, /<(?:\w+:)?Source\b/.test(facts.xml) || facts.customXml, "a bibliography source"],
    [/footnotes?/i, facts.footnotes, "footnotes"],
    [/endnotes?/i, facts.endnotes, "endnotes"],
    [/^comments$/i, facts.comments, "comments"],
    [/headers and footers/i, facts.headers && facts.footers, "header and footer parts"],
    [/^headers?$/i, facts.headers, "header parts"],
    [/^footers?$/i, facts.footers, "footer parts"],
    [/tables? in headers?/i, facts.headerFooterTables, "a table in a header or footer"],
    [/section variation|columns/i, facts.columns || /sectPr/i.test(facts.xml), "section or column markup"],
    [/style inheritance/i, /w:styles|w:pStyle/i.test(facts.xml), "style markup"],
    [/text box/i, facts.textBox, "a text box"],
    [/embedded ole object|^ole$/i, facts.ole, "an embedded OLE part"],
    [/smartart/i, facts.smartArt, "SmartArt / diagram parts"],
    [/^notes slide$/i, facts.notesSlideCount > 0, "a notes slide"],
    [/^notes$/i, facts.footnotes || facts.endnotes || facts.comments || facts.notesSlideCount > 0, "notes"],
    [/slide master/i, facts.parts.some((name) => /slideMasters/i.test(name)), "a slide master"],
    [/chart part|^charts?$/i, facts.parts.some((name) => /\/charts\//i.test(name)), "a chart part"],
    [/alternatecontent/i, facts.alternateContent > 0, "AlternateContent"],
    [/transition/i, facts.transition, "a transition"],
    [/animation timing|^p:timing/i, facts.timing, "timing"],
    [/media part|media/i, facts.mediaParts || facts.audioParts || facts.videoParts, "a media part"],
    [/embedded workbook/i, facts.ole || facts.parts.some((name) => /embeddings/i.test(name)), "an embedded workbook"],
    [/video/i, facts.videoParts, "a video part"],
    [/pivot/i, facts.pivotParts, "pivot parts"],
    [/external links?/i, facts.externalLinks, "external link parts"],
    [/locale|german decimal|european number/i, /#,##0|#\.##0|\[\$/.test(facts.xml), "locale number formats"],
    [/non-16:9|4:3|screen4x3/i, Boolean(facts.canvas && facts.canvas.cx / facts.canvas.cy < 1.55), "a non-16:9 canvas"],
    [/vba|macro/i, facts.vbaBytes >= 1024, "a real VBA project"],
  ];

  for (const [pattern, held, label] of mapped) {
    if (!pattern.test(text)) continue;
    return held ? null : `bytes do not contain ${label}`;
  }

  return `unmapped sidecar claim: ${text}`;
}

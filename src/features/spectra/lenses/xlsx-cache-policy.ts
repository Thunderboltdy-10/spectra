import { Workbook } from "@ariadng/office/xlsx";
import { XmlElement } from "@ariadng/office/xml";

const SML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const WORKBOOK_CHILD_ORDER = [
  "fileVersion",
  "fileSharing",
  "workbookPr",
  "workbookProtection",
  "bookViews",
  "sheets",
  "functionGroups",
  "externalReferences",
  "definedNames",
  "calcPr",
  "oleSize",
  "customWorkbookViews",
  "pivotCaches",
  "smartTags",
  "extLst",
];

function descendants(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  const pending = [...root.elements()].reverse();
  while (pending.length) {
    const child = pending.pop()!;
    result.push(child);
    const nested = child.elements();
    for (let index = nested.length - 1; index >= 0; index -= 1)
      pending.push(nested[index]!);
  }
  return result;
}

/**
 * Invalidate all retained formula caches after an input edit. This keeps the
 * native formula text (including functions Spectra cannot evaluate) and marks
 * the workbook for a real Excel recalculation on open. It is intentionally a
 * formula-cell walk at save time, not a whole-cell hash on every edit.
 */
export async function invalidateXlsxFormulaCaches(workbook: Workbook) {
  let invalidated = 0;
  let formulaCells = 0;
  for (const sheet of workbook.sheets()) {
    const document = await workbook.office.xml(sheet.partName);
    let dirty = false;
    for (const cell of descendants(document.root).filter(
      (candidate) =>
        candidate.namespaceUri() === SML && candidate.localName === "c",
    )) {
      if (!cell.find(SML, "f")) continue;
      formulaCells += 1;
      for (const child of [...cell.elements()]) {
        if (
          child.namespaceUri() === SML &&
          (child.localName === "v" || child.localName === "is")
        ) {
          cell.removeChild(child);
          invalidated += 1;
          dirty = true;
        }
      }
      // A formula without a cached result must not retain a cached-value type
      // such as `str` or `e` from the previous package.
      if (cell.getAttribute("t") !== undefined) {
        cell.removeAttribute("t");
        dirty = true;
      }
    }
    if (dirty) workbook.office.markDirty(sheet.partName);
  }
  if (!formulaCells) return 0;

  workbook._dropCalcChain();
  const workbookDocument = await workbook.office.xml(
    workbook.office.mainPart.name,
  );
  let calcPr = workbookDocument.root.find(SML, "calcPr");
  if (!calcPr) {
    calcPr = new XmlElement("calcPr", workbookDocument.root.prefix);
    const calcPrIndex = WORKBOOK_CHILD_ORDER.indexOf("calcPr");
    const reference = workbookDocument.root.elements().find((candidate) => {
      const index = WORKBOOK_CHILD_ORDER.indexOf(candidate.localName);
      return index >= 0 && index > calcPrIndex;
    });
    workbookDocument.root.insertBefore(calcPr, reference ?? null);
  }
  calcPr.setAttribute("calcMode", "auto");
  calcPr.setAttribute("fullCalcOnLoad", "1");
  calcPr.setAttribute("forceFullCalc", "1");
  workbook.office.markDirty(workbook.office.mainPart.name);
  return invalidated;
}

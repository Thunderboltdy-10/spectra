/*
 * The block of a document a region names. The semantic layer indexes a
 * document's top-level blocks by their stable block id (`data-block-id`, or
 * "block-N" for a block without one) and packs neighbours into one passage,
 * labelled with the heading above them. A citation may name the heading.
 */
import { foldText, headingIn, itemInPassage, ordinalIn, regionTexts, type WorkRegion } from "./locate";

const HEADINGS = "h1, h2, h3, h4, h5, h6";

/** The top-level blocks of a rendered document, in reading order. */
function topLevelBlocks(dom: Element) {
  return [...dom.children].filter((child) => child.hasAttribute("data-block-id"));
}

/** The block `region` names in the document rendered at `dom`, or null. */
export function documentBlockFor(dom: Element, region: WorkRegion): Element | null {
  const blocks = topLevelBlocks(dom);
  const textOf = (block: Element) => block.textContent ?? "";
  let start = blocks.findIndex((block) => block.getAttribute("data-block-id") === region.id);
  if (start < 0) {
    // A block id deeper in the document (a list item, a cell) is still a place.
    const nested = [...dom.querySelectorAll("[data-block-id]")].find((block) => block.getAttribute("data-block-id") === region.id);
    if (nested) return nested;
    const position = ordinalIn(region.id, ["block"]);
    if (position !== null && blocks[position]) start = position;
  }
  if (start >= 0) return itemInPassage(blocks, start, textOf, region.excerpt) ?? null;
  // No block by id: a heading the label or the locator names.
  const headings = [...dom.querySelectorAll(HEADINGS)];
  for (const text of [region.label, ...regionTexts(region)]) {
    const heading = headingIn(text);
    if (!heading) continue;
    const found =
      headings.find((element) => foldText(element.textContent ?? "") === heading) ??
      headings.find((element) => foldText(element.textContent ?? "").startsWith(heading));
    if (!found) continue;
    const top = blocks.find((block) => block === found || block.contains(found));
    if (!top || !region.excerpt) return top ?? found;
    return itemInPassage(blocks, blocks.indexOf(top), textOf, region.excerpt) ?? top;
  }
  return null;
}

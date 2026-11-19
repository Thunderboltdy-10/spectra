import type { CSSProperties } from "react";
import { twipsCss, type PageGeometry } from "../lenses/page-geometry";

/**
 * The running head and foot drawn in each sheet's margins, where Word prints
 * them: the header its distance below the paper's top edge, the footer its
 * distance above the bottom. Page numbers are each page's own. They are page
 * furniture, so they never take the caret; the page menu edits them.
 */

export type PageChromeTemplates = {
  header?: string;
  footer?: string;
  firstHeader?: string;
  firstFooter?: string;
};

/** A template's page fields filled for one page. */
export function fillChrome(template: string, page: number, total: number) {
  return template.replace(/\{(PAGE|NUMPAGES|SECTIONPAGES)\}/gu, (_match, field: string) =>
    String(field === "PAGE" ? page : total),
  );
}

/**
 * Word lays a header line on its style's tab stops: centre, then right. A
 * centred or right-aligned line reaches here already set on those stops.
 */
function ChromeLine({ line }: { line: string }) {
  if (!line.includes("\t")) return <p>{line || "\u00a0"}</p>;
  const [left = "", center = "", ...right] = line.split("\t");
  return (
    <p data-tabbed="">
      <span>{left}</span>
      <span>{center}</span>
      <span>{right.join(" ")}</span>
    </p>
  );
}

export function DocumentPageChrome({
  total,
  geometry,
  templates,
  sheetGap,
}: {
  total: number;
  geometry: PageGeometry;
  templates: PageChromeTemplates;
  /** The strip at the foot of each sheet slot that shows the desk between sheets. */
  sheetGap: number;
}) {
  if (!templates.header && !templates.footer && !templates.firstHeader && !templates.firstFooter) return null;
  const sheets = Array.from({ length: Math.max(1, total) }, (_, index) => index);
  return (
    <div className="document-page-chrome" aria-hidden>
      {sheets.map((index) => {
        const first = index === 0;
        const header = first && templates.firstHeader !== undefined ? templates.firstHeader : templates.header;
        const footer = first && templates.firstFooter !== undefined ? templates.firstFooter : templates.footer;
        const style = {
          "--sheet": index,
          "--chrome-header": twipsCss(geometry.header),
          "--chrome-footer": twipsCss(geometry.footer),
          "--chrome-left": twipsCss(geometry.left),
          "--chrome-right": twipsCss(geometry.right),
          "--chrome-gap": `${sheetGap}px`,
        } as CSSProperties;
        return (
          <div key={index} className="document-page-chrome-sheet" style={style}>
            {header ? (
              <div data-slot="header">
                {fillChrome(header, index + 1, total).split("\n").map((line, key) => (
                  <ChromeLine key={key} line={line} />
                ))}
              </div>
            ) : null}
            {footer ? (
              <div data-slot="footer">
                {fillChrome(footer, index + 1, total).split("\n").map((line, key) => (
                  <ChromeLine key={key} line={line} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

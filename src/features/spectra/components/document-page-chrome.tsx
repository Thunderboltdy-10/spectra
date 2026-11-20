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
  /** Even pages' own, when Word sets odd and even pages apart. */
  evenHeader?: string;
  evenFooter?: string;
};

/** The header and footer one page draws: the first page's own, else an even page's, else the default. */
export function chromeForPage(templates: PageChromeTemplates, page: number) {
  const first = page === 1;
  const even = page % 2 === 0;
  const pick = (own: string | undefined, firstOwn: string | undefined, evenOwn: string | undefined) =>
    first && firstOwn !== undefined ? firstOwn : even && evenOwn !== undefined ? evenOwn : own;
  return {
    header: pick(templates.header, templates.firstHeader, templates.evenHeader),
    footer: pick(templates.footer, templates.firstFooter, templates.evenFooter),
  };
}

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
  if (!Object.values(templates).some(Boolean)) return null;
  const sheets = Array.from({ length: Math.max(1, total) }, (_, index) => index);
  return (
    <div className="document-page-chrome" aria-hidden>
      {sheets.map((index) => {
        const { header, footer } = chromeForPage(templates, index + 1);
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

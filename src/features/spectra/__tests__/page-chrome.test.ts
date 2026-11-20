import { describe, expect, it } from "vitest";
import { chromeForPage } from "../components/document-page-chrome";

describe("chromeForPage", () => {
  const templates = { header: "odd", footer: "odd foot", firstHeader: "", evenHeader: "even", evenFooter: "" };

  it("draws the first page's own, then even and odd pages' own", () => {
    expect(chromeForPage(templates, 1)).toEqual({ header: "", footer: "odd foot" });
    expect(chromeForPage(templates, 2)).toEqual({ header: "even", footer: "" });
    expect(chromeForPage(templates, 3)).toEqual({ header: "odd", footer: "odd foot" });
  });

  it("draws the default on every page when Word sets no others", () => {
    expect(chromeForPage({ header: "h" }, 2)).toEqual({ header: "h", footer: undefined });
  });
});

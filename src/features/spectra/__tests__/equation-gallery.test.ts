import { describe, expect, it } from "vitest";
import { parseXml } from "@ariadng/office/xml";
import { MATH_GALLERIES } from "../editor/equation-gallery";
import { normalizeMathLatex, templateAsLatex } from "../editor/math-field";
import { latexToEquation } from "../lenses/equation-interchange";
import { ommlToLatex } from "../lenses/docx-lens";

/** A gallery entry with every empty slot typed in. */
const filled = (latex: string) => latex.replace(/#[?0@]/gu, "x");

describe("the Equation tab's galleries", () => {
  const entries = MATH_GALLERIES.flatMap((gallery) =>
    gallery.sections.flatMap((section) => section.items.map((item) => ({ gallery: gallery.label, ...item }))));

  it("offers Word's structure groups, symbols and ready-made equations", () => {
    expect(MATH_GALLERIES.map((gallery) => gallery.label)).toEqual([
      "Equation", "Fraction", "Script", "Radical", "Integral", "Large Operator", "Bracket",
      "Function", "Accent", "Limit and Log", "Operator", "Matrix", "Symbols",
    ]);
    expect(entries.length).toBeGreaterThan(250);
  });

  it.each(entries.map((entry) => [`${entry.gallery}: ${entry.label}`, entry] as const))(
    "%s becomes an editable Word equation and reads back the same",
    (_name, entry) => {
      const latex = filled(entry.latex);
      const written = latexToEquation(latex, "block");
      expect(written.diagnostics, latex).toEqual([]);
      const reread = ommlToLatex(parseXml(written.xml).root);
      const again = latexToEquation(reread, "block");
      expect(again.diagnostics, `${latex} → ${reread}`).toEqual([]);
      // What Word holds after a second pass is what it held after the first.
      expect(again.xml, `${latex} → ${reread}`).toBe(written.xml);
    },
  );

  it("an entry's empty slots are kept out of the saved LaTeX", () => {
    expect(templateAsLatex("\\frac{#?}{#?}")).toBe("\\frac{}{}");
    expect(latexToEquation("\\frac{}{}").supported).toBe(true);
    // MathLive writes one-character arguments without braces, as TeX allows.
    for (const compact of ["\frac12", "\frac\pi2", "\binom nk", "\sqrt2"]) expect(latexToEquation(compact).diagnostics, compact).toEqual([]);
    expect(normalizeMathLatex("\\frac{\\placeholder{}}{2}+\\mleft(x\\mright)")).toBe("\\frac{}{2}+\\left(x\\right)");
  });
});

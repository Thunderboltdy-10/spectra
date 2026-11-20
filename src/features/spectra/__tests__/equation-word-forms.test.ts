import { describe, expect, it } from "vitest";
import { parseXml } from "@ariadng/office/xml";
import { latexToEquation, equationNodeToLatex } from "../lenses/equation-interchange";
import { ommlToLatex } from "../lenses/docx-lens";

/* Forms Word writes that Spectra now reads as editable equations, each surviving a trip through Word. */
const forms = [
  String.raw`Q\in{}H\backslash{}\{O\}`,
  String.raw`G\mathbin{:}=E\left({F}_{29}\right)`,
  String.raw`\left〈P\right〉=\{O,P\}`,
  String.raw`\left〈P\right〉`,
  String.raw`[a,b]`,
  String.raw`x\in[0,1)`,
  String.raw`E\,\underset{\to{}}{degree\,2}\,{E}_{1,0}`,
  String.raw`\overset{\to{}}{AB}`,
  String.raw`\operatorname{kerL}{V}=\left\{0\right\}`,
  String.raw`\operatorname{Var}{X}`,
];

const throughWord = (latex: string) => ommlToLatex(parseXml(latexToEquation(latex).xml).root);
// How the lens compares an equation it asked for with the one Word reads back.
const form = (latex: string) => throughWord(latex)
  .replace(/\\(?:mathrm|operatorname|text)\b/g, "")
  .replace(/\\[,;:!]/g, "")
  .replace(/[{}\s\u2003\u2002\u2009]+/g, "");

describe("equations as Word writes them", () => {
  it.each(forms)("reads %s as an editable equation that Word reads back the same", (latex) => {
    const equation = latexToEquation(latex);
    expect(equation.diagnostics).toEqual([]);
    const readBack = throughWord(latex);
    expect(latexToEquation(readBack).supported).toBe(true);
    expect(form(readBack)).toBe(form(latex));
    // The editor's canonical form is the same equation again.
    expect(form(equationNodeToLatex(equation.ast))).toBe(form(latex));
  });

  it("keeps what it cannot write as Word would", () => {
    expect(latexToEquation(String.raw`\underset{x\to0}{\lim}`).supported).toBe(false);
    expect(latexToEquation(String.raw`\operatorname{limsigmato0Dsigma}{x}`).supported).toBe(false);
    expect(latexToEquation(String.raw`\operatorname{limsigmatoinftyEsigma}{x}`).supported).toBe(false);
    expect(latexToEquation(String.raw`\sqrt[3]{x}`).ast).toMatchObject({ kind: "root" });
  });
});

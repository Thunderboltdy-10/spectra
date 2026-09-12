import { describe, expect, it } from "vitest";
import { equationNodeToLatex, latexToEquation } from "../lenses/equation-interchange";

describe("structured equation interchange", () => {
  it("writes editable OMML for school equation constructs", () => {
    const result = latexToEquation(String.raw`\frac{a_1^2+\sqrt{b}}{\sum_{i=1}^{n} i}`, "block");
    expect(result.supported).toBe(true);
    expect(result.xml).toContain("<m:oMathPara");
    expect(result.xml).toContain("<m:f>");
    expect(result.xml).toContain("<m:rad>");
    expect(result.xml).toContain("<m:nary>");
    expect(result.xml).not.toContain("Equation:");
  });

  it("supports delimiters, matrices and aligned rows", () => {
    const result = latexToEquation(String.raw`\left(\begin{matrix}a&b\\c&d\end{matrix}\right)`, "inline");
    expect(result.supported).toBe(true);
    expect(result.xml).toContain("<m:d>");
    expect(result.xml).toContain("<m:m>");
    expect(result.xml).toContain('<m:begChr m:val="("/>');
    expect(result.xml).toContain('<m:endChr m:val=")"/>');
    expect(result.ast).toMatchObject({
      kind: "delimiter",
      left: "(",
      right: ")",
      body: { kind: "matrix", rows: [[{ kind: "text", value: "a" }, { kind: "text", value: "b" }], [{ kind: "text", value: "c" }, { kind: "text", value: "d" }]] },
    });
  });

  it("keeps pmatrix/bmatrix identities and grouped multi-character cells", () => {
    const pmatrix = latexToEquation(String.raw`\begin{pmatrix}{x+1}&\alpha\\\sqrt{y}&z\end{pmatrix}`);
    const bmatrix = latexToEquation(String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`);

    expect(pmatrix.supported).toBe(true);
    expect(pmatrix.ast).toMatchObject({ kind: "matrix", delimiter: { left: "(", right: ")" } });
    expect((pmatrix.ast as Extract<typeof pmatrix.ast, { kind: "matrix" }>).rows).toHaveLength(2);
    expect((pmatrix.ast as Extract<typeof pmatrix.ast, { kind: "matrix" }>).rows[0]).toHaveLength(2);
    expect(pmatrix.xml).toContain('<m:begChr m:val="("/>');
    expect(pmatrix.xml).toContain('<m:endChr m:val=")"/>');
    expect(pmatrix.xml).toContain("<m:mPr/>");
    expect(bmatrix.ast).toMatchObject({ kind: "matrix", delimiter: { left: "[", right: "]" } });
    expect(bmatrix.xml).toContain('<m:begChr m:val="["/>');
    expect(bmatrix.xml).toContain('<m:endChr m:val="]"/>');
  });

  it("retains aligned columns, functions, indexed roots and nary limits/body", () => {
    const result = latexToEquation(String.raw`\begin{aligned}x&=\sin{x}\\y&=\sum\limits_{i=1}^{n}\sqrt[3]{i}\end{aligned}`);
    expect(result.supported).toBe(true);
    expect(result.ast).toMatchObject({
      kind: "matrix",
      aligned: true,
      rows: [
        [{ kind: "text", value: "x" }, { kind: "sequence", children: [{ kind: "text", value: "=" }, { kind: "function", name: "sin" }] }],
        [{ kind: "text", value: "y" }, { kind: "sequence", children: [{ kind: "text", value: "=" }, { kind: "operator", value: "∑", sub: expect.anything(), sup: expect.anything(), body: { kind: "root" } }] }],
      ],
    });
    expect(result.xml).toContain("<m:eqArr>");
    expect(result.xml).toContain("<m:eqArrPr/>");
    expect(result.xml.match(/<m:e>/g)).toHaveLength(5);
    expect(result.xml).toContain('<m:limLoc m:val="undOvr"/>');
    expect(result.xml).toContain("<m:func>");
    expect(result.xml).toContain('<m:degHide m:val="0"/>');
    expect(equationNodeToLatex(result.ast)).toContain(String.raw`\begin{aligned}`);
  });

  it("rejects truncated, unbalanced, unknown and over-budget input", () => {
    for (const source of [
      String.raw`\frac{a}`,
      String.raw`\left(x`,
      String.raw`\begin{matrix}a&b`,
      String.raw`\unknown{z}`,
      "x".repeat(100_001),
    ]) {
      const result = latexToEquation(source);
      expect(result.supported, source).toBe(false);
      expect(result.diagnostics.length, source).toBeGreaterThan(0);
      expect(result.unsupported.length, source).toBeGreaterThan(0);
    }
  });

  it("reports unsupported commands without pretending fidelity", () => {
    const result = latexToEquation(String.raw`\unknown{z}`);
    expect(result.supported).toBe(false);
    expect(result.unsupported).toContain("\\unknown");
    expect(result.xml).toContain("\\unknown");
  });
});

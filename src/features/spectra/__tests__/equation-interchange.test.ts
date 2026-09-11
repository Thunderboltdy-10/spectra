import { describe, expect, it } from "vitest";
import { latexToEquation } from "../lenses/equation-interchange";

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
    expect(result.xml).toContain("m:begChr");
  });

  it("reports unsupported commands without pretending fidelity", () => {
    const result = latexToEquation(String.raw`\unknown{z}`);
    expect(result.supported).toBe(false);
    expect(result.unsupported).toContain("\\unknown");
    expect(result.xml).toContain("\\unknown");
  });
});

/**
 * Small, loss-aware interchange for school equations.  The AST is deliberately
 * finite: unsupported LaTeX remains a raw node and callers can preserve the
 * original OMML subtree instead of silently flattening it.
 */
export type EquationNode =
  | { kind: "text"; value: string }
  | { kind: "sequence"; children: EquationNode[] }
  | { kind: "fraction"; numerator: EquationNode; denominator: EquationNode }
  | { kind: "root"; degree?: EquationNode; body: EquationNode }
  | { kind: "script"; base: EquationNode; sub?: EquationNode; sup?: EquationNode }
  | { kind: "operator"; value: string; sub?: EquationNode; sup?: EquationNode; body?: EquationNode }
  | { kind: "delimiter"; left: string; right: string; body: EquationNode }
  | { kind: "matrix"; rows: EquationNode[][]; aligned: boolean }
  | { kind: "raw"; latex: string };

export type EquationInterchange = {
  ast: EquationNode;
  xml: string;
  supported: boolean;
  unsupported: string[];
};

const XML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const operators: Record<string, string> = {
  sum: "∑", int: "∫", iint: "∬", iiint: "∭", oint: "∮", prod: "∏",
  coprod: "∐", bigcup: "⋃", bigcap: "⋂",
};
const functions = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh", "log", "ln", "exp", "min", "max", "det", "gcd"]);

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function text(value: string) { return `<m:r><m:t xml:space="preserve">${escapeXml(value)}</m:t></m:r>`; }
function slot(name: string, value: EquationNode) { return `<m:${name}>${toOmml(value)}</m:${name}>`; }

function toOmml(node: EquationNode): string {
  switch (node.kind) {
    case "text": return text(node.value);
    case "raw": return text(node.latex);
    case "sequence": return node.children.map(toOmml).join("");
    case "fraction": return `<m:f><m:num>${toOmml(node.numerator)}</m:num><m:den>${toOmml(node.denominator)}</m:den></m:f>`;
    case "root": return `<m:rad>${node.degree ? `<m:deg>${toOmml(node.degree)}</m:deg>` : ""}<m:e>${toOmml(node.body)}</m:e></m:rad>`;
    case "script": {
      const tag = node.sub && node.sup ? "sSubSup" : node.sub ? "sSub" : "sSup";
      return `<m:${tag}>${slot("e", node.base)}${node.sub ? slot("sub", node.sub) : ""}${node.sup ? slot("sup", node.sup) : ""}</m:${tag}>`;
    }
    case "operator": return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(node.value)}"/></m:naryPr>${node.sub ? slot("sub", node.sub) : ""}${node.sup ? slot("sup", node.sup) : ""}${node.body ? slot("e", node.body) : ""}</m:nary>`;
    case "delimiter": return `<m:d><m:dPr><m:begChr m:val="${escapeXml(node.left)}"/><m:endChr m:val="${escapeXml(node.right)}"/></m:dPr><m:e>${toOmml(node.body)}</m:e></m:d>`;
    case "matrix": return `<m:${node.aligned ? "eqArr" : "m"}>${node.rows.map((row) => node.aligned ? `<m:e>${row.map(toOmml).join("")}</m:e>` : `<m:mr>${row.map((cell) => `<m:e>${toOmml(cell)}</m:e>`).join("")}</m:mr>`).join("")}</m:${node.aligned ? "eqArr" : "m"}>`;
  }
}

class LatexParser {
  private index = 0;
  readonly unsupported: string[] = [];
  constructor(private readonly source: string) {}
  parse(): EquationNode { return this.sequence(); }
  private peek() { return this.source[this.index] ?? ""; }
  private sequence(stop?: string): EquationNode {
    const children: EquationNode[] = [];
    while (this.index < this.source.length && this.peek() !== stop) {
      if (stop === "\\right" && this.source.startsWith("\\right", this.index)) break;
      if (/\s/.test(this.peek())) { this.index++; continue; }
      children.push(this.atom());
    }
    if (stop && this.peek() === stop) this.index++;
    return children.length === 1 ? children[0]! : { kind: "sequence", children };
  }
  private group(): EquationNode {
    if (this.peek() === "{") { this.index++; return this.sequence("}"); }
    return this.atom();
  }
  private command(): EquationNode {
    this.index++;
    const match = this.source.slice(this.index).match(/^[A-Za-z]+/);
    const name = match?.[0] ?? this.peek();
    this.index += name.length || 1;
    if (name === "frac") return { kind: "fraction", numerator: this.group(), denominator: this.group() };
    if (name === "sqrt") {
      const degree = this.peek() === "[" ? (this.index++, this.sequence("]")) : undefined;
      return { kind: "root", ...(degree ? { degree } : {}), body: this.group() };
    }
    if (operators[name]) return this.script({ kind: "operator", value: operators[name]! });
    if (name === "left") {
      const left = this.peek(); this.index++;
      const body = this.sequence("\\right");
      if (this.source.startsWith("\\right", this.index)) this.index += "\\right".length;
      const right = this.peek(); if (right) this.index++;
      return { kind: "delimiter", left, right, body };
    }
    if (name === "begin") {
      const env = this.groupText();
      const aligned = env === "aligned" || env === "align";
      if (!aligned && env !== "matrix" && env !== "pmatrix" && env !== "bmatrix") return this.unsupportedNode(`\\begin{${env}}`);
      const rows: EquationNode[][] = [[]];
      while (this.index < this.source.length && !this.source.slice(this.index).startsWith(`\\end{${env}}`)) {
        if (this.source.startsWith("\\\\", this.index)) { this.index += 2; rows.push([]); continue; }
        if (this.peek() === "&") { this.index++; continue; }
        rows[rows.length - 1]!.push(this.atom());
      }
      if (this.source.slice(this.index).startsWith(`\\end{${env}}`)) this.index += env.length + 6;
      return { kind: "matrix", rows, aligned };
    }
    if (functions.has(name)) return { kind: "text", value: name };
    const symbols: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", pi: "π", infinity: "∞", pm: "±", times: "×", cdot: "⋅", leq: "≤", geq: "≥", neq: "≠" };
    if (symbols[name]) return { kind: "text", value: symbols[name]! };
    return this.unsupportedNode(`\\${name}`);
  }
  private groupText() {
    if (this.peek() !== "{") return "";
    this.index++; const start = this.index; while (this.index < this.source.length && this.peek() !== "}") this.index++;
    const value = this.source.slice(start, this.index); if (this.peek() === "}") this.index++; return value;
  }
  private unsupportedNode(value: string): EquationNode { this.unsupported.push(value); return { kind: "raw", latex: value }; }
  private script(base: EquationNode): EquationNode {
    let sub: EquationNode | undefined; let sup: EquationNode | undefined;
    while (this.peek() === "_" || this.peek() === "^") { const marker = this.peek(); this.index++; const value = this.group(); if (marker === "_") sub = value; else sup = value; }
    if (base.kind === "operator") return { ...base, ...(sub ? { sub } : {}), ...(sup ? { sup } : {}) };
    return { kind: "script", base, ...(sub ? { sub } : {}), ...(sup ? { sup } : {}) };
  }
  private atom(): EquationNode {
    let node: EquationNode;
    if (this.peek() === "{") node = this.group();
    else if (this.peek() === "\\") node = this.command();
    else { const value = this.peek(); this.index++; node = { kind: "text", value }; }
    return this.peek() === "_" || this.peek() === "^" ? this.script(node) : node;
  }
}

export function latexToEquation(latex: string, display = "block"): EquationInterchange {
  const parser = new LatexParser(latex.trim());
  const ast = parser.parse();
  const body = toOmml(ast);
  const xml = display === "block"
    ? `<m:oMathPara xmlns:m="${XML_NS}"><m:oMath>${body}</m:oMath></m:oMathPara>`
    : `<m:oMath xmlns:m="${XML_NS}">${body}</m:oMath>`;
  return { ast, xml, supported: parser.unsupported.length === 0, unsupported: [...new Set(parser.unsupported)] };
}

export function isEquationLatexSupported(latex: string) { return latexToEquation(latex).supported; }

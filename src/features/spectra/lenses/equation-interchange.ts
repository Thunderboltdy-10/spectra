/**
 * Bounded, loss-aware interchange for everyday school mathematics.
 *
 * This is intentionally a small grammar rather than a general TeX engine. A
 * supported expression gets a semantic AST and editable OMML. An unknown or
 * malformed expression is reported as unsupported so the native caller can
 * preserve an untouched OMML subtree instead of claiming that literal LaTeX
 * is an editable equation.
 */
export type EquationNode =
  | { kind: "text"; value: string }
  | { kind: "sequence"; children: EquationNode[] }
  | { kind: "fraction"; numerator: EquationNode; denominator: EquationNode }
  | { kind: "root"; degree?: EquationNode; body: EquationNode }
  | { kind: "script"; base: EquationNode; sub?: EquationNode; sup?: EquationNode }
  | { kind: "operator"; value: string; sub?: EquationNode; sup?: EquationNode; body?: EquationNode }
  | { kind: "function"; name: string; argument?: EquationNode }
  | { kind: "delimiter"; left: string; right: string; body: EquationNode }
  | { kind: "matrix"; rows: EquationNode[][]; aligned: boolean; delimiter?: { left: string; right: string } }
  | { kind: "raw"; latex: string };

export type EquationInterchange = {
  ast: EquationNode;
  xml: string;
  supported: boolean;
  /** Stable, concise diagnostics for unsupported or malformed input. */
  diagnostics: string[];
  /** Kept as the compatibility field used by the Office capability surfaces. */
  unsupported: string[];
};

const XML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

export const EQUATION_LIMITS = {
  maxInputLength: 100_000,
  maxDepth: 64,
  maxWork: 20_000,
  maxMatrixRows: 512,
  maxMatrixColumns: 512,
} as const;

const operators: Readonly<Record<string, string>> = {
  sum: "∑",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  prod: "∏",
  coprod: "∐",
  bigcup: "⋃",
  bigcap: "⋂",
};

const operatorNames = new Map(Object.entries(operators).map(([name, value]) => [value, name]));

const functions = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh",
  "log", "ln", "exp", "min", "max", "det", "gcd",
]);

const symbols: Readonly<Record<string, string>> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ",
  mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ",
  sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ", varphi: "ϕ", chi: "χ",
  psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", infinity: "∞",
  neq: "≠", le: "≤", leq: "≤", ge: "≥", geq: "≥", approx: "≈", equiv: "≡", in: "∈",
  notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", cup: "∪",
  cap: "∩", emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃", nexists: "∄", neg: "¬",
  land: "∧", lor: "∨", Rightarrow: "⇒", Leftrightarrow: "⇔", to: "→", rightarrow: "→",
  leftarrow: "←", longrightarrow: "⟶", longleftarrow: "⟵", longleftrightarrow: "⟷", mapsto: "↦",
  pm: "±", mp: "∓", times: "×", div: "÷", cdot: "⋅", ldots: "…", dots: "…", circ: "∘",
};

const escapedSymbols: Readonly<Record<string, string>> = {
  "{": "{",
  "}": "}",
  "|": "|",
  "%": "%",
  "#": "#",
  "&": "&",
};

const delimiterCommands: Readonly<Record<string, string>> = {
  lbrace: "{",
  rbrace: "}",
  lvert: "|",
  rvert: "|",
  vert: "|",
  Vert: "‖",
  lVert: "‖",
  rVert: "‖",
  langle: "⟨",
  rangle: "⟩",
  lceil: "⌈",
  rceil: "⌉",
  lfloor: "⌊",
  rfloor: "⌋",
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function text(value: string) {
  return value
    ? `<m:r><m:t xml:space="preserve">${escapeXml(value)}</m:t></m:r>`
    : "";
}

function slot(name: string, value: EquationNode | undefined) {
  return `<m:${name}>${value ? toOmml(value) : ""}</m:${name}>`;
}

function alignedRowToOmml(row: readonly EquationNode[]) {
  return row.map((cell, index) => `${index ? text("&") : ""}${toOmml(cell)}`).join("");
}

function toOmml(node: EquationNode): string {
  switch (node.kind) {
    case "text":
      return text(node.value);
    case "raw":
      return text(node.latex);
    case "sequence":
      return node.children.map(toOmml).join("");
    case "fraction":
      return `<m:f><m:fPr><m:type m:val="bar"/></m:fPr>${slot("num", node.numerator)}${slot("den", node.denominator)}</m:f>`;
    case "root":
      return `<m:rad><m:radPr><m:degHide m:val="${node.degree ? "0" : "1"}"/></m:radPr>${slot("deg", node.degree)}${slot("e", node.body)}</m:rad>`;
    case "script": {
      const tag = node.sub && node.sup ? "sSubSup" : node.sub ? "sSub" : "sSup";
      const scripts = tag === "sSubSup"
        ? `${slot("sub", node.sub)}${slot("sup", node.sup)}`
        : tag === "sSub"
          ? slot("sub", node.sub)
          : slot("sup", node.sup);
      return `<m:${tag}>${slot("e", node.base)}${scripts}</m:${tag}>`;
    }
    case "function":
      return `<m:func><m:funcPr/><m:fName>${text(node.name)}</m:fName>${slot("e", node.argument)}</m:func>`;
    case "operator":
      return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(node.value)}"/><m:limLoc m:val="undOvr"/></m:naryPr>${slot("sub", node.sub)}${slot("sup", node.sup)}${slot("e", node.body)}</m:nary>`;
    case "delimiter":
      return `<m:d><m:dPr><m:begChr m:val="${escapeXml(node.left || ".")}"/><m:endChr m:val="${escapeXml(node.right || ".")}"/></m:dPr>${slot("e", node.body)}</m:d>`;
    case "matrix": {
      const matrix = node.aligned
        ? `<m:eqArr><m:eqArrPr/>${node.rows.map((row) => `<m:e>${alignedRowToOmml(row)}</m:e>`).join("")}</m:eqArr>`
        : `<m:m><m:mPr/>${node.rows.map((row) => `<m:mr>${row.map((cell) => slot("e", cell)).join("")}</m:mr>`).join("")}</m:m>`;
      if (!node.delimiter) return matrix;
      return `<m:d><m:dPr><m:begChr m:val="${escapeXml(node.delimiter.left || ".")}"/><m:endChr m:val="${escapeXml(node.delimiter.right || ".")}"/></m:dPr><m:e>${matrix}</m:e></m:d>`;
    }
  }
}

type Stop = "group" | "degree" | "cell" | "row" | "right" | "environment";

class EquationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EquationParseError";
  }
}

class LatexParser {
  private index = 0;
  private work = 0;
  private depth = 0;
  readonly diagnostics: string[] = [];

  constructor(private readonly source: string) {}

  parse(): EquationNode {
    const result = this.sequence();
    this.skipWhitespace();
    if (!this.atEnd()) this.fail(`unexpected token at offset ${this.index}`);
    return result;
  }

  private atEnd() {
    return this.index >= this.source.length;
  }

  private peek(offset = 0) {
    return this.source[this.index + offset] ?? "";
  }

  private starts(value: string) {
    return this.source.startsWith(value, this.index);
  }

  private bump(work = 1) {
    this.work += work;
    if (this.work > EQUATION_LIMITS.maxWork)
      this.fail(`equation exceeds work limit (${EQUATION_LIMITS.maxWork})`);
  }

  private consume(count = 1) {
    this.index += count;
    this.bump(count);
  }

  private skipWhitespace() {
    while (/\s/u.test(this.peek())) this.consume();
  }

  private skipMathSpacing() {
    this.skipWhitespace();
    while (this.peek() === "\\" && [",", ";", ":", "!", " "].includes(this.commandNameAtCursor())) {
      this.readCommandName();
      this.skipWhitespace();
    }
  }

  private enter() {
    this.depth += 1;
    if (this.depth > EQUATION_LIMITS.maxDepth)
      this.fail(`equation exceeds nesting limit (${EQUATION_LIMITS.maxDepth})`);
  }

  private leave() {
    this.depth -= 1;
  }

  private fail(message: string): never {
    throw new EquationParseError(message);
  }

  private isStop(stops: readonly Stop[], environment?: string) {
    if (stops.includes("group") && this.peek() === "}") return true;
    if (stops.includes("degree") && this.peek() === "]") return true;
    if (stops.includes("cell") && this.peek() === "&") return true;
    if (stops.includes("row") && this.starts(String.raw`\\`)) return true;
    if (stops.includes("right") && this.commandNameAtCursor() === "right") return true;
    return stops.includes("environment") && Boolean(environment) && this.starts(`\\end{${environment}}`);
  }

  private sequence(stops: readonly Stop[] = [], environment?: string): EquationNode {
    const children: EquationNode[] = [];
    while (!this.atEnd() && !this.isStop(stops, environment)) {
      this.skipWhitespace();
      if (this.atEnd() || this.isStop(stops, environment)) break;
      if (this.peek() === "}") this.fail(`unexpected } at offset ${this.index}`);
      if (this.peek() === "]") this.fail(`unexpected ] at offset ${this.index}`);
      if (this.peek() === "&") this.fail(`unexpected & at offset ${this.index}`);
      if (this.starts(String.raw`\\`)) this.fail(`unexpected row break at offset ${this.index}`);
      children.push(this.atom());
    }
    return children.length === 1 ? children[0]! : { kind: "sequence", children };
  }

  private commandNameAtCursor() {
    if (this.peek() !== "\\") return "";
    const rest = this.source.slice(this.index + 1);
    return rest.match(/^[A-Za-z]+/u)?.[0] ?? rest[0] ?? "";
  }

  private group(): EquationNode {
    if (this.peek() !== "{") this.fail(`expected { at offset ${this.index}`);
    this.consume();
    this.enter();
    try {
      const value = this.sequence(["group"]);
      if (this.peek() !== "}") this.fail(`missing } at offset ${this.index}`);
      this.consume();
      return value;
    } finally {
      this.leave();
    }
  }

  private groupText(): string {
    if (this.peek() !== "{") this.fail(`expected environment name at offset ${this.index}`);
    this.consume();
    const start = this.index;
    while (!this.atEnd() && this.peek() !== "}") {
      if (!/[A-Za-z]/u.test(this.peek())) this.fail(`invalid environment name at offset ${this.index}`);
      this.consume();
    }
    if (this.peek() !== "}") this.fail(`missing } at offset ${this.index}`);
    const value = this.source.slice(start, this.index);
    this.consume();
    if (!value) this.fail(`empty environment name at offset ${start}`);
    return value;
  }

  private optionalDegree(): EquationNode | undefined {
    if (this.peek() !== "[") return undefined;
    this.consume();
    this.enter();
    try {
      const value = this.sequence(["degree"]);
      if (this.peek() !== "]") this.fail(`missing ] at offset ${this.index}`);
      this.consume();
      if (value.kind === "sequence" && value.children.length === 0)
        this.fail(`empty root degree at offset ${this.index}`);
      return value;
    } finally {
      this.leave();
    }
  }

  private parseDelimiter(side: "left" | "right") {
    this.skipWhitespace();
    if (this.atEnd()) this.fail(`missing ${side} delimiter at offset ${this.index}`);
    if (this.peek() === ".") {
      this.consume();
      return "";
    }
    if (this.peek() === "\\") {
      const name = this.readCommandName();
      const value = delimiterCommands[name] ?? escapedSymbols[name];
      if (value === undefined) this.fail(`unsupported ${side} delimiter \\${name}`);
      return value;
    }
    const value = this.peek();
    if (!"()[]{}|‖⟨⟩⌈⌉⌊⌋".includes(value))
      this.fail(`unsupported ${side} delimiter ${JSON.stringify(value)}`);
    this.consume();
    return value;
  }

  private readCommandName() {
    if (this.peek() !== "\\") this.fail(`expected command at offset ${this.index}`);
    this.consume();
    const match = this.source.slice(this.index).match(/^[A-Za-z]+/u);
    if (match) {
      this.consume(match[0].length);
      return match[0];
    }
    if (this.atEnd()) this.fail(`incomplete command at offset ${this.index - 1}`);
    const value = this.peek();
    this.consume();
    return value;
  }

  private parseEnvironment(environment: string): EquationNode {
    const supported = new Set(["matrix", "pmatrix", "bmatrix", "aligned", "align"]);
    if (!supported.has(environment)) {
      const end = `\\end{${environment}}`;
      const start = this.index;
      const endIndex = this.source.indexOf(end, this.index);
      if (endIndex < 0) this.fail(`missing ${end} at offset ${this.index}`);
      this.index = endIndex + end.length;
      this.bump(this.index - start);
      this.diagnostics.push(`unsupported environment \\begin{${environment}}`);
      return { kind: "raw", latex: `\\begin{${environment}}...\\end{${environment}}` };
    }

    this.enter();
    try {
      const rows: EquationNode[][] = [[]];
      let sawContent = false;
      while (!this.atEnd() && !this.isStop(["environment"], environment)) {
        if (this.starts(String.raw`\\`)) {
          this.consume(2);
          if (rows.length >= EQUATION_LIMITS.maxMatrixRows)
            this.fail(`matrix exceeds row limit (${EQUATION_LIMITS.maxMatrixRows})`);
          rows.push([]);
          continue;
        }
        const cell = this.sequence(["cell", "row", "environment"], environment);
        if (cell.kind !== "sequence" || cell.children.length) sawContent = true;
        rows[rows.length - 1]!.push(cell);
        if (rows[rows.length - 1]!.length > EQUATION_LIMITS.maxMatrixColumns)
          this.fail(`matrix exceeds column limit (${EQUATION_LIMITS.maxMatrixColumns})`);
        if (this.peek() === "&") {
          this.consume();
          continue;
        }
        if (this.starts(String.raw`\\`)) {
          this.consume(2);
          if (rows.length >= EQUATION_LIMITS.maxMatrixRows)
            this.fail(`matrix exceeds row limit (${EQUATION_LIMITS.maxMatrixRows})`);
          rows.push([]);
          continue;
        }
        if (!this.starts(`\\end{${environment}}`))
          this.fail(`expected matrix separator at offset ${this.index}`);
      }
      const end = `\\end{${environment}}`;
      if (!this.starts(end)) this.fail(`missing ${end} at offset ${this.index}`);
      this.consume(end.length);
      while (rows.length > 1 && rows.at(-1)!.length === 0) rows.pop();
      if (!sawContent)
        this.fail(`empty ${environment} environment at offset ${this.index}`);
      const delimiter = environment === "pmatrix"
        ? { left: "(", right: ")" }
        : environment === "bmatrix"
          ? { left: "[", right: "]" }
          : undefined;
      return {
        kind: "matrix",
        rows,
        aligned: environment === "aligned" || environment === "align",
        ...(delimiter ? { delimiter } : {}),
      };
    } finally {
      this.leave();
    }
  }

  private script(base: EquationNode): EquationNode {
    let sub: EquationNode | undefined;
    let sup: EquationNode | undefined;
    while (this.peek() === "_" || this.peek() === "^") {
      const marker = this.peek();
      this.consume();
      const value = this.peek() === "{" ? this.group() : this.atom();
      if (marker === "_") {
        if (sub) this.fail(`duplicate subscript at offset ${this.index}`);
        sub = value;
      } else {
        if (sup) this.fail(`duplicate superscript at offset ${this.index}`);
        sup = value;
      }
    }
    if (base.kind === "operator") return { ...base, ...(sub ? { sub } : {}), ...(sup ? { sup } : {}) };
    return { kind: "script", base, ...(sub ? { sub } : {}), ...(sup ? { sup } : {}) };
  }

  private canStartFunctionArgument() {
    this.skipMathSpacing();
    if (this.atEnd() || "}])&_^=+-*/,:;".includes(this.peek())) return false;
    if (this.peek() === "\\" && ["right", "end"].includes(this.commandNameAtCursor())) return false;
    return true;
  }

  private command(): EquationNode {
    const commandStart = this.index;
    const name = this.readCommandName();
    if (name === "frac") return { kind: "fraction", numerator: this.group(), denominator: this.group() };
    if (name === "sqrt") {
      const degree = this.optionalDegree();
      const body = this.peek() === "{" ? this.group() : this.atom();
      return { kind: "root", ...(degree ? { degree } : {}), body };
    }
    if (operators[name]) {
      while (["limits", "nolimits", "displaylimits"].includes(this.commandNameAtCursor())) this.readCommandName();
      return { kind: "operator", value: operators[name]! };
    }
    if (name === "left") {
      const left = this.parseDelimiter("left");
      this.enter();
      try {
        const body = this.sequence(["right"]);
        if (this.commandNameAtCursor() !== "right") this.fail(`missing \\right at offset ${this.index}`);
        this.readCommandName();
        const right = this.parseDelimiter("right");
        return { kind: "delimiter", left, right, body };
      } finally {
        this.leave();
      }
    }
    if (name === "right") this.fail(`unexpected \\right at offset ${commandStart}`);
    if (name === "begin") return this.parseEnvironment(this.groupText());
    if (name === "text" || name === "mathrm") {
      const value = this.groupTextLiteral();
      return { kind: "text", value };
    }
    if (name === "operatorname") {
      const value = this.groupTextLiteral();
      if (!functions.has(value)) {
        this.diagnostics.push(`unsupported function \\operatorname{${value}}`);
        return { kind: "raw", latex: `\\operatorname{${value}}` };
      }
      return { kind: "function", name: value };
    }
    if (functions.has(name)) {
      const argument = this.canStartFunctionArgument()
        ? (this.peek() === "{" ? this.group() : this.atom())
        : undefined;
      return { kind: "function", name, ...(argument ? { argument } : {}) };
    }
    if (name === "," || name === ";" || name === ":" || name === "!" || name === " ")
      return { kind: "text", value: " " };
    if (escapedSymbols[name] !== undefined) return { kind: "text", value: escapedSymbols[name]! };
    if (symbols[name]) return { kind: "text", value: symbols[name]! };
    this.diagnostics.push(`unsupported command \\${name}`);
    return { kind: "raw", latex: this.source.slice(commandStart, this.index) };
  }

  private groupTextLiteral() {
    if (this.peek() !== "{") this.fail(`expected { at offset ${this.index}`);
    this.consume();
    const start = this.index;
    while (!this.atEnd() && this.peek() !== "}") this.consume();
    if (this.peek() !== "}") this.fail(`missing } at offset ${this.index}`);
    const value = this.source.slice(start, this.index);
    this.consume();
    return value;
  }

  private atom(): EquationNode {
    if (
      this.atEnd() ||
      this.peek() === "}" ||
      this.peek() === "]" ||
      this.peek() === "&" ||
      this.starts(String.raw`\\`) ||
      this.commandNameAtCursor() === "right" ||
      this.commandNameAtCursor() === "end"
    )
      this.fail(`missing expression at offset ${this.index}`);
    let node: EquationNode;
    if (this.peek() === "{") node = this.group();
    else if (this.peek() === "\\") node = this.command();
    else {
      if (this.peek() === "[") this.fail(`unexpected [ at offset ${this.index}`);
      const value = this.peek();
      this.consume();
      node = { kind: "text", value };
    }
    this.bump();
    node = this.peek() === "_" || this.peek() === "^" ? this.script(node) : node;
    if (node.kind === "operator" && this.canStartFunctionArgument()) {
      const body = this.peek() === "{" ? this.group() : this.atom();
      node = { ...node, body };
    }
    return node;
  }
}

function uniqueDiagnostics(values: readonly string[]) {
  return [...new Set(values)];
}

function latexDelimiterToken(value: string) {
  const mapped: Readonly<Record<string, string>> = {
    "{": String.raw`\{`,
    "}": String.raw`\}`,
    "‖": String.raw`\Vert`,
    "⟨": String.raw`\langle`,
    "⟩": String.raw`\rangle`,
    "⌈": String.raw`\lceil`,
    "⌉": String.raw`\rceil`,
    "⌊": String.raw`\lfloor`,
    "⌋": String.raw`\rfloor`,
  };
  return mapped[value] ?? value;
}

function compatibilityUnsupported(diagnostics: readonly string[]) {
  return uniqueDiagnostics(diagnostics.map((diagnostic) => {
    if (diagnostic.startsWith("unsupported command "))
      return diagnostic.slice("unsupported command ".length);
    if (diagnostic.startsWith("unsupported environment "))
      return diagnostic.slice("unsupported environment ".length);
    return diagnostic;
  }));
}

export function latexToEquation(latex: string, display: "inline" | "block" = "block"): EquationInterchange {
  const source = latex.trim();
  if (source.length > EQUATION_LIMITS.maxInputLength) {
    const diagnostics = [`equation exceeds input limit (${EQUATION_LIMITS.maxInputLength} characters)`];
    const ast: EquationNode = { kind: "raw", latex: source };
    const body = text(source);
    const xml = display === "block"
      ? `<m:oMathPara xmlns:m="${XML_NS}"><m:oMath>${body}</m:oMath></m:oMathPara>`
      : `<m:oMath xmlns:m="${XML_NS}">${body}</m:oMath>`;
    return { ast, xml, supported: false, diagnostics, unsupported: diagnostics };
  }

  const parser = new LatexParser(source);
  let ast: EquationNode;
  let diagnostics: string[];
  try {
    ast = parser.parse();
    diagnostics = uniqueDiagnostics(parser.diagnostics);
  } catch (error) {
    ast = { kind: "raw", latex: source };
    diagnostics = uniqueDiagnostics([
      ...parser.diagnostics,
      error instanceof EquationParseError ? error.message : "equation could not be parsed",
    ]);
  }
  const supported = diagnostics.length === 0;
  const body = supported ? toOmml(ast) : text(source);
  const xml = display === "block"
    ? `<m:oMathPara xmlns:m="${XML_NS}"><m:oMath>${body}</m:oMath></m:oMathPara>`
    : `<m:oMath xmlns:m="${XML_NS}">${body}</m:oMath>`;
  return { ast, xml, supported, diagnostics, unsupported: compatibilityUnsupported(diagnostics) };
}

/** Used by command/UI code that only needs the truthful support decision. */
export function isEquationLatexSupported(latex: string) {
  return latexToEquation(latex).supported;
}

/** Stable source form for parser/OMML corpus assertions and diagnostics. */
export function equationNodeToLatex(node: EquationNode): string {
  switch (node.kind) {
    case "text": return node.value;
    case "raw": return node.latex;
    case "sequence": return node.children.map(equationNodeToLatex).join("");
    case "fraction": return `\\frac{${equationNodeToLatex(node.numerator)}}{${equationNodeToLatex(node.denominator)}}`;
    case "root": return node.degree ? `\\sqrt[${equationNodeToLatex(node.degree)}]{${equationNodeToLatex(node.body)}}` : `\\sqrt{${equationNodeToLatex(node.body)}}`;
    case "script": return `{${equationNodeToLatex(node.base)}}${node.sub ? `_{${equationNodeToLatex(node.sub)}}` : ""}${node.sup ? `^{${equationNodeToLatex(node.sup)}}` : ""}`;
    case "operator": return `${operatorNames.get(node.value) ?? node.value}${node.sub ? `_{${equationNodeToLatex(node.sub)}}` : ""}${node.sup ? `^{${equationNodeToLatex(node.sup)}}` : ""}${node.body ? `{${equationNodeToLatex(node.body)}}` : ""}`;
    case "function": return `\\${node.name}${node.argument ? `{${equationNodeToLatex(node.argument)}}` : ""}`;
    case "delimiter": return `\\left${latexDelimiterToken(node.left || ".")}${equationNodeToLatex(node.body)}\\right${latexDelimiterToken(node.right || ".")}`;
    case "matrix": {
      const environment = node.aligned ? "aligned" : node.delimiter?.left === "(" ? "pmatrix" : node.delimiter?.left === "[" ? "bmatrix" : "matrix";
      return `\\begin{${environment}}${node.rows.map((row) => row.map(equationNodeToLatex).join(" & ")).join(String.raw` \\ `)}\\end{${environment}}`;
    }
  }
}

/**
 * What the Equation tab offers, as Word's Equation tab does: structures with
 * empty slots to type into, symbols, and whole equations people reach for.
 *
 * Every entry is LaTeX the Word writer turns into Word's own maths, so an
 * equation built from these galleries saves into the .docx as an editable
 * Word equation (the gallery test proves each one). `#?` is an empty slot:
 * the editor puts the caret in the first, and Tab moves to the next.
 */

export type MathGalleryItem = { latex: string; label: string };
export type MathGallerySection = { label: string; items: readonly MathGalleryItem[] };
export type MathGallery = {
  id: string;
  label: string;
  /** Drawn on the tab's button. */
  glyph: string;
  hint: string;
  /** Tile width, in columns of the popover's grid. */
  columns: number;
  sections: readonly MathGallerySection[];
};

const item = (latex: string, label: string): MathGalleryItem => ({ latex, label });

/** Symbols: one tile each, inserted where the caret is. */
const symbols = (pairs: readonly (readonly [string, string])[]) => pairs.map(([latex, label]) => item(latex, label));

export const MATH_STRUCTURES: readonly MathGallery[] = [
  {
    id: "fraction",
    label: "Fraction",
    glyph: "\\frac{x}{y}",
    hint: "Stacked, inline and small fractions",
    columns: 4,
    sections: [
      { label: "Fraction", items: [item("\\frac{#?}{#?}", "Stacked fraction"), item("#?/#?", "Linear fraction"), item("\\tfrac{#?}{#?}", "Small fraction"), item("\\binom{#?}{#?}", "Binomial coefficient")] },
      { label: "Common fractions", items: [item("\\frac{dy}{dx}", "Differential"), item("\\frac{\\Delta y}{\\Delta x}", "Change in y over x"), item("\\frac{\\partial y}{\\partial x}", "Partial differential"), item("\\frac{\\delta y}{\\delta x}", "Small change"), item("\\frac{\\pi}{2}", "Pi over 2"), item("\\frac{1}{2}", "One half")] },
    ],
  },
  {
    id: "script",
    label: "Script",
    glyph: "e^{x}",
    hint: "Superscripts and subscripts",
    columns: 4,
    sections: [
      { label: "Subscripts and superscripts", items: [item("#?^{#?}", "Superscript"), item("#?_{#?}", "Subscript"), item("#?_{#?}^{#?}", "Subscript and superscript"), item("{}_{#?}^{#?}#?", "Left subscript and superscript")] },
      { label: "Common", items: [item("x_{y^{2}}", "Subscript with a power"), item("e^{-i\\omega t}", "Complex exponential"), item("x^{2}", "x squared"), item("{}_{1}^{n}Y", "Left scripts")] },
    ],
  },
  {
    id: "radical",
    label: "Radical",
    glyph: "\\sqrt[n]{x}",
    hint: "Square roots and nth roots",
    columns: 4,
    sections: [
      { label: "Radicals", items: [item("\\sqrt{#?}", "Square root"), item("\\sqrt[#?]{#?}", "Root with degree"), item("\\sqrt[3]{#?}", "Cube root"), item("\\sqrt[4]{#?}", "Fourth root")] },
      { label: "Common", items: [item("\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}", "Quadratic roots"), item("\\sqrt{a^{2}+b^{2}}", "Hypotenuse")] },
    ],
  },
  {
    id: "integral",
    label: "Integral",
    glyph: "\\int_{a}^{b}",
    hint: "Integrals, contour integrals and differentials",
    columns: 4,
    sections: [
      { label: "Integrals", items: [item("\\int #?", "Integral"), item("\\int_{#?}^{#?} #?", "Integral with limits"), item("\\iint #?", "Double integral"), item("\\iint_{#?}^{#?} #?", "Double integral with limits"), item("\\iiint #?", "Triple integral"), item("\\iiint_{#?}^{#?} #?", "Triple integral with limits")] },
      { label: "Contour integrals", items: [item("\\oint #?", "Contour integral"), item("\\oint_{#?}^{#?} #?", "Contour integral with limits"), item("\\oiint #?", "Surface integral"), item("\\oiiint #?", "Volume integral")] },
      { label: "Differentials", items: [item("\\mathrm{d}x", "dx"), item("\\mathrm{d}y", "dy"), item("\\mathrm{d}\\theta", "dθ"), item("\\int_{0}^{\\infty} e^{-x}\\,\\mathrm{d}x", "Example integral")] },
    ],
  },
  {
    id: "operator",
    label: "Large Operator",
    glyph: "\\sum_{i}^{n}",
    hint: "Sums, products, unions and intersections",
    columns: 4,
    sections: [
      { label: "Summations", items: [item("\\sum #?", "Summation"), item("\\sum_{#?} #?", "Summation under"), item("\\sum_{#?}^{#?} #?", "Summation with limits")] },
      { label: "Products and co-products", items: [item("\\prod_{#?}^{#?} #?", "Product"), item("\\coprod_{#?}^{#?} #?", "Co-product"), item("\\prod #?", "Product without limits")] },
      { label: "Unions and intersections", items: [item("\\bigcup_{#?}^{#?} #?", "Union"), item("\\bigcap_{#?}^{#?} #?", "Intersection"), item("\\bigvee_{#?}^{#?} #?", "Logical or"), item("\\bigwedge_{#?}^{#?} #?", "Logical and"), item("\\bigoplus_{#?} #?", "Direct sum"), item("\\bigotimes_{#?} #?", "Tensor product")] },
      { label: "Common", items: [item("\\sum_{k=0}^{n}\\binom{n}{k}", "Sum of binomials"), item("\\sum_{i=1}^{n} x_{i}", "Sum of x"), item("\\prod_{k=1}^{n} A_{k}", "Product of A"), item("\\bigcup_{n=1}^{m}\\left(X_{n}\\cap Y_{n}\\right)", "Union of intersections")] },
    ],
  },
  {
    id: "bracket",
    label: "Bracket",
    glyph: "\\left\\{x\\right\\}",
    hint: "Brackets that grow with what they hold, and cases",
    columns: 5,
    sections: [
      { label: "Brackets", items: [item("\\left(#?\\right)", "Parentheses"), item("\\left[#?\\right]", "Square brackets"), item("\\left\\{#?\\right\\}", "Braces"), item("\\left\\langle #?\\right\\rangle", "Angle brackets"), item("\\left|#?\\right|", "Absolute value"), item("\\left\\Vert #?\\right\\Vert", "Norm"), item("\\left\\lfloor #?\\right\\rfloor", "Floor"), item("\\left\\lceil #?\\right\\rceil", "Ceiling"), item("\\left[#?\\right)", "Half-open interval"), item("\\left(#?\\right]", "Half-open interval")] },
      { label: "Single brackets", items: [item("\\left\\{#?\\right.", "Opening brace"), item("\\left.#?\\right\\}", "Closing brace"), item("\\left.#?\\right|", "Evaluated at")] },
      { label: "Cases and stacks", items: [item("\\begin{cases}#?&#?\\\\#?&#?\\end{cases}", "Cases"), item("\\binom{#?}{#?}", "Stack in brackets"), item("f(x)=\\begin{cases}-x,&x<0\\\\x,&x\\ge 0\\end{cases}", "Absolute value as cases")] },
    ],
  },
  {
    id: "function",
    label: "Function",
    glyph: "\\sin\\theta",
    hint: "Trigonometric and hyperbolic functions",
    columns: 4,
    sections: [
      { label: "Trigonometric functions", items: [item("\\sin #?", "Sine"), item("\\cos #?", "Cosine"), item("\\tan #?", "Tangent"), item("\\csc #?", "Cosecant"), item("\\sec #?", "Secant"), item("\\cot #?", "Cotangent")] },
      { label: "Inverse functions", items: [item("\\sin^{-1} #?", "Inverse sine"), item("\\cos^{-1} #?", "Inverse cosine"), item("\\tan^{-1} #?", "Inverse tangent"), item("\\arcsin #?", "Arcsine"), item("\\arccos #?", "Arccosine"), item("\\arctan #?", "Arctangent")] },
      { label: "Hyperbolic functions", items: [item("\\sinh #?", "Hyperbolic sine"), item("\\cosh #?", "Hyperbolic cosine"), item("\\tanh #?", "Hyperbolic tangent"), item("\\coth #?", "Hyperbolic cotangent")] },
      { label: "Common", items: [item("\\sin\\theta", "sin θ"), item("\\cos 2x", "cos 2x"), item("\\tan\\theta=\\frac{\\sin\\theta}{\\cos\\theta}", "Tangent identity"), item("\\sin^{2}\\theta+\\cos^{2}\\theta=1", "Pythagorean identity")] },
    ],
  },
  {
    id: "accent",
    label: "Accent",
    glyph: "\\vec{a}",
    hint: "Dots, hats, bars, arrows and braces over or under",
    columns: 6,
    sections: [
      { label: "Accents", items: [item("\\dot{#?}", "Dot"), item("\\ddot{#?}", "Double dot"), item("\\dddot{#?}", "Triple dot"), item("\\hat{#?}", "Hat"), item("\\check{#?}", "Check"), item("\\acute{#?}", "Acute"), item("\\grave{#?}", "Grave"), item("\\breve{#?}", "Breve"), item("\\tilde{#?}", "Tilde"), item("\\bar{#?}", "Bar"), item("\\vec{#?}", "Vector arrow"), item("\\mathring{#?}", "Ring")] },
      { label: "Overbars and underbars", items: [item("\\overline{#?}", "Overbar"), item("\\underline{#?}", "Underbar"), item("\\overrightarrow{#?}", "Arrow over"), item("\\overleftarrow{#?}", "Left arrow over"), item("\\overleftrightarrow{#?}", "Double arrow over")] },
      { label: "Braces and boxes", items: [item("\\overbrace{#?}", "Brace over"), item("\\underbrace{#?}", "Brace under"), item("\\boxed{#?}", "Boxed")] },
      { label: "Common", items: [item("\\overline{AB}", "Segment AB"), item("\\vec{F}", "Force vector"), item("\\hat{\\imath}", "Unit vector i"), item("\\bar{x}", "Mean of x")] },
    ],
  },
  {
    id: "limit",
    label: "Limit and Log",
    glyph: "\\lim_{n\\to\\infty}",
    hint: "Limits, logarithms, minimum and maximum",
    columns: 4,
    sections: [
      { label: "Functions", items: [item("\\log_{#?} #?", "Logarithm with base"), item("\\log #?", "Logarithm"), item("\\ln #?", "Natural logarithm"), item("\\exp #?", "Exponential")] },
      { label: "Limits", items: [item("\\lim_{#?} #?", "Limit"), item("\\min_{#?} #?", "Minimum"), item("\\max_{#?} #?", "Maximum"), item("\\lim_{#?\\to #?} #?", "Limit as x tends to a")] },
      { label: "Common", items: [item("\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n}", "e as a limit"), item("\\lim_{x\\to 0}\\frac{\\sin x}{x}", "sin x over x"), item("\\max_{0\\le x\\le 1} x e^{-x^{2}}", "Maximum on an interval"), item("\\log_{2} n", "Log base 2")] },
    ],
  },
  {
    id: "relation",
    label: "Operator",
    glyph: "\\coloneqq",
    hint: "Defined as, approximately, and relations with a mark",
    columns: 6,
    sections: [
      { label: "Basic operators", items: [item("\\coloneqq", "Defined as"), item("\\equiv", "Identical to"), item("\\approx", "Approximately"), item("\\propto", "Proportional to"), item("\\cong", "Congruent"), item("\\simeq", "Asymptotically equal"), item("\\doteq", "Approaches the limit"), item("\\triangleq", "Equal by definition"), item("\\overset{?}{=}", "Questioned equality"), item("\\overset{\\Delta}{=}", "Delta equal to"), item("\\overset{\\text{!}}{=}", "Must equal"), item("\\pm", "Plus or minus")] },
    ],
  },
  {
    id: "matrix",
    label: "Matrix",
    glyph: "\\left(\\begin{smallmatrix}a&b\\\\c&d\\end{smallmatrix}\\right)",
    hint: "Matrices, determinants and aligned equations",
    columns: 4,
    sections: [
      { label: "Empty matrices", items: [item("\\begin{matrix}#?&#?\\end{matrix}", "1 × 2"), item("\\begin{matrix}#?\\\\#?\\end{matrix}", "2 × 1"), item("\\begin{matrix}#?&#?&#?\\end{matrix}", "1 × 3"), item("\\begin{matrix}#?\\\\#?\\\\#?\\end{matrix}", "3 × 1"), item("\\begin{matrix}#?&#?\\\\#?&#?\\end{matrix}", "2 × 2"), item("\\begin{matrix}#?&#?&#?\\\\#?&#?&#?\\end{matrix}", "2 × 3"), item("\\begin{matrix}#?&#?\\\\#?&#?\\\\#?&#?\\end{matrix}", "3 × 2"), item("\\begin{matrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{matrix}", "3 × 3")] },
      { label: "Matrices with brackets", items: [item("\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}", "In parentheses"), item("\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}", "In square brackets"), item("\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}", "Determinant"), item("\\begin{Vmatrix}#?&#?\\\\#?&#?\\end{Vmatrix}", "Norm"), item("\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}", "3 × 3 in parentheses"), item("\\begin{pmatrix}#?\\\\#?\\\\#?\\end{pmatrix}", "Column vector")] },
      { label: "Identity and general", items: [item("\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}", "2 × 2 identity"), item("\\begin{pmatrix}1&0&0\\\\0&1&0\\\\0&0&1\\end{pmatrix}", "3 × 3 identity"), item("\\begin{pmatrix}a_{11}&\\cdots&a_{1n}\\\\\\vdots&\\ddots&\\vdots\\\\a_{m1}&\\cdots&a_{mn}\\end{pmatrix}", "m × n matrix")] },
      { label: "Aligned equations", items: [item("\\begin{aligned}#?&=#?\\\\#?&=#?\\end{aligned}", "Two aligned lines"), item("\\begin{aligned}#?&=#?\\\\&=#?\\\\&=#?\\end{aligned}", "Working, line by line")] },
    ],
  },
];

export const MATH_SYMBOLS: MathGallery = {
  id: "symbols",
  label: "Symbols",
  glyph: "\\pm\\infty",
  hint: "Greek letters, operators, relations, arrows and more",
  columns: 10,
  sections: [
    {
      label: "Basic maths",
      items: symbols([["\\pm", "Plus or minus"], ["\\mp", "Minus or plus"], ["\\times", "Times"], ["\\div", "Divided by"], ["\\cdot", "Dot"], ["\\ast", "Asterisk"], ["\\neq", "Not equal"], ["\\approx", "Almost equal"], ["\\equiv", "Identical"], ["\\le", "Less or equal"], ["\\ge", "Greater or equal"], ["\\ll", "Much less"], ["\\gg", "Much greater"], ["\\propto", "Proportional"], ["\\sim", "Similar"], ["\\infty", "Infinity"], ["\\partial", "Partial"], ["\\nabla", "Nabla"], ["\\sqrt{#?}", "Square root"], ["\\degree", "Degree"], ["\\forall", "For all"], ["\\exists", "There exists"], ["\\nexists", "There is no"], ["\\in", "Element of"], ["\\notin", "Not an element of"], ["\\ni", "Contains"], ["\\subset", "Subset"], ["\\subseteq", "Subset or equal"], ["\\supset", "Superset"], ["\\supseteq", "Superset or equal"], ["\\cup", "Union"], ["\\cap", "Intersection"], ["\\emptyset", "Empty set"], ["\\setminus", "Set minus"], ["\\therefore", "Therefore"], ["\\because", "Because"], ["\\neg", "Not"], ["\\land", "And"], ["\\lor", "Or"], ["\\ldots", "Ellipsis"], ["\\cdots", "Centred ellipsis"], ["\\vdots", "Vertical ellipsis"], ["\\ddots", "Diagonal ellipsis"], ["\\prime", "Prime"], ["\\hbar", "h-bar"], ["\\circ", "Ring"]]),
    },
    {
      label: "Greek letters",
      items: symbols([["\\alpha", "alpha"], ["\\beta", "beta"], ["\\gamma", "gamma"], ["\\delta", "delta"], ["\\epsilon", "epsilon"], ["\\varepsilon", "epsilon variant"], ["\\zeta", "zeta"], ["\\eta", "eta"], ["\\theta", "theta"], ["\\vartheta", "theta variant"], ["\\iota", "iota"], ["\\kappa", "kappa"], ["\\lambda", "lambda"], ["\\mu", "mu"], ["\\nu", "nu"], ["\\xi", "xi"], ["\\pi", "pi"], ["\\varpi", "pi variant"], ["\\rho", "rho"], ["\\varrho", "rho variant"], ["\\sigma", "sigma"], ["\\varsigma", "final sigma"], ["\\tau", "tau"], ["\\upsilon", "upsilon"], ["\\phi", "phi"], ["\\varphi", "phi variant"], ["\\chi", "chi"], ["\\psi", "psi"], ["\\omega", "omega"], ["\\Gamma", "Gamma"], ["\\Delta", "Delta"], ["\\Theta", "Theta"], ["\\Lambda", "Lambda"], ["\\Xi", "Xi"], ["\\Pi", "Pi"], ["\\Sigma", "Sigma"], ["\\Upsilon", "Upsilon"], ["\\Phi", "Phi"], ["\\Psi", "Psi"], ["\\Omega", "Omega"]]),
    },
    {
      label: "Letter-like symbols",
      items: symbols([["\\mathbb{R}", "Real numbers"], ["\\mathbb{N}", "Natural numbers"], ["\\mathbb{Z}", "Integers"], ["\\mathbb{Q}", "Rationals"], ["\\mathbb{C}", "Complex numbers"], ["\\ell", "Script l"], ["\\Re", "Real part"], ["\\Im", "Imaginary part"], ["\\aleph", "Aleph"], ["\\wp", "Weierstrass p"], ["\\mho", "Mho"], ["\\complement", "Complement"], ["\\imath", "Dotless i"], ["\\jmath", "Dotless j"], ["\\eth", "Eth"], ["\\top", "Top"], ["\\bot", "Bottom"]]),
    },
    {
      label: "Operators",
      items: symbols([["\\oplus", "Circled plus"], ["\\ominus", "Circled minus"], ["\\otimes", "Circled times"], ["\\odot", "Circled dot"], ["\\oslash", "Circled slash"], ["\\bullet", "Bullet"], ["\\star", "Star"], ["\\dagger", "Dagger"], ["\\wedge", "Wedge"], ["\\vee", "Vee"], ["\\sqcup", "Square union"], ["\\sqcap", "Square intersection"], ["\\uplus", "Multiset union"], ["\\diamond", "Diamond"], ["\\bigcirc", "Large circle"], ["\\wr", "Wreath"], ["\\amalg", "Amalgamation"], ["\\vdash", "Proves"], ["\\models", "Models"], ["\\prec", "Precedes"], ["\\succ", "Succeeds"], ["\\preceq", "Precedes or equal"], ["\\succeq", "Succeeds or equal"], ["\\asymp", "Asymptotic"], ["\\coloneqq", "Defined as"]]),
    },
    {
      label: "Arrows",
      items: symbols([["\\rightarrow", "Right arrow"], ["\\leftarrow", "Left arrow"], ["\\leftrightarrow", "Left-right arrow"], ["\\uparrow", "Up arrow"], ["\\downarrow", "Down arrow"], ["\\updownarrow", "Up-down arrow"], ["\\Rightarrow", "Implies"], ["\\Leftarrow", "Is implied by"], ["\\Leftrightarrow", "If and only if"], ["\\Uparrow", "Double up arrow"], ["\\Downarrow", "Double down arrow"], ["\\longrightarrow", "Long right arrow"], ["\\longleftarrow", "Long left arrow"], ["\\Longrightarrow", "Long implies"], ["\\Longleftrightarrow", "Long iff"], ["\\mapsto", "Maps to"], ["\\nearrow", "North-east arrow"], ["\\searrow", "South-east arrow"], ["\\nwarrow", "North-west arrow"], ["\\swarrow", "South-west arrow"], ["\\hookrightarrow", "Hook right"], ["\\rightleftharpoons", "Equilibrium"], ["\\leftrightharpoons", "Reverse equilibrium"], ["\\rightharpoonup", "Harpoon"]]),
    },
    {
      label: "Negated relations",
      items: symbols([["\\neq", "Not equal"], ["\\nless", "Not less"], ["\\ngtr", "Not greater"], ["\\nleq", "Neither less nor equal"], ["\\ngeq", "Neither greater nor equal"], ["\\nsim", "Not similar"], ["\\ncong", "Not congruent"], ["\\notin", "Not an element"], ["\\nsubseteq", "Not a subset"], ["\\nsupseteq", "Not a superset"], ["\\subsetneq", "Proper subset"], ["\\supsetneq", "Proper superset"], ["\\nmid", "Does not divide"], ["\\nparallel", "Not parallel"], ["\\nexists", "There is no"]]),
    },
    {
      label: "Geometry",
      items: symbols([["\\angle", "Angle"], ["\\measuredangle", "Measured angle"], ["\\sphericalangle", "Spherical angle"], ["\\triangle", "Triangle"], ["\\square", "Square"], ["\\parallel", "Parallel"], ["\\perp", "Perpendicular"], ["\\cong", "Congruent"], ["\\sim", "Similar"], ["\\mid", "Divides"], ["\\degree", "Degree"], ["\\overline{#?}", "Line segment"], ["\\overrightarrow{#?}", "Ray"], ["\\overleftrightarrow{#?}", "Line"]]),
    },
  ],
};

/** Whole equations, as Word's Equation gallery offers them. */
export const MATH_EQUATIONS: MathGallery = {
  id: "equations",
  label: "Equation",
  glyph: "\\pi r^{2}",
  hint: "Well-known equations, ready to edit",
  columns: 1,
  sections: [
    {
      label: "Built-in",
      items: [
        item("A=\\pi r^{2}", "Area of a circle"),
        item("a^{2}+b^{2}=c^{2}", "Pythagorean theorem"),
        item("x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}", "Quadratic formula"),
        item("(x+a)^{n}=\\sum_{k=0}^{n}\\binom{n}{k}x^{k}a^{n-k}", "Binomial theorem"),
        item("(1+x)^{n}=1+\\frac{nx}{1!}+\\frac{n(n-1)x^{2}}{2!}+\\cdots", "Expansion of a sum"),
        item("e^{x}=1+\\frac{x}{1!}+\\frac{x^{2}}{2!}+\\frac{x^{3}}{3!}+\\cdots", "Taylor expansion"),
        item("f(x)=a_{0}+\\sum_{n=1}^{\\infty}\\left(a_{n}\\cos\\frac{n\\pi x}{L}+b_{n}\\sin\\frac{n\\pi x}{L}\\right)", "Fourier series"),
        item("\\sin\\alpha\\pm\\sin\\beta=2\\sin\\frac{1}{2}(\\alpha\\pm\\beta)\\cos\\frac{1}{2}(\\alpha\\mp\\beta)", "Trig identity"),
        item("f'(x)=\\lim_{h\\to 0}\\frac{f(x+h)-f(x)}{h}", "Derivative"),
        item("e^{i\\pi}+1=0", "Euler's identity"),
        item("E=mc^{2}", "Mass-energy equivalence"),
        item("F=G\\frac{m_{1}m_{2}}{r^{2}}", "Gravitation"),
        item("PV=nRT", "Ideal gas law"),
        item("\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_{i}", "Mean"),
        item("\\sigma=\\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}\\left(x_{i}-\\bar{x}\\right)^{2}}", "Standard deviation"),
        item("f(x)=\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^{2}}{2\\sigma^{2}}}", "Normal distribution"),
      ],
    },
  ],
};

export const MATH_GALLERIES: readonly MathGallery[] = [MATH_EQUATIONS, ...MATH_STRUCTURES, MATH_SYMBOLS];

/** A template drawn for its tile: each empty slot is a small dotted square. */
export function mathGalleryPreview(latex: string) {
  return latex.replace(/#[?0@]/gu, "\\square");
}

/**
 * Spectra design-system baseline rules (ARCHITECTURE-PLATFORM §3).
 *
 * Three rules, all `warn` in P0 — the census they emit is the burn-down list
 * the P6 adoption sweep works top-offender-first. Directories that finish
 * adoption flip to `error` in `eslint.config.mjs`; the baseline directory
 * `src/components/ui/` lives there from the start, so the floor can never
 * regress while the sweep is still climbing.
 *
 * The rules guard the token-owning styling families (type, colour, radius,
 * shadow, layering). Layout engineering (viewport clamps like
 * `max-h-[min(70dvh,32rem)]`, positioning) is out of scope by design: no
 * token exists for it and flagging it would flood the signal.
 */

const ARBITRARY_CLASS = /(?:^|\s)((?:text|bg|rounded|shadow)-\[[^\]]+\])/g;
const HEX_LITERAL = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/;
/** Pure token references are the allowed arbitrary form: `[var(--x)]`. */
const TOKEN_REFERENCE = /^\[var\(--[\w-]+\)\]$/;
/** Literal colors are the escape: hex or an rgb/hsl channel list. */
const LITERAL_COLOR =
  /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|\b(?:rgba?|hsla?|oklch?)\s*\(/;

/**
 * Whether an arbitrary class is a token escape, calibrated per family:
 *  - type/radius: literal sizes are escapes; var()/keyword compositions pass
 *  - colour (bg): literal colours are escapes; color-mix over var()s passes
 *  - shadow: everything except a direct var(--shadow-*) reference is a
 *    hand-rolled drop shadow — the four `--shadow-*` tokens are the system
 */
function isTokenEscape(classToken) {
  const family = classToken.slice(0, classToken.indexOf("-"));
  const bracket = classToken.slice(classToken.indexOf("["));
  if (TOKEN_REFERENCE.test(bracket)) return false;
  const inner = bracket.slice(1, -1);
  switch (family) {
    case "text":
    case "rounded":
      return /\d/.test(inner);
    case "bg":
      // Hex in a background is reported precisely by the `hex` message —
      // firing both would double-count one escape in the census.
      return LITERAL_COLOR.test(inner) && !HEX_LITERAL.test(inner);
    case "shadow":
      return true;
    default:
      return false;
  }
}

function findArbitraryEscapes(text) {
  const escapes = [];
  for (const match of text.matchAll(ARBITRARY_CLASS)) {
    const classToken = match[1].trim();
    if (isTokenEscape(classToken)) escapes.push(classToken);
  }
  return escapes;
}

function* classStrings(node) {
  // className="..." and className={`...`}
  if (
    node.type === "JSXAttribute" &&
    (node.name.name === "className" || node.name.name === "class")
  ) {
    const value = node.value;
    if (!value) return;
    if (value.type === "Literal" && typeof value.value === "string") {
      yield value;
    } else if (value.type === "JSXExpressionContainer") {
      yield* literalStrings(value.expression);
    }
  }
}

function* literalStrings(node) {
  if (!node) return;
  if (node.type === "Literal" && typeof node.value === "string") {
    yield node;
  } else if (node.type === "TemplateLiteral") {
    for (const quasi of node.quasis) yield quasi;
  } else if (node.type === "ConditionalExpression") {
    yield* literalStrings(node.consequent);
    yield* literalStrings(node.alternate);
  } else if (node.type === "LogicalExpression") {
    yield* literalStrings(node.right);
  } else if (node.type === "ArrayExpression") {
    for (const element of node.elements) yield* literalStrings(element);
  } else if (node.type === "CallExpression") {
    // cn(...), clsx(...), cva(...), twMerge(...)
    const callee = node.callee;
    const name =
      callee.type === "Identifier"
        ? callee.name
        : callee.type === "MemberExpression"
          ? callee.property.name
          : null;
    if (name && ["cn", "clsx", "cva", "twMerge", "tw"].includes(name)) {
      for (const argument of node.arguments) yield* literalStrings(argument);
    }
  } else if (node.type === "ObjectExpression") {
    // cva({ ...: "classes" }) variants and cn({ "classes": cond })
    for (const property of node.properties) {
      if (property.type === "Property") {
        yield* literalStrings(property.key.computed ? null : property.key);
        yield* literalStrings(property.value);
      }
    }
  }
}

export const noArbitraryValueClasses = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow literal-value Tailwind arbitrary classes (text-[11px], bg-[#fff], rounded-[7px], shadow-[...]); consume the token scale instead. var(--token) references stay allowed.",
    },
    messages: {
      escape:
        "'{{className}}' bypasses the design tokens (DS-1). Use the token utility (text-micro/caption/ui…, rounded-chip/control/card/surface, bg-brand…, shadow-soft/card/hover).",
      hex: "Raw hex '{{hex}}' in a class is banned (DS-1). Route colour through the token system (var(--*) or a semantic utility).",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        for (const stringNode of classStrings(node)) {
          const text =
            stringNode.type === "TemplateElement"
              ? stringNode.value.raw
              : stringNode.value;
          for (const escape of findArbitraryEscapes(text)) {
            context.report({
              node: stringNode,
              messageId: "escape",
              data: { className: escape },
            });
          }
          for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g)) {
            context.report({
              node: stringNode,
              messageId: "hex",
              data: { hex: match[0] },
            });
          }
        }
      },
    };
  },
};

const NUMERIC_Z_CLASS = /(?:^|\s)(z-(?:\d+|\[\d+\]))(?=\s|$)/g;

export const noNumericZIndex = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow numeric z-index (z-50, z-[220], zIndex: 400). Name a layer from the stacking contract instead (z-chrome/dropdown/panel/modal/composer-dock/toast).",
    },
    messages: {
      numeric:
        "'{{value}}' negotiates stacking by number (UX-13). Name one of the seven layers (ARCHITECTURE-PLATFORM §3): z-base/chrome/dropdown/panel/modal/composer-dock/toast.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (
          node.name.name === "style" &&
          node.value?.type === "JSXExpressionContainer"
        ) {
          // style={{ zIndex: 220 }}
          const expression = node.value.expression;
          if (expression.type === "ObjectExpression") {
            for (const property of expression.properties) {
              if (
                property.type === "Property" &&
                ((property.key.type === "Identifier" &&
                  property.key.name === "zIndex") ||
                  (property.key.type === "Literal" &&
                    property.key.value === "zIndex")) &&
                property.value.type === "Literal" &&
                typeof property.value.value === "number"
              ) {
                context.report({
                  node: property.value,
                  messageId: "numeric",
                  data: { value: `zIndex: ${property.value.value}` },
                });
              }
            }
          }
          return;
        }
        for (const stringNode of classStrings(node)) {
          const text =
            stringNode.type === "TemplateElement"
              ? stringNode.value.raw
              : stringNode.value;
          for (const match of text.matchAll(NUMERIC_Z_CLASS)) {
            context.report({
              node: stringNode,
              messageId: "numeric",
              data: { value: match[1] },
            });
          }
        }
      },
    };
  },
};

export const noRawHexInStyles = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow hex literals in style objects ('#8b6ff0'). Colour decisions route through tokens so a re-theme cannot miss a surface (DS-1, DS-3).",
    },
    messages: {
      hex: "Raw hex '{{hex}}' in a style object (DS-1). Route colour through the token system (var(--*) or a semantic utility).",
    },
  },
  create(context) {
    return {
      Property(node) {
        if (
          node.key.type === "Identifier" &&
          /color|background|fill|stroke|border/i.test(node.key.name) &&
          node.value.type === "Literal" &&
          typeof node.value.value === "string" &&
          HEX_LITERAL.test(node.value.value)
        ) {
          context.report({
            node: node.value,
            messageId: "hex",
            data: { hex: node.value.value },
          });
        }
      },
    };
  },
};

const plugin = {
  rules: {
    "no-arbitrary-value-classes": noArbitraryValueClasses,
    "no-numeric-z-index": noNumericZIndex,
    "no-raw-hex-in-styles": noRawHexInStyles,
  },
};

export default plugin;

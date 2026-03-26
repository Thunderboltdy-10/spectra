const BLOCKED_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "svg",
  "math",
]);

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "code",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "kbd",
  "li",
  "main",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isSafeUrl(url: string, tagName: string, attrName: string) {
  const trimmed = url.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith("#")) return true;
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return true;

  try {
    const parsed = new URL(trimmed, "https://spectra.local");
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:") {
      return true;
    }
    if (protocol === "blob:") {
      return tagName === "img" && attrName === "src";
    }
    if (protocol === "data:") {
      return tagName === "img" && attrName === "src" && trimmed.toLowerCase().startsWith("data:image/");
    }
    return false;
  } catch {
    return false;
  }
}

export function sanitizeArtifactDocumentHtml(inputHtml: string) {
  if (!inputHtml) return "";
  if (typeof DOMParser === "undefined") {
    return sanitizeHtmlWithoutDom(inputHtml);
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(inputHtml, "text/html");
  const body = parsed.body;
  if (!body) return "";

  const elements = Array.from(body.querySelectorAll("*"));
  for (const element of elements) {
    const tag = element.tagName.toLowerCase();

    if (BLOCKED_TAGS.has(tag)) {
      element.remove();
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      const parent = element.parentNode;
      if (parent) {
        while (element.firstChild) {
          parent.insertBefore(element.firstChild, element);
        }
        parent.removeChild(element);
      } else {
        element.remove();
      }
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith("on") || name === "style" || name === "srcset" || name === "formaction" || name === "action") {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === "href" || name === "src" || name === "xlink:href") {
        if (!isSafeUrl(value, tag, name === "xlink:href" ? "href" : name)) {
          element.removeAttribute(attribute.name);
          continue;
        }
      }

      if (tag === "a" && name === "target" && value === "_blank") {
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
  }

  return body.innerHTML;
}

function sanitizeHtmlWithoutDom(inputHtml: string) {
  let output = inputHtml;

  for (const tag of BLOCKED_TAGS) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    output = output.replace(paired, "");
    output = output.replace(selfClosing, "");
  }

  output = output
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/\s+(style|srcset|formaction|action)\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");

  output = output.replace(
    /\s+(href|src|xlink:href)\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi,
    (full, attrName: string, rawValue: string) => {
      const unquoted = rawValue.replace(/^['"]|['"]$/g, "");
      if (!isSafeUrl(unquoted, "a", attrName.toLowerCase())) {
        return "";
      }
      return full;
    },
  );

  return output;
}

export function downloadDocumentText(
  name: string,
  type: string,
  value: string,
) {
  downloadDocumentBlob(name, new Blob([value], { type }));
}

/** A work titled after its file ("Essay.docx") exported as Word must not become "Essay.docx.docx". */
export function downloadFileName(name: string) {
  return name.replace(/(\.[a-z0-9]{1,8})\1$/i, "$1");
}

export function downloadDocumentBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = downloadFileName(name);
  window.document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // The browser may consume the blob after the click task has returned.
    // Keep it alive through the download handoff, including large Office copies.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function artifactBlobSha256(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function escapeDocumentHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Active, foreign-namespace and raw-text elements. Raw-text/template/foreign
 * content is removed whole: it serializes differently from how a scripting-
 * enabled document re-parses it (mutation XSS), and SVG/MathML carry their own
 * URL-bearing attributes and animation elements. */
const DROPPED_DOCUMENT_ELEMENTS =
  "script,style,iframe,frame,frameset,object,embed,applet,portal,form,input,button,textarea,select,option,meta,link,base,noscript,noembed,noframes,template,svg,math,xmp,plaintext,title";
const DOCUMENT_URL_ATTRIBUTES = new Set([
  "href", "src", "action", "formaction", "poster", "background", "cite", "longdesc", "lowsrc", "dynsrc", "data",
]);
const SAFE_DOCUMENT_URL_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

function safeDocumentUrl(attribute: string, value: string) {
  // Browsers strip ASCII whitespace/control characters inside a URL scheme,
  // so `java&#9;script:` must be judged by the scheme the browser will use.
  const normalized = value.replace(/[\u0000- \u007f]/g, "").toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1];
  if (!scheme) return true;
  if (SAFE_DOCUMENT_URL_SCHEMES.has(scheme)) return true;
  return (
    scheme === "data" &&
    (attribute === "src" || attribute === "poster") &&
    /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);/.test(normalized)
  );
}

function sanitizeDocumentHtmlPass(source: string) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  parsed.body
    .querySelectorAll(DROPPED_DOCUMENT_ELEMENTS)
    .forEach((node) => node.remove());
  parsed.body.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.toLowerCase();
      if (
        name.startsWith("on") ||
        name.includes(":") ||
        name === "srcset" ||
        name === "ping" ||
        name === "srcdoc" ||
        (name === "style" && /url\s*\(|expression\s*\(|\\/i.test(value)) ||
        (DOCUMENT_URL_ATTRIBUTES.has(name) &&
          !safeDocumentUrl(name, attribute.value))
      )
        element.removeAttribute(attribute.name);
    });
  });
  return parsed.body.innerHTML;
}

/**
 * Sanitize untrusted document HTML (imports, shared card text, AI output)
 * before it reaches `innerHTML` or an editor. The result must be a fixed point:
 * if sanitizing the output changes it again, the markup relies on a parser
 * differential and only its text is kept.
 */
export function sanitizeDocumentHtml(source: string) {
  const sanitized = sanitizeDocumentHtmlPass(source);
  if (sanitizeDocumentHtmlPass(sanitized) === sanitized) return sanitized;
  const text =
    new DOMParser().parseFromString(sanitized, "text/html").body.textContent ??
    "";
  return `<p>${escapeDocumentHtml(text)}</p>`;
}

export function markdownToDocumentHtml(source: string) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = null;
  };
  const inline = (value: string) =>
    escapeDocumentHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      closeList();
      output.push(
        `<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`,
      );
    } else if (bullet || ordered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        list = kind;
        output.push(`<${kind}>`);
      }
      output.push(`<li>${inline((bullet ?? ordered)![1]!)}</li>`);
    } else if (line.startsWith("> ")) {
      closeList();
      output.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`);
    } else if (line.trim()) {
      closeList();
      output.push(`<p>${inline(line)}</p>`);
    } else closeList();
  }
  closeList();
  return output.join("");
}

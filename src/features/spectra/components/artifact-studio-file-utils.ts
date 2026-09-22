export function downloadDocumentText(
  name: string,
  type: string,
  value: string,
) {
  downloadDocumentBlob(name, new Blob([value], { type }));
}

export function downloadDocumentBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
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

export function sanitizeDocumentHtml(source: string) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  parsed
    .querySelectorAll(
      "script,style,iframe,object,embed,form,input,button,meta,link,base",
    )
    .forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        (name === "style" && /url\s*\(|expression\s*\(/i.test(value)) ||
        ((name === "href" || name === "src") &&
          /^(?:javascript|vbscript|data:text\/html)/i.test(value))
      )
        element.removeAttribute(attribute.name);
    });
  });
  return parsed.body.innerHTML;
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

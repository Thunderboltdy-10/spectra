function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cloneStylesIntoPrintWindow(source: Document, target: Document) {
  const styleNodes = source.querySelectorAll('style, link[rel="stylesheet"]');
  for (const node of styleNodes) {
    target.head.appendChild(node.cloneNode(true));
  }
}

async function waitUntilPrintable(doc: Document) {
  const fontsReady = doc.fonts?.ready ?? Promise.resolve();
  const imagesReady = Promise.all(
    Array.from(doc.images).map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );

  await Promise.all([fontsReady, imagesReady]);
  await new Promise((resolve) => window.setTimeout(resolve, 150));
}

export function exportElementToPrintPdf(element: HTMLElement, title = "Conversation") {
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1120,height=900");
  if (!printWindow) return;

  const sourceDocument = element.ownerDocument;
  const cloned = element.cloneNode(true) as HTMLElement;

  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head><body></body></html>`);
  printWindow.document.close();

  cloneStylesIntoPrintWindow(sourceDocument, printWindow.document);

  printWindow.document.documentElement.className = sourceDocument.documentElement.className;
  printWindow.document.body.className = sourceDocument.body.className;

  const printStyles = printWindow.document.createElement("style");
  printStyles.textContent = `
    @page { margin: 14mm; }
    html, body { height: auto !important; }
    body { margin: 0 !important; }
    .chat-print-shell {
      max-width: 960px;
      margin: 0 auto;
      padding: 20px 0;
    }
    .chat-print-title {
      margin: 0 0 16px;
      font-size: 1.5rem;
      line-height: 1.2;
    }
    .chat-print-content {
      height: auto !important;
      overflow: visible !important;
    }
    .chat-print-content * {
      animation: none !important;
      transition: none !important;
    }
    .chat-print-content [role="dialog"] {
      display: none !important;
    }
  `;
  printWindow.document.head.appendChild(printStyles);

  const shell = printWindow.document.createElement("main");
  shell.className = "chat-print-shell";

  const heading = printWindow.document.createElement("h1");
  heading.className = "chat-print-title";
  heading.textContent = title;

  const content = printWindow.document.createElement("section");
  content.className = "chat-print-content";
  content.appendChild(cloned);

  shell.append(heading, content);
  printWindow.document.body.replaceChildren(shell);

  void (async () => {
    await waitUntilPrintable(printWindow.document);
    printWindow.focus();
    printWindow.print();
    window.setTimeout(() => printWindow.close(), 300);
  })();
}

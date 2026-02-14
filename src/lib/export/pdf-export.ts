export function exportElementToPrintPdf(element: HTMLElement, title = "Conversation") {
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=960,height=720");
  if (!printWindow) return;

  const styles = `
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; margin: 24px; color: #121212; }
      h1 { font-size: 22px; margin-bottom: 18px; }
      pre, code { font-family: 'JetBrains Mono', monospace; }
      a { color: #0d5ddf; }
      .chat-print { line-height: 1.5; }
    </style>
  `;

  printWindow.document.write(`<!doctype html><html><head><title>${title}</title>${styles}</head><body><h1>${title}</h1><div class="chat-print">${element.innerHTML}</div></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

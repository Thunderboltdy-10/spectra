/**
 * Generates sandboxed HTML for rendering code previews in an iframe.
 * All execution happens client-side via srcdoc — no server involved.
 */

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;">`;

function buildResizeScript(frameId: string): string {
  return `
<script>
  const _frameId = ${JSON.stringify(frameId)};
  const sendHeight = () => {
    const h = Math.min(document.body.scrollHeight, 2000);
    parent.postMessage({ type: 'spectra-sandbox-resize', height: h, frameId: _frameId }, '*');
  };
  new ResizeObserver(sendHeight).observe(document.body);
  window.addEventListener('load', sendHeight);
  window.onerror = (msg, src, line) => {
    parent.postMessage({ type: 'spectra-sandbox-error', message: String(msg), line, frameId: _frameId }, '*');
  };
</script>`;
}

// Keep backward compat for callers that don't use frameId
const RESIZE_SCRIPT = buildResizeScript("");

export type PreviewLanguage =
  | "html"
  | "javascript"
  | "js"
  | "css"
  | "svg"
  | "mermaid"
  | "jsx"
  | "tsx"
  | "react";

export function canPreview(language: string): boolean {
  const lower = language.toLowerCase().trim();
  return [
    "html", "javascript", "js", "css", "svg",
    "mermaid", "jsx", "tsx", "react",
  ].includes(lower);
}

export function buildSrcdoc(code: string, language: PreviewLanguage, frameId?: string): string {
  const lang = language.toLowerCase().trim() as PreviewLanguage;

  const fid = frameId ?? "";

  switch (lang) {
    case "html":
      return wrapHtml(code, fid);

    case "javascript":
    case "js":
      return wrapHtml(`
        <div id="root"></div>
        <script>
          try { ${code} } catch(e) {
            document.getElementById('root').textContent = 'Error: ' + e.message;
          }
        </script>
      `, fid);

    case "css":
      return wrapHtml(`
        <style>${code}</style>
        <div class="preview">
          <h1>Heading 1</h1>
          <h2>Heading 2</h2>
          <p>Paragraph text for previewing CSS styles.</p>
          <button>Button</button>
          <a href="#">Link</a>
          <ul><li>List item 1</li><li>List item 2</li></ul>
        </div>
      `, fid);

    case "svg":
      return wrapHtml(`
        <div style="display:flex;align-items:center;justify-content:center;min-height:200px;">
          ${code}
        </div>
      `, fid);

    case "mermaid":
      return wrapHtml(`
        <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
        <div class="mermaid">${escapeHtml(code)}</div>
        <script>
          mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
        </script>
      `, fid);

    case "jsx":
    case "tsx":
    case "react":
      return buildReactSrcdoc(code, fid);

    default:
      return wrapHtml(`<pre><code>${escapeHtml(code)}</code></pre>`, fid);
  }
}

function wrapHtml(body: string, frameId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  ${CSP_META}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1a1a2e;
      background: #fff;
    }
    .mermaid { display: flex; justify-content: center; }
  </style>
</head>
<body>
  ${body}
  ${buildResizeScript(frameId)}
</body>
</html>`;
}

function buildReactSrcdoc(code: string, frameId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  ${CSP_META}
  <meta charset="utf-8">
  <script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 14px; color: #1a1a2e; background: #fff; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module">
    ${code}

    // Auto-render: look for default export or App component
    const _exports = typeof App !== 'undefined' ? App : typeof exports !== 'undefined' && exports.default ? exports.default : null;
    if (_exports) {
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(_exports));
    }
  </script>
  ${buildResizeScript(frameId)}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

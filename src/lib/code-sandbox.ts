/**
 * Generates sandboxed HTML for rendering code previews in an iframe.
 * All execution happens client-side via srcdoc — no server involved.
 */

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src https://cdn.jsdelivr.net; worker-src blob:; child-src blob:;">`;

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

export type PreviewLanguage =
  | "html"
  | "javascript"
  | "js"
  | "css"
  | "svg"
  | "mermaid"
  | "python"
  | "py"
  | "jsx"
  | "tsx"
  | "react";

export function canPreview(language: string): boolean {
  const lower = language.toLowerCase().trim();
  return [
    "html", "javascript", "js", "css", "svg",
    "mermaid", "python", "py", "jsx", "tsx", "react",
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
        <div class="mermaid" style="min-height:200px;">${escapeHtml(code)}</div>
        <script>
          (async () => {
            const raw = ${JSON.stringify(code)};
            try {
              if (typeof mermaid.parse === 'function') {
                await mermaid.parse(raw);
              }
              mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
              const target = document.querySelector('.mermaid');
              if (target) {
                target.textContent = raw;
                await mermaid.run({ nodes: [target] });
              }
            } catch (error) {
              const message = error && typeof error === 'object' && 'message' in error
                ? String(error.message)
                : String(error ?? 'Unknown mermaid error');
              const lineMatch = message.match(/line\\s*(\\d+)/i);
              const lineNumber = lineMatch ? Number(lineMatch[1]) : null;
              const lines = raw.split(/\\r?\\n/);
              const problemLine = lineNumber && lineNumber > 0 && lineNumber <= lines.length
                ? String(lines[lineNumber - 1] ?? '').trim()
                : '';
              const cleaned = lineMatch
                ? 'Mermaid syntax error on line ' + lineMatch[1] + (problemLine ? ': ' + problemLine : '') + '.'
                : 'Mermaid syntax error: ' + message;
              parent.postMessage({ type: 'spectra-sandbox-error', message: cleaned, frameId: ${JSON.stringify(fid)} }, '*');
              const target = document.querySelector('.mermaid');
              if (target) {
                target.textContent = cleaned;
              }
            }
          })();
        </script>
      `, fid);

    case "python":
    case "py":
      return wrapHtml(`
        <script src="https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js"></script>
        <div id="py-status" class="py-status">Initializing Python runtime…</div>
        <pre id="py-output" class="py-output"></pre>
        <div id="py-plot" class="py-plot"></div>
        <script>
          (async () => {
            const statusEl = document.getElementById('py-status');
            const outputEl = document.getElementById('py-output');
            const plotEl = document.getElementById('py-plot');
            const encoded = btoa(unescape(encodeURIComponent(${JSON.stringify(code)})));
            const appendOutput = (value) => {
              if (!value) return;
              outputEl.textContent += value.endsWith('\\n') ? value : value + '\\n';
            };
            try {
              statusEl.textContent = 'Loading Pyodide…';
              const pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/' });
              pyodide.setStdout({ batched: appendOutput });
              pyodide.setStderr({ batched: appendOutput });
              statusEl.textContent = 'Running Python…';

              // Optional packages for scientific plotting.
              try {
                await pyodide.loadPackage(['matplotlib', 'numpy']);
              } catch (packageError) {
                appendOutput('Warning: optional plotting packages unavailable: ' + String(packageError));
              }

              const wrapper = [
                'import base64',
                'import io',
                'import json',
                'import contextlib',
                'CODE = base64.b64decode("' + encoded + '").decode("utf-8")',
                '_stdout = io.StringIO()',
                '_stderr = io.StringIO()',
                '_plot_svg = ""',
                '_plt = None',
                'try:',
                '  import matplotlib',
                '  matplotlib.use("svg")',
                '  import matplotlib.pyplot as plt',
                '  _plt = plt',
                'except Exception:',
                '  _plt = None',
                'globals_dict = {}',
                'with contextlib.redirect_stdout(_stdout), contextlib.redirect_stderr(_stderr):',
                '  exec(CODE, globals_dict, globals_dict)',
                'if _plt is not None and len(_plt.get_fignums()) > 0:',
                '  _svg_buffer = io.StringIO()',
                '  _plt.gcf().savefig(_svg_buffer, format="svg")',
                '  _plot_svg = _svg_buffer.getvalue()',
                '  _plt.close("all")',
                'json.dumps({"stdout": _stdout.getvalue(), "stderr": _stderr.getvalue(), "plot_svg": _plot_svg})',
              ].join('\\n');

              const resultRaw = await pyodide.runPythonAsync(wrapper);
              const parsed = JSON.parse(String(resultRaw || '{}'));
              outputEl.textContent = '';
              appendOutput(parsed.stdout || '');
              if (parsed.stderr) appendOutput(parsed.stderr);
              if (parsed.plot_svg) {
                plotEl.innerHTML = parsed.plot_svg;
              } else {
                plotEl.innerHTML = '';
              }
              statusEl.textContent = 'Python execution complete.';
            } catch (error) {
              const message = error && typeof error === 'object' && 'message' in error
                ? String(error.message)
                : String(error ?? 'Python execution failed');
              statusEl.textContent = 'Python execution failed.';
              appendOutput(message);
              parent.postMessage({ type: 'spectra-sandbox-error', message: 'Python runtime error: ' + message, frameId: ${JSON.stringify(fid)} }, '*');
            }
          })();
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
    :where(h1, h2, h3, h4, h5, h6, p, ul, ol, figure, blockquote, pre) { margin: 0; }
    :where(ul, ol) { padding-left: 1.2rem; margin: 0; }
    body {
      margin: 0;
      padding: 12px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1a1a2e;
      background: #fff;
    }
    h1 { font-size: 1.35rem; line-height: 1.25; }
    h2 { font-size: 1.15rem; line-height: 1.3; }
    h3 { font-size: 1.02rem; line-height: 1.35; }
    p + p { margin-top: 0.65rem; }
    .py-status {
      margin-bottom: 0.5rem;
      font-size: 12px;
      color: #425466;
    }
    .py-output {
      min-height: 120px;
      border: 1px solid #d9dee8;
      border-radius: 10px;
      background: #f7f9fc;
      padding: 10px;
      overflow: auto;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      color: #1f2937;
    }
    .py-plot {
      margin-top: 10px;
      overflow: auto;
      background: #ffffff;
      border-radius: 10px;
    }
    .mermaid { display: flex; justify-content: center; min-height: 200px; }
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

import type { CodeFile } from "./model";

export type PythonRuntimeEvent =
  | { type: "status"; status: "loading" | "running" }
  | { type: "stdout" | "stderr"; text: string }
  | { type: "render"; html: string }
  | { type: "chart"; spec: unknown }
  | { type: "complete"; result?: string }
  | { type: "error"; message: string; traceback?: string }
  | { type: "limit"; message: string }
  | { type: "telemetry"; startupMs: number; durationMs: number; sourceBytes: number; fileCount: number };

const MAX_OUTPUT_CHARACTERS = 120_000;
const MAX_RENDER_CHARACTERS = 700_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_SOURCE_BYTES = 1_500_000;
const MAX_PROJECT_FILES = 120;
const MAX_REUSE_RUNS = 4;
export const APPROVED_PYODIDE_PACKAGES = new Set([
  "numpy",
  "pandas",
  "matplotlib",
  "scipy",
  "scikit-learn",
  "sympy",
]);

type RuntimeSlot = {
  worker: Worker;
  url: string;
  busy: boolean;
  runs: number;
};

let reusableRuntimeSlot: RuntimeSlot | null = null;

function workerSource(assetBase: string) {
  return `
    import { loadPyodide } from ${JSON.stringify(`${assetBase}pyodide.mjs`)};
    const ASSET_BASE = ${JSON.stringify(assetBase)};
    const MAX_OUTPUT = ${MAX_OUTPUT_CHARACTERS};
    const MAX_RENDER = ${MAX_RENDER_CHARACTERS};
    let outputCharacters = 0;
    let requestId = '';
    let pyodidePromise;
    const send = (value) => self.postMessage({ ...value, requestId });
    const write = (type, value) => {
      const text = String(value ?? '');
      outputCharacters += text.length;
      if (outputCharacters > MAX_OUTPUT) {
        send({ type: 'limit', message: 'Python output exceeded the 120,000 character safety budget.' });
        throw new Error('PYTHON_OUTPUT_LIMIT');
      }
      send({ type, text });
    };
    self.onmessage = async (event) => {
      if (!event.data || event.data.type !== 'run') return;
      try {
        requestId = String(event.data.requestId || 'run');
        outputCharacters = 0;
        const startedAt = performance.now();
        send({ type: 'status', status: 'loading' });
        pyodidePromise ||= loadPyodide({ indexURL: ASSET_BASE });
        const pyodide = await pyodidePromise;
        const startupMs = performance.now() - startedAt;
        pyodide.setStdout({ batched: (value) => write('stdout', value) });
        pyodide.setStderr({ batched: (value) => write('stderr', value) });
        const resources = event.data.resources && typeof event.data.resources === 'object' ? event.data.resources : {};
        const parameters = event.data.parameters && typeof event.data.parameters === 'object' ? event.data.parameters : {};
        try { pyodide.unregisterJsModule('spectra'); } catch {}
        try { pyodide.unregisterJsModule('spectra_assets'); } catch {}
        pyodide.registerJsModule('spectra', Object.freeze({
          render(html) {
            const value = String(html ?? '');
            if (value.length > MAX_RENDER) throw new Error('Rendered HTML exceeds the 700,000 character preview budget.');
            send({ type: 'render', html: value });
          },
          chart(spec) {
            let safeSpec;
            try {
              const value = spec && typeof spec.toJs === 'function' ? spec.toJs({ dict_converter: Object.fromEntries }) : spec;
              safeSpec = JSON.parse(JSON.stringify(value));
            } catch { throw new Error('Chart data must be JSON serializable.'); }
            const encoded = JSON.stringify(safeSpec);
            if (encoded.length > 80000) throw new Error('Chart data exceeds the 80,000 character safety budget.');
            send({ type: 'chart', spec: safeSpec });
          },
          emit(name, detail) {
            const safeName = String(name ?? '').slice(0, 80);
            if (!/^[a-z][a-z0-9_.:-]{0,63}$/i.test(safeName)) throw new Error('Invalid Spectra event name.');
            let safeDetail = null;
            try { safeDetail = JSON.parse(JSON.stringify(detail)); } catch {}
            send({ type: 'stdout', text: '[interaction] ' + safeName + (safeDetail === null ? '' : ' ' + JSON.stringify(safeDetail)) });
          },
          get_resource(id) {
            const key = String(id ?? '');
            return JSON.stringify(Object.prototype.hasOwnProperty.call(resources, key) ? resources[key] : null);
          },
          list_resources() { return JSON.stringify(Object.keys(resources)); },
          get_parameter(key) {
            const name = String(key ?? '');
            return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : null;
          },
          list_parameters() { return JSON.stringify(Object.keys(parameters)); },
        }));
        const deny = () => Promise.reject(new Error('Network access is disabled in the Spectra Python runtime.'));
        try { self.fetch = deny; } catch {}
        try { self.XMLHttpRequest = class { constructor() { throw new Error('Network access is disabled in the Spectra Python runtime.'); } }; } catch {}
        try { self.WebSocket = class { constructor() { throw new Error('Network access is disabled in the Spectra Python runtime.'); } }; } catch {}
        try { self.EventSource = class { constructor() { throw new Error('Network access is disabled in the Spectra Python runtime.'); } }; } catch {}
        try { self.importScripts = () => { throw new Error('Loading external scripts is disabled in the Spectra Python runtime.'); }; } catch {}
        try { self.Worker = class { constructor() { throw new Error('Nested workers are disabled in the Spectra Python runtime.'); } }; } catch {}
        try { self.SharedWorker = class { constructor() { throw new Error('Shared workers are disabled in the Spectra Python runtime.'); } }; } catch {}
        try { self.BroadcastChannel = class { constructor() { throw new Error('Cross-context channels are disabled in the Spectra Python runtime.'); } }; } catch {}
        try { self.RTCPeerConnection = class { constructor() { throw new Error('Peer connections are disabled in the Spectra Python runtime.'); } }; } catch {}
        try { Object.defineProperty(self, 'indexedDB', { value: undefined, configurable: false }); } catch {}
        try { Object.defineProperty(self, 'caches', { value: undefined, configurable: false }); } catch {}
        if (event.data.packages?.length) await pyodide.loadPackage(event.data.packages);
        const projectRoot = '/home/pyodide/project/' + requestId.replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
        pyodide.FS.mkdirTree(projectRoot);
        const assetPaths = {};
        for (const asset of event.data.assets || []) {
          const path = projectRoot + '/' + asset.path;
          const parent = path.slice(0, path.lastIndexOf('/'));
          const marker = ';base64,';
          const split = asset.dataUrl.indexOf(marker);
          if (split < 0) throw new Error('An immutable asset payload is invalid.');
          const encoded = asset.dataUrl.slice(split + marker.length);
          const binary = atob(encoded);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          pyodide.FS.mkdirTree(parent);
          pyodide.FS.writeFile(path, bytes);
          assetPaths[asset.id] = asset.path;
        }
        pyodide.registerJsModule('spectra_assets', Object.freeze({
          get_path(id) { return assetPaths[String(id ?? '')] ?? null; },
          list_assets() { return JSON.stringify(assetPaths); },
        }));
        for (const file of event.data.files) {
          const path = projectRoot + '/' + file.path;
          const parent = path.slice(0, path.lastIndexOf('/'));
          pyodide.FS.mkdirTree(parent);
          pyodide.FS.writeFile(path, file.source, { encoding: 'utf8' });
        }
        pyodide.FS.chdir(projectRoot);
        send({ type: 'status', status: 'running' });
        const result = await pyodide.runPythonAsync(event.data.source, { filename: event.data.entryPath });
        let serialized;
        if (result !== undefined && result !== null) {
          try { serialized = String(result).slice(0, 20_000); } catch { serialized = '[result unavailable]'; }
          try { result.destroy?.(); } catch {}
        }
        send({ type: 'telemetry', startupMs, durationMs: performance.now() - startedAt, sourceBytes: event.data.sourceBytes, fileCount: event.data.files.length });
        send({ type: 'complete', ...(serialized ? { result: serialized } : {}) });
      } catch (error) {
        const message = String(error && error.message || error || 'Python execution failed.');
        if (message === 'PYTHON_OUTPUT_LIMIT') return;
        send({ type: 'error', message: message.slice(0, 1_600), traceback: String(error && error.stack || '').slice(0, 8_000) });
      }
    };
  `;
}

export function runPythonInIsolatedWorker({
  files,
  entryFileId,
  onEvent,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  additionalSource = "",
  resources = {},
  parameters = {},
  assets = [],
  packages = [],
  reuseWorker = true,
}: {
  files: CodeFile[];
  entryFileId: string;
  onEvent: (event: PythonRuntimeEvent) => void;
  timeoutMs?: number;
  additionalSource?: string;
  resources?: Record<string, unknown>;
  parameters?: Record<string, string | number | boolean>;
  assets?: Array<{
    id: string;
    path: string;
    mediaType: string;
    dataUrl: string;
  }>;
  packages?: string[];
  reuseWorker?: boolean;
}) {
  const entry =
    files.find((file) => file.id === entryFileId) ??
    files.find(
      (file) => file.language === "python" || file.path.endsWith(".py"),
    );
  if (!entry)
    throw new Error("Choose a Python entry file before running this artifact.");
  if (files.length > MAX_PROJECT_FILES)
    throw new Error(`Python projects may contain at most ${MAX_PROJECT_FILES} files locally.`);
  const sourceBytes = files.reduce((total, file) => total + new TextEncoder().encode(file.source).byteLength, 0);
  if (sourceBytes > MAX_SOURCE_BYTES)
    throw new Error("Python source exceeds the 1.5 MB local runtime budget.");
  const approvedPackages = [...new Set(packages)];
  const deniedPackage = approvedPackages.find((name) => !APPROVED_PYODIDE_PACKAGES.has(name));
  if (deniedPackage)
    throw new Error(`${deniedPackage} is not in Spectra's approved local Python package set.`);
  const createSlot = (): RuntimeSlot => {
    const blob = new Blob([workerSource("/api/spectra/runtime/python/")], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    return { worker: new Worker(url, { name: "spectra-python-runtime", type: "module" }), url, busy: false, runs: 0 };
  };
  const slot = reuseWorker && reusableRuntimeSlot && !reusableRuntimeSlot.busy && reusableRuntimeSlot.runs < MAX_REUSE_RUNS
    ? reusableRuntimeSlot
    : createSlot();
  if (reuseWorker && slot !== reusableRuntimeSlot) {
    if (reusableRuntimeSlot && !reusableRuntimeSlot.busy) {
      reusableRuntimeSlot.worker.terminate();
      URL.revokeObjectURL(reusableRuntimeSlot.url);
    }
    reusableRuntimeSlot = slot;
  }
  slot.busy = true;
  slot.runs += 1;
  const worker = slot.worker;
  const requestId = crypto.randomUUID();
  let settled = false;
  const finish = (forceTerminate = false) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    worker.onmessage = null;
    worker.onerror = null;
    if (forceTerminate || !reuseWorker || slot.runs >= MAX_REUSE_RUNS) {
      worker.terminate();
      URL.revokeObjectURL(slot.url);
      if (reusableRuntimeSlot === slot) reusableRuntimeSlot = null;
    } else {
      slot.busy = false;
    }
  };
  worker.onmessage = (event: MessageEvent<PythonRuntimeEvent & { requestId?: string }>) => {
    const value = event.data;
    if (value.requestId !== requestId) return;
    if (!value || typeof value !== "object" || typeof value.type !== "string")
      return;
    onEvent(value);
    if (
      value.type === "complete" ||
      value.type === "error" ||
      value.type === "limit"
    )
      finish();
  };
  worker.onerror = (event) => {
    onEvent({
      type: "error",
      message:
        event.message || "The isolated Python worker stopped unexpectedly.",
    });
    finish(true);
  };
  const timer = window.setTimeout(() => {
    onEvent({
      type: "limit",
      message: `Python execution exceeded the ${Math.round(timeoutMs / 1000)} second runtime limit and was stopped.`,
    });
    finish(true);
  }, timeoutMs);
  let safeResources: Record<string, unknown> = {};
  let safeParameters: Record<string, string | number | boolean> = {};
  let safeAssets: typeof assets = [];
  try {
    const encodedResources = JSON.stringify(resources);
    if (encodedResources.length <= 220_000)
      safeResources = JSON.parse(encodedResources) as Record<string, unknown>;
  } catch {}
  try {
    const encodedParameters = JSON.stringify(parameters);
    if (encodedParameters.length <= 32_000)
      safeParameters = JSON.parse(encodedParameters) as Record<
        string,
        string | number | boolean
      >;
  } catch {}
  try {
    const selected = assets
      .slice(0, 100)
      .filter(
        (asset) =>
          asset &&
          typeof asset.id === "string" &&
          typeof asset.path === "string" &&
          typeof asset.mediaType === "string" &&
          typeof asset.dataUrl === "string" &&
          asset.dataUrl.startsWith(`data:${asset.mediaType};base64,`),
      );
    const encodedAssets = JSON.stringify(selected);
    if (encodedAssets.length <= 11_000_000)
      safeAssets = JSON.parse(encodedAssets) as typeof assets;
  } catch {}
  worker.postMessage({
    type: "run",
    requestId,
    files: files.map((file) => ({ path: file.path, source: file.source })),
    entryPath: entry.path,
    source: `${entry.source}${additionalSource}`,
    resources: safeResources,
    parameters: safeParameters,
    assets: safeAssets,
    packages: approvedPackages,
    sourceBytes,
  });
  return { cancel: () => finish(true), execution: "local_worker" as const };
}

export function pythonRuntimeFallback({
  worker,
  wasm,
  sourceBytes,
}: {
  worker: boolean;
  wasm: boolean;
  sourceBytes: number;
}) {
  return worker && wasm && sourceBytes <= MAX_SOURCE_BYTES
    ? { path: "local_worker" as const, reason: "device_ready" }
    : { path: "server" as const, reason: "unsupported_or_large" };
}

export function disposeReusablePythonWorker() {
  if (!reusableRuntimeSlot) return;
  reusableRuntimeSlot.worker.terminate();
  URL.revokeObjectURL(reusableRuntimeSlot.url);
  reusableRuntimeSlot = null;
}

export type LocalBuildFile = {
  path: string;
  source: string;
  language?: "javascript" | "typescript" | "jsx" | "tsx" | "css" | "json";
};

export type CachedBuildDependency = {
  version: string;
  source: string;
};

export type LocalBuildDiagnostic = {
  level: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
};

export type LocalBuildOutput = {
  javascript: string;
  css: string;
  sourceMap: string;
  diagnostics: LocalBuildDiagnostic[];
  sourceBytes: number;
  outputBytes: number;
  durationMs: number;
  sandbox: {
    scripts: "allow-scripts";
    network: "blocked_by_spectra_bridge";
    origin: "opaque";
  };
};

export const APPROVED_LOCAL_BUILD_DEPENDENCIES = {
  react: "19.2.3",
  "react-dom": "19.2.3",
  "react/jsx-runtime": "19.2.3",
  "react/jsx-dev-runtime": "19.2.3",
} as const;

const MAX_LOCAL_BUILD_SOURCE = 1_200_000;
const MAX_LOCAL_BUILD_OUTPUT = 2_500_000;
const MAX_LOCAL_BUILD_FILES = 180;
const MAX_REUSE_BUILDS = 8;

type WorkerSlot = { worker: Worker; busy: boolean; builds: number };
let reusableBuildWorker: WorkerSlot | null = null;

function validatePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("Local build paths must remain inside the project.");
  }
  return normalized;
}

export function validateLocalBuildInput({
  files,
  entryPath,
  dependencies,
}: {
  files: readonly LocalBuildFile[];
  entryPath: string;
  dependencies?: Record<string, CachedBuildDependency>;
}) {
  if (!files.length || files.length > MAX_LOCAL_BUILD_FILES) {
    throw new Error(`Local builds accept between 1 and ${MAX_LOCAL_BUILD_FILES} files.`);
  }
  const normalized = files.map((file) => ({ ...file, path: validatePath(file.path) }));
  const unique = new Set(normalized.map((file) => file.path.toLowerCase()));
  if (unique.size !== normalized.length) throw new Error("Local build paths must be unique.");
  const sourceBytes = normalized.reduce(
    (total, file) => total + new TextEncoder().encode(file.source).byteLength,
    0,
  );
  if (sourceBytes > MAX_LOCAL_BUILD_SOURCE) throw new Error("Local build source exceeds 1.2 MB.");
  const normalizedEntry = validatePath(entryPath);
  if (!normalized.some((file) => file.path === normalizedEntry)) throw new Error("The local build entry file is missing.");
  for (const [name, dependency] of Object.entries(dependencies ?? {})) {
    const approved = APPROVED_LOCAL_BUILD_DEPENDENCIES[name as keyof typeof APPROVED_LOCAL_BUILD_DEPENDENCIES];
    if (!approved || dependency.version !== approved) {
      throw new Error(`${name}@${dependency.version} is not an approved immutable local dependency.`);
    }
  }
  return { files: normalized, entryPath: normalizedEntry, dependencies: dependencies ?? {}, sourceBytes };
}

export type LocalBuildHandle = {
  result: Promise<LocalBuildOutput>;
  cancel: () => void;
  fallback: { path: "server"; endpoint: "/api/spectra/runtime/build" };
};

export function buildLocally(input: {
  files: readonly LocalBuildFile[];
  entryPath: string;
  dependencies?: Record<string, CachedBuildDependency>;
  timeoutMs?: number;
}): LocalBuildHandle {
  const validated = validateLocalBuildInput(input);
  const slot = reusableBuildWorker && !reusableBuildWorker.busy && reusableBuildWorker.builds < MAX_REUSE_BUILDS
    ? reusableBuildWorker
    : { worker: new Worker(new URL("./local-build.worker.ts", import.meta.url), { type: "module", name: "spectra-local-js-build" }), busy: false, builds: 0 };
  if (slot !== reusableBuildWorker) {
    if (reusableBuildWorker && !reusableBuildWorker.busy) reusableBuildWorker.worker.terminate();
    reusableBuildWorker = slot;
  }
  slot.busy = true;
  slot.builds += 1;
  const requestId = crypto.randomUUID();
  let settled = false;
  let rejectTask: (reason?: unknown) => void = () => {};
  const cleanup = (terminate = false) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    if (terminate || slot.builds >= MAX_REUSE_BUILDS) {
      slot.worker.terminate();
      if (reusableBuildWorker === slot) reusableBuildWorker = null;
    } else slot.busy = false;
  };
  const result = new Promise<LocalBuildOutput>((resolve, reject) => {
    rejectTask = reject;
    slot.worker.onmessage = (event: MessageEvent<{ requestId: string; ok: boolean; output?: LocalBuildOutput; error?: string; diagnostics?: LocalBuildDiagnostic[] }>) => {
      if (event.data.requestId !== requestId) return;
      if (event.data.ok && event.data.output) resolve(event.data.output);
      else {
        const error = new Error(event.data.error || "The local build failed.");
        Object.assign(error, { diagnostics: event.data.diagnostics ?? [] });
        reject(error);
      }
      cleanup();
    };
    slot.worker.onerror = (event) => {
      reject(new Error(event.message || "The local build worker stopped."));
      cleanup(true);
    };
    slot.worker.postMessage({ requestId, ...validated, maximumOutputBytes: MAX_LOCAL_BUILD_OUTPUT });
  });
  const timer = window.setTimeout(() => {
    rejectTask(new Error("The local build exceeded its worker safety limit."));
    cleanup(true);
  }, input.timeoutMs ?? 15_000);
  return {
    result,
    cancel: () => {
      rejectTask(new DOMException("The local build was cancelled.", "AbortError"));
      cleanup(true);
    },
    fallback: { path: "server", endpoint: "/api/spectra/runtime/build" },
  };
}

export function localBuildFallback(inputBytes: number, deviceReady: boolean) {
  return deviceReady && inputBytes <= MAX_LOCAL_BUILD_SOURCE
    ? "local_worker" as const
    : "server" as const;
}

export function disposeReusableBuildWorker() {
  reusableBuildWorker?.worker.terminate();
  reusableBuildWorker = null;
}

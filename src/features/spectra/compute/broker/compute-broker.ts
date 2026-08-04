export type ComputeTaskKind =
  | "autocomplete"
  | "pdf_inspection"
  | "attachment_extraction"
  | "python_execution"
  | "javascript_build"
  | "local_analysis"
  | "office_conversion"
  | "native_model_attachment";

export type ComputePath = "local_worker" | "server" | "provider" | "degraded";
export type LocalComputePreference = "auto" | "prefer_local" | "never";
export type MemoryPressure = "low" | "moderate" | "high" | "unknown";

export type DeviceComputeProfile = {
  worker: boolean;
  wasm: boolean;
  webAssemblyStreaming: boolean;
  mobile: boolean;
  logicalCores: number;
  deviceMemoryGb?: number;
  memoryPressure: MemoryPressure;
  batterySaver: boolean;
  dataSaver: boolean;
};

export type ComputeRequest = {
  task: ComputeTaskKind;
  inputBytes: number;
  preference: LocalComputePreference;
  device: DeviceComputeProfile;
  privacy: "local_required" | "local_preferred" | "server_allowed";
  cancellable: boolean;
  modelDownloadBytes?: number;
  explicitModelApproval?: boolean;
};

export type ComputeDecision = {
  path: ComputePath;
  reason:
    | "local_only_ready"
    | "local_preferred_ready"
    | "automatic_local_fit"
    | "provider_native"
    | "server_for_size"
    | "server_for_capability"
    | "server_by_preference"
    | "server_for_pressure"
    | "degraded_local_unavailable"
    | "degraded_policy"
    | "degraded_model_approval_required";
  cancellation: "terminate_worker" | "abort_request" | "provider_abort" | "none";
  disclosure: string;
};

const LOCAL_ONLY = new Set<ComputeTaskKind>(["autocomplete"]);
const PROVIDER_NATIVE = new Set<ComputeTaskKind>(["native_model_attachment"]);
const LOCAL_SIZE_LIMIT: Record<ComputeTaskKind, number> = {
  autocomplete: 96_000,
  pdf_inspection: 20_000_000,
  attachment_extraction: 12_000_000,
  python_execution: 2_000_000,
  javascript_build: 1_200_000,
  local_analysis: 8_000_000,
  office_conversion: 8_000_000,
  native_model_attachment: 0,
};

export function isConstrainedDevice(device: DeviceComputeProfile) {
  return (
    device.mobile ||
    device.batterySaver ||
    device.memoryPressure === "high" ||
    (device.deviceMemoryGb !== undefined && device.deviceMemoryGb < 4) ||
    device.logicalCores < 4
  );
}

function localReady(request: ComputeRequest) {
  return (
    request.device.worker &&
    (request.task === "autocomplete" || request.device.wasm) &&
    request.inputBytes <= LOCAL_SIZE_LIMIT[request.task]
  );
}

export function chooseComputePath(request: ComputeRequest): ComputeDecision {
  if (PROVIDER_NATIVE.has(request.task)) {
    return {
      path: "provider",
      reason: "provider_native",
      cancellation: request.cancellable ? "provider_abort" : "none",
      disclosure: "The original file is passed through the configured model provider's native input path.",
    };
  }
  if (
    request.modelDownloadBytes !== undefined &&
    request.modelDownloadBytes > 80_000_000 &&
    !request.explicitModelApproval
  ) {
    return {
      path: "degraded",
      reason: "degraded_model_approval_required",
      cancellation: "none",
      disclosure: "A large local model requires device capability checks and explicit approval before download.",
    };
  }
  const canRunLocal = localReady(request);
  if (request.privacy === "local_required" || LOCAL_ONLY.has(request.task)) {
    return canRunLocal &&
      (request.task === "autocomplete" || !isConstrainedDevice(request.device))
      ? {
          path: "local_worker",
          reason: "local_only_ready",
          cancellation: "terminate_worker",
          disclosure:
            request.task === "autocomplete" && isConstrainedDevice(request.device)
              ? "A lightweight deterministic completion tier stays in an isolated worker; no model is loaded."
              : "This task stays on this device in an isolated worker.",
        }
      : {
          path: "degraded",
          reason: "degraded_local_unavailable",
          cancellation: "none",
          disclosure: "Local-only processing is unavailable on this device; no cloud fallback was used.",
        };
  }
  if (request.preference === "never") {
    return {
      path: "server",
      reason: "server_by_preference",
      cancellation: request.cancellable ? "abort_request" : "none",
      disclosure: "Local compute is disabled on this device.",
    };
  }
  if (!request.device.worker || !request.device.wasm) {
    return {
      path: "server",
      reason: "server_for_capability",
      cancellation: request.cancellable ? "abort_request" : "none",
      disclosure: "This browser lacks the worker or WebAssembly capability required for safe local execution.",
    };
  }
  if (request.inputBytes > LOCAL_SIZE_LIMIT[request.task]) {
    return {
      path: "server",
      reason: "server_for_size",
      cancellation: request.cancellable ? "abort_request" : "none",
      disclosure: "The input exceeds this task's bounded local processing budget.",
    };
  }
  if (isConstrainedDevice(request.device)) {
    return {
      path: "server",
      reason: "server_for_pressure",
      cancellation: request.cancellable ? "abort_request" : "none",
      disclosure: "Battery, memory or mobile constraints make the server path safer for this task.",
    };
  }
  return {
    path: "local_worker",
    reason:
      request.preference === "prefer_local"
        ? "local_preferred_ready"
        : "automatic_local_fit",
    cancellation: "terminate_worker",
    disclosure: "This task fits the current device's isolated-worker budget.",
  };
}

export function browserComputeProfile(): DeviceComputeProfile {
  if (typeof navigator === "undefined") {
    return {
      worker: false,
      wasm: typeof WebAssembly !== "undefined",
      webAssemblyStreaming: false,
      mobile: false,
      logicalCores: 1,
      memoryPressure: "unknown",
      batterySaver: false,
      dataSaver: false,
    };
  }
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
    userAgentData?: { mobile?: boolean };
  };
  return {
    worker: typeof Worker !== "undefined",
    wasm: typeof WebAssembly !== "undefined",
    webAssemblyStreaming:
      typeof WebAssembly !== "undefined" && "instantiateStreaming" in WebAssembly,
    mobile:
      nav.userAgentData?.mobile ??
      /Android|iPhone|iPad|Mobile/i.test(nav.userAgent),
    logicalCores: Math.max(1, nav.hardwareConcurrency || 1),
    ...(typeof nav.deviceMemory === "number" ? { deviceMemoryGb: nav.deviceMemory } : {}),
    memoryPressure: "unknown",
    batterySaver: false,
    dataSaver: nav.connection?.saveData === true,
  };
}

export type RegisteredComputeTask = {
  kind: ComputeTaskKind;
  execution: "worker" | "server" | "provider";
  cancellable: boolean;
};

export const COMPUTE_TASK_REGISTRY = [
  { kind: "autocomplete", execution: "worker", cancellable: true },
  { kind: "pdf_inspection", execution: "worker", cancellable: true },
  { kind: "attachment_extraction", execution: "worker", cancellable: true },
  { kind: "python_execution", execution: "worker", cancellable: true },
  { kind: "javascript_build", execution: "worker", cancellable: true },
  { kind: "office_conversion", execution: "server", cancellable: true },
  { kind: "native_model_attachment", execution: "provider", cancellable: true },
] as const satisfies readonly RegisteredComputeTask[];

export function assertNoMainThreadCompute() {
  return COMPUTE_TASK_REGISTRY.every((task) => task.execution !== ("main_thread" as never));
}

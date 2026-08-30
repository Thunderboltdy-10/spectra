import type { ProviderDescriptor } from "./types";

export const BUILT_IN_PROVIDER_DESCRIPTORS = [
  {
    id: "spectra-bridge",
    family: "file-sync",
    display: {
      name: "This device",
      description: "Use ordinary files and folders through Spectra Bridge.",
      icon: "device",
    },
    auth: { kind: "device" },
    capabilities: {
      artifactTypes: ["document", "sheets", "presentation"],
      nativeFormats: ["docx", "xlsx", "pptx", "spectra-pkg"],
      directions: ["sync"],
      notes: ["The Bridge stays local and file-system only."],
    },
    rateLimit: {
      requestsPerMinute: 12,
      baseBackoffMs: 5_000,
      maxBackoffMs: 120_000,
    },
    worker: { kind: "bridge", module: "bridge" },
  },
  {
    id: "managebac",
    family: "school-data",
    display: {
      name: "ManageBac",
      description:
        "Read school classes, deadlines, timetable data, and CAS records.",
      icon: "school",
    },
    auth: { kind: "token" },
    capabilities: {
      artifactTypes: ["planner_task", "timetable", "resource"],
      nativeFormats: [],
      directions: ["refresh"],
      notes: ["School-managed and read-only at the provider boundary."],
    },
    rateLimit: {
      requestsPerMinute: 180,
      baseBackoffMs: 15_000,
      maxBackoffMs: 900_000,
    },
    worker: {
      kind: "convex-action",
      module: "executionScheduler:dispatchManageBacSync",
    },
  },
] as const satisfies readonly ProviderDescriptor[];

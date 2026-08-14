import * as Y from "yjs";
import type {
  ArtifactCollaborationTransport,
  CollaborationPresence,
  CollaborationTransportSnapshot,
} from "../collaboration/types";
import type { SpectraStreamEvent } from "../ai/stream-events";
import { SPECTRA_PROTOCOL_VERSIONS } from "./protocol";

type JsonRecord = Record<string, unknown>;

export function resolveLegacySpectraRoute(pathname: string) {
  if (pathname === "/artifacts") return "/library";
  if (pathname.startsWith("/artifacts/"))
    return `/library/${pathname.slice("/artifacts/".length)}`;
  if (pathname === "/timetable" || pathname.startsWith("/timetable/"))
    return "/calendar";
  if (pathname === "/memory" || pathname.startsWith("/memory/"))
    return "/settings?section=privacy";
  return null;
}

export class LegacyArtifactTransportAdapter
  implements ArtifactCollaborationTransport
{
  constructor(private readonly legacy: ArtifactCollaborationTransport) {}

  get document(): Y.Doc {
    return this.legacy.document;
  }

  get clientId() {
    return this.legacy.clientId;
  }

  getSnapshot(): CollaborationTransportSnapshot {
    return this.legacy.getSnapshot();
  }

  subscribe(listener: () => void) {
    return this.legacy.subscribe(listener);
  }

  connect() {
    return this.legacy.connect();
  }

  retry() {
    return this.legacy.retry();
  }

  disconnect() {
    this.legacy.disconnect();
  }

  destroy() {
    this.legacy.destroy();
  }

  setPresence(fields: Omit<CollaborationPresence, "clientId">) {
    this.legacy.setPresence(fields);
  }

  transact(regionId: string, change: () => void) {
    this.legacy.transact(regionId, change);
  }

  flush() {
    return this.legacy.flush();
  }
}

export type LegacyArtifactSnapshot = {
  schemaVersion?: number;
  content: unknown;
  regions?: Record<string, string>;
};

export class LegacyArtifactModelAdapter {
  migrate(snapshot: LegacyArtifactSnapshot) {
    const document = new Y.Doc();
    const metadata = document.getMap<unknown>("metadata");
    const regions = document.getMap<string>("legacy-regions");
    metadata.set("schemaVersion", snapshot.schemaVersion ?? 1);
    metadata.set("legacyContent", snapshot.content);
    for (const [key, value] of Object.entries(snapshot.regions ?? {}))
      regions.set(key, value);
    return document;
  }

  project(document: Y.Doc): LegacyArtifactSnapshot {
    const metadata = document.getMap<unknown>("metadata");
    const regions = document.getMap<string>("legacy-regions");
    return {
      schemaVersion:
        typeof metadata.get("schemaVersion") === "number"
          ? (metadata.get("schemaVersion") as number)
          : 1,
      content: metadata.get("legacyContent"),
      regions: Object.fromEntries(regions.entries()),
    };
  }
}

export type RunItemV2 = {
  protocolVersion: typeof SPECTRA_PROTOCOL_VERSIONS.runItems;
  runId: string;
  type: string;
  payload: JsonRecord;
};

export function adaptLegacyRunEvent(event: SpectraStreamEvent): RunItemV2 {
  const { type, runId = "unknown", ...payload } = event;
  return {
    protocolVersion: SPECTRA_PROTOCOL_VERSIONS.runItems,
    runId,
    type,
    payload,
  };
}

export type LegacyToolDefinition = {
  type: string;
  purpose: string;
  execution: "immediate" | "confirmation" | "deferred";
  batchable: boolean;
};

export function adaptLegacyToolDefinition(definition: LegacyToolDefinition) {
  return {
    id: definition.type,
    version: 1,
    title: definition.type
      .split(/[._-]/g)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    description: definition.purpose,
    category: definition.execution === "deferred" ? "external" : "write",
    risk: definition.execution === "confirmation" ? "high" : "low",
    approval:
      definition.execution === "confirmation" ? "always" : "never",
    parallelSafe: definition.batchable,
  } as const;
}

export type LegacyReferencePreview = {
  id: string;
  artifactId: string;
  expanded?: boolean;
  regionId?: string;
};

export function adaptLegacyReferencePreview(
  legacy: LegacyReferencePreview,
) {
  return {
    protocolVersion: SPECTRA_PROTOCOL_VERSIONS.references,
    id: legacy.id,
    target: {
      workId: legacy.artifactId,
      anchor: legacy.regionId
        ? {
            workId: legacy.artifactId,
            workType: "legacy",
            kind: "region",
            path: [legacy.regionId],
            schemaVersion: 1,
          }
        : undefined,
    },
    state: legacy.expanded ? "expanded" : "collapsed",
    versionPolicy: "live",
  } as const;
}

export type LegacyPreferences = {
  theme?: "light" | "dark" | "system";
  compact?: boolean;
  continueThread?: boolean;
};

export function adaptLegacyPreferences(legacy: LegacyPreferences) {
  return {
    version: SPECTRA_PROTOCOL_VERSIONS.preferences,
    account: {
      appearance: { theme: legacy.theme ?? "system" },
      ai: { continueCurrentConversation: legacy.continueThread ?? true },
    },
    device: { density: legacy.compact ? "compact" : "comfortable" },
  } as const;
}

export type LegacySchoolRecord = JsonRecord & {
  id?: string;
  type?: string;
  updatedAt?: string | number;
};

export function adaptLegacySchoolRecord(record: LegacySchoolRecord) {
  return {
    protocolVersion: SPECTRA_PROTOCOL_VERSIONS.schoolSource,
    provider: "managebac",
    providerRecordId: record.id ?? "unknown",
    kind: record.type ?? "unknown",
    sourceUpdatedAt: record.updatedAt,
    payload: record,
  } as const;
}

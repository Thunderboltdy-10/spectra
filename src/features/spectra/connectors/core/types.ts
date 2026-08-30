export const CONNECTOR_FAMILIES = [
  "file-sync",
  "calendar",
  "school-data",
] as const;

export type ConnectorFamily = (typeof CONNECTOR_FAMILIES)[number];

export const CONNECTION_AUTH_KINDS = [
  "oauth",
  "token",
  "file",
  "device",
] as const;

export type ConnectionAuthKind = (typeof CONNECTION_AUTH_KINDS)[number];

export const CONNECTION_STATUSES = [
  "connected",
  "expired",
  "rate_limited",
  "revoked",
  "error",
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type ConnectorCapabilityManifest = {
  artifactTypes: string[];
  nativeFormats: string[];
  directions: Array<"import" | "export" | "refresh" | "sync">;
  notes?: string[];
};

export type OAuthProviderFlow = {
  kind: "oauth";
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  clientAuth?: "body" | "basic";
  scopes: string[];
  authorizationParams?: Record<string, string>;
  userInfo?: {
    url: string;
    idField: string;
    labelField?: string;
  };
};

export type ProviderAuthFlow =
  OAuthProviderFlow | { kind: "token" } | { kind: "file" } | { kind: "device" };

export type ProviderWorker =
  | { kind: "convex-action"; module: string }
  | { kind: "bridge"; module: "bridge" }
  | { kind: "none" };

export type ProviderDescriptor = {
  id: string;
  family: ConnectorFamily;
  display: {
    name: string;
    description: string;
    icon: "device" | "school" | "cloud" | "calendar" | "file";
  };
  auth: ProviderAuthFlow;
  capabilities: ConnectorCapabilityManifest;
  rateLimit: {
    requestsPerMinute: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
  };
  worker: ProviderWorker;
};

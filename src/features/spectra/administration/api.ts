import { requestSpectra } from "../data/request";

export type AdministrationIdentity = {
  account: {
    accountId: string;
    email: string;
    name: string;
    avatarUrl?: string;
    platformOperator: boolean;
  };
  membership: {
    schoolId: string;
    role: "student" | "teacher" | "school_admin";
    membershipId: string;
  } | null;
};

export type UsageSeriesPoint = {
  day: string;
  values: Record<string, number>;
};

export type AdministrationMetricState =
  | { kind: "available"; updatedAt?: number }
  | { kind: "partial"; details: string };

export type SchoolAdministrationOverview = {
  school: {
    schoolId: string;
    name: string;
    slug: string;
    timezone: string;
    verifiedDomains: string[];
    locale?: string;
    accentColor?: string;
    logoUrl?: string;
    academicYearStart?: string;
    academicYearEnd?: string;
    accessibilityDefaults?: {
      reducedMotion: boolean;
      increasedContrast: boolean;
      largerText: boolean;
    };
    status: "active" | "suspended" | "archived";
    policyVersion: number;
  };
  operatorSession: null | {
    sessionId: string;
    label: string;
    mode: "inspect" | "manage";
    expiresAt: number;
  };
  metrics: {
    members: number;
    active30d: number;
    invitations: number;
    pendingApprovals: number;
    groups: number;
    classWorkspaces: number;
    feedbackNew: number;
    artifactsCreated: number | null;
    messages: number | null;
    aiRuns: number | null;
  };
  metricStates: Record<keyof SchoolAdministrationOverview["metrics"], AdministrationMetricState>;
  computedAt: number;
  usage: {
    totals: Record<string, number>;
    series: UsageSeriesPoint[];
    completeThrough: string;
  };
  limits: {
    policyId: string | null;
    enforcement: "disabled" | "simulate" | "enforced";
    rules: Array<{
      category: string;
      period: "day" | "month" | "total";
      warningAt?: number;
      maximum: number;
    }>;
    updatedAt: number | null;
  };
  integration: null | {
    integrationId: string;
    status: string;
    lastSyncAt?: number;
    nextSyncAt?: number;
    coverage?: {
      discovered: number;
      verifiedReadable: number;
      unverified: number;
      failed: number;
      quarantined: number;
    };
  };
  groupWorkspaces: Array<{
    workspaceId: string;
    title: string;
    type: string;
    lastActivityAt?: number;
  }>;
  feedback: Array<{
    feedbackId: string;
    subject: string;
    category: string;
    status: string;
    createdAt: number;
  }>;
  recentActivity: Array<{
    eventId: string;
    action: string;
    targetType: string;
    createdAt: number;
    operator: boolean;
  }>;
  privacy: string;
};

export type PlatformAdministrationOverview = {
  metrics: {
    activeSchools: number;
    totalUsers: number;
    activeUsers30d: number;
    artifactsCreated: number | null;
    messages: number | null;
    retentionPercent: number;
  };
  metricStates: {
    activeSchools: AdministrationMetricState;
    totalUsers: AdministrationMetricState;
    activeUsers30d: AdministrationMetricState;
    artifactsCreated: AdministrationMetricState;
    messages: AdministrationMetricState;
    retentionPercent: AdministrationMetricState;
    storageBytes: AdministrationMetricState;
    integrationHealth: AdministrationMetricState;
    feedback: AdministrationMetricState;
    failedRuns24h: AdministrationMetricState;
    openRequests: AdministrationMetricState;
  };
  computedAt: number;
  usage: {
    totals: Record<string, number>;
    series: UsageSeriesPoint[];
    completeThrough: string;
  };
  storageBytes: number;
  serviceHealth: Array<{ service: string; status: string }>;
  integrations: { total: number; degraded: number };
  feedback: {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
    themes: Array<[string, number]>;
  };
  topSchools: Array<{ schoolId: string; name: string; usage: number }>;
  incidents: Array<{
    _id: string;
    title: string;
    summary: string;
    affectedServices: string[];
    severity: "minor" | "major" | "critical";
    status: string;
    updatedAt: number;
  }>;
  requests: Array<{
    _id: string;
    subject: string;
    type: string;
    priority: string;
    status: string;
    createdAt: number;
  }>;
  queues: {
    failedRuns24h: number | null;
    integrationErrors: number;
    openFeedback: number;
    openRequests: number;
  };
  privacy: string;
};

async function responseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | (T & {
        error?: string | { code?: string; message?: string; requestId?: string };
        message?: string;
      })
    | null;
  if (!response.ok) {
    const structuredError =
      data?.error && typeof data.error === "object" ? data.error : null;
    // The route strips the machine code from the sentence; keep it beside the
    // message so callers can branch on it (for example, a final invitation
    // decision must not be offered as a retry) without showing it to anyone.
    throw Object.assign(
      new Error(
        data?.message ??
          structuredError?.message ??
          (typeof data?.error === "string" ? data.error : undefined) ??
          "Spectra could not finish this request. Try again in a moment.",
      ),
      { code: structuredError?.code },
    );
  }
  return data as T;
}

export async function getAdministration<T>(
  action: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  const query = new URLSearchParams({ action });
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) query.set(key, String(value));
  return responseJson<T>(
    await requestSpectra(`/api/spectra/administration?${query}`, {
      cache: "no-store",
    }),
  );
}

export async function mutateAdministration<T>(
  action: string,
  payload: Record<string, unknown> = {},
) {
  return responseJson<T>(
    await requestSpectra("/api/spectra/administration", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    }),
  );
}

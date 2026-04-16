export type ManagebacEndpointKey =
  | "school"
  | "students"
  | "student_profile"
  | "classes"
  | "timetable"
  | "cas"
  | "announcements"
  | "assignments";

export type ManagebacEndpointProbe = {
  key: ManagebacEndpointKey;
  label: string;
  path: string;
  status: "available" | "unavailable";
  discoveredAt: number;
  requiresStudentId?: boolean;
  httpStatus?: number;
  error?: string;
};

export type ManagebacDiscoveryResult = {
  baseUrl: string;
  endpoints: ManagebacEndpointProbe[];
};

const REQUEST_TIMEOUT_MS = 12_000;

const DISCOVERY_ENDPOINTS: Array<{
  key: ManagebacEndpointKey;
  label: string;
  path: string;
  requiresStudentId?: boolean;
}> = [
  { key: "school", label: "School", path: "/api/v2/school" },
  { key: "students", label: "Students", path: "/api/v2/students" },
  { key: "student_profile", label: "Student profile", path: "/api/v2/students/{studentId}", requiresStudentId: true },
  { key: "classes", label: "Classes", path: "/api/v2/classes" },
  { key: "timetable", label: "Timetable", path: "/api/v2/students/{studentId}/timetable", requiresStudentId: true },
  { key: "cas", label: "CAS", path: "/api/v2/students/{studentId}/cas", requiresStudentId: true },
  { key: "announcements", label: "Announcements", path: "/api/v2/announcements" },
  { key: "assignments", label: "Assignments", path: "/api/v2/students/{studentId}/assignments", requiresStudentId: true },
];

export function normalizeManagebacBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function managebacHeaders(token: string) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "auth-token": token,
    Authorization: `Bearer ${token}`,
  };
}

export function resolveManagebacPath(path: string, studentId?: string) {
  if (path.includes("{studentId}") && !studentId) {
    throw new Error(`Endpoint ${path} requires a student id`);
  }
  return path.replaceAll("{studentId}", encodeURIComponent(studentId ?? ""));
}

export async function fetchManagebacJson<T = unknown>(params: {
  baseUrl: string;
  token: string;
  path: string;
  studentId?: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${normalizeManagebacBaseUrl(params.baseUrl)}${resolveManagebacPath(params.path, params.studentId)}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: managebacHeaders(params.token),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      throw Object.assign(new Error(`ManageBac request failed (${response.status})`), {
        status: response.status,
        body,
      });
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverManagebacEndpoints(params: {
  baseUrl: string;
  token: string;
  studentId?: string;
}): Promise<ManagebacDiscoveryResult> {
  const baseUrl = normalizeManagebacBaseUrl(params.baseUrl);
  const now = Date.now();
  const endpoints = await Promise.all(
    DISCOVERY_ENDPOINTS.map(async (endpoint) => {
      if (endpoint.requiresStudentId && !params.studentId) {
        return {
          ...endpoint,
          status: "unavailable" as const,
          discoveredAt: now,
          error: "student_id_required",
        };
      }
      try {
        await fetchManagebacJson({
          baseUrl,
          token: params.token,
          path: endpoint.path,
          studentId: params.studentId,
        });
        return {
          ...endpoint,
          status: "available" as const,
          discoveredAt: now,
        };
      } catch (error) {
        return {
          ...endpoint,
          status: "unavailable" as const,
          discoveredAt: now,
          httpStatus: error instanceof Error && "status" in error ? Number((error as { status?: number }).status) : undefined,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return { baseUrl, endpoints };
}

export async function fetchManagebacDataset(params: {
  baseUrl: string;
  token: string;
  studentId: string;
  endpoints?: ManagebacEndpointProbe[];
}) {
  const availability = new Map((params.endpoints ?? []).map((endpoint) => [endpoint.key, endpoint.status === "available"]));
  const canFetch = (key: ManagebacEndpointKey) => availability.get(key) ?? true;

  const jobs = {
    school: canFetch("school")
      ? fetchManagebacJson({ baseUrl: params.baseUrl, token: params.token, path: "/api/v2/school" }).catch(() => null)
      : Promise.resolve(null),
    studentProfile: canFetch("student_profile")
      ? fetchManagebacJson({ baseUrl: params.baseUrl, token: params.token, path: "/api/v2/students/{studentId}", studentId: params.studentId }).catch(() => null)
      : Promise.resolve(null),
    classes: canFetch("classes")
      ? fetchManagebacJson({ baseUrl: params.baseUrl, token: params.token, path: "/api/v2/classes" }).catch(() => null)
      : Promise.resolve(null),
    timetable: canFetch("timetable")
      ? fetchManagebacJson({ baseUrl: params.baseUrl, token: params.token, path: "/api/v2/students/{studentId}/timetable", studentId: params.studentId }).catch(() => null)
      : Promise.resolve(null),
    cas: canFetch("cas")
      ? fetchManagebacJson({ baseUrl: params.baseUrl, token: params.token, path: "/api/v2/students/{studentId}/cas", studentId: params.studentId }).catch(() => null)
      : Promise.resolve(null),
    announcements: canFetch("announcements")
      ? fetchManagebacJson({ baseUrl: params.baseUrl, token: params.token, path: "/api/v2/announcements" }).catch(() => null)
      : Promise.resolve(null),
    assignments: canFetch("assignments")
      ? fetchManagebacJson({ baseUrl: params.baseUrl, token: params.token, path: "/api/v2/students/{studentId}/assignments", studentId: params.studentId }).catch(() => null)
      : Promise.resolve(null),
  };

  const [school, studentProfile, classes, timetable, cas, announcements, assignments] = await Promise.all([
    jobs.school,
    jobs.studentProfile,
    jobs.classes,
    jobs.timetable,
    jobs.cas,
    jobs.announcements,
    jobs.assignments,
  ]);

  return {
    school,
    studentProfile,
    classes,
    timetable,
    cas,
    announcements,
    assignments,
  };
}

export type ManagebacRetrievalItemKind =
  | "student"
  | "class"
  | "assignment"
  | "announcement"
  | "cas"
  | "timetable";

export type ManagebacRetrievalItem = {
  kind: ManagebacRetrievalItemKind;
  id: string;
  title: string;
  summary: string;
  score: number;
  url?: string;
  dueAt?: number;
  payload: Record<string, unknown>;
};

export type ManagebacRuntimeRetrievalResult = {
  available: boolean;
  reason: string;
  student?: {
    id?: string;
    name?: string;
    gradeLevel?: string;
    email?: string;
  };
  items: ManagebacRetrievalItem[];
  sourceBlock: string;
};

function compactText(value: unknown, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function lexicalScore(query: string, text: string) {
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (queryTokens.length === 0) return 0;
  const haystack = new Set(tokenize(text));
  if (haystack.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) overlap += 1;
  }
  return overlap / queryTokens.length;
}

export function retrieveManagebacRuntimeContext(params: {
  message: string;
  snapshot: unknown;
  limit?: number;
}): ManagebacRuntimeRetrievalResult {
  const snapshot = params.snapshot as {
    available?: boolean;
    resolutionStatus?: string;
    message?: string;
    student?: { id?: string; name?: string; gradeLevel?: string; email?: string };
    workstreams?: Array<Record<string, unknown> & { managebacContext?: Record<string, unknown>; subjectCode?: string; managebacClassId?: string }>;
    plannerItems?: Array<Record<string, unknown>>;
    artifacts?: Array<Record<string, unknown>>;
    announcements?: Array<Record<string, unknown>>;
  } | null;

  if (!snapshot?.available) {
    return {
      available: false,
      reason: compactText(snapshot?.message ?? snapshot?.resolutionStatus ?? "ManageBac unavailable."),
      items: [],
      sourceBlock: "",
    };
  }

  const limit = Math.max(1, Math.min(8, Math.round(params.limit ?? 5)));
  const candidates: ManagebacRetrievalItem[] = [];
  const push = (item: ManagebacRetrievalItem | null) => { if (item) candidates.push(item); };

  const student = snapshot.student;
  if (student?.name || student?.gradeLevel || student?.email) {
    const text = [student.name, student.gradeLevel, student.email].filter(Boolean).join(" ");
    push({
      kind: "student",
      id: String(student.id ?? "student"),
      title: student.name ?? "ManageBac student",
      summary: compactText(`Student profile. ${student.gradeLevel ? `Grade ${student.gradeLevel}. ` : ""}${student.email ?? ""}`),
      score: lexicalScore(params.message, text) + 0.12,
      payload: { ...student },
    });
  }

  for (const row of snapshot.workstreams ?? []) {
    const title = compactText(row.title ?? row.name ?? 'ManageBac class', 120);
    const description = compactText(row.description ?? row.syncConflictSummary ?? '', 220);
    const subjectCode = compactText(row.subjectCode ?? row.managebacContext?.subjectCode ?? '', 80);
    const score = lexicalScore(params.message, `${title} ${description} ${subjectCode}`);
    push({
      kind: 'class',
      id: String(row._id ?? row.managebacClassId ?? title),
      title,
      summary: compactText(`${subjectCode ? `${subjectCode} — ` : ''}${description || 'ManageBac class workspace.'}`),
      score,
      payload: {
        workstreamId: row._id,
        managebacClassId: row.managebacClassId,
        subjectCode: row.subjectCode ?? row.managebacContext?.subjectCode,
      },
    });
  }

  for (const row of snapshot.plannerItems ?? []) {
    const title = compactText(row.title ?? 'Assignment', 120);
    const description = compactText(row.description ?? '', 220);
    const dueAt = typeof row.dueAt === 'number' ? row.dueAt : undefined;
    const score = lexicalScore(params.message, `${title} ${description}`) + (dueAt ? 0.04 : 0);
    push({
      kind: 'assignment',
      id: String(row._id ?? row.managebacItemId ?? title),
      title,
      summary: compactText(`${description}${dueAt ? ` Due ${new Date(dueAt).toISOString().slice(0, 10)}.` : ''}`),
      dueAt,
      score,
      payload: {
        plannerItemId: row._id,
        managebacItemId: row.managebacItemId,
        status: row.status,
        dueAt,
      },
    });
  }

  for (const row of snapshot.artifacts ?? []) {
    const title = compactText(row.title ?? 'ManageBac note', 120);
    const description = compactText(row.description ?? row.summary ?? '', 220);
    const itemKind = /cas/i.test(`${row.title ?? ''} ${row.description ?? ''}`) ? 'cas' : /timetable/i.test(`${row.title ?? ''}`) ? 'timetable' : 'assignment';
    const score = lexicalScore(params.message, `${title} ${description}`);
    push({
      kind: itemKind as ManagebacRetrievalItemKind,
      id: String(row._id ?? row.managebacItemId ?? title),
      title,
      summary: description || 'ManageBac synced artifact.',
      score,
      payload: {
        artifactId: row._id,
        managebacItemId: row.managebacItemId,
        workstreamId: row.workstreamId,
      },
    });
  }

  for (const row of snapshot.announcements ?? []) {
    const title = compactText(row.title ?? 'Announcement', 120);
    const summary = compactText(row.summary ?? row.body ?? '', 220);
    const url = typeof row.url === 'string' ? row.url : undefined;
    const score = lexicalScore(params.message, `${title} ${summary}`);
    push({
      kind: 'announcement',
      id: String(row.id ?? title),
      title,
      summary,
      url,
      score,
      payload: { url },
    });
  }

  const items = candidates
    .filter((item) => item.score > 0 || item.kind === 'student')
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);

  return {
    available: true,
    reason: items.length > 0 ? 'ManageBac context retrieved.' : 'ManageBac available but no strongly relevant records matched.',
    student: snapshot.student,
    items,
    sourceBlock: items.length > 0
      ? [
          '=== MANAGEBAC CONTEXT ===',
          ...items.map((item, index) => `${index + 1}. [${item.kind.toUpperCase()}] ${item.title}${item.dueAt ? ` | due ${new Date(item.dueAt).toISOString().slice(0, 10)}` : ''}
${item.summary}`),
          '=== END MANAGEBAC CONTEXT ===',
        ].join('\n\n')
      : '',
  };
}

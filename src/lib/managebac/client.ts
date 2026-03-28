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

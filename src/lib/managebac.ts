export type ManagebacTimetableItem = {
  id: string;
  title: string;
  course?: string;
  room?: string;
  teacher?: string;
  startTime?: string;
  endTime?: string;
};

export type ManagebacCasItem = {
  id: string;
  title: string;
  strand?: string;
  dueDate?: string;
  status?: string;
};

export type ManagebacAnnouncement = {
  id: string;
  title: string;
  summary?: string;
  publishedAt?: string;
  url?: string;
};

export type ManagebacSnapshot = {
  configured: boolean;
  deferred?: boolean;
  source: "live" | "fallback";
  fetchedAt: string;
  warning?: string;
  timetable: ManagebacTimetableItem[];
  cas: ManagebacCasItem[];
  announcements: ManagebacAnnouncement[];
};

type ManagebacConfig = {
  baseUrl: string;
  token: string;
  studentId: string;
  timetablePath: string;
  casPath: string;
  announcementsPath: string;
};

const REQUEST_TIMEOUT_MS = 7_500;

function asString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function getCollection(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }

  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const keys = ["data", "results", "items", "lessons", "events", "announcements", "entries"];
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
      );
    }
  }
  return [];
}

function parseTimetable(payload: unknown): ManagebacTimetableItem[] {
  const rows = getCollection(payload);
  return rows.slice(0, 16).map((row, index) => ({
    id: asString(row.id) ?? asString(row.lesson_id) ?? `lesson-${index}`,
    title:
      asString(row.title) ??
      asString(row.name) ??
      asString(row.subject) ??
      asString(row.course_name) ??
      "Scheduled lesson",
    course: asString(row.course) ?? asString(row.course_name),
    room: asString(row.room) ?? asString(row.location),
    teacher: asString(row.teacher) ?? asString(row.teacher_name),
    startTime: asString(row.start_time) ?? asString(row.starts_at) ?? asString(row.startAt),
    endTime: asString(row.end_time) ?? asString(row.ends_at) ?? asString(row.endAt),
  }));
}

function parseCas(payload: unknown): ManagebacCasItem[] {
  const rows = getCollection(payload);
  return rows.slice(0, 8).map((row, index) => ({
    id: asString(row.id) ?? asString(row.experience_id) ?? `cas-${index}`,
    title: asString(row.title) ?? asString(row.name) ?? "CAS item",
    strand: asString(row.strand) ?? asString(row.type),
    dueDate: asString(row.due_date) ?? asString(row.dueAt) ?? asString(row.deadline),
    status: asString(row.status),
  }));
}

function parseAnnouncements(payload: unknown): ManagebacAnnouncement[] {
  const rows = getCollection(payload);
  return rows.slice(0, 6).map((row, index) => ({
    id: asString(row.id) ?? asString(row.announcement_id) ?? `announcement-${index}`,
    title: asString(row.title) ?? asString(row.name) ?? "Announcement",
    summary: asString(row.summary) ?? asString(row.body) ?? asString(row.description),
    publishedAt: asString(row.published_at) ?? asString(row.created_at) ?? asString(row.date),
    url: asString(row.url) ?? asString(row.link),
  }));
}

function buildPath(template: string, studentId: string) {
  const withStudent = template.includes("{studentId}")
    ? template.replaceAll("{studentId}", encodeURIComponent(studentId))
    : template;
  return withStudent.startsWith("/") ? withStudent : `/${withStudent}`;
}

function getManagebacConfig(): ManagebacConfig | null {
  const baseUrl = asString(process.env.MANAGEBAC_BASE_URL);
  const token = asString(process.env.MANAGEBAC_API_TOKEN);
  const studentId = asString(process.env.MANAGEBAC_STUDENT_ID);

  if (!baseUrl || !token || !studentId) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    studentId,
    timetablePath: asString(process.env.MANAGEBAC_TIMETABLE_PATH) ?? "/api/v2/students/{studentId}/timetable",
    casPath: asString(process.env.MANAGEBAC_CAS_PATH) ?? "/api/v2/students/{studentId}/cas",
    announcementsPath: asString(process.env.MANAGEBAC_ANNOUNCEMENTS_PATH) ?? "/api/v2/announcements",
  };
}

async function fetchManagebacJson(config: ManagebacConfig, path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ManageBac request failed (${response.status})`);
    }

    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export function isManagebacConfigured() {
  return Boolean(getManagebacConfig());
}

export async function getManagebacSnapshot(): Promise<ManagebacSnapshot> {
  const config = getManagebacConfig();
  if (!config) {
    return {
      configured: false,
      deferred: true,
      source: "fallback",
      fetchedAt: new Date().toISOString(),
      warning: "ManageBac credentials are not configured.",
      timetable: [],
      cas: [],
      announcements: [],
    };
  }

  const [timetableResult, casResult, announcementsResult] = await Promise.allSettled([
    fetchManagebacJson(config, buildPath(config.timetablePath, config.studentId)),
    fetchManagebacJson(config, buildPath(config.casPath, config.studentId)),
    fetchManagebacJson(config, buildPath(config.announcementsPath, config.studentId)),
  ]);

  const warnings: string[] = [];
  const timetable =
    timetableResult.status === "fulfilled" ? parseTimetable(timetableResult.value) : [];
  const cas = casResult.status === "fulfilled" ? parseCas(casResult.value) : [];
  const announcements =
    announcementsResult.status === "fulfilled"
      ? parseAnnouncements(announcementsResult.value)
      : [];

  if (timetableResult.status === "rejected") warnings.push("timetable unavailable");
  if (casResult.status === "rejected") warnings.push("CAS unavailable");
  if (announcementsResult.status === "rejected") warnings.push("announcements unavailable");

  return {
    configured: true,
    source: warnings.length > 0 ? "fallback" : "live",
    fetchedAt: new Date().toISOString(),
    warning: warnings.length > 0 ? warnings.join(" • ") : undefined,
    timetable,
    cas,
    announcements,
  };
}

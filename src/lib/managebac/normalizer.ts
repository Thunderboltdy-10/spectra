type ManagebacRecord = Record<string, unknown>;

function asString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asTimestamp(value: unknown) {
  const stringValue = asString(value);
  if (!stringValue) return undefined;
  const parsed = Date.parse(stringValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getCollection(value: unknown): ManagebacRecord[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is ManagebacRecord => Boolean(item) && typeof item === "object");
  }
  if (!value || typeof value !== "object") return [];
  const record = value as ManagebacRecord;
  for (const key of ["data", "results", "items", "classes", "lessons", "announcements", "activities", "assignments"]) {
    if (Array.isArray(record[key])) {
      return getCollection(record[key]);
    }
  }
  return [];
}

export type NormalizedManagebacStudentProfile = {
  id: string;
  name?: string;
  email?: string;
  gradeLevel?: string;
  photoUrl?: string;
};

export type NormalizedManagebacClass = {
  id: string;
  title: string;
  subjectCode?: string;
  level?: string;
  teacherName?: string;
  description?: string;
};

export type NormalizedManagebacAssignment = {
  id: string;
  classId?: string;
  title: string;
  description?: string;
  dueAt?: number;
  url?: string;
  updatedAt?: number;
};

export type NormalizedManagebacCasActivity = {
  id: string;
  title: string;
  strand?: string;
  hours?: number;
  status?: string;
  reflection?: string;
  updatedAt?: number;
};

export type NormalizedManagebacTimetableEntry = {
  id: string;
  day?: string;
  startTime?: string;
  endTime?: string;
  room?: string;
  subjectTitle?: string;
  teacherName?: string;
};

export type NormalizedManagebacAnnouncement = {
  id: string;
  title: string;
  summary?: string;
  publishedAt?: number;
  url?: string;
};

export function normalizeManagebacStudentProfile(payload: unknown): NormalizedManagebacStudentProfile | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as ManagebacRecord;
  const id = asString(row.id) ?? asString(row.student_id);
  if (!id) return null;
  return {
    id,
    name: asString(row.name) ?? ([asString(row.first_name), asString(row.last_name)].filter(Boolean).join(" ") || undefined),
    email: asString(row.email) ?? asString(row.school_email),
    gradeLevel: asString(row.grade_level) ?? asString(row.grade) ?? asString(row.year_group),
    photoUrl: asString(row.photo_url) ?? asString(row.avatar_url) ?? asString(row.profile_photo_url),
  };
}

export function normalizeManagebacClasses(payload: unknown): NormalizedManagebacClass[] {
  return getCollection(payload).map((row, index) => ({
    id: asString(row.id) ?? asString(row.class_id) ?? `class-${index}`,
    title:
      asString(row.title)
      ?? asString(row.name)
      ?? asString(row.subject)
      ?? asString(row.course_name)
      ?? "Class",
    subjectCode: asString(row.code) ?? asString(row.subject_code) ?? asString(row.course_code),
    level: asString(row.level) ?? asString(row.course_level),
    teacherName: asString(row.teacher_name) ?? asString(row.teacher),
    description: asString(row.description) ?? asString(row.summary),
  }));
}

export function normalizeManagebacAssignments(payload: unknown): NormalizedManagebacAssignment[] {
  return getCollection(payload).map((row, index) => ({
    id: asString(row.id) ?? asString(row.assignment_id) ?? `assignment-${index}`,
    classId: asString(row.class_id) ?? asString(row.course_id) ?? asString(row.subject_id),
    title: asString(row.title) ?? asString(row.name) ?? "Assignment",
    description: asString(row.description) ?? asString(row.summary),
    dueAt: asTimestamp(row.due_at) ?? asTimestamp(row.due_date) ?? asTimestamp(row.deadline),
    url: asString(row.url) ?? asString(row.link),
    updatedAt: asTimestamp(row.updated_at) ?? asTimestamp(row.modified_at),
  }));
}

export function normalizeManagebacCasActivities(payload: unknown): NormalizedManagebacCasActivity[] {
  return getCollection(payload).map((row, index) => ({
    id: asString(row.id) ?? asString(row.activity_id) ?? asString(row.experience_id) ?? `cas-${index}`,
    title: asString(row.title) ?? asString(row.name) ?? "CAS activity",
    strand: asString(row.strand) ?? asString(row.type),
    hours: asNumber(row.hours) ?? asNumber(row.total_hours),
    status: asString(row.status),
    reflection: asString(row.reflection) ?? asString(row.description) ?? asString(row.notes),
    updatedAt: asTimestamp(row.updated_at) ?? asTimestamp(row.modified_at),
  }));
}

export function normalizeManagebacTimetable(payload: unknown): NormalizedManagebacTimetableEntry[] {
  return getCollection(payload).map((row, index) => ({
    id: asString(row.id) ?? asString(row.lesson_id) ?? `lesson-${index}`,
    day: asString(row.day) ?? asString(row.weekday),
    startTime: asString(row.start_time) ?? asString(row.starts_at),
    endTime: asString(row.end_time) ?? asString(row.ends_at),
    room: asString(row.room) ?? asString(row.location),
    subjectTitle: asString(row.subject) ?? asString(row.course_name) ?? asString(row.title),
    teacherName: asString(row.teacher_name) ?? asString(row.teacher),
  }));
}

export function normalizeManagebacAnnouncements(payload: unknown): NormalizedManagebacAnnouncement[] {
  return getCollection(payload).map((row, index) => ({
    id: asString(row.id) ?? asString(row.announcement_id) ?? `announcement-${index}`,
    title: asString(row.title) ?? asString(row.name) ?? "Announcement",
    summary: asString(row.summary) ?? asString(row.body) ?? asString(row.description),
    publishedAt: asTimestamp(row.published_at) ?? asTimestamp(row.created_at) ?? asTimestamp(row.date),
    url: asString(row.url) ?? asString(row.link),
  }));
}

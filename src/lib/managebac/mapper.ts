import {
  type NormalizedManagebacAnnouncement,
  type NormalizedManagebacAssignment,
  type NormalizedManagebacCasActivity,
  type NormalizedManagebacClass,
  type NormalizedManagebacStudentProfile,
  type NormalizedManagebacTimetableEntry,
} from "@/lib/managebac/normalizer";

export function mapManagebacClassToWorkstream(input: {
  klass: NormalizedManagebacClass;
  timetable: NormalizedManagebacTimetableEntry[];
  student?: NormalizedManagebacStudentProfile | null;
}) {
  return {
    type: "subject" as const,
    title: input.klass.title,
    subjectCode: input.klass.subjectCode,
    managebacClassId: input.klass.id,
    managebacContext: {
      level: input.klass.level,
      teacherName: input.klass.teacherName,
      description: input.klass.description,
      timetable: input.timetable,
      studentName: input.student?.name,
      syncedAt: Date.now(),
    },
  };
}

export function mapManagebacAssignmentToPlanner(input: {
  assignment: NormalizedManagebacAssignment;
  workstreamId?: string;
}) {
  return {
    title: input.assignment.title,
    description: input.assignment.description,
    dueAt: input.assignment.dueAt,
    workstreamId: input.workstreamId,
    sourceType: "managebac_sync" as const,
    managebacItemId: input.assignment.id,
    sourceUpdatedAt: input.assignment.updatedAt,
  };
}

export function mapManagebacCasToPlanner(input: {
  activity: NormalizedManagebacCasActivity;
  workstreamId?: string;
}) {
  return {
    title: input.activity.title,
    description: [input.activity.strand, input.activity.status, typeof input.activity.hours === "number" ? `${input.activity.hours} hours` : undefined]
      .filter(Boolean)
      .join(" • "),
    workstreamId: input.workstreamId,
    type: "milestone" as const,
    sourceType: "managebac_sync" as const,
    managebacItemId: input.activity.id,
    sourceUpdatedAt: input.activity.updatedAt,
  };
}

export function shouldCreateCasReflectionNote(activity: NormalizedManagebacCasActivity) {
  return Boolean(activity.reflection && activity.reflection.trim().length >= 120);
}

export function mapManagebacCasToNote(activity: NormalizedManagebacCasActivity) {
  return {
    title: `${activity.title} reflection`,
    plaintext: activity.reflection?.trim() ?? "",
    sourceType: "managebac_sync" as const,
    managebacItemId: activity.id,
    sourceUpdatedAt: activity.updatedAt,
  };
}

export function mapAnnouncementsToCache(announcements: NormalizedManagebacAnnouncement[]) {
  return announcements.slice(0, 20);
}

function normalizeMatchText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactMatchText(value?: string) {
  return normalizeMatchText(value).replace(/\s+/g, "");
}

function tokenizeMatchText(value?: string) {
  return normalizeMatchText(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function hasStrongTokenOverlap(subjectTitle: string, candidate: string) {
  const subjectTokens = new Set(tokenizeMatchText(subjectTitle));
  const candidateTokens = tokenizeMatchText(candidate);
  if (subjectTokens.size === 0 || candidateTokens.length === 0) return false;
  const overlap = candidateTokens.filter((token) => subjectTokens.has(token));
  if (overlap.length === 0) return false;
  if (candidateTokens.length === 1) return overlap[0]!.length >= 4;
  return overlap.length >= Math.max(2, Math.ceil(candidateTokens.length * 0.6));
}

export function timetableEntryMatchesManagebacClass(
  entry: NormalizedManagebacTimetableEntry,
  klass: NormalizedManagebacClass,
) {
  const subjectTitle = normalizeMatchText(entry.subjectTitle);
  if (!subjectTitle) return false;

  const classTitle = normalizeMatchText(klass.title);
  const subjectCode = normalizeMatchText(klass.subjectCode);

  if (classTitle) {
    if (subjectTitle === classTitle) return true;
    if (
      Math.min(subjectTitle.length, classTitle.length) >= 6
      && (subjectTitle.includes(classTitle) || classTitle.includes(subjectTitle))
    ) {
      return true;
    }
    if (hasStrongTokenOverlap(subjectTitle, classTitle)) {
      return true;
    }
  }

  if (subjectCode) {
    const compactCode = compactMatchText(subjectCode);
    const compactSubject = compactMatchText(subjectTitle);
    if (compactCode && compactSubject.includes(compactCode)) {
      return true;
    }
  }

  return false;
}

export function matchManagebacTimetableForClass(input: {
  klass: NormalizedManagebacClass;
  timetable: NormalizedManagebacTimetableEntry[];
}) {
  return input.timetable.filter((entry) => timetableEntryMatchesManagebacClass(entry, input.klass));
}

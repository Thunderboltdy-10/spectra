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

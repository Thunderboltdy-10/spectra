import { fetchManagebacDataset, type ManagebacEndpointProbe } from "@/lib/managebac/client";
import {
  normalizeManagebacAnnouncements,
  normalizeManagebacAssignments,
  normalizeManagebacCasActivities,
  normalizeManagebacClasses,
  normalizeManagebacStudentProfile,
  normalizeManagebacTimetable,
} from "@/lib/managebac/normalizer";

export type PreparedManagebacSyncPayload = {
  studentId: string;
  student: ReturnType<typeof normalizeManagebacStudentProfile>;
  classes: ReturnType<typeof normalizeManagebacClasses>;
  assignments: ReturnType<typeof normalizeManagebacAssignments>;
  casActivities: ReturnType<typeof normalizeManagebacCasActivities>;
  timetable: ReturnType<typeof normalizeManagebacTimetable>;
  announcements: ReturnType<typeof normalizeManagebacAnnouncements>;
  warnings: string[];
};

export async function prepareManagebacSyncPayload(params: {
  baseUrl: string;
  token: string;
  studentId: string;
  endpoints?: ManagebacEndpointProbe[];
}): Promise<PreparedManagebacSyncPayload> {
  const dataset = await fetchManagebacDataset(params);
  const warnings: string[] = [];
  if (!dataset.classes) warnings.push("classes unavailable");
  if (!dataset.assignments) warnings.push("assignments unavailable");
  if (!dataset.cas) warnings.push("CAS unavailable");
  if (!dataset.announcements) warnings.push("announcements unavailable");
  if (!dataset.timetable) warnings.push("timetable unavailable");

  return {
    studentId: params.studentId,
    student: normalizeManagebacStudentProfile(dataset.studentProfile),
    classes: normalizeManagebacClasses(dataset.classes),
    assignments: normalizeManagebacAssignments(dataset.assignments),
    casActivities: normalizeManagebacCasActivities(dataset.cas),
    timetable: normalizeManagebacTimetable(dataset.timetable),
    announcements: normalizeManagebacAnnouncements(dataset.announcements),
    warnings,
  };
}

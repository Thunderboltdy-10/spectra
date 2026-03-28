import { describe, expect, it } from "vitest";
import {
  normalizeManagebacAnnouncements,
  normalizeManagebacAssignments,
  normalizeManagebacCasActivities,
  normalizeManagebacClasses,
  normalizeManagebacStudentProfile,
  normalizeManagebacTimetable,
} from "@/lib/managebac/normalizer";

describe("managebac normalizer", () => {
  it("keeps only allowlisted student profile fields", () => {
    const profile = normalizeManagebacStudentProfile({
      id: "student_1",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.edu",
      grade_level: "IB DP1",
      photo_url: "https://cdn.example.edu/ada.jpg",
      phone: "+34-555",
      birthday: "2008-01-01",
      medical_info: "redacted",
      parent_email: "guardian@example.com",
    });

    expect(profile).toEqual({
      id: "student_1",
      name: "Ada Lovelace",
      email: "ada@example.edu",
      gradeLevel: "IB DP1",
      photoUrl: "https://cdn.example.edu/ada.jpg",
    });
    expect("phone" in (profile ?? {})).toBe(false);
    expect("medical_info" in (profile ?? {})).toBe(false);
  });

  it("normalizes core academic entities without leaking extra fields", () => {
    const classes = normalizeManagebacClasses([{ id: "c1", title: "Biology HL", code: "BIO-HL", teacher_name: "Mr Smith", room: "201" }]);
    const assignments = normalizeManagebacAssignments([{ id: "a1", class_id: "c1", title: "Lab report", due_at: "2026-04-05T10:00:00Z", internal_notes: "hidden" }]);
    const cas = normalizeManagebacCasActivities([{ id: "cas1", title: "Beach cleanup", strand: "Service", hours: 4, reflection: "A".repeat(140), parent_contact: "hidden" }]);
    const timetable = normalizeManagebacTimetable([{ id: "t1", day: "Mon", start_time: "09:00", end_time: "10:00", subject: "Biology HL", teacher_name: "Mr Smith", phone: "hidden" }]);
    const announcements = normalizeManagebacAnnouncements([{ id: "n1", title: "Exam week", summary: "Starts Monday", published_at: "2026-03-20T09:00:00Z", url: "https://school.example/exams", audience: "all" }]);

    expect(classes[0]).toEqual({
      id: "c1",
      title: "Biology HL",
      subjectCode: "BIO-HL",
      level: undefined,
      teacherName: "Mr Smith",
      description: undefined,
    });
    expect(assignments[0]?.classId).toBe("c1");
    expect(assignments[0]?.title).toBe("Lab report");
    expect(cas[0]?.reflection?.length).toBeGreaterThanOrEqual(140);
    expect(timetable[0]?.subjectTitle).toBe("Biology HL");
    expect(announcements[0]?.title).toBe("Exam week");
    expect("room" in classes[0]!).toBe(false);
    expect("internal_notes" in assignments[0]!).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { buildManagebacMappingState, buildManagebacStudentMappings } from "@/lib/managebac/admin-config";
import { matchManagebacTimetableForClass, timetableEntryMatchesManagebacClass } from "@/lib/managebac/mapper";

describe("managebac admin config", () => {
  it("builds saved mappings using Clerk IDs for students only", () => {
    const members = [
      { _id: "user_doc_1", clerkId: "clerk_student_1", name: "Ada", email: "ada@example.edu", role: "student" as const },
      { _id: "user_doc_2", clerkId: "clerk_teacher_1", name: "Grace", email: "grace@example.edu", role: "teacher" as const },
      { _id: "user_doc_3", clerkId: "clerk_admin_1", name: "Linus", email: "linus@example.edu", role: "admin" as const },
    ];

    const saved = buildManagebacStudentMappings(members, {
      clerk_student_1: "mb-001 ",
      user_doc_1: "wrong-key-should-not-be-used",
      clerk_teacher_1: "teacher-should-not-be-saved",
    });

    expect(saved).toEqual([
      {
        clerkId: "clerk_student_1",
        email: "ada@example.edu",
        managebacStudentId: "mb-001",
      },
    ]);
  });

  it("hydrates mapping state by Clerk ID", () => {
    expect(buildManagebacMappingState([
      { clerkId: "clerk_student_1", managebacStudentId: "mb-001" },
      { clerkId: "clerk_student_2", managebacStudentId: "mb-002", email: "two@example.edu" },
    ])).toEqual({
      clerk_student_1: "mb-001",
      clerk_student_2: "mb-002",
    });
  });
});

describe("managebac timetable matching", () => {
  it("matches timetable entries against class fields without attaching unrelated subjects", () => {
    const klass = {
      id: "class_bio",
      title: "Biology HL",
      subjectCode: "BIO-HL",
      level: "HL",
      teacherName: "Mr Smith",
      description: undefined,
    };
    const timetable = [
      { id: "lesson_1", subjectTitle: "Biology HL", day: "Mon", startTime: "09:00", endTime: "10:00" },
      { id: "lesson_2", subjectTitle: "English Literature HL", day: "Mon", startTime: "10:00", endTime: "11:00" },
      { id: "lesson_3", subjectTitle: "Advisory", day: "Tue", startTime: "08:00", endTime: "08:30" },
    ];

    expect(matchManagebacTimetableForClass({ klass, timetable }).map((entry) => entry.id)).toEqual(["lesson_1"]);
  });

  it("supports close subject-title variants for the same class", () => {
    const klass = {
      id: "class_math",
      title: "Math Analysis and Approaches SL",
      subjectCode: "MATH-AASL",
      level: "SL",
      teacherName: "Ms Doe",
      description: undefined,
    };
    const entry = {
      id: "lesson_math",
      subjectTitle: "Math Analysis and Approaches",
      day: "Wed",
      startTime: "12:00",
      endTime: "13:00",
    };

    expect(timetableEntryMatchesManagebacClass(entry, klass)).toBe(true);
  });
});

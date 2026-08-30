import { createHash } from "node:crypto";

export type ManageBacCapabilityDefinition = {
  category: string;
  name: string;
  recordType: string;
  path: string;
  purpose: string;
  scope: "personal" | "class" | "school";
  minimumRole: "student" | "teacher" | "school_admin";
  pagination: "none" | "page" | "cursor" | "unknown";
  changeStrategy:
    "full_reconciliation" | "modified_since" | "cursor" | "unknown";
  freshnessSlaMinutes: number;
  contractVersion: string;
  responseSchemaHash?: string;
  permissionState: "read_only" | "not_enabled" | "unverified";
  verificationStatus: "verified" | "failed" | "quarantined" | "unverified";
  routeSource: "tenant_reference" | "api_manager" | "manual_verified";
  personalIdParameter?: string;
  normalization: Record<string, unknown>;
};

export type ManageBacFrontierCapability = {
  category: string;
  entities: readonly string[];
  verdict: "live_probe_required";
  permissionState: "unverified";
  providerPath: null;
  reason: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function manageBacContractDigest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

/**
 * Read-only personal routes retained from the existing manually verified v2p2
 * manifest. P13.I1 must not promote a frontier route into this list until a
 * paced tenant probe has supplied both permission evidence and a response
 * contract.
 */
export function officialPersonalCapabilities(): ManageBacCapabilityDefinition[] {
  const shared = {
    scope: "personal" as const,
    minimumRole: "student" as const,
    permissionState: "read_only" as const,
    verificationStatus: "verified" as const,
    routeSource: "manual_verified" as const,
    contractVersion: "v2p2",
    freshnessSlaMinutes: 60,
  };
  return [
    {
      ...shared,
      category: "People",
      name: "Resolve signed-in student",
      recordType: "person",
      path: "/v2p2/students",
      purpose:
        "Resolve exactly one ManageBac student from the signed-in account's verified email.",
      pagination: "none" as const,
      changeStrategy: "unknown" as const,
      responseSchemaHash: manageBacContractDigest({
        students: [{ id: "number", email: "string" }],
      }),
      normalization: {
        identityOnly: true,
        recordsPath: "students",
        idPath: "id",
        emailPath: "email",
        emailQueryParameter: "q",
        requiredPaths: ["id", "email"],
        fields: {
          email: "email",
          firstName: "first_name",
          lastName: "last_name",
          role: "role",
          program: "program",
          yearGroupId: "year_group_id",
        },
      },
    },
    {
      ...shared,
      category: "Classes",
      name: "My class memberships",
      recordType: "class",
      path: "/v2p2/memberships?user_ids={student_id}",
      purpose:
        "Retrieve only the class memberships belonging to the resolved signed-in student.",
      personalIdParameter: "student_id",
      pagination: "page" as const,
      changeStrategy: "full_reconciliation" as const,
      responseSchemaHash: manageBacContractDigest({
        memberships: [
          {
            id: "number",
            user_id: "number",
            class_id: "number",
            user_email: "string",
          },
        ],
      }),
      normalization: {
        recordsPath: "memberships",
        idPath: "id",
        classIdPath: "class_id",
        modifiedAtPath: "updated_at",
        pageParameter: "page",
        nextCursorPath: "meta.next_page",
        cursorParameter: "page",
        requiredPaths: ["id", "class_id", "user_id"],
        recordKeyTemplate: "class:{class_id}",
        classification: "personal",
        audienceScope: "mapped_user",
        fields: {
          name: ["class_name", "name", "uniq_class_id"],
          title: ["class_name", "name", "uniq_class_id"],
          role: "role",
          level: "level",
          userEmail: "user_email",
          userId: "user_id",
          classId: "class_id",
          updatedAt: "updated_at",
        },
      },
    },
    {
      ...shared,
      category: "Classes",
      name: "Details for my classes",
      recordType: "class",
      path: "/v2p2/classes/{class_id}",
      purpose:
        "Resolve display details only for class IDs discovered through the signed-in student's memberships.",
      pagination: "none" as const,
      changeStrategy: "full_reconciliation" as const,
      responseSchemaHash: manageBacContractDigest({ class: { id: "number" } }),
      normalization: {
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        recordsPath: ["class", "$"],
        idPath: "id",
        requiredPaths: ["id"],
        recordKeyTemplate: "class:{id}",
        classification: "personal",
        audienceScope: "mapped_user",
        fields: {
          name: [
            "name",
            "class_name",
            "subject.name",
            "subject_name",
            "uniq_class_id",
          ],
          title: [
            "name",
            "class_name",
            "subject.name",
            "subject_name",
            "uniq_class_id",
          ],
          description: "description",
          program: ["program.name", "programme.name", "program", "programme"],
          grade: ["grade.name", "year_group.name", "grade", "year"],
          level: ["level.name", "level"],
          classId: ["uniq_class_id", "class_id", "id"],
          yearGroupId: [
            "year_group.id",
            "year_group_id",
            "grade.id",
            "grade_id",
          ],
          updatedAt: "updated_at",
        },
      },
    },
    {
      ...shared,
      category: "Tasks",
      name: "Tasks for my classes",
      recordType: "assignment",
      path: "/v2p2/classes/{class_id}/tasks",
      purpose:
        "Retrieve tasks only for classes discovered through the signed-in student's memberships.",
      pagination: "page" as const,
      changeStrategy: "full_reconciliation" as const,
      responseSchemaHash: manageBacContractDigest({
        tasks: [{ id: "number" }],
      }),
      normalization: {
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        recordsPath: ["tasks", "coursework", "items"],
        idPath: "id",
        modifiedAtPath: "updated_at",
        pageParameter: "page",
        nextCursorPath: "meta.next_page",
        cursorParameter: "page",
        requiredPaths: ["id"],
        recordKeyTemplate: "task:{id}",
        classification: "personal",
        audienceScope: "mapped_user",
        fields: {
          title: ["title", "name", "task.title", "task.name"],
          description: [
            "description",
            "notes",
            "task.description",
            "task.notes",
          ],
          dueAt: [
            "due_at",
            "due_date",
            "deadline",
            "task.due_at",
            "task.due_date",
          ],
          startAt: ["starts_at", "start_date", "task.starts_at"],
          taskType: ["task_type_name", "task_type", "type"],
          className: ["class_name", "class.title"],
          updatedAt: "updated_at",
        },
      },
    },
    {
      ...shared,
      category: "Timetable",
      name: "Timetable for my classes",
      recordType: "timetable",
      path: "/v2p2/classes/{class_id}/timetable",
      purpose:
        "Retrieve timetable slots only for classes discovered through the signed-in student's memberships.",
      pagination: "none" as const,
      changeStrategy: "full_reconciliation" as const,
      responseSchemaHash: manageBacContractDigest({
        timetable: { academic_years: [{ id: "number", slots: [] }] },
      }),
      normalization: {
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        transform: "managebac_timetable",
        recordsPath: "timetable.academic_years",
        idPath: "id",
        classification: "personal",
        audienceScope: "mapped_user",
        fields: {},
      },
    },
    {
      ...shared,
      category: "Resources",
      name: "Resources for my classes",
      recordType: "class_resource",
      path: "/v2p2/classes/{class_id}/resources",
      purpose:
        "Retrieve class resources only for classes discovered through the signed-in student's memberships.",
      pagination: "page" as const,
      changeStrategy: "full_reconciliation" as const,
      responseSchemaHash: manageBacContractDigest({
        resources: [{ id: "number" }],
      }),
      normalization: {
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        recordsPath: ["resources", "files", "items", "documents"],
        idPath: "id",
        modifiedAtPath: "updated_at",
        pageParameter: "page",
        nextCursorPath: "meta.next_page",
        cursorParameter: "page",
        requiredPaths: ["id"],
        recordKeyTemplate: "resource:{id}",
        classification: "personal",
        audienceScope: "mapped_user",
        fields: {
          title: ["title", "name", "filename", "file_name"],
          description: ["description", "notes", "body"],
          url: ["url", "download_url", "file_url", "link"],
          className: ["class_name", "class.title"],
          updatedAt: "updated_at",
        },
      },
    },
    {
      ...shared,
      category: "CAS",
      name: "My CAS experiences",
      recordType: "cas_experience",
      path: "/v2p2/year-groups/{year_group_id}/projects/cas/experiences/students?student_ids={student_id}",
      purpose:
        "Retrieve CAS experiences for the signed-in student within their year group.",
      personalIdParameter: "student_id",
      pagination: "page" as const,
      changeStrategy: "full_reconciliation" as const,
      responseSchemaHash: manageBacContractDigest({
        students: [{ id: "number", experiences: [{ id: "number" }] }],
      }),
      normalization: {
        fanOutParameter: "year_group_id",
        fanOutSource: "year_group",
        recordsPath: [
          "students.*.experiences",
          "experiences",
          "cas_experiences",
          "items",
        ],
        idPath: "id",
        modifiedAtPath: "updated_at",
        pageParameter: "page",
        nextCursorPath: "meta.next_page",
        cursorParameter: "page",
        requiredPaths: ["id"],
        recordKeyTemplate: "cas_experience:{id}",
        classification: "personal",
        audienceScope: "mapped_user",
        fields: {
          title: ["name", "title"],
          description: ["description", "notes", "reflection"],
          status: ["status", "progress.title", "approval_status"],
          startAt: ["start_date", "starts_at"],
          endAt: ["end_date", "ends_at"],
          creativity: "creativity",
          activity: "activity",
          service: "service",
          creativityHours: "creativity_hours",
          activityHours: "activity_hours",
          serviceHours: "service_hours",
          updatedAt: "updated_at",
        },
      },
    },
  ];
}

/**
 * Capability requests named by P13 but absent from the retained verified
 * manifest. Paths are deliberately null: guessing a provider route would turn
 * an evidence gap into a ghost capability.
 */
export function unverifiedPersonalCapabilityFrontier(): ManageBacFrontierCapability[] {
  const reason =
    "No tenant-approved provider path, read permission, and sampled response contract have been captured.";
  return [
    {
      category: "Year groups",
      entities: ["year group"],
      verdict: "live_probe_required",
      permissionState: "unverified",
      providerPath: null,
      reason:
        "The retained student and class contracts expose year-group IDs, but no standalone tenant-approved year-group route and response contract have been captured.",
    },
    {
      category: "CAS reflections",
      entities: ["reflection"],
      verdict: "live_probe_required",
      permissionState: "unverified",
      providerPath: null,
      reason,
    },
    {
      category: "CAS evidence",
      entities: ["evidence", "attachment"],
      verdict: "live_probe_required",
      permissionState: "unverified",
      providerPath: null,
      reason,
    },
    {
      category: "Grades",
      entities: ["grade", "assessment result"],
      verdict: "live_probe_required",
      permissionState: "unverified",
      providerPath: null,
      reason,
    },
    {
      category: "Term grades",
      entities: ["term grade"],
      verdict: "live_probe_required",
      permissionState: "unverified",
      providerPath: null,
      reason,
    },
    {
      category: "Attendance",
      entities: ["attendance record"],
      verdict: "live_probe_required",
      permissionState: "unverified",
      providerPath: null,
      reason,
    },
    {
      category: "Groups",
      entities: ["group", "group membership"],
      verdict: "live_probe_required",
      permissionState: "unverified",
      providerPath: null,
      reason,
    },
    {
      category: "Discussions and messages",
      entities: ["discussion", "announcement", "message"],
      verdict: "live_probe_required",
      permissionState: "unverified",
      providerPath: null,
      reason,
    },
    {
      category: "Events",
      entities: ["event"],
      verdict: "live_probe_required",
      permissionState: "unverified",
      providerPath: null,
      reason,
    },
  ];
}

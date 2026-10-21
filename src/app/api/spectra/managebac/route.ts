import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import {
  convexMutation,
  convexPublicMutation,
  convexQuery,
} from "@/lib/convex-server";
import {
  loadSchoolSecretForConnector,
  revokeSchoolSecret,
  storeSchoolSecret,
} from "@/lib/server-secrets";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { prepareAttachments } from "@/features/spectra/compute/files/attachment-preprocessor";
import {
  capabilitySyncKinds,
  isSchoolSyncKind,
  SCHOOL_FILE_MAX_BYTES,
  SCHOOL_FILE_TEXT_MAX_CHARS,
  SCHOOL_SYNC_KINDS,
  joinsPageSync,
  type SchoolSyncKind,
} from "../../../../../shared/school-sync";
import {
  assertPublicApiHost,
  bridgeArgs,
  canonicalJson,
  capabilityUrl,
  connectorContext,
  digest,
  identifier,
  object,
  string,
  type ConnectorActor,
  type ConnectorContext,
} from "./connector";
import { importManageBacResource } from "./resource-import";

/**
 * A sync runs inside this request. Pinning the duration keeps the hosting
 * default from cutting it off, and a sync stops asking the provider for pages
 * once SYNC_TIME_BUDGET_MS has passed. It then records a failed run, which
 * releases the lease and schedules a retry, and there is still time left
 * before the platform kills the request. A killed request cannot release
 * anything: its run keeps the lease until it expires.
 */
export const maxDuration = 300;
const SYNC_TIME_BUDGET_MS = 240_000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/**
 * MANAGEBAC_API_KEY lets a local stack connect without typing a key. A
 * deployment never reads it: there a blank admin form would silently connect
 * the school with one shared key that belongs to no school.
 */
function localDevelopmentManageBacKey() {
  const local =
    process.env.NODE_ENV !== "production" ||
    process.env.SPECTRA_APP_URL?.startsWith("http://localhost:");
  const key = local ? (process.env.MANAGEBAC_API_KEY?.trim() ?? "") : "";
  return key.length >= 16 ? key : "";
}

/**
 * School portal hosts (e.g. gcm.managebac.com) are not the Public API.
 * Map them to the regional API host documented by Faria (CA default).
 */
function normalizeManageBacBaseUrl(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      "INTEGRATION_URL_INVALID: Enter the ManageBac Public API base URL (https://api.managebac.com).",
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "api.managebac.com" || host.startsWith("api."))
    return `${parsed.protocol}//${parsed.host}`;
  if (host.endsWith(".managebac.com") || host.endsWith(".managebac.us"))
    return "https://api.managebac.com";
  return `${parsed.protocol}//${parsed.host}`;
}

function officialPersonalCapabilities() {
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
      responseSchemaHash: digest({
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
      // Archived classes are included: their tasks are the student's archive
      // (past tasks). The response is either membership rows naming a
      // class_id, or the classes themselves; both normalize to one class row.
      path: "/v2p2/students/{student_id}/memberships?archived=true",
      purpose:
        "Retrieve only the resolved signed-in student's own classes, archived ones included.",
      personalIdParameter: "student_id",
      pagination: "page" as const,
      changeStrategy: "full_reconciliation",
      responseSchemaHash: digest({
        memberships: [
          {
            id: "number",
            class_id: "number",
            archived: "boolean",
          },
        ],
      }),
      normalization: {
        syncKind: "classes",
        recordsPath: ["memberships.classes", "memberships", "classes"],
        idPath: "id",
        classIdPath: ["class_id", "class.id", "id"],
        ownerIdPath: ["user_id", "student_id"],
        modifiedAtPath: "updated_at",
        pageParameter: "page",
        nextCursorPath: "meta.next_page",
        cursorParameter: "page",
        requiredPaths: ["id"],
        recordKeyTemplate: "class:{$classId}",
        classification: "personal",
        audienceScope: "mapped_user",
        fields: {
          name: ["class_name", "class.name", "name", "uniq_class_id"],
          title: ["class_name", "class.name", "name", "uniq_class_id"],
          role: "role",
          level: ["level", "class.level"],
          archived: ["archived", "class.archived"],
          classId: ["class_id", "class.id", "id"],
          yearGroupId: ["year_group_id", "class.year_group_id", "year_group.id"],
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
      changeStrategy: "full_reconciliation",
      responseSchemaHash: digest({ class: { id: "number" } }),
      normalization: {
        syncKind: "classes",
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        // A membership can outlive its class: ManageBac answers 404 for a
        // class that was removed or that a student can no longer open.
        notFoundIsEmpty: true,
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
          archived: "archived",
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
      changeStrategy: "full_reconciliation",
      responseSchemaHash: digest({ tasks: [{ id: "number" }] }),
      normalization: {
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        // The same for its tasks: one closed class is not a broken route.
        notFoundIsEmpty: true,
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
          dueAt: ["due_at", "due_date", "deadline", "task.due_at", "task.due_date"],
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
      changeStrategy: "full_reconciliation",
      responseSchemaHash: digest({
        timetable: { academic_years: [{ id: "number", slots: [] }] },
      }),
      normalization: {
        syncKind: "classes",
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
      changeStrategy: "full_reconciliation",
      responseSchemaHash: digest({ resources: [{ id: "number" }] }),
      normalization: {
        syncKind: "task_resources",
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
      changeStrategy: "full_reconciliation",
      responseSchemaHash: digest({
        students: [{ id: "number", experiences: [{ id: "number" }] }],
      }),
      normalization: {
        syncKind: "cas",
        fanOutParameter: "year_group_id",
        fanOutSource: "year_group",
        // Experiences sit under each student; only this student's are kept.
        flatten: {
          parentPath: "students",
          itemsPaths: ["experiences", "cas_experiences", "component.items", "items"],
          ownerIdPath: ["id", "student_id"],
        },
        recordsPath: ["experiences", "cas_experiences", "items"],
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
          learningOutcomes: ["learning_outcomes", "outcomes"],
          updatedAt: "updated_at",
        },
      },
    },
    {
      ...shared,
      category: "Grades",
      name: "My result for a task",
      recordType: "task_result",
      path: "/v2p2/classes/{class_id}/tasks/{task_id}/students?student_ids={student_id}",
      purpose:
        "Read only the signed-in student's own grade and feedback for a task in a class they follow.",
      personalIdParameter: "student_id",
      pagination: "none" as const,
      changeStrategy: "full_reconciliation",
      responseSchemaHash: digest({ students: [{ id: "number" }] }),
      normalization: {
        syncKind: "grades",
        fanOutSource: "task",
        classIdFromRouteParameter: "class_id",
        taskIdFromRouteParameter: "task_id",
        recordsPath: ["students", "task_results", "results"],
        idPath: "id",
        idFromRouteParameter: "task_id",
        ownerIdPath: ["id", "student_id", "student.id", "user_id"],
        singleRecord: true,
        recordKeyTemplate: "task_result:{$route.task_id}",
        classification: "personal",
        audienceScope: "mapped_user",
        fields: {
          grade: ["grade", "result.grade", "mark"],
          score: ["score", "points", "result.score"],
          maxScore: ["max_score", "out_of", "max_points"],
          feedback: ["comments", "feedback", "teacher_comment", "result.comments"],
          criteria: ["criteria", "assessment_criteria", "rubric"],
          status: ["status", "state"],
          gradedAt: ["graded_at", "assessed_at", "updated_at"],
          updatedAt: "updated_at",
        },
      },
    },
    {
      ...shared,
      category: "Dropbox",
      name: "My submission for a task",
      recordType: "submission",
      path: "/v2p2/classes/{class_id}/tasks/{task_id}/submissions/{student_id}",
      purpose:
        "List the files the signed-in student handed in for a task. Bytes download only when the student opens one.",
      personalIdParameter: "student_id",
      pagination: "none" as const,
      changeStrategy: "full_reconciliation",
      responseSchemaHash: digest({ submission: { files: [{ id: "number" }] } }),
      normalization: {
        syncKind: "dropbox_files",
        fanOutSource: "task",
        classIdFromRouteParameter: "class_id",
        taskIdFromRouteParameter: "task_id",
        // A task the student never submitted to answers 404.
        notFoundIsEmpty: true,
        recordsPath: ["submission", "dropbox", "$"],
        idPath: "id",
        idFromRouteParameter: "task_id",
        ownerIdPath: ["student_id", "student.id", "user_id"],
        singleRecord: true,
        recordKeyTemplate: "submission:{$route.task_id}",
        classification: "personal",
        audienceScope: "mapped_user",
        fields: {
          status: ["status", "state"],
          submittedAt: ["submitted_at", "created_at"],
          files: ["files", "attachments"],
          comment: ["comment", "notes"],
          updatedAt: "updated_at",
        },
      },
    },
    {
      ...shared,
      category: "Resources",
      name: "Download one selected class resource",
      recordType: "class_resource_download",
      path: "/v2p2/classes/{class_id}/resources/{resource_id}/download",
      purpose:
        "Download bytes only after a signed-in student explicitly imports one selected resource.",
      pagination: "none" as const,
      changeStrategy: "unknown" as const,
      responseSchemaHash: digest({ bytes: "binary" }),
      normalization: {
        onDemand: true,
        classIdFromRouteParameter: "class_id",
        resourceIdFromRouteParameter: "resource_id",
      },
    },
  ];
}

function exactDigest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

async function ensureOfficialPersonalCapabilityManifest(
  actor: ConnectorActor,
  integrationId: string,
  context: ConnectorContext,
) {
  const official = officialPersonalCapabilities();
  // Current when every official route is present with today's path and
  // normalization; a route Spectra moved or re-normalized is replaced.
  if (
    official.every((route) =>
      context.capabilities.some(
        (item) =>
          item.name === route.name &&
          item.path === route.path &&
          digest(item.normalization) === digest(route.normalization),
      ),
    )
  )
    return context;
  if (actor.schoolRole !== "school_admin") return context;
  const officialNames = new Set(official.map((item) => item.name));
  const officialPaths = new Set(official.map((item) => item.path));
  const existing = context.capabilities
    .filter((item) => !officialNames.has(item.name) && !officialPaths.has(item.path))
    .map(({ _id: _capabilityId, ...item }) => ({
      ...item,
      freshnessSlaMinutes: 120,
      permissionState: "read_only" as const,
      // Only a route with a response contract can be kept as verified; one
      // without stays listed but unverified, so it never blocks the refresh.
      verificationStatus: item.responseSchemaHash ? ("verified" as const) : ("unverified" as const),
      routeSource: "tenant_reference" as const,
    }));
  const capabilities = [...existing, ...official];
  await convexMutation("managebac:replaceCapabilityManifest", {
    integrationId,
    sourceHash: digest({
      source: "spectra-official-personal-v2p2",
      capabilities,
    }),
    providerVersion: "v2p2",
    capabilities,
  });
  return connectorContext(actor, integrationId);
}

function atPath(value: unknown, path: string | undefined) {
  if (!path || path === "$" || path === ".") return value;
  const segments = path
    .replace(/^\$\.?/, "")
    .split(".")
    .filter(Boolean);
  const visit = (current: unknown, index: number): unknown => {
    if (index >= segments.length) return current;
    const segment = segments[index]!;
    if (segment === "*")
      return Array.isArray(current)
        ? current.flatMap((item) => {
            const result = visit(item, index + 1);
            return Array.isArray(result) ? result : result === undefined ? [] : [result];
          })
        : undefined;
      if (current === null || current === undefined) return undefined;
      const indexMatch = segment.match(/^(.+)\[(\d+)]$/);
      if (indexMatch) {
        const parent = object(current)[indexMatch[1]!];
        const next = Array.isArray(parent)
          ? parent[Number(indexMatch[2])]
          : undefined;
        return visit(next, index + 1);
      }
      return visit(object(current)[segment], index + 1);
  };
  return visit(value, 0);
}

function atFirstPath(value: unknown, paths: unknown) {
  const candidates = Array.isArray(paths) ? paths : [paths];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const found = atPath(value, candidate);
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return undefined;
}

function timestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return Date.parse(value);
  return undefined;
}

function normalizedScalar(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value))
    return value.slice(0, 2_000).map((item) => normalizedScalar(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 500)
        .map(([key, item]) => [key.slice(0, 120), normalizedScalar(item)]),
    );
  return null;
}

function shape(value: unknown, depth = 0): unknown {
  if (depth > 5) return "depth";
  if (Array.isArray(value))
    return value.length ? [shape(value[0], depth + 1)] : [];
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, shape(item, depth + 1)]),
    );
  return value === null ? "null" : typeof value;
}

function capabilitiesFromOpenApi(document: unknown) {
  const root = object(document);
  const paths = object(root.paths);
  const info = object(root.info);
  const providerVersion = string(info.version, 100) || "tenant-reference";
  const capabilities: Array<Record<string, unknown>> = [];
  for (const [path, pathValue] of Object.entries(paths)) {
    if (!path.startsWith("/") || path.includes("://")) continue;
    const operation = object(object(pathValue).get);
    if (!Object.keys(operation).length) continue;
    const responses = object(operation.responses);
    const successful =
      responses["200"] ??
      responses["201"] ??
      responses["2XX"] ??
      responses.default ??
      {};
    const response = object(successful);
    const content = object(response.content);
    const jsonMedia = object(content["application/json"]);
    const media = Object.keys(jsonMedia).length
      ? jsonMedia
      : object(content["application/vnd.api+json"]);
    const responseSchema = object(media).schema ?? response.schema ?? {};
    const tags = Array.isArray(operation.tags)
      ? operation.tags.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const inheritedParameters = object(pathValue).parameters;
    const operationParameters = operation.parameters;
    const pathParameters = [
      ...(Array.isArray(inheritedParameters) ? inheritedParameters : []),
      ...(Array.isArray(operationParameters) ? operationParameters : []),
    ]
      .map(object)
      .filter((parameter) => parameter.in === "path")
      .map((parameter) => string(parameter.name, 120))
      .filter(Boolean);
    capabilities.push({
      category: string(tags[0], 100) || "Uncategorized",
      name:
        string(operation.summary, 160) ||
        string(operation.operationId, 160) ||
        `GET ${path}`,
      recordType: "unclassified",
      path: path.slice(0, 1_000),
      purpose:
        string(operation.description, 300) ||
        "Purpose requires tenant administrator verification.",
      scope: "school",
      minimumRole: "school_admin",
      pagination: "unknown",
      changeStrategy: "unknown",
      freshnessSlaMinutes: 120,
      contractVersion: providerVersion,
      responseSchemaHash: digest(responseSchema),
      permissionState: "unverified",
      verificationStatus: "unverified",
      routeSource: "tenant_reference",
      normalization: {
        discoveredPathParameters: pathParameters,
        responseShape: shape(responseSchema),
      },
    });
    if (capabilities.length > 500)
      throw new Error(
        "INTEGRATION_MANIFEST_TOO_LARGE: Tenant reference contains more than 500 GET routes.",
      );
  }
  if (!capabilities.length)
    throw new Error(
      "INTEGRATION_REFERENCE_EMPTY: No GET operations were found in this tenant reference.",
    );
  return { providerVersion, capabilities };
}

/**
 * Fills a record key. `{path}` reads the provider row, `{$route.name}` a
 * route parameter the request was bound to, and `{$classId}` the class the
 * row resolved to.
 */
function interpolate(
  template: string,
  row: unknown,
  bound: { routeParameters?: Record<string, string>; classId?: string } = {},
) {
  return template.replace(/\{([^}]+)}/g, (_, path: string) => {
    if (path === "$classId") return encodeURIComponent(bound.classId ?? "");
    if (path.startsWith("$route."))
      return encodeURIComponent(bound.routeParameters?.[path.slice(7)] ?? "");
    return encodeURIComponent(String(atPath(row, path) ?? ""));
  });
}

function stringPaths(value: unknown) {
  return (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

/**
 * Whether a row belongs to someone other than the mapped student. A row that
 * names no owner is the route's own answer for the student it was asked about.
 */
function ownedByAnother(raw: unknown, ownerIdPath: unknown, providerUserId: string | undefined) {
  const paths = stringPaths(ownerIdPath);
  if (!paths.length) return false;
  const owner = identifier(atFirstPath(raw, paths), 500);
  return Boolean(owner) && owner !== providerUserId;
}

function normalizeProviderPage(
  payload: unknown,
  capability: ConnectorContext["capabilities"][number],
  accountId: string | undefined,
  routeParameters: Record<string, string> = {},
  providerUserId?: string,
) {
  const config = object(capability.normalization);
  const recordsPath = Array.isArray(config.recordsPath)
    ? config.recordsPath
    : string(config.recordsPath, 300) || "$";
  const flatten = object(config.flatten);
  const flattenParents = flatten.parentPath
    ? atPath(payload, string(flatten.parentPath, 300))
    : undefined;
  const rawRecordsValue =
    Array.isArray(flattenParents)
      ? flattenParents.flatMap((parent) => {
          // Rows nested under people: only the mapped student's are read.
          if (ownedByAnother(parent, flatten.ownerIdPath, providerUserId)) return [];
          const items = atFirstPath(parent, stringPaths(flatten.itemsPaths));
          return Array.isArray(items) ? items : [];
        })
      : config.transform === "managebac_timetable"
      ? (() => {
          const years = atPath(payload, "timetable.academic_years");
          if (!Array.isArray(years)) return [];
          const rows: Array<Record<string, unknown>> = [];
          for (const yearValue of years) {
            const year = object(yearValue);
            const yearId = String(year.id ?? "current");
            const slots = Array.isArray(year.slots) ? year.slots : [];
            for (const slotValue of slots) {
              const slot = object(slotValue);
              if (slot.enabled === false) continue;
              const day = Number(slot.day);
              const period = Number(slot.period);
              if (!Number.isInteger(day) || day < 1 || day > 7) continue;
              const explicitStart = timestamp(
                slot.starts_at ?? slot.start_at ?? slot.start,
              );
              const explicitEnd = timestamp(
                slot.ends_at ?? slot.end_at ?? slot.end,
              );
              rows.push({
                id: `${yearId}:${day}:${period}`,
                title:
                  string(slot.title ?? slot.class_name ?? slot.subject, 300) ||
                  `Class period ${period}`,
                day,
                period,
                periodKey: String(period),
                location: slot.location,
                academic_year_id: yearId,
                academic_year_starts_on: year.start_date ?? year.starts_on,
                academic_year_ends_on: year.end_date ?? year.ends_on,
                ...(explicitStart !== undefined
                  ? { start_at: new Date(explicitStart).toISOString() }
                  : {}),
                ...(explicitEnd !== undefined
                  ? { end_at: new Date(explicitEnd).toISOString() }
                  : {}),
                timePrecision:
                  explicitStart !== undefined ? "exact" : "unknown",
                ...(explicitStart === undefined
                  ? {
                      partialReason:
                        "The provider supplied a weekday/period but no verified clock time or occurrence date.",
                    }
                  : {}),
              });
            }
          }
          return rows.slice(0, 500);
        })()
      : atFirstPath(payload, recordsPath);
  const fieldMap = object(config.fields);
  const idFromRoute = identifier(
    routeParameters[string(config.idFromRouteParameter, 120)],
    500,
  );
  const rawRecords = (
    Array.isArray(rawRecordsValue)
      ? rawRecordsValue
      : rawRecordsValue && typeof rawRecordsValue === "object"
        ? [rawRecordsValue]
        : []
  ).filter(
    (raw) =>
      !ownedByAnother(raw, config.ownerIdPath, providerUserId) &&
      // A row named by its route (one per task) must carry some data; an
      // empty answer is no record.
      (!idFromRoute ||
        Object.values(fieldMap).some((path) => {
          const value = atFirstPath(raw, path);
          return value !== undefined && !(Array.isArray(value) && value.length === 0);
        })),
  );
  if (config.singleRecord === true && rawRecords.length > 1)
    throw new Error(
      `INTEGRATION_ROUTE_BROAD: ${capability.name} answered with more than this student's record, so none were kept.`,
    );
  const requiredPaths = Array.isArray(config.requiredPaths)
    ? config.requiredPaths.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const idPath = string(config.idPath, 300);
  if (!idPath)
    throw new Error(
      `INTEGRATION_CONTRACT_INVALID: ${capability.name} has no idPath.`,
    );
  const taskIdFromRoute = identifier(
    routeParameters[string(config.taskIdFromRouteParameter, 120)],
    500,
  );
  const result = rawRecords.slice(0, 500).map((raw, index) => {
    for (const path of requiredPaths)
      if (atPath(raw, path) === undefined)
        throw new Error(
          `INTEGRATION_SCHEMA_DRIFT: ${capability.name} record ${index + 1} is missing ${path}.`,
        );
    const providerRecordId =
      idFromRoute || String(atPath(raw, idPath) ?? "").trim();
    if (!providerRecordId)
      throw new Error(
        `INTEGRATION_SCHEMA_DRIFT: ${capability.name} returned a record without its verified id.`,
      );
    const normalized: JsonObject = {};
    for (const [key, path] of Object.entries(fieldMap)) {
      const value = atFirstPath(raw, path);
      if (value !== undefined) normalized[key] = normalizedScalar(value);
    }
    // Grades and submissions name the task they belong to.
    if (taskIdFromRoute) normalized.taskId = taskIdFromRoute;
    const keyTemplate =
      string(config.recordKeyTemplate, 500) ||
      `${capability.recordType}:{${idPath}}`;
    const classIdFromRouteParameter = string(
      config.classIdFromRouteParameter,
      120,
    );
    const providerClassId =
      identifier(atFirstPath(raw, stringPaths(config.classIdPath)), 500) ||
      identifier(routeParameters[classIdFromRouteParameter], 500);
    const academicPeriodKey =
      string(atPath(raw, string(config.academicPeriodPath, 300)), 300) ||
      string(
        atPath(raw, "academic_period_key") ??
          atPath(raw, "academic_period") ??
          atPath(raw, "academic_year_id") ??
          atPath(raw, "academic_year.id") ??
          normalized.academicPeriodKey,
        300,
      );
    const sourceModifiedAt = timestamp(
      atPath(raw, string(config.modifiedAtPath, 300)),
    );
    const provenancePath = string(config.provenancePath, 300);
    const provenanceUrl = provenancePath
      ? string(atPath(raw, provenancePath), 2_000)
      : "";
    const classification =
      config.classification === "class" ||
      config.classification === "school" ||
      config.classification === "public_resource"
        ? config.classification
        : "personal";
    const audienceScope =
      config.audienceScope === "class_members" ||
      config.audienceScope === "authorized_staff" ||
      config.audienceScope === "school"
        ? config.audienceScope
        : "mapped_user";
    return {
      providerRecordId: providerRecordId.slice(0, 500),
      providerRecordKey: interpolate(keyTemplate, raw, {
        routeParameters,
        classId: providerClassId,
      }).slice(0, 700),
      classification,
      audienceScope,
      ...(providerClassId ? { providerClassId } : {}),
      ...(academicPeriodKey ? { academicPeriodKey } : {}),
      normalized,
      payloadVersion:
        string(config.payloadVersion, 100) || capability.contractVersion,
      sourceHash: digest(normalized),
      ...(sourceModifiedAt ? { sourceModifiedAt } : {}),
      ...(provenanceUrl ? { provenanceUrl } : {}),
      mappedAccountId: accountId,
    };
  });
  return {
    records: result,
    nextCursor: (() => {
      const raw = atPath(payload, string(config.nextCursorPath, 300));
      if (typeof raw === "number" && Number.isFinite(raw))
        return String(raw).slice(0, 1_000);
      return string(raw, 1_000);
    })(),
    actualSchemaHash: digest(shape(payload)),
  };
}

async function providerFetch(
  context: ConnectorContext,
  capability: ConnectorContext["capabilities"][number],
  token: string,
  input: {
    providerUserId?: string;
    cursor?: string;
    page?: number;
    verifiedEmail?: string;
    routeParameters?: Record<string, string>;
  },
) {
  const url = capabilityUrl(context, capability, input);
  await assertPublicApiHost(url.origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const tokenValue =
      context.integration.authScheme === "bearer" ? `Bearer ${token}` : token;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        [context.integration.authHeaderName]: tokenValue,
      },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(
        `INTEGRATION_RATE_LIMITED: ManageBac requested a retry${retryAfter ? ` after ${retryAfter}` : ""}.`,
      );
    }
    // 401: the key itself is refused. 403: the key works but the school's
    // ManageBac administrator did not grant it this endpoint.
    if (response.status === 401)
      throw new Error(
        `INTEGRATION_CREDENTIAL_REJECTED: ManageBac refused the school's API key for ${capability.name}.`,
      );
    if (response.status === 403)
      throw new Error(
        `INTEGRATION_PERMISSION_DENIED: The school's ManageBac API key doesn't allow ${capability.name}.`,
      );
    if (
      response.status === 404 &&
      object(capability.normalization).notFoundIsEmpty === true
    )
      return null;
    if (!response.ok)
      throw new Error(
        `INTEGRATION_ROUTE_FAILED: ${capability.name} returned ${response.status}.`,
      );
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 12_000_000)
      throw new Error(
        "INTEGRATION_RESPONSE_TOO_LARGE: Route response exceeded 12 MB.",
      );
    const raw = await response.text();
    if (raw.length > 12_000_000)
      throw new Error(
        "INTEGRATION_RESPONSE_TOO_LARGE: Route response exceeded 12 MB.",
      );
    return JSON.parse(raw) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function signedCommit(
  actor: ConnectorActor,
  input: {
    operation:
            | "identity"
      | "sync-page"
      | "quarantine"
      | "sync-fail"
      | "sync-suspend"
      | "sync-complete";
    integrationId: string;
    syncRunId: string;
    payload: Record<string, unknown>;
    leaseToken?: string;
    mutation: string;
    serviceSubject?: string;
  },
) {
  const payload = {
    ...input.payload,
    ...(input.leaseToken ? { leaseToken: input.leaseToken } : {}),
  };
  const payloadDigest = exactDigest(payload);
  const bridge = await bridgeArgs({
    operation: input.operation,
    subject: actor.clerkId,
    integrationId: input.integrationId,
    syncRunId: input.syncRunId,
    payloadDigest,
  });
  const args = {
    integrationId: input.integrationId,
    syncRunId: input.syncRunId,
    ...(input.serviceSubject ? { serviceSubject: input.serviceSubject } : {}),
    ...payload,
    payloadDigest,
    ...bridge,
  };
  return input.serviceSubject
    ? convexPublicMutation(input.mutation, args)
    : convexMutation(input.mutation, args);
}

async function resolveIdentity(
  actor: Awaited<ReturnType<typeof requireActor>>,
  integrationId: string,
  context: ConnectorContext,
  token: string,
) {
  const identityCapabilities = context.capabilities.filter(
    (item) =>
      (item.recordType === "person" || item.recordType === "membership") &&
      item.scope === "personal",
  );
  const capability = identityCapabilities.find((item) => {
    const config = object(item.normalization);
    return Boolean(string(config.emailQueryParameter, 120));
  });
  if (!capability)
    throw new Error(
      "INTEGRATION_IDENTITY_ROUTE_REQUIRED: The tenant manifest needs a narrow verified-email lookup; Spectra will not enumerate people.",
    );
  const started = await convexMutation<
    Record<string, unknown>,
    { syncRunId: string; integrationId: string }
  >("managebac:beginSync", { kind: "identity" });
  const startedRecord = object(started);
  try {
    const payload = await providerFetch(context, capability, token, {
      verifiedEmail: actor.email,
    });
    const config = object(capability.normalization);
    const recordsValue = atPath(
      payload,
      string(config.recordsPath, 300) || "$",
    );
    const candidates = Array.isArray(recordsValue)
      ? recordsValue
      : recordsValue && typeof recordsValue === "object"
        ? [recordsValue]
        : [];
    if (candidates.length > 25)
      throw new Error(
        "INTEGRATION_IDENTITY_ROUTE_BROAD: The verified-email lookup returned too many candidates and was rejected without exposing them.",
      );
    const emailPath = string(config.emailPath, 300);
    const idPath = string(config.idPath, 300);
    if (!emailPath || !idPath)
      throw new Error(
        "INTEGRATION_IDENTITY_CONTRACT_INVALID: Identity route needs emailPath and idPath.",
      );
    const matches = candidates.filter(
      (candidate) =>
        string(atPath(candidate, emailPath), 320).toLowerCase() ===
        actor.email.toLowerCase(),
    );
    const providerUserId =
      matches.length === 1
        ? identifier(atPath(matches[0], idPath), 500)
        : undefined;
    const providerUserIdHash = providerUserId
      ? createHash("sha256").update(providerUserId).digest("base64url")
      : undefined;
    // CAS is read through the student's year group.
    const providerYearGroupId =
      matches.length === 1
        ? identifier(
            atFirstPath(matches[0], ["year_group_id", "year_group.id", "grade_id"]),
            40,
          )
        : "";
    const body = {
      matchCount: matches.length,
      ...(providerUserId ? { providerUserId } : {}),
      ...(providerUserIdHash ? { providerUserIdHash } : {}),
      ...(/^\d{1,20}$/.test(providerYearGroupId) ? { providerYearGroupId } : {}),
      verifiedEmailHash: createHash("sha256")
        .update(actor.email.toLowerCase())
        .digest("base64url"),
      evidenceCapabilityId: capability._id,
    };
    const result = await signedCommit(actor, {
      operation: "identity",
      integrationId,
      syncRunId: started.syncRunId,
      payload: body,
      leaseToken: string(startedRecord.leaseToken, 300) || undefined,
      mutation: "managebac:commitIdentityResolution",
    });
    return {
      result,
      syncRunId: started.syncRunId,
      matchCount: matches.length,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "INTEGRATION_IDENTITY_FAILED";
    await signedCommit(actor, {
      operation: "sync-fail",
      integrationId,
      syncRunId: started.syncRunId,
      payload: {
        errorCode:
          message.match(/^([A-Z0-9_]+)/)?.[1] ?? "INTEGRATION_IDENTITY_FAILED",
        errorSummary: message.replace(/^[A-Z0-9_]+:\s*/, "").slice(0, 500),
        ...(startedRecord.leaseToken
          ? { leaseToken: string(startedRecord.leaseToken, 300) }
          : {}),
      },
      mutation: "managebac:failSync",
    }).catch(() => undefined);
    throw error;
  }
}

/**
 * One pass over ManageBac. A student's pass is one job: one kind of School
 * data (`syncKind`), reading only the classes, year groups or tasks Convex
 * targeted for it. The school reconciliation reads the shared routes.
 */
async function runSync(
  actor: ConnectorActor,
  kind: "manual" | "reconciliation",
  context: ConnectorContext,
  token: string,
  scheduled?: {
    syncRunId: string;
    integrationId: string;
    serviceSubject: string;
    leaseToken?: string;
    selectionRevision?: number;
    pass?: unknown;
  },
  options: { syncKind?: SchoolSyncKind; deadline?: number } = {},
) {
  if (
    context.mapping.status !== "verified" &&
    actor.schoolRole !== "school_admin"
  )
    throw new Error(
      "INTEGRATION_IDENTITY_REQUIRED: Resolve your identity first.",
    );
  const started =
    scheduled ??
    (await convexMutation<
      Record<string, unknown>,
      { syncRunId: string; integrationId: string }
     >(
      "managebac:beginSync",
      kind === "manual" ? { kind, syncKind: options.syncKind } : { kind },
    ));
  const startedRecord = object(started);
  // A pass that an earlier request left part-way continues from its last
  // committed page; what that request learned about classes is restored.
  const pass = object(startedRecord.pass);
  const jobKind = isSchoolSyncKind(pass.syncKind) ? pass.syncKind : undefined;
  const targeted = pass.targeted === true;
  const targetTasks = Array.isArray(pass.tasks)
    ? pass.tasks.flatMap((item) => {
        const task = object(item);
        const classId = identifier(task.classId, 500);
        const taskId = identifier(task.taskId, 500);
        return classId && taskId ? [{ classId, taskId }] : [];
      })
    : [];
  const completedCapabilityIds = new Set(
    Array.isArray(pass.completedCapabilityIds)
      ? pass.completedCapabilityIds.map(String)
      : [],
  );
  const position = pass.position ? object(pass.position) : undefined;
  const leaseAndSelection = {
    ...(startedRecord.leaseToken
      ? { leaseToken: string(startedRecord.leaseToken, 300) }
      : {}),
    ...(startedRecord.selectionRevision !== undefined
      ? { selectionRevision: Number(startedRecord.selectionRevision) }
      : {}),
  };
  const summaries: Array<{
    capabilityId: string;
    name: string;
    pages: number;
    records: number;
    skipped?: string;
  }> = [];
  // A job reads only the routes that serve its kind, and only personal ones.
  const routes = jobKind
    ? context.capabilities.filter(
        (item) =>
          item.scope === "personal" &&
          capabilitySyncKinds(item).includes(jobKind),
      )
    : context.capabilities;
  const ordered = [...routes].sort((a, b) => {
    const priority = (item: typeof a) => {
      const config = object(item.normalization);
      return config.identityOnly === true
        ? 0
        : item.recordType === "class"
          ? 1
        : ["assignment", "deadline", "assessment"].includes(item.recordType)
            ? 2
            : 3;
    };
    return priority(a) - priority(b);
  });
  const minimumRequestGap = Math.ceil(
    60_000 /
      Math.max(1, Math.min(180, context.integration.requestBudgetPerMinute)),
  );
  let lastProviderRequestAt = 0;
  const deadline = options.deadline ?? Date.now() + SYNC_TIME_BUDGET_MS;
  const selectedClassIds = new Set(context.selection?.selectedClassIds ?? []);
  const accessibleClassIds = new Set<string>(
    Array.isArray(pass.classIds) ? pass.classIds.map(String) : [],
  );
  const accessibleYearGroupIds = new Set<string>(
    Array.isArray(pass.yearGroupIds) ? pass.yearGroupIds.map(String) : [],
  );
  // A targeted job's reach is fixed when it starts; classes a membership page
  // reveals during the job are not read until the student selects them.
  const targetClassIds = new Set(accessibleClassIds);
  const targetYearGroupIds = new Set(accessibleYearGroupIds);
  let keyAccepted = false;
  const pacedFetch = async (
    capability: ConnectorContext["capabilities"][number],
    input: Parameters<typeof providerFetch>[3],
  ) => {
    const wait = Math.max(
      0,
      minimumRequestGap - (Date.now() - lastProviderRequestAt),
    );
    if (Date.now() + wait >= deadline)
      throw new Error(
        "INTEGRATION_SYNC_TIME_BUDGET: This sync reached its time limit before every route finished. It continues from the last saved page shortly.",
      );
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastProviderRequestAt = Date.now();
    try {
      const payload = await providerFetch(context, capability, token, input);
      keyAccepted = true;
      return payload;
    } catch (error) {
      // ManageBac answers 401 for a route the key was never granted, too. When
      // the key stands (it was accepted in this sync, or the identity lookup
      // every key is granted still answers), the refusal is this route's, so
      // it must not block the school's whole connection.
      if (
        error instanceof Error &&
        error.message.startsWith("INTEGRATION_CREDENTIAL_REJECTED") &&
        (keyAccepted || (await keyStillAccepted(capability)))
      )
        throw new Error(`INTEGRATION_PERMISSION_DENIED: The school's ManageBac API key doesn't allow ${capability.name}.`);
      throw error;
    }
  };
  /** One look at the identity lookup, the route a working key always reaches. */
  const keyStillAccepted = async (refused: ConnectorContext["capabilities"][number]) => {
    const identity = context.capabilities.find(
      (item) => item._id !== refused._id && object(item.normalization).identityOnly === true,
    );
    if (!identity || !actor.email) return false;
    try {
      await providerFetch(context, identity, token, { verifiedEmail: actor.email });
      keyAccepted = true;
      return true;
    } catch {
      return false;
    }
  };
  try {
    for (const capability of ordered) {
      const capabilityConfig = object(capability.normalization);
      if (completedCapabilityIds.has(capability._id)) {
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: 0,
          records: 0,
          skipped: "Read earlier in this sync.",
        });
        continue;
      }
      if (
        capabilityConfig.identityOnly === true ||
        capabilityConfig.onDemand === true
      ) {
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: 0,
          records: 0,
          skipped:
            capabilityConfig.identityOnly === true
              ? "Identity lookup already completed for this account."
              : "Bytes are fetched only when the student opens or imports one file.",
        });
        continue;
      }
      if (
        kind === "reconciliation" &&
        actor.schoolRole === "school_admin" &&
        capability.scope === "personal"
      ) {
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: 0,
          records: 0,
          skipped:
            "School reconciliation does not enumerate or import any individual’s personal route.",
        });
        continue;
      }
      if (
        capability.scope === "personal" &&
        context.mapping.status !== "verified"
      ) {
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: 0,
          records: 0,
          skipped:
            "Resolve this account’s exact verified identity before using personal routes.",
        });
        continue;
      }
      if (
        actor.schoolRole !== "school_admin" &&
        capability.scope !== "personal" &&
        !capability.personalIdParameter
      ) {
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: 0,
          records: 0,
          skipped: "Route is not safely personal-scoped for this user.",
        });
        continue;
      }
      const fanOutParameter = string(
        capabilityConfig.fanOutParameter,
        120,
      );
      const fanOutSource = string(capabilityConfig.fanOutSource, 120);
      const fannedOut = Boolean(fanOutParameter) || fanOutSource === "task";
      // A student's job reads exactly what Convex targeted: the selected
      // classes its mode admits, the student's year groups, or the stored
      // tasks of those classes. The school reconciliation reads what this
      // pass discovered.
      const fanOutIds =
        fanOutSource === "year_group"
          ? targeted
            ? targetYearGroupIds
            : accessibleYearGroupIds
          : targeted
            ? targetClassIds
            : new Set(
                [...selectedClassIds].filter((classId) =>
                  accessibleClassIds.has(classId),
                ),
              );
      // A fixed order lets a later request skip the bindings already read.
      const routeBindings =
        fanOutSource === "task"
          ? targetTasks
              .map(({ classId, taskId }) => ({
                binding: `${classId}/${taskId}`,
                routeParameters: { class_id: classId, task_id: taskId } as Record<string, string>,
              }))
              .sort((a, b) => (a.binding < b.binding ? -1 : a.binding > b.binding ? 1 : 0))
          : (fanOutParameter ? [...fanOutIds].sort() : [""]).map((binding) => ({
              binding,
              routeParameters: (fanOutParameter
                ? { [fanOutParameter]: binding }
                : {}) as Record<string, string>,
            }));
      if (fannedOut && routeBindings.length === 0) {
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: 0,
          records: 0,
          skipped:
            fanOutSource === "year_group"
              ? "No verified year group targets this route yet."
              : fanOutSource === "task"
                ? "No stored tasks in the classes this job reads."
                : selectedClassIds.size === 0
                  ? "No classes selected yet. Choose classes to follow before class-scoped school updates can run."
                  : "No verified class membership targets this route.",
        });
        continue;
      }
      let pageCount = 0;
      let recordCount = 0;
      let lastPayloadShape: unknown;
      try {
        const resumeAt =
          position?.capabilityId === capability._id ? position : undefined;
        for (const [bindingIndex, { binding, routeParameters }] of routeBindings.entries()) {
          let cursor: string | undefined;
          let page = 1;
          if (resumeAt) {
            const resumeBinding = String(resumeAt.binding ?? "");
            if (
              binding < resumeBinding ||
              (binding === resumeBinding && resumeAt.bindingDone === true)
            )
              continue;
            // The last committed page is read again: records that moved up a
            // page while the pass waited are not skipped.
            if (binding === resumeBinding) {
              page = Math.max(1, Number(resumeAt.page) || 1);
              cursor =
                typeof resumeAt.cursor === "string" ? resumeAt.cursor : undefined;
            }
          }
          do {
            const requestedCursor = cursor;
            const requestedPage = page;
            const providerPayload = await pacedFetch(capability, {
              providerUserId: context.mapping.providerUserId,
              cursor,
              page,
              routeParameters,
            });
            lastPayloadShape = shape(providerPayload);
            const normalized = normalizeProviderPage(
              providerPayload,
              capability,
              capability.scope === "personal" ? actor.accountId : undefined,
              routeParameters,
              context.mapping.providerUserId,
            );
            const pageClassIds = new Set<string>();
            const pageYearGroupIds = new Set<string>();
            for (const item of normalized.records) {
              if (item.providerClassId) {
                accessibleClassIds.add(item.providerClassId);
                if (selectedClassIds.has(item.providerClassId))
                  pageClassIds.add(item.providerClassId);
              }
              const normalizedRecord =
                item.normalized &&
                typeof item.normalized === "object" &&
                !Array.isArray(item.normalized)
                  ? (item.normalized as Record<string, unknown>)
                  : null;
              const yearGroupId = identifier(
                normalizedRecord?.yearGroupId ??
                  normalizedRecord?.year_group_id ??
                  normalizedRecord?.grade,
                500,
              );
              if (yearGroupId && /^\d+$/.test(yearGroupId)) {
                accessibleYearGroupIds.add(yearGroupId);
                pageYearGroupIds.add(yearGroupId);
              }
            }
            const bindingDone = !normalized.nextCursor;
            const commitPayload = {
              capabilityId: capability._id,
              records: normalized.records.map(
                ({ mappedAccountId: _mappedAccountId, ...item }) => item,
              ),
              ...(normalized.nextCursor
                ? { nextCursor: normalized.nextCursor }
                : {}),
              pageNumber: requestedPage,
              progress: {
                binding,
                page: requestedPage,
                ...(requestedCursor ? { cursor: requestedCursor } : {}),
                bindingDone,
                capabilityDone:
                  bindingDone && bindingIndex === routeBindings.length - 1,
                classIds: [...pageClassIds],
                yearGroupIds: [...pageYearGroupIds],
              },
              ...leaseAndSelection,
            };
            await signedCommit(actor, {
              operation: "sync-page",
              integrationId: context.integration._id,
              syncRunId: started.syncRunId,
              payload: commitPayload,
              mutation: "managebac:commitNormalizedPage",
              serviceSubject: scheduled?.serviceSubject,
            });
            recordCount += normalized.records.length;
            pageCount += 1;
            cursor = normalized.nextCursor || undefined;
            page += 1;
            if (pageCount > 500)
              throw new Error(
                `INTEGRATION_PAGINATION_GUARD: ${capability.name} exceeded 500 pages.`,
              );
          } while (cursor);
        }
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: pageCount,
          records: recordCount,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "INTEGRATION_CAPABILITY_FAILED";
        // These end the whole sync. Quarantining one route for them would
        // hide a school-wide cause behind a single route, and a fault of
        // Spectra's own (a timed-out commit, a dropped connection) says
        // nothing about the route: the next sync simply tries again.
        if (
          message.startsWith("INTEGRATION_CREDENTIAL_REJECTED") ||
          message.startsWith("INTEGRATION_PERMISSION_DENIED") ||
          message.startsWith("INTEGRATION_RATE_LIMITED") ||
          message.startsWith("INTEGRATION_SYNC_TIME_BUDGET") ||
          transientFailure(error, message)
        )
          throw error;
        const reasonCode =
          message.match(/\b(INTEGRATION_[A-Z0-9_]+)\b/)?.[1] ??
          message.match(/^([A-Z0-9_]+)/)?.[1] ??
          "INTEGRATION_CAPABILITY_FAILED";
        const sanitizedSample = {
          error: message.slice(0, 800),
          ...(lastPayloadShape !== undefined
            ? { payloadShape: lastPayloadShape }
            : {}),
        };
        const quarantinePayload = {
          capabilityId: capability._id,
          reasonCode,
          payloadHash: digest(
            lastPayloadShape ?? {
              category: capability.category,
              path: capability.path,
              page: pageCount + 1,
            },
          ),
          providerRecordKeyHash: digest(
            `${capability._id}:${capability.path}:${pageCount + 1}`,
          ),
          sanitizedSample,
          ...leaseAndSelection,
        };
        await signedCommit(actor, {
          operation: "quarantine",
          integrationId: context.integration._id,
          syncRunId: started.syncRunId,
          payload: quarantinePayload,
          mutation: "managebac:commitQuarantine",
          serviceSubject: scheduled?.serviceSubject,
        });
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: pageCount,
          records: recordCount,
          skipped: `${reasonCode}: route quarantined for administrator review.`,
        });
      }
    }
    const completion = await signedCommit(actor, {
      operation: "sync-complete",
      integrationId: context.integration._id,
      syncRunId: started.syncRunId,
      payload: leaseAndSelection,
      mutation: "managebac:completeSync",
      serviceSubject: scheduled?.serviceSubject,
    });
    return {
      syncRunId: started.syncRunId,
      ...(jobKind ? { syncKind: jobKind } : {}),
      summaries,
      completion,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "INTEGRATION_SYNC_FAILED";
    const errorCode =
      message.match(/^([A-Z0-9_]+)/)?.[1] ?? "INTEGRATION_SYNC_FAILED";
    const errorSummary = message.replace(/^[A-Z0-9_]+:\s*/, "").slice(0, 500);
    // Running out of time or provider requests only pauses the pass: its
    // saved pages stand and the next request continues it.
    if (
      errorCode === "INTEGRATION_SYNC_TIME_BUDGET" ||
      errorCode === "INTEGRATION_RATE_LIMITED"
    ) {
      await signedCommit(actor, {
        operation: "sync-suspend",
        integrationId: context.integration._id,
        syncRunId: started.syncRunId,
        payload: {
          errorCode,
          errorSummary,
          ...(errorCode === "INTEGRATION_RATE_LIMITED"
            ? { resumeAfterAt: Date.now() + 60_000 }
            : {}),
          ...leaseAndSelection,
        },
        mutation: "managebac:suspendSync",
        serviceSubject: scheduled?.serviceSubject,
      });
      return {
        syncRunId: started.syncRunId,
        ...(jobKind ? { syncKind: jobKind } : {}),
        summaries,
        suspended: true as const,
        errorCode,
      };
    }
    await signedCommit(actor, {
      operation: "sync-fail",
      integrationId: context.integration._id,
      syncRunId: started.syncRunId,
      payload: {
        errorCode,
        errorSummary,
        ...leaseAndSelection,
      },
      mutation: "managebac:failSync",
      serviceSubject: scheduled?.serviceSubject,
    }).catch(() => undefined);
    throw error;
  }
}

type StudentSyncJob = {
  kind: SchoolSyncKind;
  syncRunId?: string;
  summaries?: Array<Record<string, unknown>>;
  completion?: unknown;
  suspended?: true;
  errorCode?: string;
  errorSummary?: string;
};

/**
 * A failure that is not the provider's answer: Convex refusing or timing out
 * a commit, or the request never completing. Only the provider's own
 * answers (a status, a shape) may quarantine a route.
 */
function transientFailure(error: unknown, message: string) {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return true;
  return /\[Request ID:|Server Error|execution timed out|fetch failed|ECONNRESET|ETIMEDOUT/i.test(message);
}

function errorParts(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return {
    errorCode: message.match(/^([A-Z0-9_]+)/)?.[1] ?? fallback,
    errorSummary: message.replace(/^[A-Z0-9_]+:\s*/, "").slice(0, 500),
  };
}

/**
 * A blocked connection, looked at again with the key already saved: one call
 * to the student lookup every key is granted. If ManageBac takes the key, the
 * block was a single route's refusal (or ManageBac's passing fault) and the
 * connection opens again; if it still refuses, only a new key will do.
 */
async function recheckSavedKey(actor: { schoolId: string; email?: string }) {
  const { integration } = (await convexQuery("managebac:adminOverview", {})) as {
    integration?: { baseUrl?: string; authHeaderName?: string; authScheme?: string; status?: string } | null;
  };
  if (!integration?.baseUrl) throw new Error("INTEGRATION_NOT_CONFIGURED: ManageBac is not configured.");
  if (integration.status !== "blocked") return { outcome: "not_blocked" as const };
  const secret = await loadSchoolSecretForConnector({ schoolId: actor.schoolId, purpose: "managebac-api-token" });
  if (!secret) return { outcome: "key_missing" as const };
  const url = new URL("/v2p2/students", normalizeManageBacBaseUrl(integration.baseUrl));
  if (actor.email) url.searchParams.set("q", actor.email);
  await assertPublicApiHost(url.origin);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      [integration.authHeaderName || "auth-token"]: integration.authScheme === "bearer" ? `Bearer ${secret.value}` : secret.value,
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) return { outcome: "key_refused" as const };
  if (!response.ok) return { outcome: "unreachable" as const, status: response.status };
  await convexMutation("managebac:reopenBlocked", {});
  return { outcome: "reopened" as const };
}

/** Errors after which no other kind can be read in this request either. */
const STOPS_EVERY_JOB = new Set([
  "INTEGRATION_CREDENTIAL_REJECTED",
  "INTEGRATION_TOKEN_REQUIRED",
  "INTEGRATION_IDENTITY_REQUIRED",
  "INTEGRATION_RATE_LIMITED",
]);

/**
 * "Sync now" for one student: one kind, or every kind that isn't Off, in the
 * order classes come first. Each kind is its own job. Whatever the request's
 * time budget doesn't reach is queued for the worker, which picks it up
 * within minutes; a job the budget interrupts continues there too.
 */
async function runStudentSync(
  actor: ConnectorActor,
  context: ConnectorContext,
  token: string,
  only?: SchoolSyncKind,
) {
  const preferences = (await convexQuery("school:preferences", {})) as {
    kinds: Array<{ kind: SchoolSyncKind; mode: string; available: boolean }>;
    classOverrides: Array<{ kind: SchoolSyncKind; mode: string }>;
  };
  const enabled = (kind: SchoolSyncKind) => {
    const row = preferences.kinds.find((item) => item.kind === kind);
    const overrides = preferences.classOverrides.filter((item) => item.kind === kind);
    const auto = row?.mode === "auto" || overrides.some((item) => item.mode === "auto");
    return Boolean(
      row?.available &&
        (row.mode !== "off" || overrides.some((item) => item.mode !== "off")) &&
        // A sync of everything starts from today; history comes when asked for.
        joinsPageSync(kind, auto),
    );
  };
  const kinds = only ? [only] : SCHOOL_SYNC_KINDS.filter(enabled);
  const deadline = Date.now() + SYNC_TIME_BUDGET_MS;
  const jobs: StudentSyncJob[] = [];
  const queued: SchoolSyncKind[] = [];
  let stopped = false;
  for (const kind of kinds) {
    if (stopped) break;
    // Too little time left to start another job: the worker runs it.
    if (Date.now() >= deadline - 15_000) {
      queued.push(kind);
      continue;
    }
    try {
      const result = await runSync(actor, "manual", context, token, undefined, {
        syncKind: kind,
        deadline,
      });
      jobs.push({
        kind,
        syncRunId: result.syncRunId,
        summaries: result.summaries,
        ...("completion" in result
          ? { completion: result.completion }
          : { suspended: true as const, errorCode: result.errorCode }),
      });
      if ("suspended" in result && result.errorCode === "INTEGRATION_RATE_LIMITED") stopped = true;
    } catch (error) {
      const parts = errorParts(error, "INTEGRATION_SYNC_FAILED");
      jobs.push({ kind, ...parts });
      if (STOPS_EVERY_JOB.has(parts.errorCode)) stopped = true;
    }
  }
  for (const kind of queued)
    await convexMutation("school:syncNow", { kind }).catch(() => undefined);
  return { jobs, queued };
}

/** Reads a response body, refusing more than `maximum` bytes. */
async function readBounded(response: Response, maximum: number, code: string) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new Error(code);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel().catch(() => undefined);
      throw new Error(code);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads one submitted file. ManageBac lists a download path per file; it
 * answers with a redirect to short-lived storage, which is followed once,
 * without the school's API key, and only to a public HTTPS host.
 */
async function providerFetchSchoolFileBytes(
  context: ConnectorContext,
  token: string,
  downloadPath: string,
) {
  if (!downloadPath)
    throw new Error(
      "INTEGRATION_ENDPOINT_UNAVAILABLE: ManageBac lists no download for this file.",
    );
  const base = new URL(context.integration.baseUrl);
  const url = new URL(downloadPath, `${base.toString().replace(/\/+$/, "")}/`);
  if (url.origin !== base.origin)
    throw new Error("INTEGRATION_EGRESS_BLOCKED: The file download left the ManageBac API host.");
  await assertPublicApiHost(url.origin);
  const tooLarge = "SCHOOL_FILE_TOO_LARGE: This file is larger than Spectra keeps (50 MB).";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const tokenValue =
      context.integration.authScheme === "bearer" ? `Bearer ${token}` : token;
    let response = await fetch(url, {
      method: "GET",
      headers: { [context.integration.authHeaderName]: tokenValue },
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location)
        throw new Error("INTEGRATION_RESOURCE_DOWNLOAD_FAILED: ManageBac's download had nowhere to go.");
      const target = new URL(location, url);
      await assertPublicApiHost(target.origin);
      response = await fetch(target, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
    }
    if (response.status === 401)
      throw new Error("INTEGRATION_CREDENTIAL_REJECTED: ManageBac refused the school's API key.");
    if (response.status === 403)
      throw new Error("INTEGRATION_PERMISSION_DENIED: The school's ManageBac API key doesn't allow downloading dropbox files.");
    if (response.status === 404)
      throw new Error("INTEGRATION_RESOURCE_UNAVAILABLE: ManageBac no longer has this file.");
    if (!response.ok)
      throw new Error(`INTEGRATION_RESOURCE_DOWNLOAD_FAILED: ManageBac returned ${response.status}.`);
    const bytes = await readBounded(response, SCHOOL_FILE_MAX_BYTES, tooLarge);
    if (!bytes.length) throw new Error("INTEGRATION_RESOURCE_EMPTY: ManageBac returned an empty file.");
    const mimeType = (response.headers.get("content-type") || "application/octet-stream")
      .split(";", 1)[0]!
      .trim()
      .slice(0, 160);
    return { bytes, mimeType };
  } finally {
    clearTimeout(timeout);
  }
}

/** Text kept from a fetched file so search can find it. Best effort. */
async function schoolFileText(bytes: Buffer, mimeType: string, filename: string) {
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const handling =
    mimeType === "application/pdf" || extension === "pdf"
      ? ("pdf" as const)
      : extension === "docx" || mimeType.includes("wordprocessingml")
        ? ("docx" as const)
        : extension === "pptx" || mimeType.includes("presentationml")
          ? ("pptx" as const)
          : extension === "xlsx" || mimeType.includes("spreadsheetml")
            ? ("xlsx" as const)
            : mimeType.startsWith("text/") || ["txt", "md", "csv"].includes(extension)
              ? ("text" as const)
              : undefined;
  if (!handling) return undefined;
  try {
    const declared = handling === "pdf" ? "application/pdf" : mimeType;
    const [prepared] = await prepareAttachments([
      {
        name: filename,
        mimeType: declared,
        size: bytes.byteLength,
        handling,
        data:
          handling === "text"
            ? bytes.toString("utf8")
            : `data:${declared};base64,${bytes.toString("base64")}`,
      },
    ]);
    const text = prepared?.extractedText?.trim();
    return text ? text.slice(0, SCHOOL_FILE_TEXT_MAX_CHARS) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens one file the student handed in. The first open downloads it into
 * the student's own storage; later opens, and the same bytes handed in for
 * another task, use what is kept.
 */
async function fetchSchoolFile(
  context: ConnectorContext,
  token: string,
  input: { submissionRecordId: string; providerFileId: string },
) {
  if (context.mapping.status !== "verified")
    throw new Error("INTEGRATION_IDENTITY_REQUIRED: Resolve your identity first.");
  const begun = object(await convexMutation("managebac:beginSchoolFileFetch", input));
  const schoolFileId = string(begun.schoolFileId, 200);
  if (begun.status === "cached") return { status: "cached" as const, schoolFileId };
  const file = object(begun.file);
  const uploadUrl = string(begun.uploadUrl, 4_000);
  try {
    const downloaded = await providerFetchSchoolFileBytes(
      context,
      token,
      string(file.downloadPath, 2_000),
    );
    const mimeType =
      downloaded.mimeType === "application/octet-stream"
        ? string(file.mimeType, 160) || downloaded.mimeType
        : downloaded.mimeType;
    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": mimeType },
      body: new Uint8Array(downloaded.bytes) as unknown as BodyInit,
    });
    const stored = (await uploaded.json().catch(() => null)) as { storageId?: string } | null;
    if (!uploaded.ok || !stored?.storageId)
      throw new Error("SCHOOL_FILE_UPLOAD_FAILED: Spectra couldn't keep this file.");
    const extractedText = await schoolFileText(
      downloaded.bytes,
      mimeType,
      string(file.filename, 240) || "file",
    );
    const attached = await convexMutation("managebac:attachSchoolFile", {
      schoolFileId,
      storageId: stored.storageId,
      contentHash: createHash("sha256").update(downloaded.bytes).digest("hex"),
      bytes: downloaded.bytes.byteLength,
      mimeType,
      ...(extractedText ? { extractedText } : {}),
    });
    return { status: "fetched" as const, ...object(attached) };
  } catch (error) {
    await convexMutation("managebac:failSchoolFileFetch", {
      schoolFileId,
      ...errorParts(error, "SCHOOL_FILE_FETCH_FAILED"),
    }).catch(() => undefined);
    throw error;
  }
}

function manageBacWorkerHttpKey() {
  const configured = process.env.SPECTRA_MANAGEBAC_WORKER_HTTP_KEY;
  if (configured && configured.length >= 32) return configured;
  const connectorKey = process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
  if (!connectorKey || connectorKey.length < 32)
    throw new Error(
      "INTEGRATION_WORKER_CONFIG_MISSING: Configure the ManageBac worker HTTP key.",
    );
  return createHmac("sha256", connectorKey)
    .update("spectra-managebac-worker-http:v1")
    .digest("base64url");
}

function verifyWorkerRequest(request: NextRequest, rawBody: string) {
  const timestamp = Number(
    request.headers.get("x-spectra-worker-timestamp") ?? "",
  );
  const signature =
    request.headers.get("x-spectra-worker-signature")?.trim() ?? "";
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 60_000)
    throw new Error(
      "INTEGRATION_WORKER_EXPIRED: The scheduled request expired.",
    );
  const bodyDigest = createHash("sha256").update(rawBody).digest("base64url");
  const expected = createHmac("sha256", manageBacWorkerHttpKey())
    .update(`${timestamp}.${bodyDigest}`)
    .digest();
  const received = Buffer.from(signature, "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new Error(
      "INTEGRATION_WORKER_INVALID: Scheduled worker authorization failed.",
    );
}

/** Most jobs one worker request takes on; each runs until the shared budget. */
const MAX_SCHEDULED_JOBS = 8;

/**
 * The scheduled worker. One request claims due jobs (students' own jobs
 * first, then the school reconciliation) until none is due or its time
 * budget is spent; a job the budget interrupts is suspended and continues in
 * a later request.
 */
async function runScheduledSync(workerId: string) {
  const deadline = Date.now() + SYNC_TIME_BUDGET_MS;
  const jobs: Array<Record<string, unknown>> = [];
  while (jobs.length < MAX_SCHEDULED_JOBS && Date.now() < deadline - 10_000) {
    const job: Record<string, unknown> = await runOneScheduledSync(workerId, deadline);
    if (!job.worked) break;
    jobs.push(job);
    if (job.suspended) break;
  }
  return {
    worked: jobs.length > 0,
    jobs,
    ...(jobs.some((job) => job.suspended) ? { suspended: true } : {}),
  };
}

async function runOneScheduledSync(workerId: string, deadline: number) {
  const payload = { workerId: workerId.slice(0, 200) };
  const payloadDigest = exactDigest(payload);
  const timestamp = Date.now();
  const nonce = randomBytes(24).toString("base64url");
  const connectorKey = process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
  if (!connectorKey || connectorKey.length < 32)
    throw new Error(
      "INTEGRATION_BRIDGE_CONFIG_MISSING: Configure a strong connector bridge key.",
    );
  const signature = createHmac("sha256", connectorKey)
    .update(["scheduled-claim", timestamp, nonce, payloadDigest].join("|"))
    .digest("base64url");
  const claimed = await convexPublicMutation<
    Record<string, unknown>,
    {
      integrationId: string;
      syncRunId: string;
      schoolId: string;
      serviceSubject: string;
      leaseToken?: string;
      selectionRevision?: number;
      pass?: unknown;
      actor: ConnectorActor;
    } | null
  >("managebac:claimScheduledSync", {
    ...payload,
    payloadDigest,
    timestamp,
    nonce,
    signature,
  });
  if (!claimed) return { worked: false };
  try {
    const context = await connectorContext(
      claimed.actor,
      claimed.integrationId,
      claimed.serviceSubject,
    );
    const secret = await loadSchoolSecretForConnector({
      schoolId: claimed.schoolId,
      purpose: "managebac-api-token",
      serviceSubject: claimed.serviceSubject,
    });
    if (!secret)
      throw new Error(
        "INTEGRATION_TOKEN_REQUIRED: The school connector token is missing.",
      );
    const studentJob = isSchoolSyncKind(object(claimed.pass).syncKind);
    const result = await runSync(
      claimed.actor,
      studentJob ? "manual" : "reconciliation",
      context,
      secret.value,
      {
        integrationId: claimed.integrationId,
        syncRunId: claimed.syncRunId,
        serviceSubject: claimed.serviceSubject,
        leaseToken:
          typeof claimed.leaseToken === "string" ? claimed.leaseToken : undefined,
        selectionRevision:
          typeof claimed.selectionRevision === "number"
            ? claimed.selectionRevision
            : undefined,
        pass: claimed.pass,
      },
      { deadline },
    );
    return {
      worked: true,
      integrationId: claimed.integrationId,
      syncRunId: claimed.syncRunId,
      ...(result.syncKind ? { syncKind: result.syncKind } : {}),
      summaries: result.summaries,
      ..."completion" in result
        ? { completion: result.completion }
        : { suspended: true, errorCode: result.errorCode },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "INTEGRATION_SYNC_FAILED";
    await signedCommit(claimed.actor, {
      operation: "sync-fail",
      integrationId: claimed.integrationId,
      syncRunId: claimed.syncRunId,
      payload: {
        errorCode:
          message.match(/^([A-Z0-9_]+)/)?.[1] ?? "INTEGRATION_SYNC_FAILED",
        errorSummary: message.replace(/^[A-Z0-9_]+:\s*/, "").slice(0, 500),
        ...(typeof claimed.leaseToken === "string"
          ? { leaseToken: claimed.leaseToken }
          : {}),
        ...(typeof claimed.selectionRevision === "number"
          ? { selectionRevision: claimed.selectionRevision }
          : {}),
      },
      mutation: "managebac:failSync",
      serviceSubject: claimed.serviceSubject,
    }).catch(() => undefined);
    // The failure is recorded on the job, which retries on its own schedule;
    // the worker moves on to the next due job.
    return {
      worked: true,
      integrationId: claimed.integrationId,
      syncRunId: claimed.syncRunId,
      failed: true,
      errorCode: message.match(/^([A-Z0-9_]+)/)?.[1] ?? "INTEGRATION_SYNC_FAILED",
    };
  }
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor({ fresh: true });
    const action = request.nextUrl.searchParams.get("action") ?? "overview";
    if (action === "myClasses") {
      return ok({
        data: await convexQuery("managebac:listMyClassCandidates", {}),
      });
    }
    if (action !== "overview")
      return badRequest("That ManageBac action is unavailable.");
    const admin = actor.schoolRole === "school_admin";
    const [data, personal] = await Promise.all([
      convexQuery(admin ? "managebac:adminOverview" : "managebac:myOverview", {}),
      admin ? convexQuery("managebac:myOverview", {}) : Promise.resolve(null),
    ]);
    const personalData = object(personal);
    const overviewData =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    return ok({
      admin,
      data: {
        ...overviewData,
        ...(admin
          ? {
              // School previews exclude mapped records. Add only this actor's
              // authorized records, leaving operational previews unchanged.
              records: [
                ...(Array.isArray(overviewData.previews) ? overviewData.previews : []),
                ...(Array.isArray(personalData.records) ? personalData.records : []),
              ],
              mapping: personalData.mapping,
              envBaseUrlHint:
                normalizeManageBacBaseUrl(
                  process.env.MANAGEBAC_BASE_URL?.trim() ||
                    "https://api.managebac.com",
                ) || undefined,
              envTokenAvailable: Boolean(localDevelopmentManageBacKey()),
            }
          : {}),
      },
    });
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const rawBody = await request.text();
    const body = object(JSON.parse(rawBody));
    const action = string(body.action, 100);
    if (action === "internal_scheduled_work") {
      verifyWorkerRequest(request, rawBody);
      const workerId = string(body.workerId, 200);
      if (!workerId)
        throw new Error(
          "INTEGRATION_WORKER_ID_REQUIRED: Worker identity is required.",
        );
      return ok({
        completed: true,
        ...(await runScheduledSync(workerId)),
      });
    }
    const actor = await requireActor({ fresh: true });

    if (action === "upsertPeriodMap") {
      if (actor.schoolRole !== "school_admin")
        throw new Error("AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.");
      return ok(
        await convexMutation("managebac:upsertCalendarPeriodMap", {
          periodKey: string(body.periodKey, 120),
          label: string(body.label, 160),
          startMinutes: Number(body.startMinutes),
          endMinutes: Number(body.endMinutes),
          timezone: string(body.timezone, 100),
          weekdays: Array.isArray(body.weekdays)
            ? body.weekdays.filter((value): value is number => typeof value === "number")
            : [],
        }),
      );
    }
    if (action === "removePeriodMap") {
      if (actor.schoolRole !== "school_admin")
        throw new Error("AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.");
      return ok(
        await convexMutation("managebac:removeCalendarPeriodMap", {
          periodMapId: string(body.periodMapId, 200),
        }),
      );
    }

    if (action === "configure") {
      if (actor.schoolRole !== "school_admin")
        throw new Error(
          "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
        );
      const typedToken = string(body.token, 20_000);
      const envToken = localDevelopmentManageBacKey();
      const current = (await convexQuery("managebac:adminOverview", {})) as {
        integration?: { _id?: string; status?: string } | null;
      };
      const token =
        typedToken.length >= 16
          ? typedToken
          : !current.integration || current.integration.status === "revoked"
            ? envToken
            : "";
      if (token.length > 0 && token.length < 16)
        throw new Error(
          "INTEGRATION_TOKEN_REQUIRED: Enter the school-wide API key.",
        );
      if (
        (!current.integration || current.integration.status === "revoked") &&
        token.length < 16
      )
        throw new Error(
          "INTEGRATION_TOKEN_REQUIRED: Enter the school-wide API key.",
        );
      const secret =
        token.length >= 16
          ? await storeSchoolSecret({
              schoolId: actor.schoolId,
              purpose: "managebac-api-token",
              label: "ManageBac school-wide API token",
              value: token,
              requestId: request.headers.get("x-request-id") ?? undefined,
            })
          : null;
      const result = await convexMutation("managebac:configure", {
        baseUrl: normalizeManageBacBaseUrl(
          process.env.MANAGEBAC_BASE_URL?.trim() || "https://api.managebac.com",
        ),
        authHeaderName: "auth-token",
        authScheme: "raw",
        credentialFingerprint: secret?.fingerprint,
        frequencyMinutes: 180,
        autoApplySafeUpdates: true,
        conflictMode: "review",
      });
      return ok(result);
    }

    if (action === "replaceManifest") {
      if (actor.schoolRole !== "school_admin")
        throw new Error(
          "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
        );
      const integrationId = string(body.integrationId, 200);
      const capabilities = Array.isArray(body.capabilities)
        ? body.capabilities
        : [];
      const sourceHash = digest({
        providerVersion: body.providerVersion ?? null,
        capabilities,
      });
      const result = await convexMutation(
        "managebac:replaceCapabilityManifest",
        {
          integrationId,
          sourceHash,
          providerVersion: string(body.providerVersion, 100) || undefined,
          capabilities,
        },
      );
      return ok(result);
    }

    if (action === "importReference") {
      if (actor.schoolRole !== "school_admin")
        throw new Error(
          "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
        );
      const integrationId = string(body.integrationId, 200);
      const discovered = capabilitiesFromOpenApi(body.document);
      const sourceHash = digest(body.document);
      const result = await convexMutation(
        "managebac:replaceCapabilityManifest",
        {
          integrationId,
          sourceHash,
          providerVersion: discovered.providerVersion,
          capabilities: discovered.capabilities,
        },
      );
      return ok({
        ...object(result),
        discovered: discovered.capabilities.length,
        warning:
          "Every discovered route remains unverified and unusable until a school administrator confirms its read-only permission, audience, normalization, and sampled response contract.",
      });
    }

    if (action === "disconnect") {
      if (actor.schoolRole !== "school_admin")
        throw new Error(
          "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
        );
      await revokeSchoolSecret({
        schoolId: actor.schoolId,
        purpose: "managebac-api-token",
        requestId: request.headers.get("x-request-id") ?? undefined,
      });
      return ok(await convexMutation("managebac:disconnect", {}));
    }

    if (action === "recheck") {
      if (actor.schoolRole !== "school_admin")
        throw new Error(
          "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
        );
      return ok(await recheckSavedKey(actor));
    }

    const overview = (await convexQuery(
      actor.schoolRole === "school_admin"
        ? "managebac:adminOverview"
        : "managebac:myOverview",
      {},
    )) as {
      integration?: { _id?: string } | null;
    };
    const integrationId = overview.integration?._id;
    if (!integrationId)
      throw new Error(
        "INTEGRATION_NOT_CONFIGURED: ManageBac is not configured.",
      );
    if (action === "selectClasses") {
      const recordIds = Array.isArray(body.recordIds)
        ? body.recordIds.filter(
            (item): item is string => typeof item === "string" && item.length > 0,
          )
        : [];
      const retention =
        body.retention === "archive_projection" ||
        body.retention === "keep_in_spectra"
          ? body.retention
          : undefined;
      const selection = (await convexMutation("managebac:setSelectedClasses", {
        recordIds,
        ...(typeof body.expectedRevision === "number"
          ? { expectedRevision: body.expectedRevision }
          : {}),
        ...(retention ? { retention } : {}),
      })) as {
        selectionRevision: number;
        selectedClassIds: string[];
        selectedRecordIds: string[];
        deselectedRecordIds?: string[];
        retention?: "keep_in_spectra" | "archive_projection";
      };
      const materialization = selection.selectedRecordIds.length
        ? await convexMutation("managebac:materializeClassWorkspaces", {
            recordIds: selection.selectedRecordIds,
          })
        : { requested: 0, created: 0, refreshed: 0, projected: 0, skipped: 0 };
      const release = selection.deselectedRecordIds?.length
        ? await convexMutation("managebac:releaseClassWorkspaces", {
            recordIds: selection.deselectedRecordIds,
            retention: selection.retention ?? retention ?? "keep_in_spectra",
          })
        : { requested: 0, removed: 0, skipped: 0, done: true };
      return ok({
        ...selection,
        materialization,
        release,
        outcome: "selection_saved",
      });
    }
    let context = await connectorContext(actor, integrationId);
    // Matching and a student's sync run on Spectra's official routes: a route
    // Spectra has since corrected replaces the stored one before it runs. The
    // school reconciliation reads the shared routes, so it leaves them be.
    if (action === "resolveIdentity" || (action === "sync" && body.kind !== "reconciliation"))
      context = await ensureOfficialPersonalCapabilityManifest(
        actor,
        integrationId,
        context,
      );
    const secret = await loadSchoolSecretForConnector({
      schoolId: actor.schoolId,
      purpose: "managebac-api-token",
    });
    if (!secret)
      throw new Error(
        "INTEGRATION_TOKEN_REQUIRED: The school token is missing.",
      );

    if (action === "importResource") {
      const sourceRecordId = string(body.sourceRecordId, 200);
      if (!sourceRecordId)
        throw new Error("INTEGRATION_RESOURCE_ID_REQUIRED: Choose a school resource first.");
      return ok(
        await importManageBacResource(
          actor,
          context,
          secret.value,
          sourceRecordId,
          body.refresh === true,
          string(body.requestKey, 240) || undefined,
        ),
      );
    }

    if (action === "resolveIdentity") {
      const identity = await resolveIdentity(
        actor,
        integrationId,
        context,
        secret.value,
      );
      // A newly matched student's class list comes in the same request, so
      // they can choose classes straight away. Their other Auto kinds were
      // queued by the match and run in the background.
      if (
        object(identity.result).status === "verified" &&
        body.syncClasses === true
      ) {
        const refreshed = await connectorContext(actor, integrationId);
        const classes = await runStudentSync(actor, refreshed, secret.value, "classes");
        return ok({ identity, classes });
      }
      return ok({ identity });
    }

    if (action === "sync") {
      // The school-wide reconciliation of shared routes (administrators).
      if (body.kind === "reconciliation")
        return ok(await runSync(actor, "reconciliation", context, secret.value));
      if (body.kind !== undefined && !isSchoolSyncKind(body.kind))
        return badRequest("Choose a kind of School data to sync.");
      return ok(
        await runStudentSync(
          actor,
          context,
          secret.value,
          isSchoolSyncKind(body.kind) ? body.kind : undefined,
        ),
      );
    }

    if (action === "fetchSchoolFile") {
      const submissionRecordId = string(body.submissionRecordId, 200);
      const providerFileId = string(body.providerFileId, 500);
      if (!submissionRecordId || !providerFileId)
        return badRequest("Choose a file from one of your submissions.");
      return ok(
        await fetchSchoolFile(context, secret.value, {
          submissionRecordId,
          providerFileId,
        }),
      );
    }

    if (action === "resolveConflict") {
      const resolution = string(body.resolution, 80);
      if (
        ![
          "rebase",
          "keep_overlay",
          "detach",
          "archive_projection",
          "link_existing",
        ].includes(resolution)
      )
        throw new Error("Choose a valid conflict resolution.");
      return ok(
        await convexMutation("managebac:resolveConflict", {
          conflictId: string(body.conflictId, 200),
          resolution,
          linkProjectionId: string(body.linkProjectionId, 300) || undefined,
        }),
      );
    }

    if (action === "materializeClasses") {
      const recordIds = Array.isArray(body.recordIds)
        ? body.recordIds.filter(
            (item): item is string => typeof item === "string" && item.length > 0,
          )
        : [];
      return ok(
        await convexMutation("managebac:materializeClassWorkspaces", {
          recordIds,
        }),
      );
    }

    if (action === "purgeAutoClassWorkspaces") {
      return ok(
        await convexMutation("managebac:purgeAutoCreatedClassWorkspaces", {
          confirmation: string(body.confirmation, 200),
        }),
      );
    }

    if (action === "releaseClasses") {
      const recordIds = Array.isArray(body.recordIds)
        ? body.recordIds.filter(
            (item): item is string => typeof item === "string" && item.length > 0,
          )
        : [];
      let last: {
        removed?: number;
        skipped?: number;
        requested?: number;
        remaining?: number;
        done?: boolean;
      } = {};
      for (let round = 0; round < 400; round += 1) {
        last = await convexMutation("managebac:releaseClassWorkspaces", {
          recordIds,
          retention:
            body.retention === "archive_projection"
              ? "archive_projection"
              : "keep_in_spectra",
        });
        if (last?.done !== false) return ok(last);
      }
      throw new Error(
        "Those class shelves could not be saved. Try again.",
      );
    }

    if (action === "requestAiRefresh") {
      return ok(
        await convexMutation("managebac:requestAiRefresh", {
          reason: string(body.reason, 240) || undefined,
        }),
      );
    }

    return badRequest("That ManageBac action is unavailable.");
  }, request);
}

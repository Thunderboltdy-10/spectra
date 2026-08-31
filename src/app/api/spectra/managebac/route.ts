import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
import {
  manageBacContractDigest as digest,
  officialPersonalCapabilities,
} from "./contracts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

type ConnectorContext = {
  integration: {
    _id: string;
    schoolId: string;
    baseUrl: string;
    authHeaderName: string;
    authScheme: "raw" | "bearer";
    requestBudgetPerMinute: number;
    bootstrapVersion: number;
    status: string;
  };
  capabilities: Array<{
    _id: string;
    category: string;
    name: string;
    recordType: string;
    path: string;
    purpose: string;
    scope: "personal" | "class" | "school";
    minimumRole: "student" | "teacher" | "school_admin";
    pagination: "none" | "page" | "cursor" | "unknown";
    changeStrategy: string;
    contractVersion: string;
    responseSchemaHash?: string;
    personalIdParameter?: string;
    normalization: unknown;
  }>;
  mapping: { status: string; providerUserId?: string };
  actor: { accountId: string; email: string; schoolRole: string };
};

type ConnectorActor = Awaited<ReturnType<typeof requireActor>>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown, maximum = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function identifier(value: unknown, maximum = 500) {
  if (typeof value === "number" && Number.isFinite(value))
    return String(value).slice(0, maximum);
  return string(value, maximum);
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

function exactDigest(value: unknown) {
  return digest(value);
}

async function bridgeArgs(input: {
  operation: string;
  subject: string;
  integrationId: string;
  syncRunId?: string;
  payloadDigest: string;
}) {
  const key = process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "INTEGRATION_BRIDGE_CONFIG_MISSING: Configure a strong connector bridge key.",
    );
  const timestamp = Date.now();
  const nonce = randomBytes(24).toString("base64url");
  const canonical = [
    input.operation,
    input.subject,
    input.integrationId,
    input.syncRunId ?? "-",
    timestamp,
    nonce,
    input.payloadDigest,
  ].join("|");
  const signature = createHmac("sha256", key)
    .update(canonical)
    .digest("base64url");
  return { timestamp, nonce, signature };
}

function isPrivateIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
}

function isPrivateIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

async function assertPublicApiHost(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("INTEGRATION_EGRESS_BLOCKED: API URL must be HTTPS.");
  if (isIP(url.hostname)) {
    if (
      (isIP(url.hostname) === 4 && isPrivateIpv4(url.hostname)) ||
      (isIP(url.hostname) === 6 && isPrivateIpv6(url.hostname))
    )
      throw new Error(
        "INTEGRATION_EGRESS_BLOCKED: Private network hosts are blocked.",
      );
    return url;
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) =>
      family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address),
    )
  )
    throw new Error(
      "INTEGRATION_EGRESS_BLOCKED: API host resolves to a private network.",
    );
  return url;
}

async function connectorContext(
  actor: ConnectorActor,
  integrationId: string,
  serviceSubject?: string,
) {
  const payloadDigest = digest({});
  const bridge = await bridgeArgs({
    operation: "context",
    subject: actor.clerkId,
    integrationId,
    payloadDigest,
  });
  const args = {
    integrationId,
    ...(serviceSubject ? { serviceSubject } : {}),
    payloadDigest,
    ...bridge,
  };
  return serviceSubject
    ? convexPublicMutation<Record<string, unknown>, ConnectorContext>(
        "managebac:connectorContext",
        args,
      )
    : convexMutation<Record<string, unknown>, ConnectorContext>(
        "managebac:connectorContext",
        args,
      );
}

async function ensureOfficialPersonalCapabilityManifest(
  actor: ConnectorActor,
  integrationId: string,
  context: ConnectorContext,
) {
  const official = officialPersonalCapabilities();
  const requiredPaths = new Set(official.map((item) => item.path));
  if (
    [...requiredPaths].every((path) =>
      context.capabilities.some((item) => item.path === path),
    )
  )
    return context;
  if (actor.schoolRole !== "school_admin") return context;
  const existing = context.capabilities.map(
    ({ _id: _capabilityId, ...item }) => ({
      ...item,
      freshnessSlaMinutes: 120,
      permissionState: "read_only" as const,
      verificationStatus: "verified" as const,
      routeSource: "tenant_reference" as const,
    }),
  );
  const merged = new Map(
    [...existing, ...official].map((item) => [item.path, item] as const),
  );
  const capabilities = [...merged.values()];
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
            return Array.isArray(result)
              ? result
              : result === undefined
                ? []
                : [result];
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

function interpolate(template: string, row: unknown) {
  return template.replace(/\{([^}]+)}/g, (_, path: string) =>
    encodeURIComponent(String(atPath(row, path) ?? "")),
  );
}

function normalizeProviderPage(
  payload: unknown,
  capability: ConnectorContext["capabilities"][number],
  accountId: string | undefined,
  routeParameters: Record<string, string> = {},
) {
  const config = object(capability.normalization);
  const recordsPath = Array.isArray(config.recordsPath)
    ? config.recordsPath
    : string(config.recordsPath, 300) || "$";
  const rawRecordsValue =
    config.transform === "managebac_timetable"
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
  const rawRecords = Array.isArray(rawRecordsValue)
    ? rawRecordsValue
    : rawRecordsValue && typeof rawRecordsValue === "object"
      ? [rawRecordsValue]
      : [];
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
  const fieldMap = object(config.fields);
  const result = rawRecords.slice(0, 500).map((raw, index) => {
    for (const path of requiredPaths)
      if (atPath(raw, path) === undefined)
        throw new Error(
          `INTEGRATION_SCHEMA_DRIFT: ${capability.name} record ${index + 1} is missing ${path}.`,
        );
    const providerRecordId = String(atPath(raw, idPath) ?? "").trim();
    if (!providerRecordId)
      throw new Error(
        `INTEGRATION_SCHEMA_DRIFT: ${capability.name} returned a record without its verified id.`,
      );
    const normalized: JsonObject = {};
    for (const [key, path] of Object.entries(fieldMap)) {
      const value = atFirstPath(raw, path);
      if (value !== undefined) normalized[key] = normalizedScalar(value);
    }
    const keyTemplate =
      string(config.recordKeyTemplate, 500) ||
      `${capability.recordType}:{${idPath}}`;
    const classIdFromRouteParameter = string(
      config.classIdFromRouteParameter,
      120,
    );
    const providerClassId =
      identifier(atPath(raw, string(config.classIdPath, 300)), 500) ||
      identifier(routeParameters[classIdFromRouteParameter], 500);
    const academicPeriodKey = string(
      atPath(raw, string(config.academicPeriodPath, 300)),
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
      providerRecordKey: interpolate(keyTemplate, raw).slice(0, 700),
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

function capabilityUrl(
  context: ConnectorContext,
  capability: ConnectorContext["capabilities"][number],
  input: {
    providerUserId?: string;
    cursor?: string;
    page?: number;
    verifiedEmail?: string;
    routeParameters?: Record<string, string>;
  },
) {
  const base = new URL(context.integration.baseUrl);
  let path = capability.path;
  const personalParameter = capability.personalIdParameter;
  if (personalParameter) {
    if (!input.providerUserId)
      throw new Error(
        `INTEGRATION_IDENTITY_REQUIRED: ${capability.name} requires the server-side mapped user.`,
      );
    path = path.replaceAll(
      `{${personalParameter}}`,
      encodeURIComponent(input.providerUserId),
    );
  }
  for (const [parameter, value] of Object.entries(input.routeParameters ?? {}))
    path = path.replaceAll(`{${parameter}}`, encodeURIComponent(value));
  if (/\{[^}]+}/.test(path))
    throw new Error(
      `INTEGRATION_ROUTE_PARAMETERS_UNRESOLVED: ${capability.name} needs a verified route binding.`,
    );
  const url = new URL(
    path.replace(/^\/+/, ""),
    `${base.toString().replace(/\/+$/, "")}/`,
  );
  if (url.origin !== base.origin)
    throw new Error(
      "INTEGRATION_EGRESS_BLOCKED: Route left the tenant API host.",
    );
  const config = object(capability.normalization);
  const emailQueryParameter = string(config.emailQueryParameter, 120);
  if (input.verifiedEmail && emailQueryParameter)
    url.searchParams.set(emailQueryParameter, input.verifiedEmail);
  const cursorParameter = string(config.cursorParameter, 120);
  if (input.cursor && cursorParameter)
    url.searchParams.set(cursorParameter, input.cursor);
  const pageParameter = string(config.pageParameter, 120);
  if (input.page && pageParameter)
    url.searchParams.set(pageParameter, String(input.page));
  return url;
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
    if (response.status === 401 || response.status === 403)
      throw new Error(
        `INTEGRATION_CREDENTIAL_REJECTED: ${capability.name} is not readable with this token.`,
      );
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
      "identity" | "sync-page" | "quarantine" | "sync-fail" | "sync-complete";
    integrationId: string;
    syncRunId: string;
    payload: Record<string, unknown>;
    mutation: string;
    serviceSubject?: string;
  },
) {
  const payloadDigest = exactDigest(input.payload);
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
    ...input.payload,
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
    const body = {
      matchCount: matches.length,
      ...(providerUserId ? { providerUserId } : {}),
      ...(providerUserIdHash ? { providerUserIdHash } : {}),
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
      },
      mutation: "managebac:failSync",
    }).catch(() => undefined);
    throw error;
  }
}

async function runSync(
  actor: ConnectorActor,
  kind: "bootstrap" | "manual" | "reconciliation",
  context: ConnectorContext,
  token: string,
  scheduled?: {
    syncRunId: string;
    integrationId: string;
    serviceSubject: string;
  },
  options: { personalOnly?: boolean } = {},
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
    >("managebac:beginSync", { kind }));
  const seen = new Set<string>();
  const reconciledCapabilityIds: string[] = [];
  const summaries: Array<{
    capabilityId: string;
    name: string;
    pages: number;
    records: number;
    skipped?: string;
  }> = [];
  const ordered = [...context.capabilities].sort((a, b) => {
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
  const accessibleClassIds = new Set<string>();
  const accessibleYearGroupIds = new Set<string>();
  const pacedFetch = async (
    capability: ConnectorContext["capabilities"][number],
    input: Parameters<typeof providerFetch>[3],
  ) => {
    const wait = Math.max(
      0,
      minimumRequestGap - (Date.now() - lastProviderRequestAt),
    );
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastProviderRequestAt = Date.now();
    return providerFetch(context, capability, token, input);
  };
  try {
    for (const capability of ordered) {
      const capabilityConfig = object(capability.normalization);
      if (
        capabilityConfig.identityOnly === true ||
        (options.personalOnly && capability.scope !== "personal")
      ) {
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: 0,
          records: 0,
          skipped:
            capabilityConfig.identityOnly === true
              ? "Identity lookup already completed for this account."
              : "Personal refresh leaves school-wide catalog routes untouched.",
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
      const fanOutParameter = string(capabilityConfig.fanOutParameter, 120);
      const fanOutSource = string(capabilityConfig.fanOutSource, 120);
      const fanOutIds =
        fanOutSource === "year_group"
          ? accessibleYearGroupIds
          : accessibleClassIds;
      const routeBindings = fanOutParameter
        ? [...fanOutIds].map((value) => ({
            [fanOutParameter]: value,
          }))
        : [{} as Record<string, string>];
      if (fanOutParameter && routeBindings.length === 0) {
        summaries.push({
          capabilityId: capability._id,
          name: capability.name,
          pages: 0,
          records: 0,
          skipped:
            fanOutSource === "year_group"
              ? "No verified year group targets this route yet."
              : "No verified class membership targets this route.",
        });
        continue;
      }
      let pageCount = 0;
      let recordCount = 0;
      let lastPayloadShape: unknown;
      try {
        for (const routeParameters of routeBindings) {
          let cursor: string | undefined;
          let page = 1;
          do {
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
            );
            for (const item of normalized.records) {
              seen.add(item.providerRecordKey);
              if (item.providerClassId)
                accessibleClassIds.add(item.providerClassId);
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
              if (yearGroupId && /^\d+$/.test(yearGroupId))
                accessibleYearGroupIds.add(yearGroupId);
            }
            const commitPayload = {
              capabilityId: capability._id,
              records: normalized.records.map(
                ({ mappedAccountId: _mappedAccountId, ...item }) => item,
              ),
              ...(normalized.nextCursor
                ? { nextCursor: normalized.nextCursor }
                : {}),
              pageNumber: pageCount + 1,
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
        if (capability.changeStrategy === "full_reconciliation")
          reconciledCapabilityIds.push(capability._id);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "INTEGRATION_CAPABILITY_FAILED";
        if (
          message.startsWith("INTEGRATION_CREDENTIAL_REJECTED") ||
          message.startsWith("INTEGRATION_RATE_LIMITED")
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
      payload: {
        seenProviderKeys: [...seen],
        reconciledCapabilityIds,
      },
      mutation: "managebac:completeSync",
      serviceSubject: scheduled?.serviceSubject,
    });
    return { syncRunId: started.syncRunId, summaries, completion };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "INTEGRATION_SYNC_FAILED";
    const errorCode =
      message.match(/^([A-Z0-9_]+)/)?.[1] ?? "INTEGRATION_SYNC_FAILED";
    const errorSummary = message.replace(/^[A-Z0-9_]+:\s*/, "").slice(0, 500);
    await signedCommit(actor, {
      operation: "sync-fail",
      integrationId: context.integration._id,
      syncRunId: started.syncRunId,
      payload: {
        errorCode,
        errorSummary,
        ...(errorCode === "INTEGRATION_RATE_LIMITED"
          ? { retryAfterAt: Date.now() + 60_000 }
          : {}),
      },
      mutation: "managebac:failSync",
      serviceSubject: scheduled?.serviceSubject,
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

async function runScheduledSync(workerId: string) {
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
    const result = await runSync(
      claimed.actor,
      "reconciliation",
      context,
      secret.value,
      {
        integrationId: claimed.integrationId,
        syncRunId: claimed.syncRunId,
        serviceSubject: claimed.serviceSubject,
      },
    );
    return {
      worked: true,
      integrationId: claimed.integrationId,
      syncRunId: claimed.syncRunId,
      summaries: result.summaries,
      completion: result.completion,
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
      },
      mutation: "managebac:failSync",
      serviceSubject: claimed.serviceSubject,
    }).catch(() => undefined);
    throw error;
  }
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const action = request.nextUrl.searchParams.get("action") ?? "overview";
    if (action === "myClasses") {
      return ok({
        data: await convexQuery("managebac:listMyClassCandidates", {}),
      });
    }
    if (action === "cas") {
      return ok({
        data: await convexQuery("managebac:casOverview", {}),
      });
    }
    if (action !== "overview")
      return badRequest("That ManageBac action is unavailable.");
    const admin = actor.schoolRole === "school_admin";
    const data = await convexQuery(
      admin ? "managebac:adminOverview" : "managebac:myOverview",
      {},
    );
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
              envBaseUrlHint:
                normalizeManageBacBaseUrl(
                  process.env.MANAGEBAC_BASE_URL?.trim() ||
                    "https://api.managebac.com",
                ) || undefined,
              envTokenAvailable: Boolean(
                process.env.MANAGEBAC_API_KEY?.trim() &&
                (process.env.MANAGEBAC_API_KEY?.trim().length ?? 0) >= 16,
              ),
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
    const actor = await requireActor();

    // Reflection drafts are local Spectra writes. Keep this action before any
    // connector context or provider-secret load so it cannot contact ManageBac.
    if (action === "createCasReflection") {
      return ok(
        await convexMutation("managebac:createCasReflectionDraft", {
          recordId: string(body.recordId, 200),
        }),
      );
    }

    if (action === "upsertPeriodMap") {
      if (actor.schoolRole !== "school_admin")
        throw new Error(
          "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
        );
      return ok(
        await convexMutation("managebac:upsertCalendarPeriodMap", {
          periodKey: string(body.periodKey, 120),
          label: string(body.label, 160),
          startMinutes: Number(body.startMinutes),
          endMinutes: Number(body.endMinutes),
          timezone: string(body.timezone, 100),
          weekdays: Array.isArray(body.weekdays)
            ? body.weekdays.filter(
                (value): value is number => typeof value === "number",
              )
            : [],
        }),
      );
    }
    if (action === "removePeriodMap") {
      if (actor.schoolRole !== "school_admin")
        throw new Error(
          "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
        );
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
      const envToken = process.env.MANAGEBAC_API_KEY?.trim() ?? "";
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
    let context = await connectorContext(actor, integrationId);
    if (action === "resolveIdentity")
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

    if (action === "resolveIdentity") {
      const identity = await resolveIdentity(
        actor,
        integrationId,
        context,
        secret.value,
      );
      if (
        object(identity.result).status === "verified" &&
        body.bootstrap !== false
      ) {
        const refreshed = await connectorContext(actor, integrationId);
        const bootstrap = await runSync(
          actor,
          "bootstrap",
          refreshed,
          secret.value,
          undefined,
          { personalOnly: true },
        );
        return ok({ identity, bootstrap });
      }
      return ok({ identity });
    }

    if (action === "sync") {
      const kind =
        body.kind === "reconciliation"
          ? "reconciliation"
          : body.kind === "bootstrap"
            ? "bootstrap"
            : "manual";
      return ok(await runSync(actor, kind, context, secret.value));
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
            (item): item is string =>
              typeof item === "string" && item.length > 0,
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

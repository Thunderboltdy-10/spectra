import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SessionActor } from "@/lib/auth-server";
import { convexMutation, convexPublicMutation } from "@/lib/convex-server";
import { isNonPublicAddress } from "@/lib/network-egress";

/*
 * The ManageBac connector's shared pieces: the context a school's connector
 * gives one person, the signed bridge to Convex, and the guarded way a route
 * reaches the school's API host. The school route and the server modules that
 * act for a person (a resource import Spectra AI started) both use them, so a
 * request leaves only for the tenant's public API host either way.
 */

export type ConnectorContext = {
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
  selection: { revision: number; selectedClassIds: string[] };
  actor: { accountId: string; email: string; schoolRole: string };
};

export type ConnectorActor = SessionActor;

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function string(value: unknown, maximum = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function identifier(value: unknown, maximum = 500) {
  if (typeof value === "number" && Number.isFinite(value))
    return String(value).slice(0, maximum);
  return string(value, maximum);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

export async function bridgeArgs(input: {
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

export async function assertPublicApiHost(baseUrl: string) {
  const url = new URL(baseUrl);
  const localStack = process.env.SPECTRA_APP_URL?.startsWith(
    "http://localhost:",
  );
  const testFixtureOrigin =
    process.env.NODE_ENV === "test" || localStack
      ? process.env.SPECTRA_MANAGEBAC_TEST_FIXTURE_ORIGIN?.trim()
      : undefined;
  if (testFixtureOrigin && url.origin === testFixtureOrigin) {
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname)
    )
      throw new Error(
        "INTEGRATION_EGRESS_BLOCKED: Test fixtures must use a loopback HTTP origin.",
      );
    return url;
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("INTEGRATION_EGRESS_BLOCKED: API URL must be HTTPS.");
  // WHATWG URLs keep IPv6 literals bracketed; judge the literal itself.
  const literal = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(literal)) {
    if (isNonPublicAddress(literal))
      throw new Error(
        "INTEGRATION_EGRESS_BLOCKED: Private network hosts are blocked.",
      );
    return url;
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isNonPublicAddress(address))
  )
    throw new Error(
      "INTEGRATION_EGRESS_BLOCKED: API host resolves to a private network.",
    );
  return url;
}

export async function connectorContext(
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

export function capabilityUrl(
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
  for (const [parameter, value] of Object.entries(
    input.routeParameters ?? {},
  ))
    path = path.replaceAll(
      `{${parameter}}`,
      encodeURIComponent(value),
    );
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

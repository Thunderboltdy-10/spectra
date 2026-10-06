import "server-only";

import { createHash } from "node:crypto";
import { docxLens } from "@/features/spectra/lenses/docx-lens";
import { xlsxLens } from "@/features/spectra/lenses/xlsx-lens";
import { pptxLens } from "@/features/spectra/lenses/pptx-lens";
import {
  xlsxArtifactContent,
  pptxArtifactContent,
} from "@/features/spectra/lenses/office-content";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { loadSchoolSecretForConnector } from "@/lib/server-secrets";
import {
  assertPublicApiHost,
  capabilityUrl,
  connectorContext,
  identifier,
  object,
  string,
  type ConnectorActor,
  type ConnectorContext,
} from "./connector";

/*
 * Importing a resource from a ManageBac class shelf into the Library: the file
 * is downloaded with the school's ManageBac key from the tenant's API host,
 * opened as an editable document, sheet or deck when it is an Office file, or
 * kept as an imported file otherwise. The School route's import (the class
 * shelf's Import) and Spectra AI's import_managebac_resource both come here,
 * as the signed-in person: Convex checks the resource is on one of their
 * selected classes, and a retried import reuses the one already made.
 */

const MAX_RESOURCE_BYTES = 80_000_000;
const OFFICE_FORMATS = new Set([
  "docx",
  "doc",
  "xlsx",
  "xlsm",
  "xltx",
  "xltm",
  "xlam",
  "pptx",
  "pptm",
  "potx",
  "potm",
  "ppsx",
  "ppsm",
  "ppam",
]);

function resourceFormat(title: string, mimeType: string) {
  const extension = title.includes(".")
    ? title.split(".").pop()?.toLowerCase() ?? ""
    : "";
  if (/^[a-z0-9][a-z0-9._-]{0,31}$/.test(extension)) return extension;
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.includes("wordprocessingml")) return "docx";
  if (mimeType.includes("spreadsheetml")) return "xlsx";
  if (mimeType.includes("presentationml")) return "pptx";
  return "bin";
}

function assertResourceBytes(bytes: Buffer, mimeType: string) {
  if (!bytes.length) throw new Error("INTEGRATION_RESOURCE_EMPTY");
  const mediaType = mimeType.split(";", 1)[0].trim().toLowerCase();
  const isPdf = mediaType === "application/pdf" || bytes.subarray(0, 5).toString() === "%PDF-";
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const office = mediaType.includes("officedocument") || mediaType.includes("ms-excel") || mediaType.includes("ms-powerpoint");
  if (isPdf && bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new Error("INTEGRATION_RESOURCE_CONTENT_INVALID: The provider did not return a valid PDF.");
  if (office && !isZip)
    throw new Error("INTEGRATION_RESOURCE_CONTENT_INVALID: The provider did not return a valid Office package.");
  if (!isPdf && !isZip && !mediaType.startsWith("text/") && !mediaType.startsWith("image/"))
    throw new Error("INTEGRATION_RESOURCE_CONTENT_UNSUPPORTED: The provider returned an unsupported file type.");
}

async function providerFetchResourceBytes(
  context: ConnectorContext,
  capability: ConnectorContext["capabilities"][number],
  token: string,
  routeParameters: Record<string, string>,
) {
  const url = capabilityUrl(context, capability, { routeParameters });
  await assertPublicApiHost(url.origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const tokenValue =
      context.integration.authScheme === "bearer" ? `Bearer ${token}` : token;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/pdf, application/zip, application/octet-stream, text/plain, image/*",
        [context.integration.authHeaderName]: tokenValue,
      },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 401)
      throw new Error("INTEGRATION_CREDENTIAL_REJECTED: ManageBac refused the school's API key.");
    if (response.status === 403)
      throw new Error("INTEGRATION_PERMISSION_DENIED: The school's ManageBac API key doesn't allow downloading this resource.");
    if (response.status === 404)
      throw new Error("INTEGRATION_RESOURCE_UNAVAILABLE: The provider no longer exposes this resource.");
    if (!response.ok)
      throw new Error(`INTEGRATION_RESOURCE_DOWNLOAD_FAILED: Provider returned ${response.status}.`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_RESOURCE_BYTES)
      throw new Error("INTEGRATION_RESOURCE_TOO_LARGE: Resource exceeds the 80 MB import limit.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESOURCE_BYTES)
      throw new Error("INTEGRATION_RESOURCE_TOO_LARGE: Resource exceeds the 80 MB import limit.");
    const mimeType = (response.headers.get("content-type") || "application/octet-stream").slice(0, 160);
    assertResourceBytes(bytes, mimeType);
    return { bytes, mimeType };
  } finally {
    clearTimeout(timeout);
  }
}

async function importOfficeProjection(bytes: Buffer, format: string) {
  if (format === "docx" || format === "doc") {
    const opened = await docxLens.open(bytes, "strict-native");
    return { blueprintKey: "document", content: opened.projection };
  }
  if (["xlsx", "xlsm", "xltx", "xltm", "xlam"].includes(format)) {
    const opened = await xlsxLens.open(bytes, "strict-native");
    return { blueprintKey: "sheets", content: xlsxArtifactContent(opened.projection) };
  }
  if (["pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam"].includes(format)) {
    const opened = await pptxLens.open(bytes, "strict-native");
    return { blueprintKey: "presentation", content: pptxArtifactContent(opened.projection) };
  }
  return null;
}

async function discardImportedArtifact(artifactId: string) {
  await convexMutation("spectraArtifacts:permanentlyDelete", { artifactId }).catch(() => undefined);
}

async function uploadResourcePayload(
  artifactId: string,
  bytes: Buffer,
  mimeType: string,
  nativeFormat: string,
) {
  const uploadUrl = await convexMutation<{ workId: string }, string>("payloads:issueUpload", { workId: artifactId });
  const uploaded = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: new Uint8Array(bytes) as unknown as BodyInit,
  });
  const stored = (await uploaded.json().catch(() => null)) as { storageId?: string } | null;
  if (!uploaded.ok || !stored?.storageId) throw new Error("RESOURCE_PAYLOAD_UPLOAD_FAILED");
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const payload = await convexMutation<{ workId: string; hash: string; storageId: string; bytes: number; mediaType: string }, { payloadRef: string }>("payloads:put", {
    workId: artifactId,
    hash: contentHash,
    storageId: stored.storageId,
    bytes: bytes.byteLength,
    mediaType: mimeType,
  });
  await convexMutation("replicas:attachPortablePayload", {
    workId: artifactId,
    payloadRef: payload.payloadRef,
    contentHash,
    nativeFormat,
  });
  return contentHash;
}

export async function importManageBacResource(
  actor: ConnectorActor,
  context: ConnectorContext,
  token: string,
  sourceRecordId: string,
  refresh: boolean,
  requestKey?: string,
) {
  if (actor.schoolRole !== "school_admin" && context.mapping.status !== "verified")
    throw new Error("INTEGRATION_IDENTITY_REQUIRED: Resolve your verified provider identity first.");
  const begun = (await convexMutation("managebac:beginResourceImport", {
    sourceRecordId,
    ...(requestKey ? { requestKey } : {}),
    refresh,
  })) as Record<string, unknown>;
  const status = string(begun.status, 60);
  if (status === "imported" || status === "update_available" || status === "source_unavailable") return begun;
  const importId = string(begun.importId, 200);
  if (!importId) throw new Error("INTEGRATION_RESOURCE_IMPORT_RECEIPT_MISSING");
  const existingArtifactId = string(begun.artifactId, 200);
  let artifactId = existingArtifactId;
  try {
    const capability = context.capabilities.find((item) => object(item.normalization).onDemand === true);
    if (!capability) throw new Error("INTEGRATION_RESOURCE_DOWNLOAD_UNAVAILABLE: The provider has no verified on-demand resource route.");
    const normalized = object(begun.normalized);
    const classId = identifier(begun.providerClassId ?? normalized.classId ?? normalized.class_id, 500);
    const resourceId = identifier(begun.providerRecordId ?? normalized.id, 500);
    if (!classId || !resourceId) throw new Error("INTEGRATION_RESOURCE_IDENTITY_MISSING");
    const downloaded = await providerFetchResourceBytes(context, capability, token, {
      class_id: classId,
      resource_id: resourceId,
    });
    const title = string(begun.title ?? normalized.title ?? normalized.name, 300) || "School resource";
    const nativeFormat = resourceFormat(title, downloaded.mimeType);
    if (!artifactId) {
      const office = OFFICE_FORMATS.has(nativeFormat)
        ? await importOfficeProjection(downloaded.bytes, nativeFormat)
        : null;
      if (office) {
        const created = await convexMutation<{ blueprintKey: string; title: string; summary: string; content: unknown; tags: string[]; source: "manual"; contextSummary: string }, { artifactId: string }>("spectraArtifacts:create", {
          blueprintKey: office.blueprintKey,
          title,
          summary: `Imported from ManageBac · ${nativeFormat}`,
          content: office.content,
          tags: ["imported", "managebac"],
          source: "manual",
          contextSummary: "Imported from a permissioned ManageBac class resource.",
        });
        artifactId = created.artifactId;
      } else {
        const created = await convexMutation<{ title: string; nativeFormat: string; bytes: number; contentHash: string; mimeType: string; tags: string[] }, { artifactId: string }>("spectraArtifacts:createImportedResource", {
          title,
          nativeFormat,
          bytes: downloaded.bytes.byteLength,
          contentHash: createHash("sha256").update(downloaded.bytes).digest("hex"),
          mimeType: downloaded.mimeType,
          tags: ["imported", "managebac"],
        });
        artifactId = created.artifactId;
      }
      await convexMutation("managebac:attachResourceImportArtifact", { importId, artifactId });
    }
    const contentHash = await uploadResourcePayload(artifactId, downloaded.bytes, downloaded.mimeType, nativeFormat);
    return await convexMutation("managebac:completeResourceImport", {
      importId,
      sourceHash: string(begun.sourceHash, 200),
      contentHash,
      bytes: downloaded.bytes.byteLength,
      mimeType: downloaded.mimeType,
      nativeFormat,
    });
  } catch (error) {
    await convexMutation("managebac:failResourceImport", {
      importId,
      errorCode: error instanceof Error ? (error.message.match(/^([A-Z0-9_]+)/)?.[1] ?? "INTEGRATION_RESOURCE_IMPORT_FAILED") : "INTEGRATION_RESOURCE_IMPORT_FAILED",
      errorSummary: error instanceof Error ? error.message.replace(/^[A-Z0-9_]+:\s*/, "").slice(0, 500) : "Resource import failed.",
    }).catch(() => undefined);
    if (artifactId) await discardImportedArtifact(artifactId);
    throw error;
  }
}

type IdentityContext = {
  accountId: string;
  clerkId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  schoolId: string;
  schoolRole: ConnectorActor["schoolRole"];
  membershipId: string;
};

/**
 * The import for someone with no Clerk request in hand: Spectra AI's run acts
 * with the owner's Convex token, so the person is read from Convex and must be
 * the one the run belongs to. The school's connector and key are found the way
 * the School route finds them.
 */
export async function importManageBacResourceAs(input: {
  clerkId: string;
  sourceRecordId: string;
  refresh?: boolean;
  requestKey?: string;
}) {
  const identity = await convexQuery<Record<string, never>, IdentityContext | null>("identity:me", {});
  if (!identity || identity.clerkId !== input.clerkId)
    throw new Error("AUTH_NO_SCHOOL: This account does not have an active school membership.");
  if (!identity.emailVerified)
    throw new Error("AUTH_EMAIL_UNVERIFIED: Verify your school email before using Spectra.");
  const actor: ConnectorActor = {
    clerkId: input.clerkId,
    accountId: identity.accountId,
    email: identity.email,
    name: identity.name,
    schoolId: identity.schoolId,
    schoolRole: identity.schoolRole,
    membershipId: identity.membershipId,
  };
  const overview = (await convexQuery(
    actor.schoolRole === "school_admin" ? "managebac:adminOverview" : "managebac:myOverview",
    {},
  )) as { integration?: { _id?: string } | null };
  const integrationId = overview.integration?._id;
  if (!integrationId)
    throw new Error("INTEGRATION_NOT_CONFIGURED: ManageBac is not connected for this school.");
  const context = await connectorContext(actor, integrationId);
  const secret = await loadSchoolSecretForConnector({
    schoolId: actor.schoolId,
    purpose: "managebac-api-token",
    subject: actor.clerkId,
  });
  if (!secret) throw new Error("INTEGRATION_TOKEN_REQUIRED: The school token is missing.");
  return importManageBacResource(
    actor,
    context,
    secret.value,
    input.sourceRecordId,
    input.refresh === true,
    input.requestKey,
  );
}

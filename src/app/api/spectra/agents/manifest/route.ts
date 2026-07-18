import { auth } from "@clerk/nextjs/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const SIGNATURE_KEY_ID = "spectra-agent-manifest-v1";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const source = value as JsonRecord;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
    .join(",")}}`;
}

function signingKey() {
  const key =
    process.env.SPECTRA_AGENT_MANIFEST_SIGNING_KEY ||
    process.env.SPECTRA_SECRET_BRIDGE_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "AGENT_MANIFEST_SIGNING_CONFIG_MISSING: Configure a strong server-side manifest signing key.",
    );
  return key;
}

function unsignedEnvelope(value: unknown) {
  const envelope = record(value);
  const { integrity: _integrity, ...manifest } = envelope;
  return manifest;
}

function validateManifest(manifest: JsonRecord) {
  if (manifest.format !== "spectra.agent" || manifest.version !== 1)
    throw new Error("AGENT_MANIFEST_FORMAT_INVALID");
  if (!manifest.content || typeof manifest.content !== "object")
    throw new Error("AGENT_MANIFEST_CONTENT_REQUIRED");
  const bytes = Buffer.byteLength(stableJson(manifest), "utf8");
  if (bytes > MAX_MANIFEST_BYTES) throw new Error("AGENT_MANIFEST_TOO_LARGE");
}

function signatureFor(manifest: JsonRecord) {
  return createHmac("sha256", signingKey())
    .update(stableJson(manifest))
    .digest("base64url");
}

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "AGENT_MANIFEST_FAILED";
  const status = message === "AUTH_NOT_SIGNED_IN" ? 401 : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session.userId) throw new Error("AUTH_NOT_SIGNED_IN");
    const payload = record(await request.json());
    const action = payload.action;

    if (action === "sign") {
      const manifest = unsignedEnvelope(payload.manifest);
      validateManifest(manifest);
      const signedBy = createHash("sha256")
        .update(`spectra-agent-exporter:${session.userId}`)
        .digest("base64url")
        .slice(0, 24);
      const signedManifest = {
        ...manifest,
        signedAt: new Date().toISOString(),
        signedBy,
      };
      return NextResponse.json({
        ok: true,
        manifest: {
          ...signedManifest,
          integrity: {
            algorithm: "HMAC-SHA256",
            keyId: SIGNATURE_KEY_ID,
            signature: signatureFor(signedManifest),
          },
        },
      });
    }

    if (action === "verify") {
      const supplied = record(payload.manifest);
      const integrity = record(supplied.integrity);
      const manifest = unsignedEnvelope(supplied);
      validateManifest(manifest);
      if (
        integrity.algorithm !== "HMAC-SHA256" ||
        integrity.keyId !== SIGNATURE_KEY_ID ||
        typeof integrity.signature !== "string"
      )
        throw new Error("AGENT_MANIFEST_SIGNATURE_REQUIRED");
      const expected = Buffer.from(signatureFor(manifest));
      const actual = Buffer.from(integrity.signature);
      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      )
        throw new Error("AGENT_MANIFEST_SIGNATURE_INVALID");
      return NextResponse.json({ ok: true, manifest });
    }

    return NextResponse.json(
      { ok: false, error: "AGENT_MANIFEST_ACTION_INVALID" },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

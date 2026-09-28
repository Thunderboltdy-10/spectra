"use node";

import { createHash, createHmac } from "node:crypto";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/**
 * Each callback route pins maxDuration = 300, so an answer later than that
 * plus a connection margin never comes. Without a limit, a stalled connection
 * held this action until Convex's ten-minute action limit.
 */
export const SCHEDULED_CALLBACK_TIMEOUT_MS = 330_000;

function callbackUrl() {
  const value = process.env.SPECTRA_APP_URL?.trim();
  if (!value) throw new Error("SPECTRA_APP_URL is required for scheduled work.");
  return new URL(value);
}

function derivedKey(baseName: string, purpose: string) {
  const base = process.env[baseName]?.trim();
  if (!base || base.length < 32)
    throw new Error(`${baseName} is required for scheduled work.`);
  return createHmac("sha256", base).update(purpose).digest("base64url");
}

async function postSigned(
  path: string,
  body: Record<string, unknown>,
  key: string,
  headerPrefix: string,
) {
  const rawBody = JSON.stringify(body);
  const timestamp = Date.now();
  const digest = createHash("sha256").update(rawBody).digest("base64url");
  const signature = createHmac("sha256", key)
    .update(`${timestamp}.${digest}`)
    .digest("base64url");
  const url = callbackUrl();
  url.pathname = path;
  url.search = "";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [`x-${headerPrefix}-timestamp`]: String(timestamp),
      [`x-${headerPrefix}-signature`]: signature,
    },
    body: rawBody,
    signal: AbortSignal.timeout(SCHEDULED_CALLBACK_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Scheduled callback failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`,
    );
  }
}

export const dispatchSpectraResume = internalAction({
  args: {
    actorClerkId: v.string(),
    runId: v.id("spectraAiRuns"),
    resultCardId: v.id("spectraResultCards"),
    executionId: v.string(),
    conflictOperationId: v.optional(v.id("spectraOperations")),
    collaborationClientId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    await postSigned(
      "/api/spectra/run",
      { action: "scheduled_resume", ...args },
      derivedKey(
        "SPECTRA_COLLAB_BRIDGE_KEY",
        "spectra-event-callback:v1",
      ),
      "spectra-scheduler",
    );
  },
});

export const dispatchSpectraRun = internalAction({
  args: {
    actorClerkId: v.string(),
    runId: v.id("spectraAiRuns"),
    resultCardId: v.id("spectraResultCards"),
    executionId: v.string(),
    payload: v.any(),
  },
  handler: async (_ctx, args) => {
    await postSigned(
      "/api/spectra/run",
      { action: "scheduled_run", ...args },
      derivedKey(
        "SPECTRA_COLLAB_BRIDGE_KEY",
        "spectra-event-callback:v1",
      ),
      "spectra-scheduler",
    );
  },
});

export const dispatchManageBacSync = internalAction({
  args: {
    integrationId: v.id("schoolIntegrations"),
    scheduledFor: v.number(),
  },
  handler: async (_ctx, args) => {
    await postSigned(
      "/api/spectra/managebac",
      {
        action: "internal_scheduled_work",
        workerId: `convex:${args.integrationId}:${args.scheduledFor}`,
      },
      derivedKey(
        "SPECTRA_CONNECTOR_BRIDGE_KEY",
        "spectra-managebac-worker-http:v1",
      ),
      "spectra-worker",
    );
  },
});

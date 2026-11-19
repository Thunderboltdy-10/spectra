import { internalAction } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/*
 * These actions only sign a request and wait for the app to answer, so they run
 * in Convex's own runtime: it bills a fraction of the Node runtime's memory for
 * every second spent waiting. Signing uses Web Crypto for the same reason.
 */

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

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: string, message: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
}

export function derivedKey(baseName: string, purpose: string) {
  const base = process.env[baseName]?.trim();
  if (!base || base.length < 32)
    throw new Error(`${baseName} is required for scheduled work.`);
  return hmac(base, purpose);
}

export async function postSigned(
  path: string,
  body: Record<string, unknown>,
  key: Promise<string>,
  headerPrefix: string,
) {
  const rawBody = JSON.stringify(body);
  const timestamp = Date.now();
  const digest = base64url(await crypto.subtle.digest("SHA-256", encoder.encode(rawBody)));
  const signature = await hmac(await key, `${timestamp}.${digest}`);
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
  return response;
}

/** The worker's own per-request cap (MAX_SCHEDULED_JOBS in the ManageBac route). */
const WORKER_JOB_CAP = 8;

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
  handler: async (ctx, args) => {
    let failed = false;
    let full = false;
    try {
      const response = await postSigned(
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
      const result = (await response.json().catch(() => null)) as { jobs?: unknown } | null;
      // A worker that stopped at its cap may have left due jobs behind: the next wake-up goes now.
      full = Array.isArray(result?.jobs) && result.jobs.length >= WORKER_JOB_CAP;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // Wake-ups are shared, so each one schedules the next for the work still waiting.
      await ctx.runMutation(internal.managebac.scheduleNextDispatch, { integrationId: args.integrationId, failed, full });
    }
  },
});

/** The morning brief, written as the student a little before they wake. */
export const dispatchDailyBrief = internalAction({
  args: { clerkId: v.string(), timeZone: v.string(), wakeAt: v.number() },
  handler: async (_ctx, args) => {
    await postSigned(
      "/api/spectra/brief",
      { action: "scheduled", ...args },
      derivedKey(
        "SPECTRA_COLLAB_BRIDGE_KEY",
        "spectra-event-callback:v1",
      ),
      "spectra-scheduler",
    );
  },
});

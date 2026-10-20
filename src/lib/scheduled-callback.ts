import "server-only";
import { createClerkClient } from "@clerk/backend";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { withWorkerConvexToken } from "@/lib/convex-worker-context";

/*
 * Work Convex schedules and Next runs: the callback is signed with a key
 * derived from SPECTRA_COLLAB_BRIDGE_KEY (convex/executionScheduler.ts), and
 * the work then acts as its owner with a short-lived session token. Used by
 * scheduled runs and the morning brief.
 */

export function verifyScheduledCallback(request: Request, rawBody: string) {
  const base = process.env.SPECTRA_COLLAB_BRIDGE_KEY?.trim();
  if (!base || base.length < 32) return false;
  const key = createHmac("sha256", base).update("spectra-event-callback:v1").digest("base64url");
  const timestampText = request.headers.get("x-spectra-scheduler-timestamp") ?? "";
  const signature = request.headers.get("x-spectra-scheduler-signature") ?? "";
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 30_000) return false;
  const digest = createHash("sha256").update(rawBody).digest("base64url");
  const expected = createHmac("sha256", key).update(`${timestamp}.${digest}`).digest();
  const received = Buffer.from(signature, "base64url");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/*
 * Scheduled workers act as the owner, with a short-lived session token. The owner's session, remembered per worker process. A worker still asks
 * Clerk for a fresh token every time (Clerk refuses one for a session that
 * ended), so remembering the session only skips the lookup: one round trip
 * less before a resumed or follow-up run starts.
 */
const ownerSessions = new Map<string, string>();

async function ownerToken(clerk: ReturnType<typeof createClerkClient>, actorClerkId: string) {
  const known = ownerSessions.get(actorClerkId);
  if (known) {
    const token = await clerk.sessions.getToken(known, "convex", 1_800).catch(() => null);
    if (token?.jwt) return token.jwt;
    ownerSessions.delete(actorClerkId);
  }
  const sessions = await clerk.sessions.getSessionList({ userId: actorClerkId, status: "active", limit: 10 });
  const session = sessions.data.sort((left, right) => right.lastActiveAt - left.lastActiveAt)[0];
  if (!session) throw new Error("The owner has no active session for this scheduled run.");
  const token = await clerk.sessions.getToken(session.id, "convex", 1_800);
  ownerSessions.set(actorClerkId, session.id);
  if (ownerSessions.size > 500) ownerSessions.delete(ownerSessions.keys().next().value!);
  return token.jwt;
}

export async function asOwner<T>(actorClerkId: string, task: () => Promise<T>) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("Scheduled execution authentication is unavailable.");
  const clerk = createClerkClient({ secretKey });
  return withWorkerConvexToken(await ownerToken(clerk, actorClerkId), task);
}

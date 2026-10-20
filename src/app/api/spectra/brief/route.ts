import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { readTimeZone, zonedDay } from "@/features/spectra/today/daily-brief";
import { writeMorningBrief } from "@/features/spectra/today/brief-server";
import { asOwner, verifyScheduledCallback } from "@/lib/scheduled-callback";

/*
 * Writes the morning brief (docs/product/HOME.md, "The morning brief"). The
 * scheduler calls it, signed, shortly before the student's wake-up time;
 * Home calls it when it opens after that time and no brief is there yet (the
 * student was signed out, or the scheduler is not configured). Either way the
 * brief reaches Home through its live query, so the answer only says whether
 * this call wrote it.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

/** The brief is finished even when the tab that asked for it closes or moves on. */
const writeSignal = () => AbortSignal.timeout(280_000);

const body = (raw: string) => {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export async function POST(request: Request) {
  const raw = await request.text();
  const input = body(raw);
  const timeZone = readTimeZone(input.timeZone);
  try {
    if (input.action === "scheduled") {
      if (!verifyScheduledCallback(request, raw)) return new Response("Forbidden", { status: 403 });
      const clerkId = typeof input.clerkId === "string" ? input.clerkId : "";
      const wakeAt = typeof input.wakeAt === "number" ? input.wakeAt : Date.now();
      if (!clerkId) return NextResponse.json({ ok: false }, { status: 400 });
      const written = await asOwner(clerkId, () =>
        writeMorningBrief({ day: zonedDay(wakeAt, timeZone), timeZone, signal: writeSignal() }),
      );
      return NextResponse.json({ ok: true, written });
    }
    const session = await auth();
    if (!session.userId) return NextResponse.json({ ok: false }, { status: 401 });
    const written = await writeMorningBrief({ day: zonedDay(Date.now(), timeZone), timeZone, signal: writeSignal() });
    return NextResponse.json({ ok: true, written });
  } catch (error) {
    console.warn("[spectra:brief]", error instanceof Error ? `${error.name}: ${error.message}` : error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { asOwner, verifyScheduledCallback } from "@/lib/scheduled-callback";
import { POST as docxPost } from "../../lenses/docx/route";
import { POST as officePost } from "../../lenses/office/route";

/*
 * The server outbox's send (convex/nativeOutbox.ts): Convex asks, signed, for
 * the same materialize or reconcile an open studio would run, and the app
 * runs it as the work's owner. So an AI edit made while the student is
 * elsewhere still reaches Word on their computer, and a Word save still
 * reaches Spectra. Every answer is 200 with either `state` or `error`, so the
 * outbox can tell a refusal it should stop on from a failure worth retrying.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

type Input = { workId: string; action: "materialize" | "reconcile"; route: "docx" | "office"; clerkId: string };

function parse(raw: string): Input | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.workId !== "string" || !value.workId) return null;
    if (value.action !== "materialize" && value.action !== "reconcile") return null;
    if (value.route !== "docx" && value.route !== "office") return null;
    if (typeof value.clerkId !== "string" || !value.clerkId) return null;
    return value as Input;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyScheduledCallback(request, raw)) return new Response("Forbidden", { status: 403 });
  const input = parse(raw);
  if (!input) return NextResponse.json({ error: "OUTBOX_REQUEST_INVALID" });
  try {
    const answer = await asOwner(input.clerkId, async () => {
      const handler = input.route === "docx" ? docxPost : officePost;
      const response = await handler(new Request("https://spectra.internal/outbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: input.action, artifactId: input.workId }),
      }));
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: response.status, body };
    });
    if (answer.status >= 400 || typeof answer.body.error === "string") {
      const code = typeof answer.body.error === "string" ? answer.body.error : `HTTP_${answer.status}`;
      const message = typeof answer.body.message === "string" ? `: ${answer.body.message}` : "";
      return NextResponse.json({ error: `${code}${message}`.slice(0, 300) });
    }
    return NextResponse.json({ state: typeof answer.body.state === "string" ? answer.body.state : "done" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[spectra:native-outbox]", message);
    return NextResponse.json({
      error: /no active session/i.test(message) ? "OWNER_SESSION_UNAVAILABLE" : message.slice(0, 300),
    });
  }
}

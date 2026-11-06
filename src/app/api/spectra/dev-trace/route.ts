import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* Browser timing marks for a local diagnostic run. Off unless the trace folder is set. */
export async function POST(request: Request) {
  const root = process.env.SPECTRA_RUN_TRACE_DIR?.trim();
  if (!root) return new NextResponse(null, { status: 404 });
  const body = await request.text();
  mkdirSync(root, { recursive: true });
  appendFileSync(join(root, "client-marks.jsonl"), `${body.replace(/\n/g, " ")}\n`);
  return new NextResponse(null, { status: 204 });
}

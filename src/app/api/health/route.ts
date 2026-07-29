import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      service: "spectra-web",
      status: "ready",
      protocolVersion: 1,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

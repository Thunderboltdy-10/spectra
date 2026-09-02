import { NextResponse } from "next/server";
import {
  collaborationHealthUrlFromEnv,
  probeConvexDependency,
  probeGatewayDependency,
  webHealthPayload,
} from "@/lib/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const [convex, gateway] = await Promise.all([
    probeConvexDependency(
      process.env.SPECTRA_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL,
    ),
    probeGatewayDependency(collaborationHealthUrlFromEnv(process.env)),
  ]);
  const payload = webHealthPayload({
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
    convex,
    gateway,
  });
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

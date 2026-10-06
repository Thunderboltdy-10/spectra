import { NextRequest, NextResponse } from "next/server";
import {
  publishRuntime,
  readPublishedRuntime,
  unpublishRuntime,
} from "@/features/spectra/code/runtime-publish-server";
import { requireActor } from "@/lib/auth-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const artifactId = request.nextUrl.searchParams.get("artifactId")?.trim();
    if (!artifactId) throw new Error("RUNTIME_ARTIFACT_ID_REQUIRED");
    return NextResponse.json(
      { ok: true, ...(await readPublishedRuntime(artifactId)) },
      { headers: NO_STORE },
    );
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const artifactId =
      typeof body.artifactId === "string" ? body.artifactId.trim() : "";
    if (!artifactId) throw new Error("RUNTIME_ARTIFACT_ID_REQUIRED");
    if (body.action === "unpublish") {
      return NextResponse.json(
        { ok: true, ...(await unpublishRuntime(artifactId)) },
        { headers: NO_STORE },
      );
    }
    if (body.action !== "publish") throw new Error("RUNTIME_ACTION_INVALID");
    const result = await publishRuntime(
      artifactId,
      typeof body.expectedSourceHash === "string" ? body.expectedSourceHash : "",
    );
    return NextResponse.json(result, {
      status: result.ok ? 200 : 422,
      headers: NO_STORE,
    });
  }, request);
}

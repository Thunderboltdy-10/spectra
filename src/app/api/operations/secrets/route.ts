import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { getSchoolSecretStatus, revokeSchoolSecret, storeSchoolSecret } from "@/lib/server-secrets";

function text(value: unknown, maximum = 200) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const schoolId = text(request.nextUrl.searchParams.get("schoolId"));
    const purpose = text(request.nextUrl.searchParams.get("purpose"), 100);
    if (!schoolId || !purpose) return badRequest("School and secret purpose are required.");
    return ok(await getSchoolSecretStatus({ schoolId, purpose, operatorSessionId: text(request.nextUrl.searchParams.get("operatorSessionId")) || undefined }));
  }, request);
}

export async function PUT(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const body = await request.json() as Record<string, unknown>;
    const schoolId = text(body.schoolId);
    const purpose = text(body.purpose, 100);
    const value = typeof body.value === "string" ? body.value : "";
    if (!schoolId || !purpose || !value.trim()) return badRequest("School, purpose, and secret value are required.");
    const result = await storeSchoolSecret({ schoolId, purpose, label: text(body.label, 120), value, operatorSessionId: text(body.operatorSessionId) || undefined, requestId: text(body.requestId, 120) || undefined, keyVersion: typeof body.keyVersion === "number" ? body.keyVersion : undefined });
    return ok(result);
  }, request);
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const body = await request.json() as Record<string, unknown>;
    const schoolId = text(body.schoolId);
    const purpose = text(body.purpose, 100);
    if (!schoolId || !purpose) return badRequest("School and purpose are required.");
    return ok(await revokeSchoolSecret({ schoolId, purpose, operatorSessionId: text(body.operatorSessionId) || undefined, requestId: text(body.requestId, 120) || undefined }));
  }, request);
}

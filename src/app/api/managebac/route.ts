import { requireActor } from "@/lib/auth-server";
import { getManagebacSnapshot, isManagebacConfigured } from "@/lib/managebac";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    await requireActor();

    if (!isManagebacConfigured()) {
      return ok({
        configured: false,
        deferred: true,
        message:
          "ManageBac integration is not configured. Set MANAGEBAC_BASE_URL, MANAGEBAC_API_TOKEN, and MANAGEBAC_STUDENT_ID.",
        timetable: [],
        cas: [],
        announcements: [],
        fetchedAt: new Date().toISOString(),
      });
    }

    const snapshot = await getManagebacSnapshot();
    return ok(snapshot);
  });
}

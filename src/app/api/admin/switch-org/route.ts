import { cookies } from "next/headers";
import { isSuperAdminEmail, requireActor } from "@/lib/auth-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function POST(req: Request) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (!isSuperAdminEmail(actor.email)) {
      return badRequest("Super admin access required", 403);
    }

    const { orgId } = (await req.json()) as { orgId: string };
    if (!orgId) {
      return badRequest("orgId is required");
    }

    const cookieStore = await cookies();
    cookieStore.set("spectra_active_org_id", orgId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      sameSite: "lax",
    });

    return ok({ success: true });
  });
}

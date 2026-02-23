import { requireActor } from "@/lib/auth-server";
import { convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

type Params = {
  params: Promise<{
    notificationId: string;
  }>;
};

export async function PATCH(_request: Request, { params }: Params) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { notificationId } = await params;
    if (!notificationId?.trim()) {
      return badRequest("notificationId is required.");
    }

    await convexMutation<
      {
        actorClerkId: string;
        notificationId: string;
      },
      { ok: boolean }
    >("notifications:markRead", {
      actorClerkId: actor.clerkId,
      notificationId,
    });

    return ok({
      ok: true,
    });
  });
}

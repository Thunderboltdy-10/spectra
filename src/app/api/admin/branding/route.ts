import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

async function uploadToConvexStorage(uploadUrl: string, file: File) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Storage upload failed: ${await response.text()}`);
  }

  const json = (await response.json()) as { storageId?: string };
  if (!json.storageId) {
    throw new Error("Storage upload did not return storageId");
  }
  return json.storageId;
}

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin", 403);
    }

    const settings = await convexQuery("admin:getOrgSettings", {
      actorClerkId: actor.clerkId,
    });
    return ok(settings);
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin", 403);
    }

    const body = (await request.json()) as {
      primaryColor?: string;
      accentColor?: string;
      welcomeMessage?: string;
    };

    await convexMutation("admin:updateOrgBranding", {
      actorClerkId: actor.clerkId,
      primaryColor: body.primaryColor,
      accentColor: body.accentColor,
      welcomeMessage: body.welcomeMessage,
    });

    return ok({ ok: true });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin", 403);
    }

    const formData = await request.formData();
    const file = formData.get("logo");
    if (!(file instanceof File)) {
      return badRequest("logo file is required");
    }
    if (!file.type.startsWith("image/")) {
      return badRequest("logo must be an image");
    }
    if (file.size > 4 * 1024 * 1024) {
      return badRequest("logo must be 4MB or less");
    }

    const uploadUrl = (await convexMutation("admin:createOrgLogoUploadUrl", {
      actorClerkId: actor.clerkId,
    })) as string;

    const storageId = await uploadToConvexStorage(uploadUrl, file);

    await convexMutation("admin:setOrgLogoStorageId", {
      actorClerkId: actor.clerkId,
      storageId,
    });

    return ok({ ok: true });
  });
}

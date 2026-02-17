import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { NextRequest } from "next/server";

type PreferencesPayload = {
  learningStyle?: string;
  preferredDifficulty?: string;
  interests?: string[];
  weakAreas?: string[];
  preferredModes?: string[];
  communicationStyle?: string;
  customGuidance?: string;
};

// GET — load current user's soul preferences
export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const prefs = await convexQuery("personalSoul:getPreferences", {
      actorClerkId: actor.clerkId,
    });
    return ok({ prefs });
  });
}

// POST — save / upsert preferences
export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as PreferencesPayload;

    const result = await convexMutation("personalSoul:savePreferences", {
      actorClerkId: actor.clerkId,
      learningStyle: body.learningStyle,
      preferredDifficulty: body.preferredDifficulty,
      interests: body.interests,
      weakAreas: body.weakAreas,
      preferredModes: body.preferredModes,
      communicationStyle: body.communicationStyle,
      customGuidance: body.customGuidance,
    });

    return ok(result);
  });
}

// PATCH — mark onboarding complete
export async function PATCH() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const result = await convexMutation("personalSoul:completeOnboarding", {
      actorClerkId: actor.clerkId,
    });
    return ok(result);
  });
}

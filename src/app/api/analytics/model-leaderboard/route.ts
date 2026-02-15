import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

type LeaderboardEntry = {
  modelId: string;
  provider: string;
  name: string;
  totalTokens: number;
  usageCount: number;
};

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const models = (await convexQuery("models:getModelLeaderboard", {
      actorClerkId: actor.clerkId,
      limit: 30,
    })) as LeaderboardEntry[];

    return NextResponse.json({ models });
  });
}

import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    const [streak, achievements, catalog] = await Promise.all([
      convexQuery<
        { actorClerkId: string },
        {
          currentStreak: number;
          longestStreak: number;
          totalXp: number;
          lastActiveDate: string | null;
        }
      >("gamification:getUserStreak", {
        actorClerkId: actor.clerkId,
      }),
      convexQuery<
        { actorClerkId: string },
        Array<{
          type: string;
          name: string;
          description: string;
          xpEarned: number;
          earnedAt: number;
        }>
      >("gamification:getUserAchievements", {
        actorClerkId: actor.clerkId,
      }),
      convexQuery<
        { actorClerkId: string },
        Array<{
          type: string;
          name: string;
          description: string;
          xpEarned: number;
          difficulty?: "starter" | "bronze" | "silver" | "gold" | "legend";
        }>
      >("gamification:getAchievementCatalog", {
        actorClerkId: actor.clerkId,
      }),
    ]);

    return ok({
      currentStreak: streak.currentStreak ?? 0,
      longestStreak: streak.longestStreak ?? 0,
      totalXp: streak.totalXp ?? 0,
      lastActiveDate: streak.lastActiveDate ?? null,
      achievements: achievements ?? [],
      catalog: catalog ?? [],
    });
  });
}

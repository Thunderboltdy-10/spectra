import { query } from "./functions";
import { v } from "convex/values";
import { loadIncomingShareInvitations } from "./authority";
import { loadArtifactCommentNotifications } from "./artifactComments";
import { getAuthenticatedActor } from "./identityShared";
import { loadPlannerReminderNotifications } from "./plannerReminders";
import { loadTimetableReminderNotifications } from "./timetableReminders";

export const listMine = query({
  args: {
    unreadOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    const [comments, planner, timetable, invitations] = await Promise.all([
      loadArtifactCommentNotifications(ctx, actor, args),
      loadPlannerReminderNotifications(ctx, actor, args),
      loadTimetableReminderNotifications(ctx, actor, args),
      loadIncomingShareInvitations(ctx, actor),
    ]);
    return { comments, planner, timetable, invitations };
  },
});

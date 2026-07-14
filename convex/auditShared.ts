import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export type AuditMetadata = Record<string, string | number | boolean | null>;

export async function writeAuditEvent(ctx: MutationCtx, event: {
  actorAccountId: Id<"accounts">;
  schoolId?: Id<"schools">;
  operatorSessionId?: Id<"operatorSchoolSessions">;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: AuditMetadata;
  requestId?: string;
  retentionClass?: "operational" | "security" | "legal";
}) {
  return ctx.db.insert("auditEvents", {
    actorAccountId: event.actorAccountId,
    schoolId: event.schoolId,
    operatorSessionId: event.operatorSessionId,
    action: event.action.slice(0, 120),
    targetType: event.targetType.slice(0, 80),
    targetId: event.targetId?.slice(0, 180),
    metadata: event.metadata,
    requestId: event.requestId?.slice(0, 120),
    retentionClass: event.retentionClass ?? "operational",
    createdAt: Date.now(),
  });
}

import type {
  WorkActorIdentity,
  WorkTransactionKind,
  WorkTransactionOrigin,
  WorkYjsOriginSet,
} from "./contracts";
import { WorkTransactionOrigin as Origin } from "./contracts";

const originsByActor = new Map<string, Map<WorkTransactionKind, Origin>>();

function keyFor(actor: WorkActorIdentity) {
  return [actor.kind, actor.accountId ?? "", actor.clientId].join(":");
}

export function workTransactionOrigin(
  actor: WorkActorIdentity,
  kind: WorkTransactionKind,
  operationId?: string,
): WorkTransactionOrigin {
  if (operationId) return new Origin(kind, actor, operationId);
  const actorKey = keyFor(actor);
  let actorOrigins = originsByActor.get(actorKey);
  if (!actorOrigins) {
    actorOrigins = new Map();
    originsByActor.set(actorKey, actorOrigins);
  }
  let origin = actorOrigins.get(kind);
  if (!origin) {
    origin = new Origin(kind, actor);
    actorOrigins.set(kind, origin);
  }
  return origin;
}

export function workYjsOrigins(actor: WorkActorIdentity): WorkYjsOriginSet {
  return {
    localHuman: workTransactionOrigin(actor, "local_human"),
    remoteHuman: workTransactionOrigin(actor, "remote_human"),
    ai: workTransactionOrigin(actor, "ai_semantic_edit"),
    import: workTransactionOrigin(actor, "import"),
    normalization: workTransactionOrigin(actor, "normalization"),
    referenceInsertion: workTransactionOrigin(actor, "reference_insertion"),
    sourceUpdate: workTransactionOrigin(actor, "source_update"),
    migration: workTransactionOrigin(actor, "migration"),
    undo: workTransactionOrigin(actor, "undo"),
    redo: workTransactionOrigin(actor, "redo"),
  };
}

export function clearWorkTransactionOriginsForTests() {
  originsByActor.clear();
}

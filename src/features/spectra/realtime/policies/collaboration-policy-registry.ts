import type { ArtifactTypeKey } from "../../artifacts/types";
import { listWorkDefinitions } from "../../work/registry";
import type { ControlPrimitive } from "../../collaboration/interaction-model";

export type CollaborationPolicy =
  | { mode: "mergeable"; sharedType: "text" | "xml" | "array" | "map" }
  | {
      mode: "interaction_lease";
      leaseScope: "control" | "field" | "object" | "gesture";
      release: "blur" | "close" | "pointer_up" | "commit" | "explicit";
    }
  | {
      mode: "structural_claim";
      targetScope: "region" | "collection" | "work";
      queueable: boolean;
    };

export type CollaborationPolicyTarget = {
  workType: ArtifactTypeKey;
  actionId?: string;
  control?: ControlPrimitive;
  path?: readonly (string | number)[];
  operation?:
    | "edit"
    | "create"
    | "delete"
    | "move"
    | "reorder"
    | "resize"
    | "rotate"
    | "bulk";
};

const MERGEABLE_TEXT: CollaborationPolicy = {
  mode: "mergeable",
  sharedType: "text",
};
const MERGEABLE_XML: CollaborationPolicy = {
  mode: "mergeable",
  sharedType: "xml",
};
const MERGEABLE_MAP: CollaborationPolicy = {
  mode: "mergeable",
  sharedType: "map",
};
const FIELD_LEASE: CollaborationPolicy = {
  mode: "interaction_lease",
  leaseScope: "field",
  release: "commit",
};
const CONTROL_LEASE: CollaborationPolicy = {
  mode: "interaction_lease",
  leaseScope: "control",
  release: "close",
};
const GESTURE_LEASE: CollaborationPolicy = {
  mode: "interaction_lease",
  leaseScope: "gesture",
  release: "pointer_up",
};
const OBJECT_LEASE: CollaborationPolicy = {
  mode: "interaction_lease",
  leaseScope: "object",
  release: "pointer_up",
};
const COLLECTION_CLAIM: CollaborationPolicy = {
  mode: "structural_claim",
  targetScope: "collection",
  queueable: true,
};
const REGION_CLAIM: CollaborationPolicy = {
  mode: "structural_claim",
  targetScope: "region",
  queueable: true,
};
const WORK_CLAIM: CollaborationPolicy = {
  mode: "structural_claim",
  targetScope: "work",
  queueable: true,
};

const gestureControls = new Set<ControlPrimitive>([
  "canvasObject",
  "timelineEvent",
]);
const fieldControls = new Set<ControlPrimitive>(["gridCell", "slider"]);
const controlLeaseControls = new Set<ControlPrimitive>(["dropdown", "toggle"]);
const mergeableControls = new Set<ControlPrimitive>([
  "text",
  "richtext",
  "code",
]);

const structuralPattern =
  /(?:delete|remove|reorder|move|group|ungroup|archive|restore|import|bulk|schema|migrat|publish)/i;
const wholeRewritePattern =
  /(?:rewrite|generate_from_sources|improve_cards|decompose|outline)/i;
const gesturePattern = /(?:drag|resize|rotate|schedule)/i;

function pathPolicy(
  target: CollaborationPolicyTarget,
): CollaborationPolicy | null {
  const path = target.path?.map(String) ?? [];
  const key = path.at(-1) ?? "";
  if (
    /^(?:text|source|prompt|front|back|explanation|description|speakerNotes|instructions)$/i.test(
      key,
    )
  )
    return target.workType === "document" ? MERGEABLE_XML : MERGEABLE_TEXT;
  if (
    /^(?:formula|value|status|priority|dueAt|startAt|endAt|assignee|type|score|rotation|x|y|width|height)$/i.test(
      key,
    )
  )
    return FIELD_LEASE;
  if (
    target.operation === "delete" ||
    target.operation === "move" ||
    target.operation === "reorder"
  )
    return COLLECTION_CLAIM;
  if (target.operation === "bulk") return WORK_CLAIM;
  if (target.operation === "resize" || target.operation === "rotate")
    return target.workType === "whiteboard" ||
      target.workType === "presentation"
      ? OBJECT_LEASE
      : GESTURE_LEASE;
  return null;
}

export class CollaborationPolicyRegistry {
  private readonly explicit = new Map<string, CollaborationPolicy>();

  register(
    workType: ArtifactTypeKey,
    semanticId: string,
    policy: CollaborationPolicy,
  ) {
    const key = `${workType}:${semanticId}`;
    if (this.explicit.has(key))
      throw new Error(`COLLABORATION_POLICY_DUPLICATE: ${key}`);
    this.explicit.set(key, policy);
  }

  resolve(target: CollaborationPolicyTarget): CollaborationPolicy {
    const semanticId =
      target.actionId ??
      (target.control ? `control:${target.control}` : undefined);
    if (semanticId) {
      const explicit = this.explicit.get(`${target.workType}:${semanticId}`);
      if (explicit) return explicit;
    }
    const fromPath = pathPolicy(target);
    if (fromPath) return fromPath;
    if (target.control) {
      if (mergeableControls.has(target.control))
        return target.control === "richtext" ? MERGEABLE_XML : MERGEABLE_TEXT;
      if (gestureControls.has(target.control)) return OBJECT_LEASE;
      if (fieldControls.has(target.control)) return FIELD_LEASE;
      if (controlLeaseControls.has(target.control)) return CONTROL_LEASE;
      if (target.control === "listItem") return COLLECTION_CLAIM;
    }
    const action = target.actionId ?? "";
    if (structuralPattern.test(action)) return COLLECTION_CLAIM;
    if (wholeRewritePattern.test(action)) return REGION_CLAIM;
    if (gesturePattern.test(action)) return GESTURE_LEASE;
    return MERGEABLE_MAP;
  }

  hasExplicit(workType: ArtifactTypeKey, semanticId: string) {
    return this.explicit.has(`${workType}:${semanticId}`);
  }

  assertEveryRegisteredActionResolves() {
    const missing: string[] = [];
    for (const definition of listWorkDefinitions())
      for (const actionId of definition.actions) {
        const policy = this.resolve({ workType: definition.key, actionId });
        if (!policy) missing.push(`${definition.key}:${actionId}`);
      }
    if (missing.length)
      throw new Error(`COLLABORATION_POLICY_MISSING: ${missing.join(", ")}`);
  }
}

export const collaborationPolicyRegistry = new CollaborationPolicyRegistry();

// High-risk whole-work operations are explicit so future heuristic changes can
// never quietly weaken them.
for (const workType of listWorkDefinitions().map(
  (definition) => definition.key,
)) {
  collaborationPolicyRegistry.register(workType, "migration", WORK_CLAIM);
  collaborationPolicyRegistry.register(workType, "bulk_replace", WORK_CLAIM);
}

collaborationPolicyRegistry.register(
  "document",
  "rewrite_selection",
  REGION_CLAIM,
);
collaborationPolicyRegistry.register("code", "control:code", MERGEABLE_TEXT);
collaborationPolicyRegistry.register("sheets", "control:gridCell", FIELD_LEASE);
collaborationPolicyRegistry.register(
  "presentation",
  "control:canvasObject",
  OBJECT_LEASE,
);
// Adding or regenerating slides is structural, so it queues a collection claim
// rather than merging into whatever slide edits a collaborator is making.
collaborationPolicyRegistry.register(
  "presentation",
  "build_bibliography",
  COLLECTION_CLAIM,
);
collaborationPolicyRegistry.register(
  "whiteboard",
  "control:canvasObject",
  OBJECT_LEASE,
);
collaborationPolicyRegistry.register("planner_task", "schedule", GESTURE_LEASE);

collaborationPolicyRegistry.assertEveryRegisteredActionResolves();

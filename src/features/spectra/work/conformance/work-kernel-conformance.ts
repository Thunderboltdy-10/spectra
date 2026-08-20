import * as Y from "yjs";
import { WORK_ANCHOR_ADAPTERS } from "../../anchors/registry";
import type { SemanticAnchor } from "../../anchors/semantic-anchor";
import { getBlueprint } from "../../artifacts/blueprint-catalog";
import { WORK_TYPE_KEYS, type ArtifactTypeKey } from "../../artifacts/types";
import { INTERNAL_LEGACY_TERMS } from "../../copy/user-facing";
import { collaborationPolicyRegistry } from "../../realtime/policies/collaboration-policy-registry";
import { getWorkReferenceContract } from "../../references/registry";
import { getWorkSourceContract } from "../../sources/work-source-contracts";
import {
  isNativeWorkYjsType,
  workYjsAdapter,
} from "../models/yjs/registry";
import {
  availableWorkModes,
  getWorkDefinition,
  workCapabilities,
} from "../registry/registry";
import type { WorkCapability, WorkDefinition } from "../registry/types";

/**
 * The Work Kernel conformance suite (§11.0).
 *
 * Every work type runs through the same obligations before it is considered
 * finished. The point is not to make the types look alike — a board and a quiz
 * should not — but to make sure none of them quietly skips a shared product
 * promise: that it can be shared read-only, referenced, cited, commented on,
 * navigated by keyboard, and edited by a person and by AI at the same time.
 *
 * Each obligation reports pass or fail with a reason. A failing type is a
 * defect in that type, not in the suite.
 */

export const WORK_KERNEL_OBLIGATIONS = [
  "full_editor_surface",
  "side_panel_renderer",
  "tiled_renderer",
  "read_only_renderer",
  "user_facing_modes",
  "sharing_mapping",
  "internal_capabilities",
  "native_yjs_model",
  "transaction_origins",
  "semantic_anchors",
  "reference_surfaces",
  "citations_and_sources",
  "comments_and_history",
  "responsive_contract",
  "ai_semantic_actions",
  "import_export",
  "capability_truth",
  "accessibility_contract",
  "terminology",
  "empty_state",
] as const;

export type WorkKernelObligation = (typeof WORK_KERNEL_OBLIGATIONS)[number];

export type WorkKernelCheck = {
  obligation: WorkKernelObligation;
  passed: boolean;
  detail: string;
};

export type WorkKernelReport = {
  workType: ArtifactTypeKey;
  passed: boolean;
  checks: readonly WorkKernelCheck[];
  failures: readonly WorkKernelCheck[];
};

function check(
  obligation: WorkKernelObligation,
  passed: boolean,
  detail: string,
): WorkKernelCheck {
  return { obligation, passed, detail };
}

/** Reads a surface renderer key, treating an empty string as absent. */
function surface(definition: WorkDefinition, key: keyof WorkDefinition["surfaces"]) {
  const value = definition.surfaces[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function hasAll(
  granted: readonly WorkCapability[],
  required: readonly WorkCapability[],
) {
  return required.every((capability) => granted.includes(capability));
}

/** Words that read as internal machinery rather than as a person's vocabulary. */
const JARGON = /(artifact|timetable|schema|payload|entity|record set|crud)/i;

function checkSurfaces(definition: WorkDefinition): WorkKernelCheck[] {
  return [
    check(
      "full_editor_surface",
      Boolean(surface(definition, "full")),
      `full renderer: ${definition.surfaces.full ?? "missing"}`,
    ),
    check(
      "side_panel_renderer",
      Boolean(surface(definition, "panel")) && definition.responsive.supportsPanel,
      `panel renderer: ${definition.surfaces.panel ?? "missing"}`,
    ),
    check(
      "tiled_renderer",
      Boolean(surface(definition, "tile")) && definition.responsive.supportsTile,
      `tile renderer: ${definition.surfaces.tile ?? "missing"}`,
    ),
    check(
      "read_only_renderer",
      Boolean(surface(definition, "read_only")) &&
        Boolean(surface(definition, "public")),
      `read-only renderer: ${definition.surfaces.read_only ?? "missing"}`,
    ),
  ];
}

function checkModes(definition: WorkDefinition): WorkKernelCheck {
  const modes = definition.modes;
  const primaries = modes.filter((mode) => mode.primary);
  const ids = new Set(modes.map((mode) => mode.id));
  const problems: string[] = [];
  if (!modes.length) problems.push("no modes declared");
  if (modes.length > 6) problems.push(`${modes.length} modes is not simple`);
  if (primaries.length !== 1)
    problems.push(`${primaries.length} primary modes, expected exactly one`);
  if (ids.size !== modes.length) problems.push("duplicate mode ids");
  for (const mode of modes) {
    if (JARGON.test(mode.label)) problems.push(`mode "${mode.label}" uses jargon`);
    if (mode.label !== mode.label.trim() || !mode.label)
      problems.push("mode label is blank or padded");
  }
  return check(
    "user_facing_modes",
    problems.length === 0,
    problems.length
      ? problems.join("; ")
      : `${modes.length} modes, primary "${primaries[0]?.label}"`,
  );
}

/**
 * Sharing grants exactly Read-only or Edit. Read-only must never carry an
 * editing capability, Edit must never lose one Read-only has, and at least one
 * mode has to remain reachable for a read-only viewer — otherwise sharing a
 * link produces a surface nobody can use.
 */
function checkSharing(definition: WorkDefinition): WorkKernelCheck {
  const readOnly = workCapabilities(definition.key, "read_only");
  const edit = workCapabilities(definition.key, "edit");
  const problems: string[] = [];
  if (!readOnly.includes("view")) problems.push("read-only cannot view");
  if (readOnly.includes("edit") || readOnly.includes("ai_mutate"))
    problems.push("read-only carries an editing capability");
  if (!hasAll(edit, readOnly))
    problems.push("edit does not include every read-only capability");
  if (!hasAll(edit, ["edit", "ai_mutate"]))
    problems.push("edit cannot edit or accept AI edits");
  if (!availableWorkModes(definition.key, "read_only").length)
    problems.push("no mode is reachable read-only");
  return check(
    "sharing_mapping",
    problems.length === 0,
    problems.length
      ? problems.join("; ")
      : `read-only: ${readOnly.join(", ")}`,
  );
}

/**
 * Internal capabilities have to match what the type can actually do. A quiz
 * that cannot be attempted, or a project that cannot be run, is a capability
 * claim the interface would then have to walk back.
 */
function checkInternalCapabilities(definition: WorkDefinition): WorkKernelCheck {
  const readOnly = workCapabilities(definition.key, "read_only");
  const problems: string[] = [];
  const { assess, execute, present, embedInteractively } = definition.capabilities;
  if (assess && !hasAll(readOnly, ["attempt", "submit"]))
    problems.push("assessable type cannot be attempted read-only");
  if (!assess && readOnly.includes("attempt"))
    problems.push("non-assessable type grants attempt");
  if (execute !== readOnly.includes("execute"))
    problems.push("execute capability disagrees with runtime support");
  if (present !== readOnly.includes("present"))
    problems.push("present capability disagrees with presentation support");
  if (!readOnly.includes("interact"))
    problems.push("a viewer cannot select, filter or comment");
  // An interactive embed has to have something a viewer can do inside it, so
  // the claim is only true if a mode is reachable without Edit.
  if (
    embedInteractively &&
    !availableWorkModes(definition.key, "read_only").length
  )
    problems.push("claims interactive embedding with no read-only mode");
  for (const mode of definition.modes) {
    const reachable =
      workCapabilities(definition.key, "edit").includes(mode.requiredCapability);
    if (!reachable)
      problems.push(`mode "${mode.label}" needs a capability nobody can hold`);
  }
  return check(
    "internal_capabilities",
    problems.length === 0,
    problems.length
      ? problems.join("; ")
      : `present=${present} execute=${execute} assess=${assess}`,
  );
}

/**
 * The native model has to round-trip through Yjs: create a document from the
 * type's own default content, project it back, and derive regions. A type that
 * only survives as JSON has not moved onto the shared realtime kernel.
 */
function checkNativeModel(definition: WorkDefinition): WorkKernelCheck[] {
  const adapter = isNativeWorkYjsType(definition.key)
    ? workYjsAdapter(definition.key)
    : null;
  if (!adapter)
    return [
      check("native_yjs_model", false, "no native Yjs adapter registered"),
      check("transaction_origins", false, "no native Yjs adapter registered"),
    ];
  const blueprint = getBlueprint(definition.key);
  if (!blueprint)
    return [
      check("native_yjs_model", false, "no default content to model"),
      check("transaction_origins", false, "no default content to model"),
    ];

  const problems: string[] = [];
  let doc: Y.Doc | null = null;
  try {
    doc = adapter.createDocument(blueprint.defaultContent);
    const projected = adapter.project(doc);
    if (projected === null || projected === undefined)
      problems.push("projection returned nothing");
    const validity = adapter.validate(doc);
    if (!validity.valid)
      problems.push(`document invalid: ${validity.issues.join(", ")}`);
    if (adapter.workType !== definition.key)
      problems.push("adapter is registered under the wrong type");
    if (adapter.modelVersion < 1) problems.push("model version is not set");
    adapter.deriveSemanticRegions(doc);
  } catch (error) {
    problems.push(
      `model threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const originProblems: string[] = [];
  try {
    const origins = adapter.origins({ clientId: "conformance", kind: "human" });
    const distinct = new Set<unknown>([
      origins.localHuman,
      origins.remoteHuman,
      origins.ai,
      origins.import,
      origins.normalization,
      origins.migration,
    ]);
    if (distinct.size !== 6)
      originProblems.push("origins are not distinct objects");
    if (origins.localHuman.kind !== "local_human")
      originProblems.push("local origin is mislabelled");
    if (origins.ai.kind !== "ai_semantic_edit")
      originProblems.push("AI origin is mislabelled");
    if (doc) {
      // Undo has to be actor-aware: a manager built for one human must not
      // adopt AI or remote transactions as that person's to undo.
      const manager = adapter.createUndoManager(doc, {
        clientId: "conformance",
        kind: "human",
      });
      const tracked = manager.trackedOrigins;
      if (tracked.has(origins.ai) || tracked.has(origins.remoteHuman))
        originProblems.push("undo tracks AI or remote origins");
      manager.destroy();
    }
  } catch (error) {
    originProblems.push(
      `origins threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  doc?.destroy();

  return [
    check(
      "native_yjs_model",
      problems.length === 0,
      problems.length
        ? problems.join("; ")
        : `native model v${adapter.modelVersion}`,
    ),
    check(
      "transaction_origins",
      originProblems.length === 0,
      originProblems.length ? originProblems.join("; ") : "actor-aware origins",
    ),
  ];
}

/**
 * Anchors must survive the round trip that every semantic consumer depends on:
 * a whole-work target can be created, still exists against real content, and
 * describes itself in words a person would recognise.
 */
function checkAnchors(definition: WorkDefinition): WorkKernelCheck {
  const adapter = WORK_ANCHOR_ADAPTERS[definition.key];
  const blueprint = getBlueprint(definition.key);
  const problems: string[] = [];
  if (!adapter) problems.push("no anchor adapter registered");
  if (!blueprint) problems.push("no content to anchor against");
  if (adapter && blueprint) {
    const content = blueprint.defaultContent;
    const root = adapter.createFromSelection("work-conformance", {}, content);
    if (!root) problems.push("whole-work anchor cannot be created");
    if (root) {
      if (!adapter.exists(root, content))
        problems.push("whole-work anchor does not resolve");
      const described = adapter.describe(root, content);
      if (!described.trim()) problems.push("anchor has no readable description");
      if (JARGON.test(described))
        problems.push(`anchor description uses jargon: "${described}"`);
      if (adapter.migrate(root, content).workType !== definition.key)
        problems.push("anchor migration loses the work type");
      if (typeof adapter.reveal !== "function")
        problems.push("anchor cannot be revealed");
    }
    const regions = definition.model.deriveSemanticRegions(content);
    const region = regions[0];
    if (region) {
      const anchor = definition.anchors.fromRegion(
        "work-conformance",
        region,
      ) as SemanticAnchor;
      if (!adapter.exists(anchor, content))
        problems.push("region anchor does not resolve against its own content");
      if (anchor.schemaVersion !== definition.model.schemaVersion)
        problems.push("region anchor carries the wrong schema version");
    }
  }
  return check(
    "semantic_anchors",
    problems.length === 0,
    problems.length ? problems.join("; ") : "anchors create, resolve and reveal",
  );
}

function checkReferences(definition: WorkDefinition): WorkKernelCheck {
  const contract = getWorkReferenceContract(definition.key);
  const problems: string[] = [];
  if (!definition.references.collapsed) problems.push("no collapsed renderer");
  if (!definition.references.expanded) problems.push("no expanded renderer");
  if (definition.references.collapsed === definition.references.expanded)
    problems.push("collapsed and expanded renderers are the same");
  if (!contract) problems.push("no reference contract");
  if (contract) {
    if (!contract.targets.length) problems.push("no reference targets");
    for (const target of contract.targets) {
      if (!target.views.length)
        problems.push(`target "${target.kind}" has no views`);
      if (!target.label.trim() || JARGON.test(target.label))
        problems.push(`target "${target.kind}" has no usable label`);
    }
    if (!contract.insertion) problems.push("no native insertion form");
  }
  return check(
    "reference_surfaces",
    problems.length === 0,
    problems.length
      ? problems.join("; ")
      : `${contract.targets.length} targets, inserted as ${contract.insertion}`,
  );
}

function checkSources(definition: WorkDefinition): WorkKernelCheck {
  const contract = getWorkSourceContract(definition.key);
  const problems: string[] = [];
  if (!definition.sources.supported) problems.push("sources unsupported");
  if (!definition.sources.citationKinds.length)
    problems.push("no citation kinds");
  if (!contract) problems.push("no source contract");
  if (contract) {
    if (!contract.placements.length)
      problems.push("citations have nowhere to live");
    if (!contract.sourceViews.length) problems.push("sources cannot be read");
    if (!contract.exportTargets.length)
      problems.push("sources do not survive export");
    if (!contract.preservesOnConversion)
      problems.push("sources are lost on conversion");
  }
  return check(
    "citations_and_sources",
    problems.length === 0,
    problems.length
      ? problems.join("; ")
      : `${contract.placements.length} citation placements`,
  );
}

function checkCommentsAndHistory(definition: WorkDefinition): WorkKernelCheck {
  const problems: string[] = [];
  if (!definition.comments.anchorKinds.length)
    problems.push("comments have no anchor kinds");
  if (!definition.comments.supportsGeneral)
    problems.push("no general comment target");
  if (!definition.history.snapshot) problems.push("no history strategy");
  if (!definition.history.partialRestore)
    problems.push("history cannot restore part of the work");
  return check(
    "comments_and_history",
    problems.length === 0,
    problems.length
      ? problems.join("; ")
      : `${definition.comments.anchorKinds.join("/")} comments, ${definition.history.snapshot} history`,
  );
}

function checkResponsive(definition: WorkDefinition): WorkKernelCheck {
  const { responsive } = definition;
  const problems: string[] = [];
  if (responsive.minInlineSize < 320)
    problems.push(`minimum ${responsive.minInlineSize}px is below 320px`);
  if (responsive.preferredInlineSize <= responsive.minInlineSize)
    problems.push("preferred width is not larger than the minimum");
  for (const priority of ["mode", "primary", "overflow"])
    if (!responsive.toolbarPriorities.includes(priority))
      problems.push(`toolbar has no "${priority}" priority`);
  if (!responsive.supportsCompact) problems.push("no compact rendering");
  return check(
    "responsive_contract",
    problems.length === 0,
    problems.length
      ? problems.join("; ")
      : `${responsive.minInlineSize}–${responsive.preferredInlineSize}px`,
  );
}

/**
 * Every declared action has to resolve to a concurrency policy, and the
 * destructive ones must not resolve to plain merging — that is the difference
 * between two people working at once and one of them losing a paragraph.
 */
function checkActions(definition: WorkDefinition): WorkKernelCheck {
  const problems: string[] = [];
  if (!definition.actions.length) problems.push("no semantic actions");
  const inspects = definition.actions.filter((action) =>
    /(?:^|\.)(?:inspect|read|list|check)(?:\.|$)/.test(action),
  );
  const mutates = definition.actions.filter(
    (action) => !/(?:^|\.)(?:inspect|read|list|check|validate)(?:\.|$)/.test(action),
  );
  if (!inspects.length) problems.push("AI cannot inspect this type");
  if (!mutates.length) problems.push("AI cannot change this type");
  for (const action of definition.actions) {
    const policy = collaborationPolicyRegistry.resolve({
      workType: definition.key,
      actionId: action,
    });
    if (!policy) {
      problems.push(`action "${action}" has no concurrency policy`);
      continue;
    }
    const structural = /(?:delete|remove|reorder|move|import|bulk|publish)/i.test(
      action,
    );
    if (structural && policy.mode === "mergeable")
      problems.push(`structural action "${action}" merges instead of claiming`);
  }
  if (!definition.commands.length) problems.push("no commands");
  return check(
    "ai_semantic_actions",
    problems.length === 0,
    problems.length
      ? problems.join("; ")
      : `${definition.actions.length} actions, all policy-resolved`,
  );
}

function checkInterop(definition: WorkDefinition): WorkKernelCheck {
  const { imports, exports, quarantinesExecutableContent } =
    definition.interoperability;
  const problems: string[] = [];
  if (!imports.length) problems.push("nothing can be imported");
  if (!exports.length) problems.push("nothing can be exported");
  // A type that can carry executable content must quarantine it on import,
  // whatever its own runtime policy is.
  const carriesCode =
    definition.capabilities.execute ||
    definition.key === "sheets" ||
    definition.key === "presentation";
  if (carriesCode && !quarantinesExecutableContent)
    problems.push("imports executable content without quarantining it");
  return check(
    "import_export",
    problems.length === 0,
    problems.length
      ? problems.join("; ")
      : `${imports.length} in, ${exports.length} out`,
  );
}

/**
 * Capability truth: validation has to reject content this type cannot hold.
 * A model that accepts anything cannot report a real failure, so its surface
 * would show a broken state as an ordinary empty one.
 */
function checkCapabilityTruth(definition: WorkDefinition): WorkKernelCheck {
  const problems: string[] = [];
  const blueprint = getBlueprint(definition.key);
  if (!blueprint) problems.push("no default content");
  if (blueprint && !definition.model.validate(blueprint.defaultContent).success)
    problems.push("its own default content does not validate");
  for (const nonsense of [null, "text", 42, []])
    if (definition.model.validate(nonsense).success)
      problems.push(`validation accepts ${JSON.stringify(nonsense)}`);
  if (definition.model.schemaVersion < 1) problems.push("no schema version");
  return check(
    "capability_truth",
    problems.length === 0,
    problems.length ? problems.join("; ") : "validation accepts only real content",
  );
}

function checkAccessibility(definition: WorkDefinition): WorkKernelCheck {
  const { primaryModel, keyboardOperations } = definition.accessibility;
  const problems: string[] = [];
  if (!primaryModel.trim()) problems.push("no keyboard navigation model");
  if (keyboardOperations.length < 3)
    problems.push("fewer than three core keyboard operations");
  for (const operation of keyboardOperations)
    if (!/^[a-z]/.test(operation))
      problems.push(`keyboard operation "${operation}" is not phrased as an action`);
  return check(
    "accessibility_contract",
    problems.length === 0,
    problems.length ? problems.join("; ") : primaryModel,
  );
}

function checkTerminology(definition: WorkDefinition): WorkKernelCheck {
  const problems: string[] = [];
  const userFacing = [
    definition.userFacingName,
    definition.description,
    definition.emptyState.headline,
    definition.emptyState.body,
    definition.emptyState.action,
    ...definition.modes.map((mode) => mode.label),
  ];
  for (const term of INTERNAL_LEGACY_TERMS)
    for (const text of userFacing)
      if (new RegExp(`\\b${term}s?\\b`, "i").test(text))
        problems.push(`"${text}" uses the internal term "${term}"`);
  if (!definition.userFacingName.trim()) problems.push("no user-facing name");
  if (definition.userFacingName === definition.internalName)
    problems.push("user-facing name is the internal key");
  return check(
    "terminology",
    problems.length === 0,
    problems.length ? problems.join("; ") : definition.userFacingName,
  );
}

/**
 * An empty surface is an invitation, so it names one thing to do next and says
 * it in the interface's voice — no apology, no "nothing to see here".
 */
function checkEmptyState(definition: WorkDefinition): WorkKernelCheck {
  const { headline, body, action } = definition.emptyState;
  const problems: string[] = [];
  if (!headline.trim()) problems.push("no headline");
  if (!body.trim()) problems.push("no guidance");
  if (!action.trim()) problems.push("no next action");
  if (headline.endsWith(".")) problems.push("headline is punctuated as a sentence");
  if (!body.endsWith(".")) problems.push("guidance is not a sentence");
  if (action.split(/\s+/).length > 4) problems.push("action is not a short verb phrase");
  if (/sorry|unfortunately|oops/i.test(`${headline} ${body}`))
    problems.push("empty state apologises");
  if (headline.length > 48) problems.push("headline is too long to scan");
  return check(
    "empty_state",
    problems.length === 0,
    problems.length ? problems.join("; ") : `${headline} — ${action}`,
  );
}

export function runWorkKernelConformance(
  workType: ArtifactTypeKey,
): WorkKernelReport {
  const definition = getWorkDefinition(workType);
  const checks: WorkKernelCheck[] = [
    ...checkSurfaces(definition),
    checkModes(definition),
    checkSharing(definition),
    checkInternalCapabilities(definition),
    ...checkNativeModel(definition),
    checkAnchors(definition),
    checkReferences(definition),
    checkSources(definition),
    checkCommentsAndHistory(definition),
    checkResponsive(definition),
    checkActions(definition),
    checkInterop(definition),
    checkCapabilityTruth(definition),
    checkAccessibility(definition),
    checkTerminology(definition),
    checkEmptyState(definition),
  ];
  const failures = checks.filter((entry) => !entry.passed);
  return { workType, passed: failures.length === 0, checks, failures };
}

export function runWorkKernelConformanceSuite() {
  const reports = WORK_TYPE_KEYS.map((type) => runWorkKernelConformance(type));
  return {
    passed: reports.every((report) => report.passed),
    reports,
    failures: reports.flatMap((report) =>
      report.failures.map((failure) => ({
        workType: report.workType,
        ...failure,
      })),
    ),
  };
}

/** One line per failure, for a check script or a CI log. */
export function formatWorkKernelFailures(
  suite: ReturnType<typeof runWorkKernelConformanceSuite>,
) {
  return suite.failures.map(
    (failure) =>
      `${failure.workType} · ${failure.obligation}: ${failure.detail}`,
  );
}

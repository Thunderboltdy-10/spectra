import { buildContext } from "./gather";
import { provisionalSingleCreation } from "./intake";
import { remapDocumentSectionRewriteChanges } from "@/features/spectra/ai/document-content-patch";
import {
  promoteMatchingUpdateToCreate,
  promptLooksLikeFocusedStructuralEdit,
  promptLooksLikeFreshCreate,
} from "@/features/spectra/operations/intent-alignment";
import { formatPlanApplicationPublicError } from "@/features/spectra/operations/plan-diagnostics";
import {
  SPECTRA_BLUEPRINT_KEYS,
  parseModelOperation,
  parseSpectraPlan,
} from "@/features/spectra/operations/schema";
import type {
  ModelOperation,
  SpectraPlan,
} from "@/features/spectra/operations/schema";
import { validatePlanAgainstIntent } from "@/features/spectra/operations/validate-plan";
import type { OwnedOperationReferences } from "@/features/spectra/operations/validate-plan";

export function ownedReferences(
  context: Awaited<ReturnType<typeof buildContext>>,
): OwnedOperationReferences {
  const artifactIds = new Set<string>();
  const artifactBlueprints = new Map<string, string>();
  const workspaceIds = new Set<string>();
  const placementNodes = new Map<
    string,
    { artifactId?: string; workspaceId: string }
  >();
  for (const workspace of context.workspaces)
    if (typeof workspace.id === "string") workspaceIds.add(workspace.id);
  for (const artifact of context.artifacts) {
    if (typeof artifact.id === "string") {
      artifactIds.add(artifact.id);
      if (typeof artifact.blueprintKey === "string")
        artifactBlueprints.set(artifact.id, artifact.blueprintKey);
    }
    for (const placement of artifact.placements) {
      if (typeof placement.workspaceId === "string")
        workspaceIds.add(placement.workspaceId);
      if (
        typeof placement.nodeId === "string" &&
        typeof placement.workspaceId === "string"
      )
        placementNodes.set(placement.nodeId, {
          artifactId: typeof artifact.id === "string" ? artifact.id : undefined,
          workspaceId: placement.workspaceId,
        });
    }
  }
  if (
    context.focusedArtifact &&
    typeof context.focusedArtifact.id === "string"
  ) {
    artifactIds.add(context.focusedArtifact.id);
    if (typeof context.focusedArtifact.blueprintKey === "string")
      artifactBlueprints.set(
        context.focusedArtifact.id,
        context.focusedArtifact.blueprintKey,
      );
  }
  if (
    context.currentWorkspace?.id &&
    typeof context.currentWorkspace.id === "string"
  )
    workspaceIds.add(context.currentWorkspace.id);
  for (const item of context.currentWorkspace?.items ?? []) {
    if (typeof item.id === "string" && typeof item.workspaceId === "string")
      placementNodes.set(item.id, {
        artifactId:
          item.kind === "work" && typeof item.sourceId === "string"
            ? item.sourceId
            : undefined,
        workspaceId: item.workspaceId,
      });
  }
  return {
    artifactIds,
    artifactBlueprints,
    workspaceIds,
    placementNodes,
    threadIds: new Set([
      ...context.threads.flatMap((thread) =>
        typeof thread.id === "string" ? [thread.id] : [],
      ),
      ...(context.currentThreadId ? [context.currentThreadId] : []),
    ]),
  };
}

export function normalizedReference(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function resolveNamedReference(
  value: string | null | undefined,
  candidates: Array<{ id: unknown; title: unknown }>,
) {
  if (!value) return value;
  const valid = candidates.flatMap((candidate) =>
    typeof candidate.id === "string" && typeof candidate.title === "string"
      ? [{ id: candidate.id, title: candidate.title }]
      : [],
  );
  if (valid.some((candidate) => candidate.id === value)) return value;
  const needle = normalizedReference(value);
  if (!needle) return value;
  const exact = valid.filter(
    (candidate) => normalizedReference(candidate.title) === needle,
  );
  if (exact.length === 1) return exact[0]!.id;
  if (needle.length < 5) return value;
  const contained = valid.filter((candidate) => {
    const title = normalizedReference(candidate.title);
    return title.includes(needle) || needle.includes(title);
  });
  return contained.length === 1 ? contained[0]!.id : value;
}

export function resolvePlanReferences(
  plan: SpectraPlan,
  context: Awaited<ReturnType<typeof buildContext>>,
) {
  const next = structuredClone(plan) as SpectraPlan;
  const artifactCandidates = context.artifacts.map((artifact) => ({
    id: artifact.id,
    title: artifact.title,
  }));
  const workspaceCandidates = context.workspaces.map((workspace) => ({
    id: workspace.id,
    title: workspace.title,
  }));
  const threadCandidates = context.threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
  }));
  const resolveArtifact = (value: string | null | undefined) =>
    resolveNamedReference(value, artifactCandidates);
  const resolveWorkspace = (value: string | null | undefined) =>
    resolveNamedReference(value, workspaceCandidates);
  const resolveThread = (value: string | null | undefined) =>
    resolveNamedReference(value, threadCandidates);
  next.intent.targetArtifactId =
    resolveArtifact(next.intent.targetArtifactId) ?? null;
  next.intent.targetWorkspaceId =
    resolveWorkspace(next.intent.targetWorkspaceId) ?? null;
  for (const operation of next.operations) {
    if (operation.type === "artifact.create") {
      operation.input.workspaceId =
        resolveWorkspace(operation.input.workspaceId) ?? null;
      if (operation.input.blueprintKey === "planner_task") {
        operation.input.content.linkedArtifactIds = (
          operation.input.content.linkedArtifactIds ?? []
        ).map((id) => resolveArtifact(id) ?? id);
        operation.input.content.linkedThreadIds = (
          operation.input.content.linkedThreadIds ?? []
        ).map((id) => resolveThread(id) ?? id);
      }
    } else if (operation.type === "artifact.update") {
      operation.input.artifactId =
        resolveArtifact(operation.input.artifactId) ??
        operation.input.artifactId;
    } else if (operation.type === "workspace.update") {
      operation.input.workspaceId =
        resolveWorkspace(operation.input.workspaceId) ??
        operation.input.workspaceId;
    } else if (operation.type === "workspaceItem.add") {
      operation.input.artifactId =
        resolveArtifact(operation.input.artifactId) ??
        operation.input.artifactId;
      operation.input.workspaceId =
        resolveWorkspace(operation.input.workspaceId) ??
        operation.input.workspaceId;
    } else if (operation.type === "workspaceItem.hide") {
      if (
        !context.currentWorkspace?.items.some(
          (item) => item.id === operation.input.nodeId,
        )
      ) {
        const artifactId = resolveArtifact(operation.input.nodeId);
        const matches =
          context.currentWorkspace?.items.filter(
            (item) => item.kind === "work" && item.sourceId === artifactId,
          ) ?? [];
        if (matches.length === 1 && typeof matches[0]!.id === "string")
          operation.input.nodeId = matches[0]!.id;
      }
    } else if (operation.type === "workspaceItem.setPinned") {
      if (
        !context.currentWorkspace?.items.some(
          (item) => item.id === operation.input.nodeId,
        )
      ) {
        const artifactId = resolveArtifact(operation.input.nodeId);
        const matches =
          context.currentWorkspace?.items.filter(
            (item) => item.sourceId === artifactId,
          ) ?? [];
        if (matches.length === 1 && typeof matches[0]!.id === "string")
          operation.input.nodeId = matches[0]!.id;
      }
    } else if (operation.type === "artifact.link") {
      operation.input.sourceArtifactId =
        resolveArtifact(operation.input.sourceArtifactId) ??
        operation.input.sourceArtifactId;
      operation.input.targetArtifactId =
        resolveArtifact(operation.input.targetArtifactId) ??
        operation.input.targetArtifactId;
      operation.input.workspaceId =
        resolveWorkspace(operation.input.workspaceId) ?? null;
    }
  }
  return parseSpectraPlan(next);
}

export function reconcileExplicitRequestContract(
  plan: SpectraPlan,
  prompt: string,
) {
  const requestedCreation = provisionalSingleCreation(prompt);
  if (!requestedCreation || plan.decision !== "operate") return plan;
  let retainedCreate = false;
  const forbiddenUpdateNoun: Record<
    (typeof SPECTRA_BLUEPRINT_KEYS)[number],
    string
  > = {
    document: "documents?|notes?|guide|outline",
    flashcard_deck: "(?:flashcard\s+)?decks?|flashcards?",
    quiz: "quizzes?|quiz",
    planner_task: "(?:planner\s+|study\s+)?tasks?",
    agent: "agents?|assistants?",
    timetable: "timetables?|calendars?|schedules?",
    presentation: "presentations?|slides?|slide decks?",
    sheets: "spreadsheets?|workbooks?|sheets?",
    code: "code|visuali[sz]ations?|web apps?",
    whiteboard: "whiteboards?|canvases?|mind maps?",
  };
  const operations = plan.operations.filter((operation) => {
    if (operation.type === "artifact.create") {
      if (
        operation.input.blueprintKey !== requestedCreation.blueprintKey ||
        retainedCreate
      )
        return false;
      retainedCreate = true;
      return true;
    }
    if (operation.type !== "artifact.update") return true;
    const noun = forbiddenUpdateNoun[operation.input.blueprintKey];
    return !new RegExp(
      `\\b(?:do not|don't|dont|without)\\s+(?:change|edit|update|modify|rewrite|replace)[^.!?]{0,100}\\b(?:${noun})\\b`,
      "i",
    ).test(prompt);
  });
  if (!retainedCreate) return plan;
  const retained = operations.find(
    (operation) => operation.type === "artifact.create",
  );
  const hasOtherMutations = operations.some(
    (operation) => operation.type !== "artifact.create",
  );
  const targetedArtifactIds = [
    ...new Set(
      operations.flatMap((operation) => {
        if (
          operation.type === "artifact.update" ||
          operation.type === "artifact.archive"
        )
          return [operation.input.artifactId];
        return [];
      }),
    ),
  ];
  return parseSpectraPlan({
    ...plan,
    intent: {
      ...plan.intent,
      mode: hasOtherMutations ? "mixed" : "create",
      requestedArtifactTypes: [requestedCreation.blueprintKey],
      requestedVisibleArtifactCount: 1,
      // A mixed create + focused edit still has an authoritative edit target.
      // Erasing it turns an exact owned update into artificial ambiguity during
      // intent validation, even though the operation itself already names the
      // canonical artifact.
      targetArtifactId:
        targetedArtifactIds.length === 1
          ? targetedArtifactIds[0]!
          : plan.intent.targetArtifactId,
      targetWorkspaceId:
        retained?.type === "artifact.create"
          ? retained.input.workspaceId
          : plan.intent.targetWorkspaceId,
    },
    operations,
  });
}

export function reconcileExplicitDocumentOperation(
  operation: ModelOperation,
  prompt: string,
  focusedArtifact: unknown,
): ModelOperation {
  if (
    operation.type !== "artifact.update" ||
    operation.input.blueprintKey !== "document" ||
    !focusedArtifact ||
    typeof focusedArtifact !== "object" ||
    Array.isArray(focusedArtifact)
  )
    return operation;
  const artifact = focusedArtifact as Record<string, unknown>;
  const content =
    artifact.content &&
    typeof artifact.content === "object" &&
    !Array.isArray(artifact.content)
      ? (artifact.content as Record<string, unknown>)
      : null;
  const blocks = Array.isArray(content?.blocks) ? content.blocks : [];

  // Exact region repair requests are a contract, not a suggestion. The model
  // still authors the operation, but the harness resolves the natural-language
  // target against the canonical block tree so a plausible-looking JSON
  // pointer cannot silently edit the heading (or no block at all).
  const exactHeadingRepair = prompt.match(
    /heading\s+that\s+currently\s+starts\s+["'“]([^"'”]+)["'”]\s+(?:back\s+)?to\s+exactly\s+["'“]([^"'”]+)["'”]/i,
  );
  const exactParagraphRepair = prompt.match(
    /first\s+paragraph\s+under\s+(?:that|the)\s+heading(?:\s+with)?\s*:\s*["'“]([\s\S]+?)["'”](?=\s+(?:preserve|keep|leave)\b|\s*$)/i,
  );
  if (exactHeadingRepair && exactParagraphRepair) {
    const startsWith = exactHeadingRepair[1]!.trim().toLowerCase();
    const headingText = exactHeadingRepair[2]!.trim();
    const headingIndex = blocks.findIndex((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block))
        return false;
      const row = block as Record<string, unknown>;
      return (
        typeof row.type === "string" &&
        row.type.startsWith("heading") &&
        typeof row.text === "string" &&
        row.text.trim().toLowerCase().startsWith(startsWith)
      );
    });
    const paragraphIndex = blocks.findIndex(
      (block, index) =>
        index > headingIndex &&
        block !== null &&
        typeof block === "object" &&
        !Array.isArray(block) &&
        (block as Record<string, unknown>).type === "paragraph",
    );
    if (headingIndex >= 0 && paragraphIndex >= 0) {
      return parseModelOperation({
        ...operation,
        input: {
          ...operation.input,
          content: null,
          contentPatch: {
            changes: [
              { path: `/blocks/${headingIndex}/text`, value: headingText },
              {
                path: `/blocks/${paragraphIndex}/text`,
                value: exactParagraphRepair[1]!.trim(),
              },
            ],
          },
        },
      });
    }
  }
  const exactNthParagraph = prompt.match(
    /(?:replace|set|rewrite)\s+(?:only\s+)?(?:the\s+)?(first|second|third)\s+paragraph\s+under\s+(?:the\s+)?["'“]?([^"'”:,.]+?)["'”]?\s+(?:with|to)\s*:\s*["'“]([\s\S]+?)["'”](?=\s+(?:preserve|keep|leave)\b|\s*$)/i,
  );
  if (exactNthParagraph) {
    const ordinal = { first: 0, second: 1, third: 2 }[
      exactNthParagraph[1]!.toLowerCase() as "first" | "second" | "third"
    ];
    const requestedHeading = exactNthParagraph[2]!.trim().toLowerCase();
    const headingIndex = blocks.findIndex((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block))
        return false;
      const row = block as Record<string, unknown>;
      return (
        typeof row.type === "string" &&
        row.type.startsWith("heading") &&
        typeof row.text === "string" &&
        row.text.trim().toLowerCase() === requestedHeading
      );
    });
    if (headingIndex >= 0) {
      const paragraphIndices: number[] = [];
      for (let index = headingIndex + 1; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (!block || typeof block !== "object" || Array.isArray(block))
          continue;
        const type = (block as Record<string, unknown>).type;
        if (typeof type === "string" && type.startsWith("heading")) break;
        if (type === "paragraph") paragraphIndices.push(index);
      }
      const paragraphIndex = paragraphIndices[ordinal];
      if (paragraphIndex !== undefined)
        return parseModelOperation({
          ...operation,
          input: {
            ...operation.input,
            content: null,
            contentPatch: {
              changes: [
                {
                  path: `/blocks/${paragraphIndex}/text`,
                  value: exactNthParagraph[3]!.trim(),
                },
              ],
            },
          },
        });
    }
  }
  if (!operation.input.contentPatch) return operation;

  // Section rewrites ("rewrite section 2 more concisely") must never land on
  // earlier headings via fragile absolute indices. Remap onto the named
  // section by heading text before any other path repair.
  const sectionRemapped = remapDocumentSectionRewriteChanges(
    content,
    prompt,
    operation.input.contentPatch.changes,
  );
  if (
    sectionRemapped.length !== operation.input.contentPatch.changes.length ||
    sectionRemapped.some(
      (change, index) =>
        change.path !== operation.input.contentPatch!.changes[index]!.path ||
        change.value !== operation.input.contentPatch!.changes[index]!.value,
    )
  ) {
    return parseModelOperation({
      ...operation,
      input: {
        ...operation.input,
        content: null,
        contentPatch: { changes: sectionRemapped },
      },
    });
  }

  const headingRequest = prompt
    .match(
      /\b(?:first\s+)?paragraph\s+(?:directly\s+)?under\s+(?:the\s+)?["']?([^"',.]+?)["']?(?=\s+(?:so|to|and|while|without|with)\b|[,.;]|$)/i,
    )?.[1]
    ?.trim();
  if (!headingRequest) return operation;
  const normalizedHeading = headingRequest.toLowerCase();
  const headingIndex = blocks.findIndex((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block))
      return false;
    const row = block as Record<string, unknown>;
    const text =
      typeof row.text === "string" ? row.text.trim().toLowerCase() : "";
    return (
      typeof row.type === "string" &&
      row.type.startsWith("heading") &&
      (text === normalizedHeading || text.startsWith(`${normalizedHeading} `))
    );
  });
  if (headingIndex < 0) return operation;
  const paragraphIndex = blocks.findIndex((block, index) => {
    if (
      index <= headingIndex ||
      !block ||
      typeof block !== "object" ||
      Array.isArray(block)
    )
      return false;
    const type = (block as Record<string, unknown>).type;
    return type === "paragraph";
  });
  if (paragraphIndex < 0) return operation;
  const textChanges = operation.input.contentPatch.changes.filter((change) =>
    /^\/(?:content\/)?blocks\/(?:id:[^/]+|byId\/[^/]+|\d+)\/text$/.test(
      change.path,
    ),
  );
  if (textChanges.length !== 1) return operation;
  const intendedPath = `/blocks/${paragraphIndex}/text`;
  if (textChanges[0]!.path === intendedPath) return operation;
  return parseModelOperation({
    ...operation,
    input: {
      ...operation.input,
      contentPatch: {
        changes: operation.input.contentPatch.changes.map((change) =>
          change === textChanges[0]
            ? { ...change, path: intendedPath }
            : change,
        ),
      },
    },
  });
}

export function assertRequestedArtifactMutation(
  operations: ModelOperation[],
  prompt: string,
) {
  // Negative preservation constraints describe what must *not* change. Remove
  // them before detecting a requested content mutation; otherwise a request
  // such as "add a tag while preserving all content" is misread as an edit to
  // the document body and a perfectly valid metadata-only operation is rejected.
  const mutationPrompt = prompt
    .replace(
      /\b(?:while|and)\s+(?:preserv(?:e|ing)|keep(?:ing)?|leav(?:e|ing))\b[^.!?]{0,180}\b(?:content|text|paragraphs?|headings?|sections?|blocks?|questions?|answers?|cards?|subtasks?|explanations?|formulas?|tables?)\b[^.!?]*/gi,
      " ",
    )
    .replace(
      /\bwithout\s+(?:chang(?:e|ing)|edit(?:ing)?|rewrit(?:e|ing)|replac(?:e|ing)|remov(?:e|ing)|touch(?:ing)?|modif(?:y|ying)|alter(?:ing)?)\b[^.!?]{0,180}\b(?:content|text|paragraphs?|headings?|sections?|blocks?|questions?|answers?|cards?|subtasks?|explanations?|formulas?|tables?)\b[^.!?]*/gi,
      " ",
    );
  const requestsContentChange =
    /\b(?:rewrite|replace|edit|change|update|add|remove|delete|set|repair|fix)\b[^.!?]{0,180}\b(?:content|text|paragraph|heading|section|block|question|answer|card|subtask|explanation|formula|table|column|cell|sheet|workbook|range|chart|slide|event)\b/i.test(
      mutationPrompt,
    ) ||
    /\b(?:paragraph|heading|section|block|question|answer|card|subtask|explanation|formula|table|column|cell|sheet|workbook|range|chart|slide|event)\b[^.!?]{0,180}\b(?:rewrite|replace|edit|change|update|add|remove|delete|set|repair|fix)\b/i.test(
      mutationPrompt,
    );
  if (!requestsContentChange) return;
  const updates = operations.filter(
    (
      operation,
    ): operation is Extract<ModelOperation, { type: "artifact.update" }> =>
      operation.type === "artifact.update",
  );
  if (
    updates.length > 0 &&
    updates.every(
      (operation) =>
        operation.input.content === null &&
        (!operation.input.contentPatch ||
          operation.input.contentPatch.changes.length === 0),
    )
  )
    throw new Error(
      "The proposed artifact update did not contain the requested content change.",
    );
}

export const PRESENTATION_LAYOUT_IDS = [
  "title-content",
  "title-only",
  "two-column",
  "title-visual-text",
  "visual-story",
  "three-ideas",
  "statement",
  "full-bleed",
  "blank",
] as const;

export function requestedPresentationLayout(prompt: string) {
  const normalized = prompt.toLowerCase().replace(/[–—]/g, "-");
  return PRESENTATION_LAYOUT_IDS.find((layoutId) =>
    normalized.includes(layoutId),
  );
}

export function presentationSlidesAuthoredByOperation(
  operation: Extract<ModelOperation, { type: "artifact.update" }>,
) {
  const candidates: unknown[] = [];
  const content =
    operation.input.content &&
    typeof operation.input.content === "object" &&
    !Array.isArray(operation.input.content)
      ? (operation.input.content as Record<string, unknown>)
      : null;
  if (Array.isArray(content?.slides)) candidates.push(...content.slides);
  for (const change of operation.input.contentPatch?.changes ?? []) {
    if (/^\/(?:content\/)?slides\/(?:-|\d+)$/.test(change.path))
      candidates.push(change.value);
    if (
      /^\/(?:content\/)?slides$/.test(change.path) &&
      Array.isArray(change.value)
    )
      candidates.push(...change.value);
  }
  return candidates.filter(
    (slide): slide is Record<string, unknown> =>
      Boolean(slide) && typeof slide === "object" && !Array.isArray(slide),
  );
}

export function assertPresentationLayoutContract(
  operations: ModelOperation[],
  prompt: string,
) {
  const requestedLayout = requestedPresentationLayout(prompt);
  if (!requestedLayout) return;
  const presentationUpdates = operations.filter(
    (
      operation,
    ): operation is Extract<ModelOperation, { type: "artifact.update" }> =>
      operation.type === "artifact.update" &&
      operation.input.blueprintKey === "presentation",
  );
  if (!presentationUpdates.length) return;
  const slides = presentationUpdates.flatMap(
    presentationSlidesAuthoredByOperation,
  );
  const matching = slides.filter((slide) => slide.layoutId === requestedLayout);
  if (!matching.length)
    throw new Error(
      `The requested presentation layout was not applied. Set the authored slide layoutId to "${requestedLayout}" and fit its native objects to that layout before proposing the operation again.`,
    );
  for (const slide of matching) {
    const objects = Array.isArray(slide.objects)
      ? slide.objects.filter(
          (object): object is Record<string, unknown> =>
            Boolean(object) &&
            typeof object === "object" &&
            !Array.isArray(object),
        )
      : [];
    const canvasHeight = 562.5;
    for (const object of objects) {
      const x = typeof object.x === "number" ? object.x : 0;
      const y = typeof object.y === "number" ? object.y : 0;
      const width = typeof object.width === "number" ? object.width : 0;
      const height = typeof object.height === "number" ? object.height : 0;
      if (
        width < 10 ||
        height < 10 ||
        x < 0 ||
        y < 0 ||
        x + width > 1_000 ||
        y + height > canvasHeight
      )
        throw new Error(
          "The authored slide has an object outside the visible canvas. Correct its geometry before proposing the operation again.",
        );
      if (object.type === "text") {
        const style =
          object.style &&
          typeof object.style === "object" &&
          !Array.isArray(object.style)
            ? (object.style as Record<string, unknown>)
            : {};
        if (
          typeof style.fontSize === "number" &&
          style.fontSize > 0 &&
          style.fontSize < 20
        )
          throw new Error(
            "The authored slide contains presentation text below 20px. Increase its type scale and rebalance the geometry before proposing the operation again.",
          );
      }
    }
    if (
      (requestedLayout === "title-visual-text" ||
        requestedLayout === "visual-story") &&
      !objects.some((object) => object.type !== "text")
    )
      throw new Error(
        `The "${requestedLayout}" slide needs an editable visual object as well as text. Add and place the visual before proposing the operation again.`,
      );
  }
}

export function reconcileExplicitDocumentRegions(
  plan: SpectraPlan,
  prompt: string,
  context: Awaited<ReturnType<typeof buildContext>>,
) {
  const operations = plan.operations.map((operation) =>
    reconcileExplicitDocumentOperation(
      operation,
      prompt,
      context.focusedArtifact,
    ),
  );
  return operations.some(
    (operation, index) => operation !== plan.operations[index],
  )
    ? parseSpectraPlan({ ...plan, operations })
    : plan;
}

export function resolveAndValidatePlan(
  plan: SpectraPlan,
  context: Awaited<ReturnType<typeof buildContext>>,
  prompt: string,
) {
  const requestedCreation = provisionalSingleCreation(prompt);
  const workspaceId =
    typeof context.currentWorkspace?.id === "string"
      ? context.currentWorkspace.id
      : null;
  // Workspace-focused vague creates often land as artifact.update against an
  // existing same-type object. Promote that content to a fresh create first.
  // Never promote when the prompt is a structural edit of the open artifact.
  const promoted =
    requestedCreation &&
    promptLooksLikeFreshCreate(prompt) &&
    !promptLooksLikeFocusedStructuralEdit(prompt)
      ? parseSpectraPlan(
          promoteMatchingUpdateToCreate(plan, {
            requested: requestedCreation,
            workspaceId,
          }),
        )
      : plan;
  const reconciled = reconcileExplicitDocumentRegions(
    reconcileExplicitRequestContract(promoted, prompt),
    prompt,
    context,
  );
  let resolved = resolvePlanReferences(reconciled, context);
  if (
    (context.focusMode === "artifact" || context.focusMode === "thread") &&
    context.focusedArtifact &&
    typeof context.focusedArtifact.id === "string"
  ) {
    const focusedId = context.focusedArtifact.id;
    const allowed = ownedReferences(context).artifactIds;
    const operations = resolved.operations.map((operation) => {
      if (
        operation.type === "artifact.update" &&
        !allowed.has(operation.input.artifactId) &&
        operation.input.blueprintKey === context.focusedArtifact?.blueprintKey
      ) {
        return parseModelOperation({
          ...operation,
          input: { ...operation.input, artifactId: focusedId },
        });
      }
      if (
        operation.type === "artifact.archive" &&
        !allowed.has(operation.input.artifactId)
      ) {
        return parseModelOperation({
          ...operation,
          input: { ...operation.input, artifactId: focusedId },
        });
      }
      return operation;
    });
    const repairedTarget =
      resolved.intent.targetArtifactId &&
      !allowed.has(resolved.intent.targetArtifactId)
        ? focusedId
        : resolved.intent.targetArtifactId;
    if (
      repairedTarget !== resolved.intent.targetArtifactId ||
      operations.some(
        (operation, index) => operation !== resolved.operations[index],
      )
    ) {
      console.warn("[spectra.plan.focused_reference_repaired]", {
        focusedId,
        focusMode: context.focusMode,
      });
      resolved = parseSpectraPlan({
        ...resolved,
        intent: { ...resolved.intent, targetArtifactId: repairedTarget },
        operations,
      });
    }
  }
  // A visible artifact is context, not an instruction to mutate it. When the
  // user explicitly asks for a fresh object, keep the conversation identity
  // anchored to that new object as well; otherwise the model can correctly
  // create `Magnets Quiz` while leaving the Dock mislabeled `Update Water
  // Cycle Quiz` from the contextual artifact.
  if (requestedCreation && promptLooksLikeFreshCreate(prompt)) {
    const created = resolved.operations.find(
      (operation) =>
        operation.type === "artifact.create" &&
        operation.input.blueprintKey === requestedCreation.blueprintKey,
    );
    if (created?.type === "artifact.create") {
      resolved = parseSpectraPlan({
        ...resolved,
        conversationTitle: created.input.title.trim().slice(0, 64),
      });
    }
  }
  assertRequestedArtifactMutation(resolved.operations, prompt);
  assertPresentationLayoutContract(resolved.operations, prompt);
  console.info(
    `[spectra.plan.summary] ${JSON.stringify({
      intent: resolved.intent,
      operations: resolved.operations.map((operation) => ({
        type: operation.type,
        blueprintKey:
          operation.type === "artifact.create" ||
          operation.type === "artifact.update"
            ? operation.input.blueprintKey
            : undefined,
        workspaceId:
          operation.type === "artifact.create"
            ? operation.input.workspaceId
            : undefined,
        placement:
          operation.type === "artifact.create"
            ? operation.input.placement
            : undefined,
      })),
    })}`,
  );
  try {
    return validatePlanAgainstIntent(resolved, ownedReferences(context));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(
      `[spectra.plan.resolve_validate] ${JSON.stringify({
        promptPreview: prompt.slice(0, 160),
        decision: resolved.decision,
        intent: resolved.intent,
        operations: resolved.operations.map((operation) => ({
          type: operation.type,
          blueprintKey:
            operation.type === "artifact.create" ||
            operation.type === "artifact.update"
              ? operation.input.blueprintKey
              : undefined,
          workspaceId:
            operation.type === "artifact.create"
              ? operation.input.workspaceId
              : undefined,
        })),
        message: message.slice(0, 400),
        publicError: formatPlanApplicationPublicError(error),
      })}`,
    );
    // Quietly collapse duplicate same-type creates from a singular request
    // instead of exposing an intent mismatch after shells already appeared.
    if (/more visible artifacts/i.test(message)) {
      const creates = resolved.operations.filter(
        (operation) => operation.type === "artifact.create",
      );
      const createdTypes = [
        ...new Set(creates.map((operation) => operation.input.blueprintKey)),
      ];
      const requested =
        provisionalSingleCreation(prompt) ??
        (createdTypes.length === 1
          ? {
              blueprintKey: createdTypes[0]!,
              label: createdTypes[0]!,
            }
          : null);
      if (
        requested &&
        creates.length > 1 &&
        creates.every(
          (operation) =>
            operation.input.blueprintKey === requested.blueprintKey,
        )
      ) {
        const trimmed = parseSpectraPlan({
          ...resolved,
          intent: {
            ...resolved.intent,
            mode: "create",
            requestedArtifactTypes: [requested.blueprintKey],
            requestedVisibleArtifactCount: 1,
            targetWorkspaceId:
              creates[0]!.input.workspaceId ??
              resolved.intent.targetWorkspaceId,
          },
          operations: [
            creates[0]!,
            ...resolved.operations.filter(
              (operation) => operation.type !== "artifact.create",
            ),
          ],
        });
        console.warn("[spectra.plan.duplicate_create_trimmed]", {
          blueprintKey: requested.blueprintKey,
          dropped: creates.length - 1,
        });
        return validatePlanAgainstIntent(trimmed, ownedReferences(context));
      }
    }
    // Vague single-create prompts often leave intent.requestedArtifactTypes
    // empty/wrong while the operation itself is the correct blueprint. Align
    // intent to the create instead of failing after the model already authored.
    // Also recover create-counted-as-update slips against workspace focus.
    if (
      /unrelated to the interpreted request|does not match the interpreted request/i.test(
        message,
      )
    ) {
      const creates = resolved.operations.filter(
        (operation) => operation.type === "artifact.create",
      );
      const requested = provisionalSingleCreation(prompt);
      if (
        requested &&
        creates.length === 0 &&
        promptLooksLikeFreshCreate(prompt)
      ) {
        const promotedCreate = parseSpectraPlan(
          promoteMatchingUpdateToCreate(resolved, {
            requested,
            workspaceId,
          }),
        );
        if (
          promotedCreate.operations.some(
            (operation) => operation.type === "artifact.create",
          )
        ) {
          console.warn("[spectra.plan.update_promoted_to_create]", {
            blueprintKey: requested.blueprintKey,
          });
          return validatePlanAgainstIntent(
            promotedCreate,
            ownedReferences(context),
          );
        }
      }
      if (
        requested &&
        creates.length === 1 &&
        creates[0]!.input.blueprintKey === requested.blueprintKey
      ) {
        const aligned = parseSpectraPlan({
          ...resolved,
          intent: {
            ...resolved.intent,
            mode: "create",
            requestedArtifactTypes: [requested.blueprintKey],
            requestedVisibleArtifactCount: 1,
            targetArtifactId: null,
            targetWorkspaceId:
              creates[0]!.input.workspaceId ??
              resolved.intent.targetWorkspaceId ??
              workspaceId,
          },
        });
        console.warn("[spectra.plan.intent_aligned_to_create]", {
          blueprintKey: requested.blueprintKey,
        });
        return validatePlanAgainstIntent(aligned, ownedReferences(context));
      }
      if (creates.length === 1) {
        const blueprintKey = creates[0]!.input.blueprintKey;
        const aligned = parseSpectraPlan({
          ...resolved,
          intent: {
            ...resolved.intent,
            mode: resolved.operations.some(
              (operation) => operation.type !== "artifact.create",
            )
              ? "mixed"
              : "create",
            requestedArtifactTypes: [blueprintKey],
            requestedVisibleArtifactCount: Math.max(
              1,
              resolved.intent.requestedVisibleArtifactCount,
            ),
            targetWorkspaceId:
              creates[0]!.input.workspaceId ??
              resolved.intent.targetWorkspaceId ??
              workspaceId,
          },
        });
        console.warn("[spectra.plan.intent_aligned_to_authored_create]", {
          blueprintKey,
        });
        return validatePlanAgainstIntent(aligned, ownedReferences(context));
      }
    }
    if (
      !/\b(reference|target|destination|owned id|database ids?)\b/i.test(
        message,
      )
    )
      throw error;
    const candidates = context.artifacts
      .slice(0, 3)
      .flatMap((artifact) =>
        typeof artifact.title === "string" ? [artifact.title] : [],
      );
    // Clarification is appropriate only for genuine ambiguity. If retrieval found
    // no viable owned target, treat the model operation as invalid so the run
    // records one safe recoverable error instead of silently converting it into
    // a successful-looking answer.
    if (candidates.length < 2) throw error;
    return parseSpectraPlan({
      ...resolved,
      decision: "clarify",
      operations: [],
      choices:
        candidates.length >= 2
          ? {
              question: "Which Spectra object should I use?",
              options: candidates.map((title) => ({
                title,
                description: "Use this owned object as the target.",
              })),
            }
          : null,
      finalResponse: candidates.length
        ? `I found relevant work, but the requested change could apply to more than one object. Choose ${candidates.map((title) => `“${title}”`).join(", ")}, or name a different object.`
        : "I can help with that, but I need the name of the Spectra object you want to change.",
    });
  }
}

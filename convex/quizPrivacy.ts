import type { Doc } from "./_generated/dataModel";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function projectQuizContentForLearner(contentValue: unknown) {
  const content =
    contentValue &&
    typeof contentValue === "object" &&
    !Array.isArray(contentValue)
      ? (contentValue as Record<string, unknown>)
      : {};
  const questions = Array.isArray(content.questions)
    ? content.questions.map((candidate) => {
        const question =
          candidate &&
          typeof candidate === "object" &&
          !Array.isArray(candidate)
            ? (candidate as Record<string, unknown>)
            : {};
        const matchingPairs = Array.isArray(question.matchingPairs)
          ? question.matchingPairs.map((candidate) => {
              const pair =
                candidate &&
                typeof candidate === "object" &&
                !Array.isArray(candidate)
                  ? (candidate as Record<string, unknown>)
                  : {};
              const { right: _right, ...safePair } = pair;
              return safePair;
            })
          : undefined;
        const {
          correctAnswer: _correctAnswer,
          correctAnswers: _correctAnswers,
          numericTolerance: _numericTolerance,
          explanation: _explanation,
          feedback: _feedback,
          rubric: _rubric,
          ...safeQuestion
        } = question;
        return {
          ...safeQuestion,
          ...(matchingPairs ? { matchingPairs } : {}),
        };
      })
    : [];
  return { ...content, questions };
}

export function projectQuizSnapshotForLearner(snapshotValue: unknown) {
  const snapshot =
    snapshotValue &&
    typeof snapshotValue === "object" &&
    !Array.isArray(snapshotValue)
      ? (snapshotValue as Record<string, unknown>)
      : {};
  if ("content" in snapshot) {
    return {
      ...snapshot,
      content: projectQuizContentForLearner(snapshot.content),
    };
  }
  return projectQuizContentForLearner(snapshotValue);
}

export function isSensitiveQuizRegion(regionId: string) {
  return /:(?:answer|answers|pair:|rubric|explanation|feedback)(?:$|:)/.test(
    regionId,
  );
}

export function projectTimetableSharedContent(contentValue: unknown) {
  const content = record(contentValue);
  const layers = (Array.isArray(content.layers) ? content.layers : []).flatMap(
    (candidate) => {
      const layer = record(candidate);
      const authority =
        typeof layer.authority === "string" ? layer.authority : undefined;
      const kind = typeof layer.kind === "string" ? layer.kind : undefined;
      const isPrivate =
        layer.private === true ||
        authority === "user" ||
        ((kind === "personal" || kind === "study") &&
          authority !== "workspace" &&
          authority !== "school" &&
          authority !== "external");
      if (isPrivate || typeof layer.id !== "string") return [];
      const { private: _private, ...shared } = layer;
      return [{ ...shared, visible: true } as Record<string, unknown>];
    },
  );
  const sharedLayerIds = new Set(
    layers.flatMap((layer) => (typeof layer.id === "string" ? [layer.id] : [])),
  );
  const events = (Array.isArray(content.events) ? content.events : []).flatMap(
    (candidate) => {
      const event = record(candidate);
      if (
        typeof event.layerId !== "string" ||
        !sharedLayerIds.has(event.layerId)
      )
        return [];
      const { overlay: _overlay, ...shared } = event;
      return [shared];
    },
  );
  return {
    timezone:
      typeof content.timezone === "string" && content.timezone.trim()
        ? content.timezone.slice(0, 100)
        : "UTC",
    layers,
    events,
  };
}

export function timetableContentContainsPersonalState(contentValue: unknown) {
  const content = record(contentValue);
  if (
    Object.prototype.hasOwnProperty.call(content, "view") ||
    Object.prototype.hasOwnProperty.call(content, "availability") ||
    Object.prototype.hasOwnProperty.call(content, "preferences")
  )
    return true;
  const layers = Array.isArray(content.layers) ? content.layers : [];
  if (
    layers.some((candidate) => {
      const layer = record(candidate);
      const authority =
        typeof layer.authority === "string" ? layer.authority : undefined;
      const kind = typeof layer.kind === "string" ? layer.kind : undefined;
      return (
        layer.private === true ||
        authority === "user" ||
        ((kind === "personal" || kind === "study") &&
          authority !== "workspace" &&
          authority !== "school" &&
          authority !== "external")
      );
    })
  )
    return true;
  return (Array.isArray(content.events) ? content.events : []).some(
    (candidate) =>
      Object.prototype.hasOwnProperty.call(record(candidate), "overlay"),
  );
}

export function projectTimetableSnapshot(snapshotValue: unknown) {
  const snapshot = record(snapshotValue);
  if ("content" in snapshot) {
    return {
      ...snapshot,
      content: projectTimetableSharedContent(snapshot.content),
    };
  }
  return projectTimetableSharedContent(snapshotValue);
}

export function projectArtifactForAccess(
  artifact: Doc<"spectraArtifacts">,
  level: "read" | "modify",
) {
  if (artifact.blueprintKey === "timetable") {
    const { textIndex: _textIndex, ...safeArtifact } = artifact;
    return {
      ...safeArtifact,
      content: projectTimetableSharedContent(artifact.content),
    };
  }
  if (level === "modify" || artifact.blueprintKey !== "quiz") return artifact;
  const { textIndex: _textIndex, ...safeArtifact } = artifact;
  return {
    ...safeArtifact,
    content: projectQuizContentForLearner(artifact.content),
  };
}

import type { ArtifactEmbedContextPolicy } from "../../../../shared/artifact-embed";
import { boundedArtifactRead } from "./bounded-artifact-read";
import { artifactContextSnapshot } from "./context-builder";

type Row = Record<string, unknown>;

const record = (value: unknown): Row | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;

/**
 * What the model may see of one embed, decided by the embed's contextPolicy.
 * The Convex projection is the permission-bound view of the source (quiz keys
 * and private timetable layers already removed); this decides how much of that
 * view the AI is given:
 *   - none: the embed's identity and state only; its content is withheld.
 *   - summary: the source's summary card (summary, excerpt, structure), with
 *     how to read the full live source when the model needs it.
 *   - visible_region: a bounded read of the content the embed renders.
 * Unknown policies are treated as summary.
 */
export function embedForModel(embed: unknown) {
  const row = record(embed);
  if (!row) return null;
  const policy = (row.contextPolicy ?? "summary") as ArtifactEmbedContextPolicy;
  const source = record(row.source);
  const version = record(row.version);
  const base = {
    embedId: row.embedId,
    sourceArtifactId: row.sourceArtifactId,
    containerRegionId: row.containerRegionId,
    state: row.state,
    versionPolicy: row.versionPolicy,
    ...(version ? { version: { versionId: version.versionId, name: version.name, createdAt: version.createdAt } } : {}),
    interaction: row.effectiveInteraction ?? row.interaction,
    contextPolicy: policy,
    ...(row.sourceUnavailable ? { sourceUnavailable: true } : {}),
  };
  if (!source) return base;
  const identity = { artifactId: source.artifactId, title: source.title, type: source.blueprintKey };
  if (policy === "none")
    return {
      ...base,
      source: identity,
      contentWithheld: "This embed's owner set it to share no content with the AI. Do not infer its content.",
    };
  const snapshot = record(source.snapshot) ?? {};
  const artifact: Row = {
    _id: source.artifactId,
    title: snapshot.title ?? source.title,
    summary: snapshot.summary ?? source.summary,
    tags: snapshot.tags ?? source.tags,
    blueprintKey: source.blueprintKey,
    updatedAt: source.updatedAt,
    content: snapshot.content,
  };
  const pinned = row.versionPolicy === "pinned";
  if (policy === "visible_region") {
    const read = boundedArtifactRead(artifact) as Row;
    return {
      ...base,
      source: {
        ...identity,
        updatedAt: source.updatedAt,
        tags: artifact.tags,
        summary: artifact.summary,
        content: read.content,
        ...(read.contentCoverage ? { contentCoverage: read.contentCoverage } : {}),
      },
    };
  }
  const card = artifactContextSnapshot(artifact, { includeExcerpt: true });
  return {
    ...base,
    source: {
      ...identity,
      updatedAt: source.updatedAt,
      summary: card.summary,
      tags: card.tags,
      excerpt: card.excerpt,
      structure: card.structure,
      ...(card.answerBoundary ? { answerBoundary: card.answerBoundary } : {}),
    },
    fullContent: pinned
      ? "This is a summary of the pinned version. read_artifact on sourceArtifactId returns the current version, which may differ from what this embed shows."
      : "This is a summary. Call read_artifact with sourceArtifactId for the full current content when it matters.",
  };
}

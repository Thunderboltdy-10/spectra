import { presenceColor } from "../../collaboration/interaction-model";
import { foldUnchanged, wordDiff } from "../../collaboration/word-diff";
import type { SpectraArtifactVersion, SpectraArtifactVersionSummary } from "../../data/api";

/*
 * What one version changed, marked up the way a teacher marks a draft: struck
 * words for what went, the author's own colour under what came in. Each
 * person, and each person's AI, keeps one colour through the whole timeline,
 * so who did what reads at a glance.
 */

export type VersionChange = { label: string; before: string; after: string };

export type VersionAuthor = { name: string; color: string; ai: boolean };

const NOT_SET = "Not set";

export function versionAuthor(version: SpectraArtifactVersionSummary): VersionAuthor {
  const creator = version.creators?.[0];
  const ai = version.source === "ai";
  const accountId = creator?.accountId ?? version.creatorAccountIds?.[0];
  const color = presenceColor(
    ai
      ? { clientId: accountId ?? "spectra", kind: "ai", name: "", ownerAccountId: accountId }
      : { clientId: accountId ?? "person", kind: "human", name: creator?.name ?? "", accountId },
  );
  const people = version.creators?.map((entry) => entry.name).filter(Boolean) ?? [];
  if (ai) return { name: creator?.name ? `${creator.name}'s AI` : "Spectra AI", color, ai };
  return { name: people.join(", ") || "A collaborator", color, ai };
}

/** Every author in the loaded timeline, in the order they first appear. */
export function timelineAuthors(versions: readonly SpectraArtifactVersionSummary[]) {
  const authors = new Map<string, VersionAuthor>();
  for (const version of versions) {
    const author = versionAuthor(version);
    if (!authors.has(author.name)) authors.set(author.name, author);
  }
  return [...authors.values()];
}

export function AuthorMark({ author }: { author: VersionAuthor }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={
          author.ai
            ? { boxShadow: `inset 0 0 0 1.5px ${author.color}` }
            : { background: author.color }
        }
      />
      <span className="truncate">{author.name}</span>
    </span>
  );
}

function ChangeText({ change, color }: { change: VersionChange; color: string }) {
  const before = change.before === NOT_SET ? "" : change.before;
  const after = change.after === NOT_SET ? "" : change.after;
  const segments = foldUnchanged(wordDiff(before, after));
  return (
    <p className="whitespace-pre-wrap break-words font-serif text-editor leading-7 text-[var(--text-primary)]">
      {segments.map((segment, index) =>
        segment.kind === "same" ? (
          <span key={index} className="text-[var(--text-secondary)]">
            {segment.text}
          </span>
        ) : segment.kind === "removed" ? (
          <del
            key={index}
            // A word replaced in place keeps a gap before its replacement.
            className={`text-[var(--text-tertiary)] decoration-[color-mix(in_oklab,var(--danger)_70%,transparent)] decoration-1 ${segments[index + 1]?.kind === "added" ? "mr-1" : ""}`}
          >
            {segment.text}
          </del>
        ) : (
          <ins
            key={index}
            className="rounded-xs px-[1px] no-underline"
            style={{
              background: `color-mix(in oklab, ${color} 16%, transparent)`,
              boxShadow: `inset 0 -1.5px 0 ${color}`,
            }}
          >
            {segment.text}
          </ins>
        ),
      )}
    </p>
  );
}

export function VersionChanges({
  version,
  changes,
}: {
  version: SpectraArtifactVersion;
  changes: readonly VersionChange[];
}) {
  const author = versionAuthor(version);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-[720px] px-6 py-6">
        <header className="mb-5 border-b border-[var(--border-subtle)] pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-caption font-semibold text-[var(--text-primary)]">
            <AuthorMark author={author} />
            <span className="text-micro font-normal text-[var(--text-tertiary)]">
              {new Date(version.createdAt).toLocaleString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          {version.summary ? (
            <p className="mt-1.5 text-micro leading-5 text-[var(--text-secondary)]">{version.summary}</p>
          ) : null}
        </header>
        {version.before === undefined ? (
          <p className="text-micro leading-5 text-[var(--text-secondary)]">
            This is where the work began, so there is nothing earlier to compare it with.
          </p>
        ) : changes.length === 0 ? (
          <p className="text-micro leading-5 text-[var(--text-secondary)]">
            Nothing you can read changed in this version.
          </p>
        ) : (
          <ol className="space-y-5">
            {changes.map((change, index) => (
              <li
                key={`${index}:${change.label}`}
                className="border-l-2 pl-4"
                style={{ borderColor: `color-mix(in oklab, ${author.color} 55%, transparent)` }}
              >
                <div className="mb-1 text-micro font-medium text-[var(--text-tertiary)]">{change.label}</div>
                <ChangeText change={change} color={author.color} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

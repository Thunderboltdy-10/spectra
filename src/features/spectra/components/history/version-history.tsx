"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { foldUnchanged, wordDiff } from "../../collaboration/word-diff";
import { AlertCircle, ArrowLeft, Loader2, Plus, RotateCcw } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { SpectraArtifactVersion, SpectraArtifactVersionSummary } from "../../data/api";
import { readableParts, versionPartChanges, type VersionPartChange } from "./readable-version";
import { AuthorMark, ChangeText, versionAuthor } from "./version-changes";

/*
 * Going back through a work. The pane lists when things happened; picking one
 * lays that moment over the page, read as words, never as stored structure.
 * Nothing is lost by looking, and restoring only ever adds a new version.
 */

export function historyKind(version: SpectraArtifactVersionSummary) {
  if (version.name) return version.name;
  if (version.source === "ai") return "AI edit";
  if (version.source === "restore" || version.source === "revert") return "Restored version";
  if (version.source === "checkpoint") return "Named version";
  if (version.source === "import") return "Imported";
  if (version.source === "migration") return "Moved to a newer format";
  return "Edit";
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function dayStart(at: number) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayLabel(at: number, now = Date.now()) {
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return dayFormat.format(at);
}

/** The versions in order, under the day each belongs to. */
export function versionDays(versions: readonly SpectraArtifactVersionSummary[], now = Date.now()) {
  const days: { label: string; versions: SpectraArtifactVersionSummary[] }[] = [];
  for (const version of versions) {
    const label = dayLabel(version.createdAt, now);
    const last = days.at(-1);
    if (last?.label === label) last.versions.push(version);
    else days.push({ label, versions: [version] });
  }
  return days;
}

/** Summaries were written in the editor's own terms; a person reads about parts of their work. */
function readableSummary(summary: string) {
  return summary.replace(/\bregions\b/g, "parts").replace(/\bregion\b/g, "part");
}

export function VersionTimeline({
  versions,
  selectedId,
  disabled,
  loading,
  error,
  hasMore,
  canName,
  onSelect,
  onSelectNow,
  onLoadMore,
  onRetry,
  onName,
}: {
  versions: readonly SpectraArtifactVersionSummary[];
  selectedId: string | null;
  disabled: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  canName: boolean;
  onSelect: (version: SpectraArtifactVersionSummary) => void;
  onSelectNow: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onName: (name: string) => Promise<void>;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const days = useMemo(() => versionDays(versions), [versions]);

  async function saveName() {
    const chosen = name.trim();
    if (!chosen || nameBusy) return;
    setNameBusy(true);
    setNameError(null);
    try {
      await onName(chosen);
      setName("");
      setNaming(false);
    } catch (failure) {
      setNameError(failure instanceof Error ? failure.message : "Could not name this version.");
    } finally {
      setNameBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {canName ? (
        <div className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-2">
            {naming ? (
              <form
                className="flex gap-1.5 py-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveName();
                }}
              >
                <input
                  autoFocus
                  value={name}
                  aria-label="Name for this version"
                  placeholder="Before teacher review"
                  onChange={(event) => setName(event.target.value.slice(0, 180))}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    setNaming(false);
                  }}
                  className="h-8 min-w-0 flex-1 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-caption text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                />
                <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || nameBusy}>
                  {nameBusy ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
                </Button>
              </form>
            ) : (
              <button type="button" onClick={() => setNaming(true)} className="reference-text-action -ml-1.5">
                <Plus className="size-3.5" /> Name this version
              </button>
            )}
          {nameError ? (
            <p role="alert" className="pb-1 text-micro text-[var(--danger)]">
              {nameError}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="version-timeline min-h-0 flex-1 overflow-y-auto">
        <button type="button" data-selected={selectedId === null || undefined} onClick={onSelectNow} className="version-row">
          <span aria-hidden className="version-dot" style={{ background: "var(--success)" }} />
          <span className="min-w-0 flex-1">
            <span className="version-row-who">Now</span>
            <span className="version-row-what">As it is now</span>
          </span>
        </button>
        {days.map((day) => (
          <section key={day.label}>
            <h3 className="version-day">{day.label}</h3>
            {day.versions.map((version) => {
              const author = versionAuthor(version);
              const kind = historyKind(version);
              const named = Boolean(version.name);
              const plain = kind === "AI edit" || kind === "Edit";
              return (
                <button
                  key={version._id}
                  type="button"
                  disabled={disabled}
                  data-selected={selectedId === version._id || undefined}
                  data-named={named || undefined}
                  onClick={() => onSelect(version)}
                  className="version-row"
                  style={{ "--version-author": author.color } as CSSProperties}
                >
                  <span aria-hidden className="version-dot" style={author.ai ? { boxShadow: `inset 0 0 0 1.5px ${author.color}` } : { background: author.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="version-row-who">{named ? kind : author.name}</span>
                      <time className="shrink-0 text-micro text-[var(--text-tertiary)]">{timeFormat.format(version.createdAt)}</time>
                    </span>
                    {named ? <span className="version-row-what">{author.name}</span> : plain ? null : <span className="version-row-what">{kind}</span>}
                    {version.summary ? <span className="version-row-what line-clamp-2">{readableSummary(version.summary)}</span> : null}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
        {error ? (
          <div role="alert" className="px-4 py-3 text-micro text-[var(--text-secondary)]">
            <p>{error}</p>
            <button type="button" onClick={onRetry} disabled={loading} className="reference-text-action -ml-1.5 mt-1">
              Try again
            </button>
          </div>
        ) : null}
        {loading ? (
          <p role="status" className="px-4 py-3 text-micro text-[var(--text-tertiary)]">
            Loading versions
          </p>
        ) : hasMore && !error ? (
          <button type="button" onClick={onLoadMore} className="reference-text-action mx-2.5 my-2">
            Show older versions
          </button>
        ) : null}
        {!versions.length && !loading && !error ? (
          <p className="px-4 py-6 text-micro leading-5 text-[var(--text-tertiary)]">Each working session is kept here as you go, whoever makes it.</p>
        ) : null}
      </div>
    </div>
  );
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function PartChange({ change, color }: { change: VersionPartChange; color: string }) {
  if (change.kind === "same")
    return (
      <li className="version-fold">
        <span>{plural(change.count, "part")} unchanged</span>
      </li>
    );
  return (
    <li className="version-part" data-kind={change.kind} style={{ "--version-author": color } as CSSProperties}>
      {change.label ? <div className="version-part-label">{change.label}</div> : null}
      <ChangeText
        color={color}
        change={{
          label: change.label ?? "",
          before: change.kind === "added" ? "" : change.before,
          after: change.kind === "removed" ? "" : change.after,
        }}
      />
    </li>
  );
}

/** What this version did to the one before it, marked on the page's own words. */
function WhatChanged({ version, blueprintKey }: { version: SpectraArtifactVersion; blueprintKey: string }) {
  const author = versionAuthor(version);
  const changes = useMemo(() => {
    if (!version.after) return [];
    const after = readableParts(blueprintKey, version.after);
    return versionPartChanges(version.before ? readableParts(blueprintKey, version.before) : [], after);
  }, [blueprintKey, version.after, version.before]);
  if (!version.before)
    return <p className="version-note">This is where the artifact began, so there is nothing earlier to compare it with.</p>;
  if (!changes.some((change) => change.kind !== "same")) return <p className="version-note">Nothing you can read changed in this version.</p>;
  return (
    <ol className="version-page">
      {changes.map((change, index) => (
        <PartChange key={index} change={change} color={author.color} />
      ))}
    </ol>
  );
}

/** One side of a comparison, with the words that differ from the other side marked. */
function Side({ before, after, side }: { before: string; after: string; side: "removed" | "added" }) {
  const segments = useMemo(() => foldUnchanged(wordDiff(before, after)), [after, before]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "same" ? (
          <span key={index}>{segment.text}</span>
        ) : segment.kind === side ? (
          <mark key={index} className="version-mark" data-side={side}>
            {segment.text}
          </mark>
        ) : null,
      )}
    </>
  );
}

export type LiveChange = { label: string; before: string; after: string; regionId?: string };

function AgainstNow({
  changes,
  selectedRegions,
  readOnly,
  onSelectedRegionsChange,
}: {
  changes: readonly LiveChange[];
  selectedRegions: ReadonlySet<string>;
  readOnly: boolean;
  onSelectedRegionsChange: (regions: Set<string>) => void;
}) {
  if (!changes.length) return <p className="version-note">This version matches the work as it is now.</p>;
  return (
    <ul className="version-page space-y-3">
      {changes.map((change, index) => {
        const regionId = change.regionId;
        return (
          <li key={`${index}:${change.label}`} className="version-compare">
            <label className="version-compare-head">
              <input
                type="checkbox"
                disabled={!regionId || readOnly}
                checked={Boolean(regionId && selectedRegions.has(regionId))}
                onChange={(event) => {
                  if (!regionId) return;
                  const next = new Set(selectedRegions);
                  if (event.target.checked) next.add(regionId);
                  else next.delete(regionId);
                  onSelectedRegionsChange(next);
                }}
                className="size-3.5 accent-[var(--accent-cyan)]"
              />
              {change.label}
            </label>
            <div className="version-compare-sides">
              <div>
                <h4>In this version</h4>
                <p><Side before={change.before} after={change.after} side="removed" /></p>
              </div>
              <div>
                <h4>Now</h4>
                <p><Side before={change.before} after={change.after} side="added" /></p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const longDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** One moment of the work, laid over the page. The work itself is untouched underneath. */
export function VersionStage({
  blueprintKey,
  version,
  liveChanges,
  selectedRegions,
  readOnly,
  busy,
  loading,
  error,
  fills,
  style,
  renderSnapshot,
  onSelectedRegionsChange,
  onRestore,
  onRetry,
  onBack,
}: {
  blueprintKey: string;
  version: SpectraArtifactVersion;
  liveChanges: readonly LiveChange[];
  selectedRegions: ReadonlySet<string>;
  readOnly: boolean;
  busy: boolean;
  loading: boolean;
  error: string | null;
  /** So little room that this takes the whole work, the pane included, and offers the way back. */
  fills: boolean;
  style?: CSSProperties;
  renderSnapshot: (snapshot: NonNullable<SpectraArtifactVersion["after"]>) => ReactNode;
  onSelectedRegionsChange: (regions: Set<string>) => void;
  onRestore: (regions?: readonly string[]) => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const [view, setView] = useState<"changed" | "page" | "now">("changed");
  const author = versionAuthor(version);
  const kind = historyKind(version);
  const views = [
    ["changed", "What changed"],
    ["page", "As it was"],
    ["now", liveChanges.length ? `Against now (${liveChanges.length})` : "Against now"],
  ] as const;
  const ready = Boolean(version.after);
  return (
    <section className="version-stage" data-fills={fills || undefined} style={style} aria-label={`Version from ${longDate.format(version.createdAt)}`}>
      <header className="version-stage-head">
        {fills ? <IconButton icon={<ArrowLeft className="size-4" />} label="Back to versions" onClick={onBack} size="compact" /> : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-caption font-semibold text-[var(--text-primary)]">
            {version.name ? version.name : <AuthorMark author={author} />}
          </div>
          <p className="truncate text-micro text-[var(--text-tertiary)]">
            {version.name ? `${author.name}, ` : kind === "AI edit" || kind === "Edit" ? "" : `${kind}, `}
            {longDate.format(version.createdAt)}
          </p>
        </div>
        {readOnly ? null : (
          <div className="flex shrink-0 items-center gap-1.5">
            {view === "now" && selectedRegions.size ? (
              <Button variant="secondary" size="sm" disabled={!ready || busy} onClick={() => onRestore([...selectedRegions])}>
                Restore {selectedRegions.size} selected
              </Button>
            ) : null}
            <Button variant="primary" size="sm" disabled={!ready || busy} title="Restoring adds a new version, so nothing later is lost." onClick={() => onRestore()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
              Restore this version
            </Button>
          </div>
        )}
      </header>
      <div role="tablist" aria-label="How to look at this version" className="version-views">
        {views.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="version-stage-body">
        {version.after ? (
          view === "changed" ? (
            <WhatChanged version={version} blueprintKey={blueprintKey} />
          ) : view === "page" ? (
            renderSnapshot(version.after)
          ) : (
            <AgainstNow changes={liveChanges} selectedRegions={selectedRegions} readOnly={readOnly} onSelectedRegionsChange={onSelectedRegionsChange} />
          )
        ) : loading ? (
          <p role="status" className="version-note flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" /> Opening this version
          </p>
        ) : error ? (
          <div role="alert" className="version-note">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className="reference-text-action -ml-1.5 mt-1">
              Try again
            </button>
          </div>
        ) : (
          <div className="version-note">
            <AlertCircle className="mb-2 size-4 text-[var(--warning)]" />
            <p>
              This version can&apos;t be shown because its saved copy is {version.snapshotState === "corrupt" ? "damaged" : "missing"}. Everything after it is
              intact.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

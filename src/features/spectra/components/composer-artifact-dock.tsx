"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Check, ExternalLink, FileText, Link2, Loader2, X } from "lucide-react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import type { ResultCardStreamView } from "../ai/stream-events";
import type { SpectraArtifact } from "../data/api";
import { isArtifactTypeKey } from "../artifacts/registry";
import { suggestedEmbedInteraction } from "../capabilities";
import { workTypeMeta } from "./artifact-card";
import { useArtifactEmbedContainer } from "./artifact-embed-host";
import { readConvexError } from "../../../../shared/convex-error.mjs";

function pendingKeepKey(threadId: string | undefined, sourceId: string) {
  return JSON.stringify([threadId ?? "", sourceId]);
}

export function ComposerArtifactDock({
  artifacts,
  cards,
  explicitIds,
  threadId,
  onOpen,
  onDismiss,
}: {
  artifacts: SpectraArtifact[];
  cards?: ResultCardStreamView[];
  /** Selected or explicitly surfaced artifact identities. */
  explicitIds?: string[];
  threadId?: string;
  onOpen?: (artifactId: string) => void;
  onDismiss?: (artifactId: string) => void;
}) {
  const createReference = useMutation(api.artifactEmbeds.create);
  const existing = useArtifactEmbedContainer(
    "thread",
    threadId ?? "",
    Boolean(threadId),
  );
  const pendingRequests = useRef(new Map<string, object>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const activeView = useRef<{
    threadId: string | undefined;
    sourceIds: ReadonlySet<string>;
  } | null>(null);
  const embeddedSourceIds = useMemo(
    () =>
      new Set((existing?.embeds ?? []).map((embed) => embed.sourceArtifactId)),
    [existing?.embeds],
  );
  const rows = useMemo(() => {
    const byId = new Map(artifacts.map((artifact) => [artifact._id, artifact]));
    const ordered: string[] = [];
    const push = (id?: string | null) => {
      if (!id || !byId.has(id) || ordered.includes(id)) return;
      ordered.push(id);
    };
    for (const id of explicitIds ?? []) push(id);
    for (const card of cards ?? []) {
      for (const id of card.provenance?.artifactIds ?? []) push(id);
      for (const action of card.actions ?? []) {
        if (action.targetType === "artifact") push(action.targetId);
      }
    }
    return ordered.slice(0, 6).flatMap((id) => {
      const artifact = byId.get(id);
      return artifact ? [artifact] : [];
    });
  }, [artifacts, cards, explicitIds]);

  useEffect(() => {
    activeView.current = {
      threadId,
      sourceIds: new Set(rows.map((artifact) => artifact._id)),
    };
    return () => {
      activeView.current = null;
    };
  }, [rows, threadId]);

  async function keepInThread(artifact: SpectraArtifact) {
    const key = pendingKeepKey(threadId, artifact._id);
    if (
      !threadId ||
      !isArtifactTypeKey(artifact.blueprintKey) ||
      embeddedSourceIds.has(artifact._id) ||
      pendingRequests.current.has(key)
    )
      return;
    const request = { threadId, sourceId: artifact._id };
    pendingRequests.current.set(key, request);
    setPendingKeys(new Set(pendingRequests.current.keys()));
    try {
      await createReference({
        containerType: "thread",
        containerId: threadId,
        containerRegionId: `thread:work:${artifact._id}`,
        sourceArtifactId: artifact._id as Id<"spectraArtifacts">,
        mode: "compact",
        interaction: suggestedEmbedInteraction(artifact.blueprintKey),
        versionPolicy: "live",
        contextPolicy: "summary",
        displayPreferences: { sourceWorkType: artifact.blueprintKey },
      });
      // Membership comes from the authorized subscription. An acknowledgement
      // cannot resurrect a removed reference or mark another conversation kept.
    } catch (error) {
      if (
        pendingRequests.current.get(key) === request &&
        activeView.current?.threadId === request.threadId &&
        activeView.current.sourceIds.has(request.sourceId)
      ) {
        toast.error(
          readConvexError(error).message ||
            "This work could not be kept in the conversation.",
        );
      }
    } finally {
      if (pendingRequests.current.get(key) === request) {
        pendingRequests.current.delete(key);
        if (activeView.current)
          setPendingKeys(new Set(pendingRequests.current.keys()));
      }
    }
  }

  if (rows.length === 0) return null;

  return (
    <div
      className="mb-2 flex max-h-[148px] flex-col gap-1.5 overflow-y-auto [scrollbar-width:thin]"
      aria-label="Work from this conversation"
    >
      {rows.map((artifact) => {
        const meta = workTypeMeta[artifact.blueprintKey];
        const Icon = meta?.icon ?? FileText;
        const busy = pendingKeys.has(pendingKeepKey(threadId, artifact._id));
        return (
          <div
            key={artifact._id}
            data-spectra-card="result"
            data-card-state="normal"
            data-interactive={onOpen ? "true" : undefined}
            className="px-3 py-2 outline-none"
            style={{ "--card-accent": "var(--card-pinned)" } as CSSProperties}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)]"
                style={{ color: meta?.color ?? "var(--accent-gold)" }}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(artifact._id)}
                    className="block max-w-full truncate rounded-chip text-left text-caption font-semibold text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]"
                  >
                    {artifact.title}
                  </button>
                ) : (
                  <div className="truncate text-caption font-semibold text-[var(--text-primary)]">
                    {artifact.title}
                  </div>
                )}
                <div className="truncate text-micro text-[var(--text-secondary)]">
                  {artifact.summary ??
                    meta?.label ??
                    artifact.blueprintKey.replaceAll("_", " ")}
                </div>
              </div>
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(artifact._id)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  aria-label={`Open ${artifact.title}`}
                  title="Open"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {threadId && isArtifactTypeKey(artifact.blueprintKey) ? (
                embeddedSourceIds.has(artifact._id) ? (
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--success)]"
                    aria-label={`${artifact.title} is in this conversation`}
                    title="In conversation"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void keepInThread(artifact)}
                    disabled={busy}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-45"
                    aria-label={`Keep ${artifact.title} in this conversation`}
                    title="Keep in conversation"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                )
              ) : null}
              {onDismiss ? (
                <button
                  type="button"
                  onClick={() => onDismiss(artifact._id)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  aria-label={`Hide ${artifact.title}`}
                  title="Hide"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

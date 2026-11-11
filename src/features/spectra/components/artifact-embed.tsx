"use client";

import { useEmbedFromDevice } from "./use-embed-from-device";
import { ArrowUpRight, Check, RotateCw, AlertCircle, FileQuestion, Laptop, LockKeyhole, Maximize2, Minimize2, Pencil, Pin, Plus, Radio, Send, X } from "@/components/icons/glyph-icons";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { SpectraArtifactEmbed } from "../data/api";
import { workTypeMeta } from "./artifact-card";
import { workCardStyle } from "./work-card";
import { useSpectraMotion } from "../motion/motion-level";
import { transitionFor } from "../motion/grammar";
import { RetainedPinRecovery } from "./retained-pin-recovery";
import { shouldMountArtifactEmbedRuntime } from "./artifact-embed-runtime";
import { EmbedFace } from "./artifact-embed-faces";
import { OverflowMenu, type OverflowItem } from "@/components/ui/dropdown-menu";
import { useStudioContextItems, type StudioMenuItem } from "./studio-context-menu";

export { whiteboardPreviewNodes, type WhiteboardPreviewNode } from "./artifact-embed-faces";

/*
 * An embedded work is the same index card the shelf lays out (LIBRARY.md,
 * "The shelf"), set into the page: its kind's tab, its name, and its face,
 * which here is the work itself and works where it sits (artifact-embed-faces).
 * A click on the face opens the work beside the page, a double-click edits it
 * in place where the type allows (EDITORS.md, "Embeds"). The card's own
 * controls stay quiet until the reader comes near it.
 */

/** The key an embed's preview and its editor share, so one grows out of the other and folds back into it. */
export function embedLifeKey(embedId: string) {
  return `embed:${embedId}`;
}

/** What a press inside a preview uses itself: it neither opens nor edits the work. */
const PREVIEW_CONTROLS =
  "button, a, input, select, textarea, label, summary, iframe, [role='button'], [role='checkbox'], [role='radio'], [role='tab'], [contenteditable='true']";
/** How long a click waits to see if it is the first of a double-click (which edits instead of opening). */
const DOUBLE_CLICK_MS = 260;

function pressedControl(event: ReactMouseEvent) {
  return event.target instanceof Element && Boolean(event.target.closest(PREVIEW_CONTROLS));
}

type EmbedAction = "open" | "edit" | "expand" | "compact" | "live" | "pin" | "another" | "unstack" | "remove";

type Status = { icon: typeof Send; title: string; detail: string };

/** Why an embed cannot show its work, in the reader's words, or nothing when it can. */
function statusOf(embed: SpectraArtifactEmbed): Status | null {
  switch (embed.state) {
    case "no_access":
      return embed.accessRequest
        ? { icon: Send, title: "Access requested", detail: "Its owner decides. It appears here as soon as they say yes." }
        : { icon: LockKeyhole, title: "You can't open this yet", detail: "It belongs to someone who hasn't shared it with you, so nothing of it shows here." };
    case "deleted":
      return { icon: AlertCircle, title: "This artifact was deleted", detail: "The page around it is unchanged." };
    case "version_unavailable":
      return embed.placementRefreshKey
        ? { icon: AlertCircle, title: "The saved version needs checking", detail: "It shows again once it matches the page around it." }
        : { icon: AlertCircle, title: "The saved version is missing", detail: "Follow the live artifact instead, or remove it." };
    case "removed":
      return { icon: X, title: "No longer linked", detail: "This spot is no longer connected to its artifact. You can delete it from the page." };
    default:
      return null;
  }
}

function EmbedStatus({
  embed,
  status,
  busy,
  onRetry,
  onRequestAccess,
  onCancelAccessRequest,
  onUseLiveVersion,
}: {
  embed: SpectraArtifactEmbed;
  status: Status;
  busy: boolean;
  onRetry?: () => void;
  onRequestAccess?: () => void;
  onCancelAccessRequest?: (requestId: string) => void;
  onUseLiveVersion?: () => void;
}) {
  const StatusIcon = status.icon;
  return (
    <section className="work-embed-status">
      <StatusIcon className="size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <strong>{status.title}</strong>
        <p>{status.detail}</p>
        {embed.state === "version_unavailable" && embed.placementRefreshKey ? (
          <RetainedPinRecovery embedId={embed.embedId} refreshKey={embed.placementRefreshKey} />
        ) : null}
      </div>
      <div className="work-embed-status-actions">
        {embed.state === "no_access" && embed.canRequestAccess && onRequestAccess ? (
          <button type="button" disabled={busy} onClick={onRequestAccess} data-primary="">
            <Send className="size-3" />
            Request access
          </button>
        ) : null}
        {embed.state === "no_access" && embed.accessRequest && onCancelAccessRequest ? (
          <button type="button" disabled={busy} onClick={() => onCancelAccessRequest(embed.accessRequest!.requestId)}>
            Cancel request
          </button>
        ) : null}
        {embed.state === "version_unavailable" && !embed.sourceUnavailable && embed.canConfigure && onUseLiveVersion ? (
          <button type="button" disabled={busy} onClick={onUseLiveVersion} data-primary="">
            Follow the live artifact
          </button>
        ) : null}
        {onRetry && !embed.placementRefreshKey ? (
          <button type="button" disabled={busy} onClick={onRetry} aria-label="Retry embed" title="Try again">
            <RotateCw className="size-3.5" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function ArtifactEmbed({
  embed: reference,
  busy = false,
  onOpenSource,
  onRetry,
  onModeChange,
  onResize,
  onRequestAccess,
  onCancelAccessRequest,
  onUseLiveVersion,
  onPinVersion,
  onEdit,
  editor,
  onDoneEditing,
  onRemove,
  tabs,
  onStackAnother,
  onUnstack,
}: {
  embed: SpectraArtifactEmbed;
  busy?: boolean;
  onOpenSource?: (artifactId: string) => void;
  onRetry?: () => void;
  onModeChange?: (mode: "compact" | "expanded") => void;
  onResize?: (size: { width: number; height: number }) => void;
  onRequestAccess?: () => void;
  onCancelAccessRequest?: (requestId: string) => void;
  /** Back to the live work: offered for a pinned version too, which only reads. */
  onUseLiveVersion?: () => void;
  /** Hold this embed at the work's latest saved version. */
  onPinVersion?: () => void;
  /** The work can be edited here: a double-click on the preview, or Edit here. */
  onEdit?: () => void;
  /** The work's editor, shown in place of the preview while it is edited here. */
  editor?: ReactNode;
  onDoneEditing?: () => void;
  onRemove?: () => void;
  /** A stacked card's tabs, one per work, in place of this work's own tab. */
  tabs?: ReactNode;
  /** Lay another work on this card as a tab. */
  onStackAnother?: () => void;
  /** Take this work off a stacked card, onto one of its own. */
  onUnstack?: () => void;
}) {
  const embed = useEmbedFromDevice(reference);
  const rootRef = useRef<HTMLElement | null>(null);
  const faceRef = useRef<HTMLDivElement | null>(null);
  // Right-clicking a reference offers what its own menu does.
  const menuItems = useRef<StudioMenuItem[]>([]);
  useStudioContextItems(({ target }) => {
    const place = target.closest("[data-reference-id]");
    if (place?.getAttribute("data-reference-id") !== embed.embedId) return null;
    return [menuItems.current];
  });
  const openTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(openTimer.current), []);
  const isCode = embed.source?.blueprintKey === "code";
  const [nearViewport, setNearViewport] = useState(
    () => typeof window !== "undefined" && !("IntersectionObserver" in window),
  );
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  /* A drag on the native resize grip is the only thing that may persist a size.
     Reading the box on any pointer-up would save a size the reader never chose
     — a plain click, a text selection, or a pane resize would silently pin the
     card. So we remember the box when the pointer goes down and write only if
     that same interaction actually changed it. */
  const dragOriginRef = useRef<{ width: number; height: number } | null>(null);
  const motionLevel = useSpectraMotion();

  // A running visualisation pauses off screen and in a hidden tab.
  useEffect(() => {
    if (!isCode) return;
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(Boolean(entry?.isIntersecting)),
      { rootMargin: "640px 0px", threshold: 0.01 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [embed.embedId, isCode]);

  useEffect(() => {
    if (!isCode) return;
    const update = () => setPageVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [isCode]);

  const status = statusOf(embed);
  if (status) {
    // What can still be done to a card that cannot show its work: take it off
    // the page, or off its stack; a stacked card keeps its tabs to turn away.
    const statusActions: OverflowItem<"unstack" | "remove">[] = [
      ...(onUnstack ? [{ key: "unstack" as const, label: "Give it a card of its own", icon: ArrowUpRight }] : []),
      ...(onRemove ? [{ key: "remove" as const, label: "Remove from page", icon: X }] : []),
    ];
    const body = (
      <EmbedStatus
        embed={embed}
        status={status}
        busy={busy}
        onRetry={onRetry}
        onRequestAccess={onRequestAccess}
        onCancelAccessRequest={onCancelAccessRequest}
        onUseLiveVersion={onUseLiveVersion}
      />
    );
    if (!tabs && !statusActions.length) return body;
    return (
      <section data-reference-id={embed.embedId} className="work-embed" data-mode={embed.mode}>
        <div className="work-embed-top">
          {tabs ?? <span />}
          {statusActions.length ? (
            <div className="work-embed-more">
              <OverflowMenu<"unstack" | "remove">
                label="Options for this reference"
                size={28}
                items={statusActions}
                onSelect={(action) => (action === "unstack" ? onUnstack?.() : onRemove?.())}
                triggerClassName="work-embed-more-trigger"
                modal={false}
              />
            </div>
          ) : null}
        </div>
        {body}
      </section>
    );
  }

  const source = embed.source;
  const meta = source ? workTypeMeta[source.blueprintKey] : null;
  if (!source || !meta) return null;
  const Icon = meta.icon ?? FileQuestion;
  const sourceId = source.artifactId;
  const pinned = embed.versionPolicy === "pinned";
  const expanded = embed.mode === "expanded";
  const interaction = embed.effectiveInteraction ?? embed.interaction;
  const referenceState = [
    expanded ? "Expanded" : "Compact",
    pinned ? "a saved version" : "live",
    embed.sourceUnavailable ? "unavailable" : undefined,
    interaction === "read" ? "read only" : interaction === "interact" ? "usable here" : interaction === "edit" ? "editable here" : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  const openFromPreview = (event: ReactMouseEvent) => {
    if (!onOpenSource || pressedControl(event)) return;
    window.clearTimeout(openTimer.current);
    if (!onEdit) return onOpenSource(sourceId);
    openTimer.current = window.setTimeout(() => onOpenSource(sourceId), DOUBLE_CLICK_MS);
  };
  const editFromPreview = (event: ReactMouseEvent) => {
    if (!onEdit || pressedControl(event)) return;
    window.clearTimeout(openTimer.current);
    onEdit();
  };

  const embedActions: OverflowItem<EmbedAction>[] = [
    ...(onOpenSource ? [{ key: "open" as const, label: "Open", icon: ArrowUpRight }] : []),
    ...(onEdit ? [{ key: "edit" as const, label: "Edit here", icon: Pencil, hint: "Double-click" }] : []),
    ...(onModeChange
      ? [expanded
          ? { key: "compact" as const, label: "Show less", icon: Minimize2 }
          : { key: "expand" as const, label: "Show more", icon: Maximize2 }]
      : []),
    ...(embed.canConfigure && pinned && onUseLiveVersion
      ? [{ key: "live" as const, label: "Follow the live artifact", icon: Radio }]
      : []),
    ...(embed.canConfigure && !pinned && onPinVersion
      ? [{ key: "pin" as const, label: "Keep this version", icon: Pin }]
      : []),
    ...(onStackAnother ? [{ key: "another" as const, label: "Add another artifact here", icon: Plus }] : []),
    ...(onUnstack ? [{ key: "unstack" as const, label: "Give it a card of its own", icon: ArrowUpRight }] : []),
    ...(onRemove ? [{ key: "remove" as const, label: "Remove from page", icon: X }] : []),
  ].map((item) => ({ ...item, disabled: busy && item.key !== "open" }));
  const runAction = (action: EmbedAction) => {
    if (action === "open") onOpenSource?.(sourceId);
    else if (action === "edit") onEdit?.();
    else if (action === "expand") onModeChange?.("expanded");
    else if (action === "compact") onModeChange?.("compact");
    else if (action === "live") onUseLiveVersion?.();
    else if (action === "pin") onPinVersion?.();
    else if (action === "another") onStackAnother?.();
    else if (action === "unstack") onUnstack?.();
    else onRemove?.();
  };
  menuItems.current = embedActions.map((item) => ({
    key: `embed-${item.key}`,
    label: item.label,
    icon: typeof item.icon === "string" ? undefined : item.icon,
    hint: item.hint,
    disabled: item.disabled,
    onSelect: () => runAction(item.key),
  }));

  const sized = expanded
    ? {
        width: typeof embed.displayPreferences?.width === "number" ? embed.displayPreferences.width : undefined,
        height: typeof embed.displayPreferences?.height === "number" ? embed.displayPreferences.height : undefined,
        resize: onResize ? ("both" as const) : undefined,
      }
    : undefined;

  return (
    <motion.section
      layout={!motionLevel.disabled}
      transition={motionLevel.disabled ? undefined : transitionFor("morph", motionLevel.level)}
      ref={rootRef}
      data-reference-id={embed.embedId}
      data-embed-editing={editor ? "true" : undefined}
      data-mode={embed.mode}
      data-work-card={source.blueprintKey}
      className="work-embed"
      style={workCardStyle(source.blueprintKey)}
    >
      <div className="work-embed-top">
      {/* The tab names the work; its kind is in the icon and the card's hue.
          A stacked card has a tab for each of its works instead. */}
      {tabs ?? (
      <span className="work-card-tab work-embed-tab">
        <Icon className="size-3.5" aria-hidden />
        <span className="sr-only">{meta.label}: </span>
        {onOpenSource ? (
          <button type="button" tabIndex={-1} onClick={() => onOpenSource(sourceId)} className="work-embed-title">
            {source.title}
          </button>
        ) : (
          <span className="work-embed-title">{source.title}</span>
        )}
        <span className="sr-only">, {referenceState}</span>
        {pinned ? (
          <span className="work-embed-tab-note" title="This shows a saved version. It stays as it is when the artifact changes.">
            <Pin className="size-3" aria-hidden />
            Saved version
          </span>
        ) : null}
        {embed.sourceUnavailable ? (
          <span className="work-embed-tab-note" data-warning="">
            <AlertCircle className="size-3" aria-hidden />
            Unavailable
          </span>
        ) : null}
      </span>
      )}
      {/* Everything the reader can do to the embed itself waits in one menu on
          its border, so the face holds only the work. */}
      <div className="work-embed-more">
        {editor && onDoneEditing ? (
          <button type="button" onClick={onDoneEditing} title="Stop editing here (Esc)" className="work-embed-done">
            <Check className="size-3.5" />
            Done
          </button>
        ) : (
          <OverflowMenu<EmbedAction>
            label={`Options for ${source.title}`}
            size={28}
            items={embedActions}
            onSelect={runAction}
            triggerClassName="work-embed-more-trigger"
            modal={false}
          />
        )}
      </div>
      </div>
      <div
        ref={faceRef}
        className="work-card-face work-embed-face"
        style={sized}
        onPointerDown={() => {
          if (!onResize || !expanded || !faceRef.current) {
            dragOriginRef.current = null;
            return;
          }
          const bounds = faceRef.current.getBoundingClientRect();
          dragOriginRef.current = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
        }}
        onPointerCancel={() => {
          dragOriginRef.current = null;
        }}
        onPointerUp={() => {
          const origin = dragOriginRef.current;
          dragOriginRef.current = null;
          if (!onResize || !expanded || !faceRef.current || !origin) return;
          const bounds = faceRef.current.getBoundingClientRect();
          const width = Math.round(bounds.width);
          const height = Math.round(bounds.height);
          if (Math.abs(width - origin.width) > 3 || Math.abs(height - origin.height) > 3) onResize({ width, height });
        }}
      >
        {editor ?? (
          <motion.div
            key={embed.mode}
            // The editor grows out of this preview and folds back into it.
            data-life-key={embedLifeKey(embed.embedId)}
            data-life-launch=""
            data-embed-preview=""
            data-opens={onOpenSource ? "true" : undefined}
            onClick={openFromPreview}
            onDoubleClick={editFromPreview}
            initial={motionLevel.disabled ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={
              motionLevel.disabled
                ? undefined
                : {
                    ...transitionFor("reveal", motionLevel.level),
                    // Geometry settles first, then the content declares itself.
                    delay: motionLevel.reduced ? 0 : 0.09,
                  }
            }
            className="work-embed-body"
          >
            {embed.keptOn ? (
              <p className="work-embed-kept">
                <Laptop className="size-4 shrink-0" aria-hidden />
                <span>
                  <strong>Kept on {embed.keptOn.deviceName}</strong>
                  Its contents stay on that computer, so they don&apos;t show here. Open it there to read it.
                </span>
              </p>
            ) : shouldMountArtifactEmbedRuntime({ sourceType: source.blueprintKey, nearViewport, pageVisible }) ? (
              <EmbedFace embed={embed} />
            ) : (
              <p className="work-embed-empty" aria-label="Published runtime paused">
                Paused until it is back on screen.
              </p>
            )}
          </motion.div>
        )}
      </div>
    </motion.section>
  );
}

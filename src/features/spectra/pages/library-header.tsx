"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Download, PencilLine, Trash2 } from "@/components/icons/glyph-icons";
import { Icon } from "@/components/icons";
import { OverflowMenu } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { workspaceThreadCount } from "../components/spectra-view-model";
import type { SpectraRun, SpectraWorkspace, SpectraWorkspaceItem } from "../data/api";
import { classSentence, classWorkspaceIdentity, isClassWorkspace, useClassTasks } from "../organization/class-shelf";
import { useTreePath, type TreeNode } from "../organization/tree-client";
import { inkStyle, useClassBook } from "../school/use-class-book";

/*
 * The Library's greeting (SHELL.md, "Page anatomy"). At the top it is the
 * Library; inside a folder it is that folder, so the page always opens with
 * the name of the place the student is in, the way Home opens with the day,
 * and the breadcrumb under it says how they got there. A class greets with
 * what is to do for it. A workspace is a place in the Library too, so its
 * header stands in the same frame, a size down from the Library's own.
 */

export const WORKSPACE_BAR_PLAN: readonly CollapseStep[] = [{ hideLabel: "chats" }, { hideLabel: "people" }, { toMenu: "chats" }];

export function LibraryHeader({
  surface,
  folderId,
  workspaceCount,
  onOpenChats,
}: {
  surface: "library" | "workspace";
  /** The folder the Library has open, or null at its top. */
  folderId: string | null;
  workspaceCount: number;
  onOpenChats?: () => void;
}) {
  const path = useTreePath(surface === "library" ? folderId : null);
  const folder = folderId && path?.node.nodeId === folderId ? path.node : null;
  const threads: BarCommand[] = onOpenChats ? [{ id: "chats", icon: "conversations", label: "Threads", onSelect: onOpenChats }] : [];

  if (folder && isClassWorkspace(folder)) return <ClassHeader folder={folder} threads={threads} />;
  if (folder)
    return (
      <Frame>
        {/* The list under it says what is here; a count or an "empty" over it only repeats it, or, unread, gets it wrong. */}
        <PageHeader title={folder.name} level="place" commands={threads} plan={WORKSPACE_BAR_PLAN} barLabel="Library commands" />
      </Frame>
    );
  return (
    <Frame>
      <PageHeader
        title={surface === "library" ? "Library" : "Workspace"}
        commands={threads}
        plan={WORKSPACE_BAR_PLAN}
        barLabel={surface === "library" ? "Library commands" : "Workspace commands"}
        description={
          surface === "library"
            ? "Everything you have made, filed where you put it."
            : workspaceCount === 0
              ? "Your work lives here."
              : workspaceCount === 1
                ? "One workspace, and everything filed across it."
                : `${workspaceCount} workspaces, and everything filed across them.`
        }
      />
    </Frame>
  );
}

export function WorkspaceHeader({
  workspace,
  items,
  runs,
  optimisticActive,
  optimisticRunId,
  onEditWorkspace,
  onShareWorkspace,
  onExportWorkspace,
  onDeleteWorkspace,
  onOpenChats,
}: {
  workspace: SpectraWorkspace | null;
  items: SpectraWorkspaceItem[];
  runs: SpectraRun[];
  optimisticActive?: boolean;
  optimisticRunId?: string;
  onEditWorkspace: () => void;
  onShareWorkspace: () => void;
  onExportWorkspace: () => void;
  onDeleteWorkspace: () => void;
  onOpenChats?: () => void;
}) {
  const artifactCount = items.filter((item) => item.artifact).length;
  const threadCount = workspaceThreadCount(items);
  const cardCount = items.filter((item) => item.pinned).length;
  const persistedActiveRuns = runs.filter(
    (run) =>
      run.status === "running" ||
      run.status === "queued" ||
      run.status === "awaiting_confirmation" ||
      run.status === "awaiting_resolution",
  ).length;
  const activeRuns =
    persistedActiveRuns +
    (optimisticActive &&
    (!optimisticRunId || !runs.some((run) => run._id === optimisticRunId))
      ? 1
      : 0);

  const commands: BarCommand[] = [
    ...(onOpenChats
      ? [{ id: "chats", icon: "conversations", label: "Threads", onSelect: onOpenChats } satisfies BarCommand]
      : []),
    {
      id: "people",
      icon: "people",
      label: workspace?.sharedWithCount
        ? `${workspace.sharedWithCount} ${workspace.sharedWithCount === 1 ? "person" : "people"}`
        : "People",
      onSelect: onShareWorkspace,
    },
    {
      id: "more",
      icon: "more",
      label: "More workspace actions",
      pinned: true,
      render: () => (
        <OverflowMenu
          label="More workspace actions"
          items={[
            { key: "settings", label: "Workspace settings", icon: PencilLine },
            { key: "export", label: "Export workspace", icon: Download },
            { key: "delete", label: "Delete workspace", icon: Trash2 },
          ]}
          onSelect={(key) => {
            if (key === "settings") onEditWorkspace();
            else if (key === "export") onExportWorkspace();
            else if (key === "delete") onDeleteWorkspace();
          }}
          size={32}
        />
      ),
    },
  ];

  return (
    <Frame role="group" ariaLabel={`${artifactCount} work items, ${threadCount} threads, ${cardCount} pinned, ${activeRuns} active runs`}>
      <PageHeader
        title={
          <span className="inline-flex min-w-0 max-w-full items-center gap-2">
            <span className="truncate">{workspace?.title ?? "Workspace"}</span>
            {workspace?.isShared ? (
              <span role="img" aria-label="Shared workspace" className="inline-flex shrink-0 text-[var(--text-tertiary)]">
                <Icon name="share" size={16} />
              </span>
            ) : null}
          </span>
        }
        level="place"
        commands={commands}
        plan={WORKSPACE_BAR_PLAN}
        barLabel="Workspace commands"
        description={workspace?.description || undefined}
        lifeKey={workspace?._id}
      />
    </Frame>
  );
}

function ClassHeader({ folder, threads }: { folder: TreeNode; threads: BarCommand[] }) {
  const router = useRouter();
  const book = useClassBook();
  const [now] = useState(() => Date.now());
  const identity = classWorkspaceIdentity(folder, book);
  const providerClassId = book.idNamed(folder.name);
  const { loading, ahead } = useClassTasks(providerClassId, now);
  const school: BarCommand = {
    id: "school",
    icon: "school",
    label: "Open in School",
    labelPolicy: "always",
    onSelect: () => router.push(providerClassId ? `/school?section=classes&class=${encodeURIComponent(providerClassId)}` : "/school?section=classes"),
  };
  return (
    <Frame className="library-header--class" style={inkStyle(identity)}>
      <PageHeader
        title={folder.name}
        level="place"
        lifeKey={`class:${folder.nodeId}`}
        commands={[school, ...threads]}
        plan={WORKSPACE_BAR_PLAN}
        barLabel={`${folder.name} commands`}
        description={loading ? " " : classSentence(identity, folder.name, ahead, now)}
      />
    </Frame>
  );
}

function Frame({
  children,
  className,
  style,
  role,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  role?: string;
  ariaLabel?: string;
}) {
  return (
    <div role={role} aria-label={ariaLabel} style={style} className={cn("spectra-workspace-header border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-8 pb-4 pt-6", className)}>
      {children}
    </div>
  );
}

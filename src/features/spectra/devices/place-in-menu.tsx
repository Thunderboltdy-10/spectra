"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { treeFailureMessage, useTreeActions, useTreeContainers, type TreeNode } from "../organization/tree-client";

export type Placeable = { nodeId: string; name: string };

function ContainerRows({
  parentId,
  depth,
  skip,
  onChoose,
}: {
  parentId: string | null;
  depth: number;
  skip: ReadonlySet<string>;
  onChoose: (node: TreeNode) => void;
}) {
  const { nodes, status } = useTreeContainers(parentId, true);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const shown = nodes.filter((node) => !skip.has(node.nodeId));
  if (!shown.length && depth === 0)
    return (
      <p className="px-2 py-1.5 text-caption text-[var(--text-secondary)]">
        {status === "LoadingFirstPage" ? "Finding your workspaces" : "No workspaces yet."}
      </p>
    );
  return (
    <>
      {shown.map((node) => {
        const expanded = open.has(node.nodeId);
        const nests = (node.childCount ?? 1) > 0;
        return (
          <div key={node.nodeId}>
            <div className="place-in-row" style={{ paddingLeft: depth * 14 }}>
              <button type="button" className="place-in-choice" onClick={() => onChoose(node)}>
                <Icon name="folder" size={14} />
                <span className="min-w-0 truncate">{node.name}</span>
              </button>
              {nests ? (
                <button
                  type="button"
                  className="place-in-more"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Hide" : "Show"} folders in ${node.name}`}
                  onClick={() =>
                    setOpen((current) => {
                      const next = new Set(current);
                      if (expanded) next.delete(node.nodeId);
                      else next.add(node.nodeId);
                      return next;
                    })
                  }
                >
                  <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} />
                </button>
              ) : null}
            </div>
            {expanded ? <ContainerRows parentId={node.nodeId} depth={depth + 1} skip={skip} onChoose={onChoose} /> : null}
          </div>
        );
      })}
    </>
  );
}

function wordFor(items: readonly Placeable[]) {
  return items.length === 1 ? items[0]!.name : `${items.length} items`;
}

/**
 * Choosing where work goes, for one thing or many. It stays where it is as
 * well: this adds it to the chosen place, and adding it twice changes nothing.
 */
export function PlaceInMenu({
  items,
  children,
  align = "end",
  skip,
  emptyHint,
  onPlaced,
}: {
  items: readonly Placeable[];
  children: ReactNode;
  align?: "start" | "end";
  /** Places that make no sense for these items, such as a folder itself. */
  skip?: ReadonlySet<string>;
  /** Shown when there is nothing to place yet, such as a file still arriving. */
  emptyHint?: string;
  onPlaced?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { createReference } = useTreeActions();
  const place = async (target: TreeNode) => {
    setOpen(false);
    const failures: string[] = [];
    let lastError: unknown;
    for (const item of items) {
      try {
        await createReference(item.nodeId, target.nodeId);
      } catch (error) {
        failures.push(item.name);
        lastError = error;
      }
    }
    if (!failures.length) {
      toast.success(`${wordFor(items)} ${items.length === 1 ? "is" : "are"} in ${target.name}.`);
      onPlaced?.();
    } else {
      toast.error(treeFailureMessage(lastError, `Couldn't add ${failures.length === 1 ? failures[0] : `${failures.length} items`} to ${target.name}.`));
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="place-in-menu">
        {items.length === 0 ? (
          <p className="px-2 py-1.5 text-caption text-[var(--text-secondary)]">{emptyHint ?? "Nothing selected."}</p>
        ) : open ? (
          <ContainerRows parentId={null} depth={0} skip={skip ?? new Set()} onChoose={(node) => void place(node)} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

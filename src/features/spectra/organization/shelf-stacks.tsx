"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { Icon } from "@/components/icons";
import { OverflowMenu, type OverflowItem } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ClassIdentity } from "../../../../shared/class-identity";
import { aiWorking } from "../artifacts/ai-working";
import { authoredSummary } from "../artifacts/registry";
import { useWorkPreview } from "../artifacts/use-work-previews";
import { workTypeMeta } from "../components/artifact-card";
import { WorkCardBody, workCardStyle } from "../components/work-card";
import { useAuthedArgs } from "../data/use-authed-args";
import { LibraryNote, PickMark, pickable, previewSource, workSourceOf, workType, type WorkPicking } from "./library-note";
import { relativeTime } from "./node-identity";
import { useShelfGather, type GatherDrop } from "./shelf-gather";
import { useStackLook } from "./library-view";
import type { TreeNode } from "./tree-client";

/*
 * Stacks (LIBRARY.md, "Stacks"): works laid on one another on a shelf become
 * one card. Closed, it is a folder listing them, each name opening its work;
 * opened, the folder wipes away and the card underneath has a binder tab for
 * each work, so one press on a tab turns to that work. Nothing moves: each work still lives
 * where it was, and the stack is only how the shelf shows them.
 */

/** One place on a shelf: a work, or a stack led by its newest work. */
export type ShelfItem = { node: TreeNode; stack?: TreeNode[] };

/**
 * The shelf's work with each stack gathered at its newest work's place. A
 * stack's other works come whole from the server, so it shows complete even
 * when they are further down the shelf's pages.
 */
export function useShelfStacks(nodes: readonly TreeNode[]): ShelfItem[] {
  const stackIds = useMemo(
    () => [...new Set(nodes.flatMap((node) => (node.stackId ? [node.stackId] : [])))].sort(),
    [nodes],
  );
  const members = useQuery(api.workStacks.members, useAuthedArgs(stackIds.length ? { stackIds } : "skip"));
  return useMemo(() => {
    const whole = new Map((members ?? []).map((stack) => [stack.stackId, stack.nodes as TreeNode[]]));
    const seen = new Set<string>();
    const items: ShelfItem[] = [];
    for (const node of nodes) {
      if (!node.stackId) {
        items.push({ node });
        continue;
      }
      if (seen.has(node.stackId)) continue;
      seen.add(node.stackId);
      const stack = whole.get(node.stackId) ?? nodes.filter((other) => other.stackId === node.stackId);
      const rest = stack.filter((other) => other.nodeId !== node.nodeId);
      items.push(rest.length ? { node, stack: [node, ...rest] } : { node });
    }
    return items;
  }, [nodes, members]);
}

/** A shelf's cards, any of which can be laid on another to stack them. */
export function ShelfNotes({
  items,
  now,
  placeOf = () => null,
  whereOf = () => undefined,
  onOpen,
  onMenu,
  picking,
  onMoveInto,
}: {
  items: readonly ShelfItem[];
  now: number;
  /** The place whose colour a card wears; null keeps its kind's. */
  placeOf?: (node: TreeNode) => ClassIdentity | null;
  /** The place named at a card's foot. */
  whereOf?: (node: TreeNode) => string | undefined;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  picking?: WorkPicking;
  /** Moves a card into the workspace whose tile it was let go on. */
  onMoveInto?: (nodeId: string, placeId: string) => void;
}) {
  const gather = useMutation(api.workStacks.gather);
  const release = useMutation(api.workStacks.release);
  const drop = async ({ nodeId, ontoNodeId, intoPlaceId, fromStack }: GatherDrop) => {
    try {
      if (intoPlaceId) onMoveInto?.(nodeId, intoPlaceId);
      else if (ontoNodeId)
        await gather({ nodeId: nodeId as Id<"orgNodes">, ontoNodeId: ontoNodeId as Id<"orgNodes"> });
      else if (fromStack) await release({ nodeId: nodeId as Id<"orgNodes"> });
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "Could not stack these." }).message);
    }
  };
  const beginGather = useShelfGather((next) => void drop(next), !picking);
  const openOrPick = (node: TreeNode) => (picking && pickable(node) ? picking.toggle(node) : onOpen(node));

  return (
    <ul className="library-notes">
      {items.map((item) => {
        const stackable = item.node.kind === "work";
        return (
          <li
            key={item.stack ? `stack:${item.node.stackId}` : item.node.nodeId}
            data-shelf-item={stackable ? item.node.nodeId : undefined}
          >
            {item.stack ? (
              <LibraryStack
                nodes={item.stack}
                now={now}
                placeOf={placeOf}
                whereOf={whereOf}
                onOpen={openOrPick}
                onMenu={onMenu}
                picking={picking}
                onGather={beginGather}
                onRelease={(node, all) =>
                  void release({ nodeId: node.nodeId as Id<"orgNodes">, all }).catch((error) =>
                    toast.error(describeFailure(error, { fallback: "Could not take it out." }).message),
                  )
                }
              />
            ) : (
              <div
                data-shelf-drag={stackable ? undefined : item.node.nodeId}
                onPointerDown={
                  stackable
                    ? (event) => beginGather(event, item.node.nodeId, false)
                    : onMoveInto
                      ? (event) => beginGather(event, item.node.nodeId, false, true)
                      : undefined
                }
              >
                <LibraryNote
                  node={item.node}
                  place={placeOf(item.node)}
                  where={whereOf(item.node)}
                  now={now}
                  onOpen={openOrPick}
                  onMenu={onMenu}
                  picked={picking && pickable(item.node) ? picking.has(item.node) : undefined}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type StackAction = "fold" | "out" | "all";

function LibraryStack({
  nodes,
  now,
  placeOf,
  whereOf,
  onOpen,
  onMenu,
  picking,
  onGather,
  onRelease,
}: {
  nodes: TreeNode[];
  now: number;
  placeOf: (node: TreeNode) => ClassIdentity | null;
  whereOf: (node: TreeNode) => string | undefined;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  picking?: WorkPicking;
  onGather: ReturnType<typeof useShelfGather>;
  onRelease: (node: TreeNode, all?: boolean) => void;
}) {
  const [look, setLook] = useStackLook(nodes[0]!.stackId ?? nodes[0]!.nodeId);
  const open = look === "cards";
  const [activeId, setActiveId] = useState(nodes[0]!.nodeId);
  const active = nodes.find((node) => node.nodeId === activeId) ?? nodes[0]!;
  const type = workType(active);
  const card = useRef<HTMLDivElement>(null);
  const preview = useWorkPreview(previewSource(active), card);
  const picked = picking && pickable(active) ? picking.has(active) : undefined;
  const options: OverflowItem<StackAction>[] = [
    { key: "fold", label: "Put back in the folder", icon: "folder" },
    { key: "out", label: `Take “${active.name}” out`, icon: "arrowUp" },
    { key: "all", label: "Unstack all", icon: "layers" },
  ];

  return (
    <div
      ref={card}
      className="work-card work-stack"
      data-open={open || undefined}
      data-work-card={type}
      data-work-source={workSourceOf(active)}
      data-node-row={active.nodeId}
      data-picking={picking ? true : undefined}
      data-picked={picked || undefined}
      style={workCardStyle(type, placeOf(active)?.ink)}
      onPointerDown={(event) => onGather(event, active.nodeId, true)}
    >
      <div className="work-stack-tabs">
        <div role="tablist" aria-label={`Stack of ${nodes.length} works`} className="work-stack-tab-strip" inert={!open}>
          {nodes.map((node, index) => {
            const meta = workTypeMeta[workType(node)];
            return (
              <button
                key={node.nodeId}
                type="button"
                role="tab"
                aria-selected={node === active}
                title={node.name}
                className="work-card-tab work-stack-tab"
                style={{ ...workCardStyle(workType(node), placeOf(node)?.ink), "--tab-index": index } as React.CSSProperties}
                onClick={() => setActiveId(node.nodeId)}
              >
                <Icon name={meta.glyph} size={12} />
                <span className="work-stack-tab-name">{node.name}</span>
              </button>
            );
          })}
        </div>
        <span data-stack-menu className="work-stack-options" inert={!open}>
          <OverflowMenu<StackAction>
            label="Stack options"
            size={24}
            items={options}
            onSelect={(key) => (key === "fold" ? setLook("folder") : onRelease(active, key === "all"))}
            triggerClassName="work-stack-more-trigger"
          />
        </span>
      </div>
      <button
        type="button"
        aria-label={active.name}
        aria-pressed={picked}
        data-life-launch
        className="work-stack-face"
        inert={!open}
        onClick={() => onOpen(active)}
        onContextMenu={(event) => onMenu(event, active)}
      >
        <WorkCardBody
          bare
          type={type}
          title={active.name}
          preview={preview}
          summary={authoredSummary(active.source?.blueprintKey, active.source?.summary)}
          place={whereOf(active)}
          when={relativeTime(active.activityAt, now)}
          live={aiWorking(active.source)}
        />
        {picked !== undefined ? <PickMark /> : null}
      </button>
      <StackFolder nodes={nodes} open={open} onOpenCards={() => setLook("cards")} onPick={onOpen} />
    </div>
  );
}

/**
 * The folder a stack rests in: how many it holds and every work's name, each
 * opening its work straight from the folder. Its tab, or a press anywhere
 * else on it, opens the folder into cards; the menu on the cards puts them
 * back. Which of the two a stack shows is remembered on this device.
 */
function StackFolder({
  nodes,
  open,
  onOpenCards,
  onPick,
}: {
  nodes: TreeNode[];
  open: boolean;
  onOpenCards: () => void;
  onPick: (node: TreeNode) => void;
}) {
  return (
    <div className="work-stack-cover" inert={open} onClick={onOpenCards}>
      <button
        type="button"
        className="work-stack-folder-tab"
        aria-label={`Open the stack of ${nodes.length} works as cards`}
        title="Show as cards"
        onClick={(event) => {
          event.stopPropagation();
          onOpenCards();
        }}
      >
        <Icon name="folder" size={12} />
        {nodes.length} works
        <Icon name="expand" size={11} />
      </button>
      <div className="work-stack-folder-front">
        <ul className="work-stack-names" aria-label="Works in this stack">
          {nodes.map((node) => (
            <li key={node.nodeId} style={workCardStyle(workType(node))}>
              <button
                type="button"
                data-life-launch
                title={`Open ${node.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPick(node);
                }}
              >
                <Icon name={workTypeMeta[workType(node)].glyph} size={12} />
                <span>{node.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

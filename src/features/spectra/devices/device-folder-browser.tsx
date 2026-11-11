"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { nodeIdentity } from "../organization/node-identity";
import { isPlaceNode, useTreeChildren, type TreeNode } from "../organization/tree-client";
import { PlaceInMenu, type Placeable } from "./place-in-menu";

/** What placing a row means: a reference is placed as the thing it points at. */
function placeable(node: TreeNode): Placeable {
  return node.kind === "link" && node.target ? { nodeId: node.target.nodeId, name: node.target.name } : { nodeId: node.nodeId, name: node.name };
}

function sourceOf(node: TreeNode) {
  if (node.kind === "work") return node.sourceId;
  return node.kind === "link" && node.target?.kind === "work" ? node.target.sourceId : undefined;
}

/**
 * Inside a folder on a computer, as Spectra has it: the files listed plainly,
 * any of them chosen to go into a workspace or folder. A file that arrived with
 * a folder is the same kind of thing as one chosen on its own.
 */
export function DeviceFolderBrowser({
  rootNodeId,
  name,
  onClose,
}: {
  rootNodeId: string;
  name: string;
  onClose: () => void;
}) {
  const [trail, setTrail] = useState<readonly Placeable[]>([{ nodeId: rootNodeId, name }]);
  const here = trail[trail.length - 1]!;
  const { nodes, status, loadMore } = useTreeChildren(here.nodeId, { sortKey: "name", direction: "asc", pageSize: 60, withoutThreads: true });
  const [picked, setPicked] = useState<ReadonlyMap<string, Placeable>>(new Map());
  const anchor = useRef<string | null>(null);
  const rows = useMemo(
    () => [...nodes.filter(isPlaceNode), ...nodes.filter((node) => !isPlaceNode(node))],
    [nodes],
  );
  const allPicked = rows.length > 0 && rows.every((node) => picked.has(placeable(node).nodeId));

  const toggle = (node: TreeNode, range: boolean) => {
    const item = placeable(node);
    const from = range && anchor.current ? rows.findIndex((row) => placeable(row).nodeId === anchor.current) : -1;
    const to = rows.indexOf(node);
    setPicked((current) => {
      const next = new Map(current);
      const on = !next.has(item.nodeId);
      if (from >= 0 && to >= 0) {
        for (const row of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          const entry = placeable(row);
          if (on) next.set(entry.nodeId, entry);
          else next.delete(entry.nodeId);
        }
      } else if (on) next.set(item.nodeId, item);
      else next.delete(item.nodeId);
      return next;
    });
    anchor.current = item.nodeId;
  };
  const toggleAll = () =>
    setPicked((current) => {
      const next = new Map(current);
      for (const node of rows) {
        const entry = placeable(node);
        if (allPicked) next.delete(entry.nodeId);
        else next.set(entry.nodeId, entry);
      }
      return next;
    });

  return (
    <li className="device-browser" aria-label={`Files in ${name}`}>
      <div className="device-browser-head">
        <nav aria-label="Folder path" className="device-browser-trail">
          {trail.map((step, index) => {
            const last = index === trail.length - 1;
            return (
              <span key={step.nodeId} className="flex min-w-0 items-center gap-1">
                {index ? <Icon name="chevronRight" size={12} className="shrink-0 text-[var(--text-tertiary)]" /> : null}
                {last ? (
                  <span aria-current="page" className="truncate font-medium text-[var(--text-primary)]">{step.name}</span>
                ) : (
                  <button type="button" className="truncate hover:text-[var(--text-primary)]" onClick={() => setTrail(trail.slice(0, index + 1))}>
                    {step.name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <IconButton icon="close" label={`Close ${name}`} size="compact" onClick={onClose} />
      </div>

      {status === "LoadingFirstPage" ? (
        <p className="device-browser-quiet">Reading this folder</p>
      ) : !rows.length ? (
        <p className="device-browser-quiet">Nothing here yet. Files appear as they sync.</p>
      ) : (
        <>
          <label className="device-browser-all">
            <input type="checkbox" checked={allPicked} onChange={toggleAll} />
            <span>Select everything here</span>
          </label>
          <ul className="device-browser-list">
            {rows.map((node) => {
              const item = placeable(node);
              const place = isPlaceNode(node);
              const source = sourceOf(node);
              const identity = nodeIdentity(node);
              const IdentityIcon = identity.icon;
              return (
                <li key={node.nodeId} className="device-browser-row" data-picked={picked.has(item.nodeId) || undefined}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${node.name}`}
                    checked={picked.has(item.nodeId)}
                    onChange={() => undefined}
                    onClick={(event) => toggle(node, event.shiftKey)}
                  />
                  <IdentityIcon size={15} className="shrink-0" style={{ color: identity.color }} aria-hidden />
                  {place ? (
                    <button type="button" className="device-browser-name" onClick={() => setTrail([...trail, item])}>
                      {node.name}
                    </button>
                  ) : (
                    <button type="button" className="device-browser-name" onClick={(event) => toggle(node, event.shiftKey)}>
                      {node.name}
                    </button>
                  )}
                  {place ? <Icon name="chevronRight" size={14} className="shrink-0 text-[var(--text-tertiary)]" /> : null}
                  {source ? (
                    <Link href={`/library?artifactId=${source}`} className="device-browser-open">
                      Open
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {status === "CanLoadMore" ? (
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => loadMore(60)}>
              Show more
            </Button>
          ) : null}
        </>
      )}

      <div className="device-browser-foot">
        <span className="min-w-0 flex-1 truncate text-caption text-[var(--text-secondary)]">
          {picked.size ? `${picked.size} selected` : "Select files to add them to a workspace or folder."}
        </span>
        {picked.size ? (
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Map())}>
            Clear
          </Button>
        ) : null}
        <PlaceInMenu
          items={[...picked.values()]}
          skip={new Set(trail.map((step) => step.nodeId))}
          onPlaced={() => setPicked(new Map())}
        >
          <Button variant="primary" size="sm" disabled={!picked.size}>
            Add to…
          </Button>
        </PlaceInMenu>
      </div>
    </li>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { Icon } from "@/components/icons";
import { Plus, X } from "@/components/icons/glyph-icons";
import { api } from "../../../../../convex/_generated/api";
import { workTypeMeta, type PresentedWorkType } from "../../artifacts/presentation";
import { useAuthedArgs } from "../../data/use-authed-args";
import { spectraBus } from "../../events";
import { useTreeQuickView, useTreeSearch, type TreeNode } from "../../organization/tree-client";

/*
 * The work a task is for (EDITORS.md, "Planner task"): the essay it is about,
 * the deck to revise from. Each linked work is a slip that opens it. Linking
 * one is a search over the Library, starting from what was open last.
 */

const LINKS_MAX = 30;

export function TaskLinks({
  ids,
  selfId,
  canEdit,
  onChange,
  bare,
}: {
  ids: string[];
  selfId?: string;
  canEdit: boolean;
  onChange: (ids: string[]) => void;
  /** Just the list, for a property row that already names it. */
  bare?: boolean;
}) {
  const [picking, setPicking] = useState(bare && canEdit && !ids.length);
  if (!ids.length && !canEdit) return null;
  const list = (
      <ul className="task-links">
        {ids.map((id) => (
          <LinkedWork key={id} workId={id} canEdit={canEdit} onRemove={() => onChange(ids.filter((candidate) => candidate !== id))} />
        ))}
        {canEdit && ids.length < LINKS_MAX ? (
          <li>
            {picking ? (
              <WorkPicker
                exclude={new Set([...ids, ...(selfId ? [selfId] : [])])}
                onPick={(id) => {
                  onChange([...ids, id]);
                  setPicking(false);
                }}
                onClose={() => setPicking(false)}
              />
            ) : (
              <button type="button" className="sheet-quiet" onClick={() => setPicking(true)}>
                <Plus className="size-3.5" /> Link artifact
              </button>
            )}
          </li>
        ) : null}
      </ul>
  );
  if (bare) return list;
  return (
    <section className="sheet-section" aria-label="Linked artifact">
      <header className="sheet-section-head">
        <h3>Linked artifact</h3>
      </header>
      {list}
    </section>
  );
}

function typeOf(key?: string) {
  return workTypeMeta[(key ?? "resource") as PresentedWorkType] ?? workTypeMeta.resource;
}

function LinkedWork({ workId, canEdit, onRemove }: { workId: string; canEdit: boolean; onRemove: () => void }) {
  const placement = useQuery(api.orgTree.placementForSource, useAuthedArgs({ kind: "work" as const, sourceId: workId }));
  const node = placement?.node as TreeNode | undefined;
  const type = typeOf(node?.typeKey);
  const where = (placement?.ancestors as TreeNode[] | undefined)?.at(-1)?.name;
  return (
    <li className="task-link" style={{ ["--type-ink" as string]: type.color }}>
      <button type="button" className="task-link-open" disabled={placement === null} onClick={() => void spectraBus.command("work.open", { workId })}>
        <Icon name={type.glyph} size={16} />
        <span className="min-w-0 flex-1 truncate">{placement === undefined ? " " : (node?.name ?? "An artifact you can no longer open")}</span>
        {where ? <span className="task-link-where">{where}</span> : null}
      </button>
      {canEdit ? (
        <button type="button" className="sheet-icon-button" aria-label={`Unlink ${node?.name ?? "work"}`} title="Unlink" onClick={onRemove}>
          <X className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}

function WorkPicker({ exclude, onPick, onClose }: { exclude: Set<string>; onPick: (id: string) => void; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const search = useTreeSearch(term, ["work"]);
  const recent = useTreeQuickView(search.active ? null : "recent", ["work"]);
  const nodes = (search.active ? search.results : recent.nodes).filter((node) => node.sourceId && !exclude.has(node.sourceId)).slice(0, 8);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);

  return (
    <div ref={box} className="task-picker">
      <input
        autoFocus
        className="sheet-input w-full"
        placeholder="Find an artifact by name"
        aria-label="Find an artifact to link"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Enter" && nodes[0]?.sourceId) onPick(nodes[0].sourceId);
        }}
      />
      <p className="task-picker-note">{search.active ? (nodes.length ? "Found" : "Nothing by that name") : "Recent"}</p>
      <ul>
        {nodes.map((node) => {
          const type = typeOf(node.typeKey);
          return (
            <li key={node.nodeId}>
              <button type="button" className="task-picker-row" style={{ ["--type-ink" as string]: type.color }} onClick={() => onPick(node.sourceId!)}>
                <Icon name={type.glyph} size={15} />
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                <span className="task-link-where">{type.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

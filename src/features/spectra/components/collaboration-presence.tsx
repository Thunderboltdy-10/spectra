"use client";

import { MousePointer2, Sparkles, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { CollaborationPresence } from "../collaboration/types";
import type { ArtifactCommentRegion } from "./artifact-comments-panel";

function initials(name?: string) {
  return (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function presenceName(
  person: CollaborationPresence,
  presence: CollaborationPresence[],
  currentAccountId?: string,
  currentDisplayName?: string,
) {
  if (person.actorKind !== "ai") return person.name || "Collaborator";
  if (person.accountId && person.accountId === currentAccountId)
    return currentDisplayName ? `${currentDisplayName}'s AI` : "Your AI";
  const owner = presence.find(
    (candidate) =>
      candidate.actorKind !== "ai" &&
      candidate.accountId &&
      candidate.accountId === person.accountId,
  );
  return owner?.name ? `${owner.name}'s AI` : "A collaborator's AI";
}

function validCursor(
  cursor: CollaborationPresence["cursor"],
): cursor is { x: number; y: number; updatedAt?: number } {
  return Boolean(
    cursor &&
      Number.isFinite(cursor.x) &&
      Number.isFinite(cursor.y) &&
      cursor.x >= 0 &&
      cursor.x <= 1 &&
      cursor.y >= 0 &&
      cursor.y <= 1,
  );
}

function presenceColor(person: CollaborationPresence) {
  return person.actorKind === "ai"
    ? "var(--accent-cyan)"
    : person.color || "#6f7b72";
}

export function CollaborationCursorLayer({
  presence,
  currentClientId,
  currentAccountId,
  currentDisplayName,
}: {
  presence: CollaborationPresence[];
  currentClientId?: string;
  currentAccountId?: string;
  currentDisplayName?: string;
}) {
  const collaborators = presence.filter(
    (person) =>
      person.clientId !== currentClientId && validCursor(person.cursor),
  );
  if (!collaborators.length) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[66] overflow-hidden"
      aria-hidden="true"
    >
      {collaborators.map((person) => {
        const name = presenceName(
          person,
          presence,
          currentAccountId,
          currentDisplayName,
        );
        const color = presenceColor(person);
        return (
          <div
            key={person.clientId}
            className="absolute transition-[left,top] duration-75 ease-out motion-reduce:transition-none"
            style={{
              left: `${person.cursor!.x * 100}%`,
              top: `${person.cursor!.y * 100}%`,
            }}
          >
            <MousePointer2
              className="h-5 w-5 -translate-x-1 -translate-y-1 fill-current drop-shadow-[0_2px_3px_rgba(20,18,15,.18)]"
              style={{ color }}
            />
            <span
              className="ml-2 -mt-0.5 inline-flex max-w-48 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-[10px] font-semibold text-white shadow-[0_5px_18px_rgba(20,18,15,.18)]"
              style={{ backgroundColor: color }}
            >
              {person.actorKind === "ai" ? (
                <Sparkles className="h-3 w-3 animate-pulse motion-reduce:animate-none" />
              ) : null}
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CollaborationPresenceIndicator({
  presence,
  currentClientId,
  currentAccountId,
  currentDisplayName,
  regions,
}: {
  presence: CollaborationPresence[];
  currentClientId?: string;
  currentAccountId?: string;
  currentDisplayName?: string;
  regions: readonly ArtifactCommentRegion[];
}) {
  const [open, setOpen] = useState(false);
  const collaborators = useMemo(
    () => presence.filter((person) => person.clientId !== currentClientId),
    [currentClientId, presence],
  );
  if (collaborators.length === 0) return null;
  const regionNames = new Map(regions.map((region) => [region.regionId, region.label]));
  const activeCount = collaborators.filter(
    (person) => person.activeRegionId || validCursor(person.cursor),
  ).length;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${collaborators.length} collaborator${collaborators.length === 1 ? "" : "s"} present`}
        className="group flex h-9 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_84%,transparent)] px-2 shadow-[0_2px_8px_rgba(27,20,12,.04)] transition hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
      >
        <span className="flex -space-x-1.5">
          {collaborators.slice(0, 3).map((person) => (
            <span
              key={person.clientId}
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--bg-primary)] text-[7px] font-bold text-white shadow-sm"
              style={{ backgroundColor: presenceColor(person) }}
              title={presenceName(
                person,
                presence,
                currentAccountId,
                currentDisplayName,
              )}
            >
              {person.actorKind === "ai" ? (
                <Sparkles className="h-3 w-3" />
              ) : (
                initials(person.name)
              )}
            </span>
          ))}
        </span>
        <span className="hidden text-left xl:block">
          <span className="block text-[9px] font-semibold leading-none text-[var(--text-primary)]">
            Here now
          </span>
          <span className="mt-1 block text-[8px] leading-none text-[var(--text-tertiary)]">
            {activeCount
              ? `${activeCount} active`
              : `${collaborators.length} viewing`}
          </span>
        </span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[78] cursor-default"
            aria-label="Close collaborator list"
            onClick={() => setOpen(false)}
          />
          <section className="absolute right-0 top-11 z-[79] w-[300px] overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,transparent)] shadow-[0_20px_60px_rgba(27,20,12,0.2)] backdrop-blur-xl">
            <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-primary)]">
                  <Users className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                  Live in this artifact
                </div>
                <p className="mt-1 text-[9px] text-[var(--text-tertiary)]">
                  Cursors and activity update in real time
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </header>
            <ul className="max-h-[320px] overflow-y-auto p-2">
              {collaborators.map((person) => (
                <li
                  key={person.clientId}
                  className="flex items-center gap-3 rounded-[8px] px-2.5 py-2.5 hover:bg-[var(--bg-hover)]"
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[9px] font-bold text-white shadow-sm"
                    style={{ backgroundColor: presenceColor(person) }}
                  >
                    {person.actorKind === "ai" ? (
                      <Sparkles className="h-4 w-4" />
                    ) : (
                      initials(person.name)
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">
                      {presenceName(
                        person,
                        presence,
                        currentAccountId,
                        currentDisplayName,
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-[var(--text-tertiary)]">
                      {person.activeRegionId
                        ? `${person.actorKind === "ai" ? "Editing" : "Working in"} ${regionNames.get(person.activeRegionId) ?? "this artifact"}`
                        : validCursor(person.cursor)
                          ? "Moving through this artifact"
                          : person.actorKind === "ai"
                            ? "Preparing the next live edit"
                            : "Viewing this artifact"}
                    </span>
                  </span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ring-4 ring-[color-mix(in_oklab,var(--success)_10%,transparent)] ${person.actorKind === "ai" && person.activeRegionId ? "animate-pulse motion-reduce:animate-none" : ""}`}
                    style={{ backgroundColor: presenceColor(person) }}
                  >
                    <span className="sr-only">Online</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

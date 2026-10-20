"use client";

import type { CSSProperties } from "react";
import {
  Beaker,
  BookOpen,
  FilePenLine,
  FlaskConical,
  GraduationCap,
  Loader2,
  MessageCircleQuestion,
  ShieldCheck,
  Sprout,
  type GlyphIcon,
} from "@/components/icons/glyph-icons";
import type { SpectraArtifact, SpectraPublicAgent } from "../data/api";
import { formatRelativeTime } from "../components/spectra-view-model";

/*
 * One agent on the Agents page, written as an entry in a roster rather than
 * boxed as a card: its glyph in its own ink, its name in the reading face,
 * what it is for, and one line of who made it and what it is good at. The
 * entry opens the agent; the word at its right end does the section's verb.
 */

export type LibrarySection = "discover" | "installed" | "yours" | "shared";

export type LibraryCard = {
  id: string;
  section: LibrarySection;
  title: string;
  summary: string;
  subject: string;
  capabilities: string[];
  owner: { name: string; avatarUrl?: string };
  updatedAt: number;
  releaseNumber?: number;
  rating?: number | null;
  ratingCount?: number;
  artifact?: SpectraArtifact;
  publicAgent?: SpectraPublicAgent;
  /** Installed agents reference a published release rather than copying it. */
  installedRelease?: number;
};

const GLYPHS: readonly GlyphIcon[] = [
  FlaskConical,
  FilePenLine,
  BookOpen,
  Sprout,
  GraduationCap,
  Beaker,
  MessageCircleQuestion,
  ShieldCheck,
];

const INKS = ["var(--ink-green)", "var(--ink-orange)", "var(--ink-violet)", "var(--ink-blue)"];

/** A stable number for an agent, so it keeps its glyph and ink between visits. */
function signature(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) >>> 0;
  return result;
}

export function agentVerb(card: LibraryCard) {
  if (card.section === "yours") return "Open";
  if (card.section === "discover") return "Install";
  if (card.section === "installed") return "Uninstall";
  if (card.artifact?.placementsComplete === false) return "Use";
  return card.artifact?.placements?.length ? "Open" : "Add to a workspace";
}

/** Who the agent comes from and when, said as a person would. */
function provenance(card: LibraryCard) {
  const when = formatRelativeTime(card.updatedAt);
  const owner = card.owner.name === "You" ? "Yours" : `By ${card.owner.name}`;
  switch (card.section) {
    case "yours":
      return card.releaseNumber ? `Yours, release ${card.releaseNumber}, updated ${when}` : `Yours, not released, updated ${when}`;
    case "shared":
      return `Shared by ${card.owner.name} ${when}`;
    case "installed":
      return `${owner}, installed ${when}`;
    default:
      return `${owner}, published ${when}`;
  }
}

function rating(card: LibraryCard) {
  if (card.section !== "discover" || typeof card.rating !== "number" || !card.ratingCount) return null;
  return `Rated ${card.rating.toFixed(1)} by ${card.ratingCount} ${card.ratingCount === 1 ? "person" : "people"}`;
}

export function AgentLibraryEntry({
  card,
  busy,
  onOpen,
  onPrimary,
}: {
  card: LibraryCard;
  busy: boolean;
  onOpen: () => void;
  onPrimary: () => void;
}) {
  const mark = signature(card.id);
  const Glyph = GLYPHS[mark % GLYPHS.length]!;
  const good = card.capabilities.filter((capability) => capability !== card.subject).slice(0, 3);
  const said = rating(card);
  return (
    <li className="agent-entry" style={{ "--agent-entry-ink": INKS[mark % INKS.length] } as CSSProperties}>
      <button type="button" className="agent-entry-body" onClick={onOpen}>
        <Glyph className="agent-entry-glyph" strokeWidth={1.7} aria-hidden />
        <span className="agent-entry-title">{card.title || "Untitled agent"}</span>
        {card.summary ? <span className="agent-entry-summary">{card.summary}</span> : null}
        <span className="agent-entry-meta">
          {provenance(card)}
          {card.subject !== "General" ? `. For ${card.subject}` : ""}
          {good.length ? `. Good at ${good.join(", ")}` : ""}
          {said ? `. ${said}` : ""}
        </span>
      </button>
      <button type="button" className="agent-entry-verb" disabled={busy} onClick={onPrimary}>
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {agentVerb(card)}
      </button>
    </li>
  );
}

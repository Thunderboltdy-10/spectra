"use client";

import {
  ArtifactCard,
  type ArtifactCardView,
} from "@/features/spectra/components/artifact-card";
import { ResultCardStack } from "@/features/spectra/components/result-card";
import { ThreadCard } from "@/features/spectra/components/thread-card";
import { ConversationSurface } from "@/features/spectra/components/conversation-surface";
import type {
  SpectraMessage,
  SpectraThread,
  SpectraThreadDetail,
} from "@/features/spectra/data/api";
import { deriveLiveDockTab } from "@/features/spectra/runs/live-dock/live-dock-model";
import { CrossfadeText } from "@/features/spectra/motion/motion-primitives";
import type { ResultCardView } from "@/features/spectra/components/result-card";

/**
 * Landing demo surfaces (Phase 15.6): REAL Spectra product components fed by
 * deterministic fixtures. When the components change, these vignettes change
 * — nothing here duplicates product markup by hand.
 *
 * Discipline:
 * - no auth, no Convex, no router, no network (fixtures only);
 * - no interactive callbacks that would fire requests (no onContinue, no
 *   provenance.agentId);
 * - timestamps are coarse so SSR/CSR agree;
 * - frames bound height so scroll surfaces do not grow the page.
 */

const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 6, 28, 9, 0, 0); // deterministic fixture clock

/* ------------------------------------------------------------------ */
/* Work card: the real Library card, mid-creation by Spectra            */
/* ------------------------------------------------------------------ */

export const demoDocumentCard: ArtifactCardView = {
  id: "demo-doc",
  title: "Ecosystems revision notes",
  blueprintKey: "document",
  summary:
    "Photosynthesis, respiration and the carbon cycle — chapter 4 condensed into study blocks.",
  meta: "Document · Biology",
  placement: "workspace",
  updatedAt: BASE - 2 * HOUR,
  aiState: "creating",
  aiProgress: 0.62,
  metrics: { Sections: 5, Sources: 3 },
};

export function DemoWorkCard({ className }: { className?: string }) {
  return (
    <ArtifactCard artifact={demoDocumentCard} className={className} quiet />
  );
}

/* ------------------------------------------------------------------ */
/* Run tab strip: the REAL Live Dock derivation, real tab chrome        */
/* ------------------------------------------------------------------ */

const DEMO_TAB = deriveLiveDockTab({
  runId: "run-demo",
  threadId: "thread-demo",
  threadTitle: "Revision notes",
  run: { status: "running" },
  card: {
    title: "Revising the photosynthesis summary",
    provenance: { artifactTitles: ["Ecosystems revision notes"] },
  },
  checkpointSummary:
    "Comparing the chapter against the rubric, then tightening section two.",
  recentSteps: ["Read the current rubric", "Drafted the Calvin cycle summary"],
});

export function DemoRunTabs({ className }: { className?: string }) {
  return (
    <div className={`spectra-run-tab-strip flex gap-2 ${className ?? ""}`}>
      <article
        data-run-status="running"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[9px] border border-[var(--border-default)] px-2.5 py-2"
      >
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent-cyan)] motion-reduce:animate-none" />
        <div className="min-w-0">
          <CrossfadeText
            value={DEMO_TAB.title}
            className="block truncate text-[11px] font-semibold text-[var(--text-primary)]"
          />
          <CrossfadeText
            value={DEMO_TAB.semanticStep}
            className="block truncate text-micro text-[var(--text-tertiary)]"
          />
        </div>
        <span className="ml-auto shrink-0 text-micro capitalize text-[var(--text-tertiary)]">
          Working
        </span>
      </article>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Conversation: the real chat surface with verified citation chips     */
/* ------------------------------------------------------------------ */

const DEMO_MESSAGES: SpectraMessage[] = [
  {
    _id: "m1",
    threadId: "thread-demo",
    role: "user",
    content: "Turn these notes into a revision document for Friday's test.",
    createdAt: BASE - 26 * 60_000,
  },
  {
    _id: "m2",
    threadId: "thread-demo",
    role: "assistant",
    content:
      "I've condensed chapter four into five study blocks and kept every claim attached to its source. The Calvin cycle section now cites your textbook [[cite:src-textbook:span-4-7|Campbell, ch. 4]] and the light-dependent reactions reference the lecture slides [[cite:src-slides:span-2|Week 6 slides]].\n\nTwo statements conflicted with the mark scheme, so I tightened them — the differences are in the margin.",
    createdAt: BASE - 25 * 60_000,
  },
];

const DEMO_THREAD: SpectraThread = {
  _id: "thread-demo",
  title: "Revision notes",
  origin: "workspace",
  status: "active",
  createdAt: BASE - 30 * 60_000,
  updatedAt: BASE - 25 * 60_000,
  lastMessageAt: BASE - 25 * 60_000,
  messageCount: 2,
};

const DEMO_DETAIL: SpectraThreadDetail = {
  thread: DEMO_THREAD,
  messages: DEMO_MESSAGES,
  traces: [],
  viewerName: "Pablo",
};

export function DemoConversation({ className }: { className?: string }) {
  return (
    <div className={`flex h-full min-h-0 flex-col ${className ?? ""}`}>
      <ConversationSurface
        detail={DEMO_DETAIL}
        compact
        onRetryRun={() => undefined}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result cards: the real run-outcome cards with source provenance      */
/* ------------------------------------------------------------------ */

const DEMO_CARDS: ResultCardView[] = [
  {
    id: "card-demo-1",
    runId: "run-demo",
    status: "completed",
    variant: "artifact",
    title: "Revision document created",
    summary:
      "Five study blocks with sources carried through — ready in **Ecosystems revision notes**.",
    actions: [
      {
        key: "open",
        label: "Open",
        targetType: "artifact",
        targetId: "demo-doc",
      },
    ],
    provenance: {
      artifactTitles: ["Ecosystems revision notes"],
      attachmentNames: ["Cell biology, ch. 4.pdf", "Week 6 slides.pdf"],
    },
    updatedAt: BASE - 24 * 60_000,
  },
  {
    id: "card-demo-2",
    runId: "run-demo-2",
    status: "awaiting_confirmation",
    variant: "operation",
    title: "Schedule three study blocks?",
    summary: "Spectra can place them in Calendar around your Thursday classes.",
    actions: [
      {
        key: "confirm",
        label: "Schedule",
        targetType: "run",
        targetId: "run-demo-2",
      },
      {
        key: "cancel",
        label: "Not now",
        targetType: "run",
        targetId: "run-demo-2",
      },
    ],
    updatedAt: BASE - 20 * 60_000,
  },
];

export function DemoResultCards({ className }: { className?: string }) {
  return (
    <ResultCardStack
      cards={DEMO_CARDS}
      className={className}
      onAction={() => undefined}
      onRevise={() => undefined}
      onOpen={() => undefined}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Thread card: the real conversation card                              */
/* ------------------------------------------------------------------ */

export function DemoThreadCard({ className }: { className?: string }) {
  return (
    <div className={className}>
      <ThreadCard
        thread={{
          ...DEMO_THREAD,
          title: "Mark my rubric against last year's",
          summaryShort: "Science Tutor · comparing criteria",
        }}
        workspaceLabel="Biology"
        running
        onOpen={() => undefined}
      />
    </div>
  );
}

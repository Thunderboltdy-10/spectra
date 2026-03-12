"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { GlobalUtilityDock } from "@/components/global-utility-dock";
import { useSidebar } from "@/context/sidebar-context";
import { cn } from "@/lib/utils";
import type { GuidedTourStep } from "@/components/ui/guided-tour";

const GuidedTour = dynamic(
  () => import("@/components/ui/guided-tour").then((module) => module.GuidedTour),
  { ssr: false },
);

const PAGE_TOUR_VERSION = "v1";
const BASE_TOUR_STEPS: GuidedTourStep[] = [
  {
    selector: '[data-tour="utility-tour"]',
    title: "Global tour control",
    description: "Open guided tours from here on any screen.",
    position: "left",
  },
  {
    selector: '[data-tour="sidebar-pages"]',
    title: "Sidebar pages",
    description: "Use this rail to move across core pages without losing context.",
    position: "right",
  },
  {
    selector: '[data-tour="utility-feedback"]',
    title: "Feedback",
    description: "Send feedback from anywhere without leaving your current page.",
    position: "left",
  },
];

const PAGE_TOUR_STEPS: Record<string, GuidedTourStep[]> = {
  "/flashcards": [
    {
      selector: '[data-tour="flashcards-header"]',
      title: "Flashcard studio",
      description: "Start due-card review, toggle shuffle, and refresh your queues from here.",
      position: "bottom",
    },
    {
      selector: '[data-tour="flashcards-decks"]',
      title: "Deck list",
      description: "Select any saved deck to focus review on one topic at a time.",
      position: "right",
    },
    {
      selector: '[data-tour="flashcards-review"]',
      title: "Review workspace",
      description: "Flip cards, jump with dot navigation, and rate difficulty to schedule next review.",
      position: "left",
    },
  ],
  "/bookmarks": [
    {
      selector: '[data-tour="bookmarks-header"]',
      title: "Bookmarks hub",
      description: "This page stores your saved highlights from chat.",
      position: "bottom",
    },
    {
      selector: '[data-tour="bookmarks-search"]',
      title: "Search bookmarks",
      description: "Filter by topic or phrase to find key explanations quickly.",
      position: "bottom",
    },
    {
      selector: '[data-tour="bookmarks-list"]',
      title: "Grouped highlights",
      description: "Bookmarks are grouped by chat so you can reopen context instantly.",
      position: "top",
    },
  ],
  "/achievements": [
    {
      selector: '[data-tour="achievements-header"]',
      title: "Progress milestones",
      description: "Track streaks, XP, and completion from this summary area.",
      position: "bottom",
    },
    {
      selector: '[data-tour="achievements-overview"]',
      title: "Quick metrics",
      description: "These cards summarize XP, current streak, and overall completion rate.",
      position: "bottom",
    },
    {
      selector: '[data-tour="achievements-grid"]',
      title: "Badge catalog",
      description: "Completed badges are sorted first, with pending goals listed after.",
      position: "top",
    },
  ],
  "/analytics": [
    {
      selector: '[data-tour="analytics-header"]',
      title: "Analytics overview",
      description: "Use this page to monitor learning patterns and study outcomes.",
      position: "bottom",
    },
    {
      selector: '[data-tour="analytics-stats"]',
      title: "Key stats",
      description: "Top-line metrics show streak, message volume, topics, and quiz performance.",
      position: "bottom",
    },
    {
      selector: '[data-tour="analytics-charts"]',
      title: "Trend panels",
      description: "These charts track activity, study-time rhythm, and mode/quiz trends.",
      position: "top",
    },
  ],
  "/models": [
    {
      selector: '[data-tour="models-header"]',
      title: "Model atlas",
      description: "Use this page to compare models by capability, context size, and budget fit.",
      position: "bottom",
    },
    {
      selector: '[data-tour="models-search-models"]',
      title: "Model-first search",
      description: "Search models first, then narrow by provider when needed.",
      position: "bottom",
    },
    {
      selector: '[data-tour="models-provider-panel"]',
      title: "Provider panel",
      description: "Filter by provider and open leaderboard insights without leaving this screen.",
      position: "left",
    },
  ],
  "/agents": [
    {
      selector: '[data-tour="agents-header"]',
      title: "Agents workspace",
      description: "Create and manage specialist agents tailored to your workflows.",
      position: "bottom",
    },
    {
      selector: '[data-tour="agents-search"]',
      title: "Semantic search",
      description: "Search by intent, topic, or skill and filter agents in one pass.",
      position: "bottom",
    },
    {
      selector: '[data-tour="agents-filters"]',
      title: "Quick filters",
      description: "Use category and visibility filters to narrow large agent libraries.",
      position: "bottom",
    },
    {
      selector: '[data-tour="agents-grid"]',
      title: "Agent catalog",
      description: "Open an agent to edit prompts, resources, and preferred modes.",
      position: "top",
    },
    {
      selector: '[data-tour="agents-create"]',
      title: "Create flow",
      description: "Launch the guided builder or switch to manual prompt mode when needed.",
      position: "left",
    },
    {
      selector: '[data-tour="utility-tour"]',
      title: "Replay tours",
      description: "Re-open this tour any time while you work with agents.",
      position: "left",
    },
    {
      selector: '[data-tour="utility-feedback"]',
      title: "Report agent issues",
      description: "Share broken prompts or filtering issues directly from this page.",
      position: "left",
    },
  ],
  "/admin": [
    {
      selector: '[data-tour="admin-header"]',
      title: "Admin workspace",
      description: "Manage school controls, permissions, and operational settings in one place.",
      position: "bottom",
    },
    {
      selector: '[data-tour="admin-controls"]',
      title: "Control center",
      description: "Update user roles and core admin toggles from this section.",
      position: "top",
    },
  ],
  "/admin/school": [
    {
      selector: '[data-tour="school-admin-header"]',
      title: "School dashboard",
      description: "Use this overview to jump into members, branding, SOUL, and analytics.",
      position: "bottom",
    },
  ],
  "/admin/school/soul": [
    {
      selector: '[data-tour="soul-header"]',
      title: "SOUL policy workspace",
      description: "Define institutional guidance that shapes tutoring behavior across your school.",
      position: "bottom",
    },
    {
      selector: '[data-tour="soul-sections"]',
      title: "Guidance sections",
      description: "Switch between mission, pedagogy, tone, and policy sections quickly.",
      position: "bottom",
    },
    {
      selector: '[data-tour="soul-editor"]',
      title: "Editor",
      description: "Write and save section content, then publish when ready.",
      position: "right",
    },
    {
      selector: '[data-tour="soul-test-panel"]',
      title: "Preview impact",
      description: "Test sample prompts to preview how published SOUL guidance is injected.",
      position: "left",
    },
  ],
  "/admin/school/branding": [
    {
      selector: '[data-tour="branding-header"]',
      title: "Branding controls",
      description: "Manage logo and color identity for your school workspace.",
      position: "bottom",
    },
    {
      selector: '[data-tour="branding-logo"]',
      title: "Logo upload",
      description: "Upload or replace your school logo with live updates.",
      position: "right",
    },
    {
      selector: '[data-tour="branding-colors"]',
      title: "Theme colors",
      description: "Set primary and accent colors with immediate visual feedback.",
      position: "right",
    },
    {
      selector: '[data-tour="branding-preview"]',
      title: "Live preview",
      description: "Validate the look before saving it for your whole organization.",
      position: "left",
    },
  ],
  "/super-admin/feedback": [
    {
      selector: '[data-tour="super-feedback-header"]',
      title: "Feedback inbox",
      description: "Review incoming reports and triage them quickly.",
      position: "bottom",
    },
    {
      selector: '[data-tour="super-feedback-filters"]',
      title: "AI categories",
      description: "Filter by status, user category, and AI-generated bucket.",
      position: "bottom",
    },
    {
      selector: '[data-tour="super-feedback-list"]',
      title: "Thread list",
      description: "Open each report, inspect metadata, and send replies.",
      position: "top",
    },
  ],
};

export function AppShell({
  children,
  fullBleed = false,
  contentClassName,
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
  contentClassName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const sidebar = useSidebar();
  const [tourOpen, setTourOpen] = useState(false);

  const selectedChatId = "";
  const pageTourSteps = useMemo(
    () => PAGE_TOUR_STEPS[pathname] ?? BASE_TOUR_STEPS,
    [pathname],
  );
  const pageTourKey = useMemo(
    () => (pageTourSteps.length > 0 ? `ai-school-tour:${pathname}:${PAGE_TOUR_VERSION}` : null),
    [pageTourSteps.length, pathname],
  );

  useEffect(() => {
    if (!pageTourKey) {
      setTourOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (window.sessionStorage.getItem('tour-dismissed-' + pathname) === "1") {
        return;
      }
      try {
        if (window.localStorage.getItem(pageTourKey) !== "1") {
          setTourOpen(true);
        }
      } catch {
        // noop
      }
    }, 420);
    return () => window.clearTimeout(timer);
  }, [pageTourKey, pathname]);

  useEffect(() => {
    const onOpenTour = () => {
      if (pageTourSteps.length > 0) {
        setTourOpen(true);
      }
    };
    window.addEventListener("ai-school:open-tour", onOpenTour);
    return () => window.removeEventListener("ai-school:open-tour", onOpenTour);
  }, [pageTourSteps.length]);

  function markPageTourSeen() {
    if (!pageTourKey) return;
    try {
      window.sessionStorage.setItem('tour-dismissed-' + pathname, '1');
      window.localStorage.setItem(pageTourKey, "1");
    } catch {
      // Ignore storage failures.
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <aside
        className={`hidden h-full transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:block ${sidebar.sidebarOpen ? "w-[clamp(220px,18vw,280px)]" : "w-[64px]"}`}
      >
        <ChatSidebar
          chats={sidebar.filteredChats}
          selectedChatId={selectedChatId}
          search={sidebar.search}
          collapsed={!sidebar.sidebarOpen}
          onToggleCollapse={() => sidebar.setSidebarOpen((prev) => !prev)}
          onSearchChange={sidebar.setSearch}
          onSelectChat={(chatId) => router.push(`/chat?chatId=${encodeURIComponent(chatId)}`)}
          onNewChat={() => router.push("/chat")}
          onDeleteChat={(chatId) => {
            void sidebar.deleteChat(chatId).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to delete chat"),
            );
          }}
          onRenameChat={(chatId, title) => {
            void sidebar.renameChat(chatId, title).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Failed to rename chat"),
            );
          }}
          onOpenSettings={() => {
            window.dispatchEvent(new Event("ai-school:toggle-settings"));
          }}
          onPinChat={sidebar.pinChat}
          pinnedChatIds={sidebar.pinnedChatIds}
          role={sidebar.role}
          isSuperAdmin={sidebar.isSuperAdmin}
          userSpending={sidebar.userSpending}
          userMemorySummary={sidebar.userMemorySummary}
          orgName={sidebar.orgName}
          orgLogoUrl={sidebar.orgLogoUrl}
        />
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <main
          className={cn(
            "w-full px-3 py-5 sm:px-6 lg:px-10",
            fullBleed ? "max-w-none" : "mx-auto max-w-6xl",
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>

      {!sidebar.sidebarOpen ? <GlobalUtilityDock placement="floating" /> : null}

      {pageTourSteps.length > 0 ? (
        <GuidedTour
          open={tourOpen}
          steps={pageTourSteps}
          onClose={() => {
            markPageTourSeen();
            setTourOpen(false);
          }}
          onComplete={markPageTourSeen}
        />
      ) : null}
    </div>
  );
}

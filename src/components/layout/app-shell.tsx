"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { useSidebar } from "@/context/sidebar-context";
import { cn } from "@/lib/utils";
import type { GuidedTourStep } from "@/components/ui/guided-tour";

const GuidedTour = dynamic(
  () => import("@/components/ui/guided-tour").then((module) => module.GuidedTour),
  { ssr: false },
);

const PAGE_TOUR_VERSION = "v1";

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
    () => PAGE_TOUR_STEPS[pathname] ?? [],
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
      try {
        if (window.localStorage.getItem(pageTourKey) !== "1") {
          setTourOpen(true);
        }
      } catch {
        setTourOpen(true);
      }
    }, 420);
    return () => window.clearTimeout(timer);
  }, [pageTourKey]);

  function markPageTourSeen() {
    if (!pageTourKey) return;
    try {
      window.localStorage.setItem(pageTourKey, "1");
    } catch {
      // Ignore storage failures.
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <aside
        className={`hidden h-full transition-all duration-300 md:block ${sidebar.sidebarOpen ? "w-[320px]" : "w-[76px]"}`}
      >
        <ChatSidebar
          chats={sidebar.filteredChats}
          selectedChatId={selectedChatId}
          search={sidebar.search}
          collapsed={!sidebar.sidebarOpen}
          onToggleCollapse={() => sidebar.setSidebarOpen((prev) => !prev)}
          onSearchChange={sidebar.setSearch}
          onSelectChat={(chatId) => router.push(`/?chatId=${encodeURIComponent(chatId)}`)}
          onNewChat={() => router.push("/")}
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

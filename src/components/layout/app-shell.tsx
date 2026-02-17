"use client";

import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { useSidebar } from "@/context/sidebar-context";
import { cn } from "@/lib/utils";

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

  const selectedChatId = "";

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
            if (pathname !== "/") {
              router.push("/");
              return;
            }
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
    </div>
  );
}

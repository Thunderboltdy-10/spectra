type SidebarThread = { _id: string; title: string; pinned?: boolean };

/** Latest unpinned chats shown as Recents outside the Chats page. */
const RECENTS_LIMIT = 10;

/**
 * The sidebar's chat sections: Pinned, then Recents (or every loaded chat on
 * the Chats page). Pinned is never capped — a pinned chat is excluded from
 * Recents, so a cap there made the sixth pinned chat vanish from the sidebar
 * altogether. The search covers every loaded chat.
 */
export function sidebarThreadSections<T extends SidebarThread>(
  threads: T[],
  { term, chatPage }: { term: string; chatPage: boolean },
) {
  const query = term.trim().toLowerCase();
  const matches = (thread: T) =>
    !query || thread.title.toLowerCase().includes(query);
  const pinned = threads.filter((thread) => thread.pinned && matches(thread));
  const rest = threads.filter((thread) => !thread.pinned && matches(thread));
  return [
    { pinned: true, rows: pinned },
    { pinned: false, rows: chatPage ? rest : rest.slice(0, RECENTS_LIMIT) },
  ].filter((section) => section.rows.length > 0);
}

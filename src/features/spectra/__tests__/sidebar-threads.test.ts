import { describe, expect, it } from "vitest";
import { sidebarThreadSections } from "@/components/layout/sidebar-threads";

function thread(index: number, pinned = false) {
  return { _id: `t${index}`, title: `Chat ${index}`, pinned };
}

describe("sidebar chat sections", () => {
  it("never hides a pinned chat: pinning a sixth keeps all six in Pinned", () => {
    const threads = [1, 2, 3, 4, 5, 6].map((index) => thread(index, true));
    const [pinned] = sidebarThreadSections(threads, { term: "", chatPage: false });
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.rows.map((row) => row._id)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
  });

  it("lists every loaded chat on the Chats page, and the ten latest elsewhere", () => {
    const threads = Array.from({ length: 30 }, (_, index) => thread(index));
    const chats = sidebarThreadSections(threads, { term: "", chatPage: true });
    expect(chats.find((section) => !section.pinned)?.rows).toHaveLength(30);
    const recents = sidebarThreadSections(threads, { term: "", chatPage: false });
    expect(recents.find((section) => !section.pinned)?.rows).toHaveLength(10);
  });

  it("searches every loaded chat, not just the visible ten", () => {
    const threads = Array.from({ length: 30 }, (_, index) => thread(index));
    const [match] = sidebarThreadSections(threads, { term: "chat 27", chatPage: false });
    expect(match?.rows.map((row) => row._id)).toEqual(["t27"]);
  });
});

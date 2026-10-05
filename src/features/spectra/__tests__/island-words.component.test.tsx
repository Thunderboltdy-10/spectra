// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const plain = vi.hoisted(() => ({ success: vi.fn(() => "plain"), error: vi.fn(() => "plain"), warning: vi.fn(), message: vi.fn(), dismiss: vi.fn(), custom: vi.fn() }));
vi.mock("sonner", () => ({ toast: plain }));

import { setToastSink, toast, type ToastWord } from "@/components/ui/toast";
import { IslandNotice } from "../island/notice";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the app's words", () => {
  it("reach the island while it is there, and a plain toast otherwise", () => {
    const shown: ToastWord[] = [];
    const release = setToastSink({ show: (word) => shown.push(word), dismiss: () => {} });
    const id = toast.success("Saved");
    toast.error("Could not move it", { id: "move" });
    expect(shown.map(({ tone, message }) => [tone, message])).toEqual([
      ["success", "Saved"],
      ["error", "Could not move it"],
    ]);
    expect(shown[1].id).toBe("move");
    expect(id).toBe(shown[0].id);
    expect(plain.success).not.toHaveBeenCalled();

    release();
    toast.success("Saved");
    expect(plain.success).toHaveBeenCalledWith("Saved");
  });

  it("dismisses both the island's word and any plain toast", () => {
    const dismiss = vi.fn();
    const release = setToastSink({ show: () => {}, dismiss });
    toast.dismiss("move");
    expect(dismiss).toHaveBeenCalledWith("move");
    expect(plain.dismiss).toHaveBeenCalledWith("move");
    release();
  });
});

describe("a word in the island", () => {
  it("offers its one action, and goes once it is taken", async () => {
    const undo = vi.fn();
    const gone = vi.fn();
    const dismiss = vi.fn();
    const view = render(
      <IslandNotice
        notice={{ key: "toast:1", text: "Chat moved to Trash.", tone: "done", action: { label: "Undo", onClick: undo }, onGone: gone }}
        from={undefined}
        onOpen={() => {}}
        onDismiss={dismiss}
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("stays while its action may be needed again", async () => {
    const dismiss = vi.fn();
    render(
      <IslandNotice
        notice={{ key: "toast:2", text: "Could not save.", tone: "problem", duration: Infinity, action: { label: "Retry", onClick: (event) => event.preventDefault() } }}
        from={undefined}
        onOpen={() => {}}
        onDismiss={dismiss}
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("keeps a word meant to stay until it is dismissed", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<IslandNotice notice={{ key: "toast:3", text: "Offline", tone: "needs", duration: Infinity }} from={undefined} onOpen={() => {}} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(dismiss).not.toHaveBeenCalled();
  });
});

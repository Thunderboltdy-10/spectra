// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessWidgets, ThreadWidget, messageWidgets } from "../../components/thread-widget";
import { WIDGET_LIMITS } from "../widget-document";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.create }));

const widget = { id: "call-1", title: "Projectile range", html: "<p>Range</p><script>1</script>" };

function frame() {
  return screen.getByTitle("Projectile range") as HTMLIFrameElement;
}

describe("ThreadWidget", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    document.documentElement.classList.remove("dark");
  });
  afterEach(cleanup);

  it("renders a scripts-only sandbox with the CSP document", () => {
    render(<ThreadWidget widget={widget} />);
    const iframe = frame();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    const doc = iframe.getAttribute("srcdoc") ?? "";
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("<p>Range</p>");
    expect(iframe).not.toHaveAttribute("src");
  });

  it("starts in the app's dark mode and posts later theme changes without reloading", async () => {
    document.documentElement.classList.add("dark");
    render(<ThreadWidget widget={widget} />);
    const iframe = frame();
    const before = iframe.getAttribute("srcdoc");
    expect(before).toContain('data-theme="dark"');
    const post = vi.spyOn(iframe.contentWindow!, "postMessage");
    act(() => document.documentElement.classList.remove("dark"));
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: "spectra-widget:theme", theme: "light" }, "*"));
    expect(iframe.getAttribute("srcdoc")).toBe(before);
  });

  it("sizes to the height its own frame reports, within limits, and ignores other senders", () => {
    render(<ThreadWidget widget={widget} />);
    const iframe = frame();
    expect(iframe.style.height).toBe(`${WIDGET_LIMITS.defaultHeight}px`);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "spectra-widget:size", height: 9_999 }, source: window }));
    });
    expect(iframe.style.height).toBe(`${WIDGET_LIMITS.defaultHeight}px`);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "spectra-widget:size", height: 9_999 }, source: iframe.contentWindow }));
    });
    expect(iframe.style.height).toBe(`${WIDGET_LIMITS.maxHeight}px`);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "spectra-widget:size", height: 240 }, source: iframe.contentWindow }));
    });
    expect(iframe.style.height).toBe("240px");
  });

  it("saves as a code work in the thread, recording why, then offers to open it", async () => {
    mocks.create.mockResolvedValue({ artifactId: "art-9", nodeId: "n" });
    const open = vi.fn();
    render(<ThreadWidget widget={widget} threadId="thread-1" onOpenArtifact={open} />);
    fireEvent.click(screen.getByRole("button", { name: /Save as work/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Open saved work/ })).toBeInTheDocument());
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const args = mocks.create.mock.calls[0]![0];
    expect(args).toMatchObject({ blueprintKey: "code", title: "Projectile range", threadId: "thread-1", source: "chat" });
    expect(args.contextSummary).toMatch(/as code \(browser runtime\)/);
    fireEvent.click(screen.getByRole("button", { name: /Open saved work/ }));
    expect(open).toHaveBeenCalledWith("art-9");
  });

  it("says plainly when saving fails and lets the user try again", async () => {
    mocks.create.mockRejectedValueOnce(new Error("You are offline."));
    render(<ThreadWidget widget={widget} />);
    fireEvent.click(screen.getByRole("button", { name: /Save as work/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You are offline.");
    expect(screen.getByRole("button", { name: /Save as work/ })).toBeEnabled();
  });
});

describe("saved replies", () => {
  afterEach(cleanup);

  it("reads widgets from message metadata and drops malformed or oversized rows", () => {
    expect(
      messageWidgets({
        widgets: [widget, { id: 1 }, { id: "big", title: "x", html: "x".repeat(WIDGET_LIMITS.maxHtmlChars + 1) }, null],
      }),
    ).toEqual([widget]);
    expect(messageWidgets(undefined)).toEqual([]);
  });

  it("renders every widget of a reply and nothing when there are none", () => {
    const { container, rerender } = render(<HarnessWidgets widgets={[widget, { ...widget, id: "call-2", title: "Second" }]} />);
    expect(container.querySelectorAll("iframe")).toHaveLength(2);
    rerender(<HarnessWidgets widgets={[]} />);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
  });
});

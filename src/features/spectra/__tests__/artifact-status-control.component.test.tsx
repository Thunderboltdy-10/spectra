// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageSquare, Maximize2, MessagesSquare } from "lucide-react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
  on: true,
  pulse: vi.fn(),
  glowStop: vi.fn(),
  glow: vi.fn(),
}));

vi.mock("../life/life", () => ({
  life: {
    get on() {
      return field.on;
    },
    pulse: field.pulse,
    glow: (...args: unknown[]) => {
      field.glow(...args);
      return { move: vi.fn(), stop: field.glowStop };
    },
  },
  rectOf: () => ({ x: 100, y: 20, width: 80, height: 32 }),
}));

import { ArtifactStatusControl } from "../components/artifact-status-control";
import { ArtifactHeaderActions, HEADER_IDENTITY_MIN, shedHeaderCommands } from "../components/artifact-header-actions";
import type { ArtifactStatus } from "../components/artifact-status";
import { STATUS_COLOURS } from "../life/prism";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const SAVED: ArtifactStatus = {
  state: "saved",
  glyph: "saved",
  hue: "var(--success)",
  running: false,
  sentence: "Saved 2 min ago.",
  facts: [{ label: "Last saved", value: "2 min ago" }],
  actions: [{ kind: "history", label: "Version history" }],
};
const SAVING: ArtifactStatus = { ...SAVED, state: "saving", glyph: "saving", hue: "var(--accent-cyan)", words: "Saving", running: true, sentence: "Saving." };
const SYNCING: ArtifactStatus = { ...SAVING, state: "syncing", glyph: "syncing", words: "Updating Essay.docx" };
const PROBLEM: ArtifactStatus = {
  ...SAVED,
  state: "problem",
  glyph: "problem",
  hue: "var(--danger)",
  words: "Couldn't save",
  sentence: "Synchronization stopped.",
  actions: [
    { kind: "retry", label: "Try again" },
    { kind: "history", label: "Version history" },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  field.on = true;
  field.pulse.mockClear();
  field.glow.mockClear();
  field.glowStop.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the status control", () => {
  it("is one control named for its state, with the hover sentence as its description", () => {
    render(<ArtifactStatusControl status={SAVED} onAction={() => {}} />);
    const control = screen.getByRole("button", { name: "Status: Saved" });
    expect(control.getAttribute("data-status")).toBe("saved");
    const description = document.getElementById(control.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe("Saved 2 min ago.");
    // Saved says nothing beside the glyph.
    expect(control.querySelector(".spectra-status-words")).toBeNull();
    expect(control.querySelector('[data-icon="saved"]')).not.toBeNull();
  });

  it("slides words out while something happens and back in when it is done", () => {
    const { rerender } = render(<ArtifactStatusControl status={SAVING} onAction={() => {}} />);
    const control = screen.getByRole("button", { name: "Status: Saving" });
    expect(control.querySelector(".spectra-status-words")?.textContent).toBe("Saving");
    expect(control.querySelector('[data-icon="saving"]')?.getAttribute("data-animate")).toBe("true");

    rerender(<ArtifactStatusControl status={SAVED} onAction={() => {}} />);
    // The words stay while they slide back into the glyph.
    expect(control.getAttribute("data-words")).toBe("leaving");
    expect(control.querySelector(".spectra-status-words")?.textContent).toBe("Saving");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(control.querySelector(".spectra-status-words")).toBeNull();
    // The glyph changed in place: only the saved glyph is left.
    expect(control.querySelectorAll("[data-icon]")).toHaveLength(1);
    expect(control.querySelector('[data-icon="saved"]')).not.toBeNull();
  });

  it("announces what is happening, and stays quiet when saved", () => {
    const { rerender } = render(<ArtifactStatusControl status={SAVING} onAction={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Saving");
    rerender(<ArtifactStatusControl status={SAVED} onAction={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("opens the details and the state's actions on click", () => {
    const onAction = vi.fn();
    render(<ArtifactStatusControl status={PROBLEM} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Status: Problem" }));
    const dialog = screen.getByRole("dialog", { name: "Status details" });
    expect(dialog.textContent).toContain("Synchronization stopped.");
    expect(dialog.textContent).toContain("Last saved");
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry.getAttribute("data-primary")).toBe("true");
    fireEvent.click(retry);
    expect(onAction).toHaveBeenCalledWith("retry");
  });

  it("holds its actions while one runs", () => {
    render(<ArtifactStatusControl status={PROBLEM} onAction={() => {}} busy />);
    fireEvent.click(screen.getByRole("button", { name: "Status: Problem" }));
    expect((screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the status control in the field", () => {
  it("pulses softly in the done hue when a save lands", () => {
    const { rerender } = render(<ArtifactStatusControl status={SAVING} onAction={() => {}} />);
    expect(field.pulse).not.toHaveBeenCalled();
    rerender(<ArtifactStatusControl status={SAVED} onAction={() => {}} />);
    expect(field.pulse).toHaveBeenCalledTimes(1);
    const [, , strength, colour] = field.pulse.mock.calls[0];
    expect(strength).toBeLessThan(0.6);
    expect(colour).toBe(STATUS_COLOURS.done);
  });

  it("is marked as working while the desktop copy updates, and lets go after", () => {
    const { container, rerender } = render(<ArtifactStatusControl status={SYNCING} onAction={() => {}} />);
    expect(container.querySelector("[data-life-working]")).not.toBeNull();
    rerender(<ArtifactStatusControl status={SAVED} onAction={() => {}} />);
    expect(container.querySelector("[data-life-working]")).toBeNull();
  });

  it("answers a failure in the problem hue", () => {
    const { rerender } = render(<ArtifactStatusControl status={SAVING} onAction={() => {}} />);
    rerender(<ArtifactStatusControl status={PROBLEM} onAction={() => {}} />);
    expect(field.pulse.mock.calls.at(-1)?.[3]).toBe(STATUS_COLOURS.problem);
  });

  it("is still when the field is off", () => {
    field.on = false;
    const { rerender } = render(<ArtifactStatusControl status={SAVING} onAction={() => {}} />);
    rerender(<ArtifactStatusControl status={SAVED} onAction={() => {}} />);
    expect(field.pulse).not.toHaveBeenCalled();
  });
});

describe("the header around it", () => {
  const commands = [
    { id: "comments", label: "Comments", icon: MessageSquare, onSelect: () => {} },
    { id: "chats", label: "Browse chats about this artifact", icon: MessagesSquare, onSelect: () => {} },
    { id: "open-full", label: "Open full", icon: Maximize2, onSelect: () => {} },
  ];

  it("keeps every command when there is room", () => {
    expect(shedHeaderCommands({ commands, rowWidth: 900, fixedWidth: 200 }).size).toBe(0);
  });

  it("moves commands into More from the end, and never the pinned status", () => {
    const fixed = 200;
    const tight = HEADER_IDENTITY_MIN + fixed + 4 + 32;
    expect([...shedHeaderCommands({ commands, rowWidth: tight, fixedWidth: fixed })]).toEqual(["open-full", "chats"]);
    expect([...shedHeaderCommands({ commands, rowWidth: 300, fixedWidth: fixed })].sort()).toEqual(
      ["chats", "comments", "open-full"],
    );
  });

  it("renders the status control just before More, with no second overflow button", () => {
    render(
      <ArtifactHeaderActions
        presence={<span>People</span>}
        status={<ArtifactStatusControl status={SAVED} onAction={() => {}} />}
        commands={commands}
        moreLabel="More artifact actions"
        more={null}
        close={<button type="button">Close</button>}
      />,
    );
    const buttons = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(buttons).toEqual([
      "Comments",
      "Browse chats about this artifact",
      "Open full",
      "Status: Saved",
      "More artifact actions",
      "Close",
    ]);
  });
});

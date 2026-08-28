// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactWorkbar, type CommandBinding } from "../components/artifact-workbar";
import {
  StudioContractProvider,
  type StudioContract,
  type StudioDensity,
} from "../components/artifact-studio-shell";
import { SHARED_FONT_SIZES, SHARED_FONT_STACKS, type CommandParam } from "../commands";

/**
 * The workbar contract, proved by rendering it.
 *
 * A screenshot shows that a bar looks right. It cannot show that the font picker
 * is the same command as the one in the overflow menu, that a shed control is not
 * quietly rendered twice, that pinning survives a reload, or that typing the
 * letter b in a paragraph does not embolden it. Those are the failures this pass
 * is meant to remove, so they are asserted here and photographed later.
 */

/**
 * A real store, not a stub that swallows writes. The customizer is only honest if
 * saving something changes what the panel shows — a mock that records a write and
 * never re-renders would let a broken "unpin" pass.
 */
const workbarStore: {
  value: Record<string, unknown>;
  listeners: Set<() => void>;
} = { value: {}, listeners: new Set() };

vi.mock("../settings/preference-store", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSpectraPreferences: () => {
      const value = useSyncExternalStore(
        (listener: () => void) => {
          workbarStore.listeners.add(listener);
          return () => workbarStore.listeners.delete(listener);
        },
        () => workbarStore.value,
        () => workbarStore.value,
      );
      return {
        preferences: { workbar: value },
        hydrated: true,
        update: (section: string, patch: Record<string, unknown>) => {
          if (section !== "workbar") return;
          // Mirrors the real store: the patch is shallow-merged into the
          // section, so one type's layout can never clobber a sibling's.
          workbarStore.value = { ...workbarStore.value, ...patch };
          for (const listener of workbarStore.listeners) listener();
        },
        replace: () => {},
        reset: () => {},
      };
    },
  };
});

function contract(density: StudioDensity = "comfortable"): StudioContract {
  return {
    artifactId: "artifact-1",
    type: "document",
    role: "edit",
    can: () => true,
    modes: [],
    readOnly: false,
    surface: "full",
    sync: { state: "saved", label: "Saved" },
    responsive: {
      minInlineSize: 320,
      preferredInlineSize: 960,
      supportsPanel: true,
      supportsTile: true,
      supportsCompact: true,
      toolbarPriorities: [],
      canvasExtent: "infinite",
    },
    density,
    compatibilityProfile: "spectra-native",
    fidelity: { artifact: "NATIVE" },
    inspector: { open: null, show: () => {}, hide: () => {} },
  };
}

function renderWorkbar(
  actions: readonly CommandBinding[],
  density: StudioDensity = "comfortable",
) {
  return render(
    <StudioContractProvider value={contract(density)}>
      <ArtifactWorkbar label="Document workbar" actions={actions} modes={[]} />
    </StudioContractProvider>,
  );
}

/** The nine General defaults the contract names for Document, in contract order. */
function documentDefaults(
  spies: Record<string, (value?: CommandParam) => void> = {},
) {
  const bindings: CommandBinding[] = [
    { id: "navigate.find", label: "Find", general: true, priority: "essential", shortcut: "Mod+F", onSelect: spies.find ?? (() => {}) },
    { id: "history.undo", label: "Undo", general: true, priority: "essential", shortcut: "Mod+Z", onSelect: spies.undo ?? (() => {}) },
    { id: "history.redo", label: "Redo", general: true, priority: "essential", shortcut: "Mod+Shift+Z", onSelect: spies.redo ?? (() => {}) },
    { id: "navigate.outline", label: "Outline", general: true, priority: "essential", onSelect: () => {} },
    { id: "review.comments", label: "Comments", general: true, priority: "essential", onSelect: () => {} },
    {
      id: "format.fontFamily",
      label: "Font",
      general: true,
      priority: "secondary",
      control: { kind: "select", options: [...SHARED_FONT_STACKS], value: undefined },
      onSelect: spies.font ?? (() => {}),
    },
    {
      id: "format.fontSize",
      label: "Size",
      general: true,
      priority: "secondary",
      control: { kind: "numeric", value: 11, min: 4, max: 400, presets: [...SHARED_FONT_SIZES] },
      onSelect: spies.size ?? (() => {}),
    },
    { id: "format.bold", label: "Bold", general: true, priority: "secondary", shortcut: "Mod+B", active: false, onSelect: spies.bold ?? (() => {}) },
    { id: "format.italic", label: "Italic", general: true, priority: "secondary", shortcut: "Mod+I", active: false, onSelect: () => {} },
  ];
  return bindings;
}

beforeEach(() => {
  workbarStore.value = {};
  workbarStore.listeners.clear();
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 1200,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      const mode = (this as HTMLElement).getAttribute?.("data-measure-mode");
      if (mode === "icon") return 32;
      if (mode === "full") return 80;
      return (this as HTMLElement).clientWidth || 40;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("artifact workbar", () => {
  it("renders a parameterized control in the bar and passes its value to the command", () => {
    const font = vi.fn();
    renderWorkbar(documentDefaults({ font }));

    const picker = screen.getByRole("button", { name: "Font" });
    fireEvent.click(picker);
    const option = screen.getByRole("option", { name: /Georgia/ });
    fireEvent.click(option);

    expect(font).toHaveBeenCalledTimes(1);
    expect(String(font.mock.calls[0]?.[0])).toContain("Georgia");
  });

  it("clamps a numeric control inside the command, not inside the input", () => {
    const size = vi.fn();
    renderWorkbar(documentDefaults({ size }));

    const input = screen.getByRole("spinbutton", { name: /Size/ });
    fireEvent.change(input, { target: { value: "9000" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The shared command clamps to the typographic maximum. A person typing a
    // wrong number and the assistant proposing one land on the same value.
    expect(size).toHaveBeenCalledWith(400);
  });

  it("never lists an action in both the bar and the overflow menu", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 280,
    });
    renderWorkbar(documentDefaults());

    const bar = screen.getByRole("toolbar", { name: "Document workbar" });
    fireEvent.click(within(bar).getByRole("button", { name: /More/i }));
    // The menu is portaled, so it lives outside the toolbar element. That is what
    // keeps the bar 42px tall, and it is also what makes "in the bar" and "in the
    // menu" two answerable questions.
    const menu = screen.getByRole("menu");
    expect(bar.contains(menu)).toBe(false);

    const present = (scope: HTMLElement, label: string) => {
      const exact = new RegExp(`^${label}$`);
      return (
        within(scope).queryAllByRole("button", { name: exact }).length > 0 ||
        within(scope).queryAllByRole("menuitem", { name: exact }).length > 0 ||
        within(scope).queryAllByRole("spinbutton", { name: exact }).length > 0 ||
        within(scope).queryAllByRole("combobox", { name: exact }).length > 0
      );
    };

    const labels = ["Find", "Undo", "Redo", "Outline", "Comments", "Font", "Size", "Bold", "Italic"];
    const inBoth = labels.filter((label) => present(bar, label) && present(menu, label));
    expect(inBoth).toEqual([]);
    // And everything stays reachable from one side or the other — shedding moves
    // a control, it never deletes one.
    const missing = labels.filter(
      (label) => !present(bar, label) && !present(menu, label),
    );
    expect(missing).toEqual([]);
  });

  it("sheds to the overflow menu as the pane tightens instead of clipping", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 960,
    });
    const { unmount } = renderWorkbar(documentDefaults());
    expect(screen.queryByRole("button", { name: /More/i })).toBeNull();
    unmount();

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 200,
    });
    renderWorkbar(documentDefaults());
    expect(screen.getByRole("button", { name: /More/i })).toBeTruthy();
  });

  it("does not fire a shortcut when someone is simply typing", () => {
    const bold = vi.fn();
    renderWorkbar(documentDefaults({ bold }));

    // Typing the letter b in a paragraph must not embolden the paragraph.
    fireEvent.keyDown(document, { key: "b" });
    expect(bold).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "b", ctrlKey: true });
    expect(bold).toHaveBeenCalledTimes(1);
  });

  it("keeps Mod+Z and Mod+Shift+Z two different commands", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    renderWorkbar(documentDefaults({ undo, redo }));

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "z", ctrlKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("states why a disabled command is unavailable rather than hiding it", () => {
    renderWorkbar([
      {
        id: "history.undo",
        label: "Undo",
        general: true,
        priority: "essential",
        disabled: true,
        hint: "Nothing to undo yet",
        onSelect: () => {},
      },
    ]);

    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toHaveProperty("disabled", true);
    expect(undo.getAttribute("title")).toContain("Nothing to undo yet");
  });
});

describe("workbar customization", () => {
  it("customizes on the live bar instead of opening a separate panel", () => {
    renderWorkbar(documentDefaults());
    fireEvent.click(screen.getByRole("button", { name: /Customize/i }));
    const bar = screen.getByRole("toolbar", { name: "Document workbar" });
    expect(bar.getAttribute("data-workbar-customizing")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: /Find a command/i })).toBeNull();
  });

  it("exposes reset on the bar, not inside a customize panel", () => {
    renderWorkbar(documentDefaults());
    expect(screen.getByRole("button", { name: /Reset this workbar/i })).toBeTruthy();
  });

  it("writes only its own type's layout when expanding", () => {
    workbarStore.value = { sheets: { expanded: true } };
    renderWorkbar(documentDefaults());
    fireEvent.click(screen.getByRole("button", { name: /Expand workbar/i }));
    expect((workbarStore.value as Record<string, unknown>).sheets).toEqual({ expanded: true });
    expect((workbarStore.value as Record<string, unknown>).document).toBeTruthy();
  });
});

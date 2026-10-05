// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactWorkbar, type CommandBinding } from "../components/artifact-workbar";
import {
  StudioContractProvider,
  type StudioContract,
  type StudioDensity,
} from "../components/artifact-studio-shell";
import { Bold, Image, Italic, List, Quote, Redo2, Table, Undo2 } from "lucide-react";
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
      if ((this as HTMLElement).hasAttribute?.("data-measure-group")) return 70;
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

  it("never lists an action in two places, and never loses one", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 280,
    });
    renderWorkbar(documentDefaults());
    const bar = screen.getByRole("toolbar", { name: "Document workbar" });

    const present = (scope: HTMLElement, label: string) => {
      const exact = new RegExp(`^${label}$`);
      return (
        within(scope).queryAllByRole("button", { name: exact }).length > 0 ||
        within(scope).queryAllByRole("menuitem", { name: exact }).length > 0 ||
        within(scope).queryAllByRole("listbox", { name: exact }).length > 0 ||
        within(scope).queryAllByRole("spinbutton", { name: exact }).length > 0 ||
        within(scope).queryAllByRole("combobox", { name: exact }).length > 0
      );
    };
    const labels = ["Find", "Undo", "Redo", "Outline", "Comments", "Font", "Size", "Bold", "Italic"];
    const places = new Map(labels.map((label) => [label, present(bar, label) ? 1 : 0]));

    // Every menu the bar holds, a folded group's or More, opened one at a time.
    // They are portaled, which is what keeps the bar's height fixed.
    const triggers = within(bar)
      .getAllByRole("button")
      .filter((button) => / group$|^More /.test(button.getAttribute("aria-label") ?? ""));
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      const menu = screen.getByRole("menu");
      expect(bar.contains(menu)).toBe(false);
      for (const label of labels) if (present(menu, label)) places.set(label, places.get(label)! + 1);
      fireEvent.keyDown(menu, { key: "Escape" });
    }
    expect(labels.filter((label) => places.get(label)! > 1)).toEqual([]);
    expect(labels.filter((label) => places.get(label) === 0)).toEqual([]);
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
    // The reason is on the button itself, not only in a hover tooltip.
    expect(document.getElementById(undo.getAttribute("aria-describedby") ?? "")?.textContent).toContain("Nothing to undo yet");
    expect(undo.getAttribute("title")).toBeNull();
  });
});

/** An Insert tab with a group whose commands mean nothing without their words. */
function insertBindings(): CommandBinding[] {
  return [
    { id: "history.undo", label: "Undo", icon: Undo2, general: true, priority: "essential", onSelect: () => {} },
    { id: "history.redo", label: "Redo", icon: Redo2, general: true, priority: "essential", onSelect: () => {} },
    { id: "insert.table", label: "Table", icon: Table, tab: "Insert", group: "Tables", onSelect: () => {} },
    { id: "insert.image", label: "Image", icon: Image, tab: "Insert", group: "Media", onSelect: () => {} },
    { id: "insert.citation", label: "Citation", icon: Quote, tab: "Insert", group: "References", onSelect: () => {} },
    { id: "insert.footnote", label: "Footnote", icon: Quote, tab: "Insert", group: "References", onSelect: () => {} },
    { id: "format.bold", label: "Bold", icon: Bold, tab: "Format", group: "Font", onSelect: () => {} },
    { id: "format.italic", label: "Italic", icon: Italic, tab: "Format", group: "Font", onSelect: () => {} },
    { id: "format.list.bullet", label: "Bulleted list", icon: List, tab: "Format", group: "Lists", onSelect: () => {} },
  ];
}

describe("the editor's collapse plan", () => {
  it("leads every tab with undo and redo, as icons only", () => {
    renderWorkbar(insertBindings());
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo.textContent).toBe("");
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
    expect(undo.closest("[data-workbar-history]")).toBeTruthy();
  });

  it("never labels a universal symbol, even with room to spare", () => {
    renderWorkbar(insertBindings());
    fireEvent.click(screen.getByRole("tab", { name: "Format" }));
    expect(screen.getByRole("button", { name: "Bold" }).textContent).toBe("");
  });

  it("shows every command with its words when there is room", () => {
    renderWorkbar(insertBindings());
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(screen.getByRole("button", { name: "Table" }).textContent).toBe("Table");
    expect(screen.getByRole("button", { name: "Citation" }).textContent).toBe("Citation");
    expect(screen.queryByRole("button", { name: "References group" })).toBeNull();
  });

  it("moves a label-dependent group into its own dropdown as a unit", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
    renderWorkbar(insertBindings());
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    // Icons that are unmistakable lose their words first…
    expect(screen.getByRole("button", { name: "Table" }).textContent).toBe("");
    // …and Citation is never shrunk to an icon: its whole group folds instead.
    expect(screen.queryByRole("button", { name: "Citation" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "References group" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Citation" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Footnote" })).toBeTruthy();
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

  it("reorders a command within its group and saves only its own type's layout", () => {
    workbarStore.value = { sheets: { tabOrder: ["Data"] } };
    renderWorkbar(insertBindings());
    fireEvent.click(screen.getByRole("tab", { name: "Format" }));
    fireEvent.click(screen.getByRole("button", { name: /Customize/i }));
    // Nothing runs while customising, and undo and redo cannot move.
    expect(screen.queryByRole("button", { name: "Move Undo" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Move Italic" }), { key: "ArrowLeft" });
    const stored = workbarStore.value as Record<string, { commandOrder?: Record<string, string[]> } | undefined>;
    expect(stored.document?.commandOrder?.Format?.slice(0, 2)).toEqual([
      "document.format.italic",
      "document.format.bold",
    ]);
    expect(stored.sheets).toEqual({ tabOrder: ["Data"] });
    const chips = screen.getAllByRole("button", { name: /^Move (Bold|Italic)$/ });
    expect(chips.map((chip) => chip.getAttribute("aria-label"))).toEqual(["Move Italic", "Move Bold"]);
  });

  it("moves a whole group, and reset returns the shipped order", () => {
    renderWorkbar(insertBindings());
    fireEvent.click(screen.getByRole("tab", { name: "Format" }));
    fireEvent.click(screen.getByRole("button", { name: /Customize/i }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Move group Lists" }), { key: "ArrowLeft" });
    const stored = () => (workbarStore.value as Record<string, { groupOrder?: Record<string, string[]> } | undefined>).document;
    expect(stored()?.groupOrder?.Format).toEqual(["Lists", "Font"]);
    fireEvent.click(screen.getByRole("button", { name: "Finish customizing" }));
    const groups = [...screen.getByRole("toolbar").querySelectorAll("[data-workbar-group]")].map((node) =>
      node.getAttribute("data-workbar-group"),
    );
    expect(groups).toEqual(["History", "Lists", "Font"]);
    fireEvent.click(screen.getByRole("button", { name: /Reset this workbar/i }));
    expect(stored()).toEqual({});
  });
});

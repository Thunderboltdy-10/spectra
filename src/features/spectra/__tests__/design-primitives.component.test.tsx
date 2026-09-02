// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ArtifactDeleteDialog,
  PendingCreateDialog,
  TrashPurgeDialog,
  WorkspaceDeleteDialog,
} from "../components/shell-dialogs";

/**
 * The baseline primitives, proved by rendering them (DS-2, DS-4,
 * ARCHITECTURE-PLATFORM §3). These tests exist because the defect class was
 * structural: dialogs with no focus trap, inputs with no visible focus, icon
 * buttons with no name — all invisible in screenshots.
 */

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dialog", () => {
  it("portals exactly one overlay at the named layer and traps focus", () => {
    render(
      <Dialog open>
        <DialogContent layer="modal">
          <DialogTitle>Rename workspace</DialogTitle>
          <DialogDescription>Names stay editable.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("z-modal");
    const overlays = document.querySelectorAll(
      "[data-slot='dialog-overlay'], .z-modal",
    );
    // One overlay (the content shares the class but is a separate node).
    const underlays = [...overlays].filter(
      (element) => element !== dialog && element.classList.contains("fixed"),
    );
    expect(underlays.length).toBe(1);
    expect(underlays[0]!.className).toContain("bg-[var(--bg-overlay)]");
    // Radix wires the title/description pair.
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("lets a surface choose another layer", () => {
    render(
      <Dialog open>
        <DialogContent layer="composer-dock">
          <DialogTitle>Pick from page</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("dialog").className).toContain("z-composer-dock");
    expect(screen.getByRole("dialog").className).not.toContain("z-modal");
  });

  it("names its close button (DS-4: unnamed icon buttons)", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Anything</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Anything</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("Field", () => {
  it("binds label to control and announces the error instead of the hint", () => {
    render(
      <Field
        label="Workspace name"
        description="Shown in the rail."
        error="Name is required."
        required
      >
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: /workspace name/i });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const describedElement = document.getElementById(describedBy!);
    expect(describedElement?.textContent).toBe("Name is required.");
    expect(describedElement?.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("Shown in the rail.")).toBeNull();
  });

  it("wires the description when there is no error", () => {
    render(
      <Field label="Title" description="You can change it later.">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Title" });
    const describedElement = document.getElementById(
      input.getAttribute("aria-describedby")!,
    );
    expect(describedElement?.textContent).toBe("You can change it later.");
  });
});

describe("Input", () => {
  it("carries the restored focus ring itself (DS-4)", () => {
    render(<Input aria-label=" bare" />);
    const className = screen.getByRole("textbox").className;
    expect(className).toContain("focus-visible:ring-2");
    expect(className).toContain("focus-visible:ring-[var(--focus-ring-color)]");
    expect(className).not.toContain("focus-visible:ring-0");
  });
});

describe("Button", () => {
  it("keeps one hover/focus treatment across variants", () => {
    render(<Button variant="primary">Create</Button>);
    const className = screen.getByRole("button", { name: "Create" }).className;
    expect(className).toContain("focus-visible:ring-2");
    expect(className).toContain("hover:-translate-y-px");
    expect(className.split(/\s+/)).toContain("[color:var(--bg-primary)]");
    expect(className.split(/\s+/)).toContain("text-caption");
  });
});

describe("shell dialogs", () => {
  it("WorkspaceDeleteDialog holds the confirm gate until the sentence matches", () => {
    const onConfirm = vi.fn();
    const onConfirmationChange = vi.fn();
    const { rerender } = render(
      <WorkspaceDeleteDialog
        open
        workspaceTitle="Biology"
        confirmation=""
        onConfirmationChange={onConfirmationChange}
        busy={false}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText("Permanently remove Biology?")).toBeTruthy();
    const confirmButton = screen.getByRole("button", {
      name: /delete permanently/i,
    }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    rerender(
      <WorkspaceDeleteDialog
        open
        workspaceTitle="Biology"
        confirmation="Remove Biology permanently"
        onConfirmationChange={onConfirmationChange}
        busy={false}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("TrashPurgeDialog uses the shared delete voice", () => {
    const onConfirm = vi.fn();
    render(
      <TrashPurgeDialog
        open
        title="Delete “Unit 3” forever?"
        detail="Folders include everything inside them. This cannot be undone."
        busy={false}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText("Delete “Unit 3” forever?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /delete forever/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ArtifactDeleteDialog names the artifact honestly", () => {
    render(
      <ArtifactDeleteDialog
        open
        artifactTitle="Lab notes"
        busy={false}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("Delete Lab notes?")).toBeTruthy();
    expect(
      screen.getByText(/version history, and directly linked/i),
    ).toBeTruthy();
  });

  it("PendingCreateDialog offers General plus every workspace", () => {
    const onSelect = vi.fn();
    render(
      <PendingCreateDialog
        open
        typeLabel="document"
        workspaces={[
          { id: "ws1", title: "Biology", accentColor: "#123456" },
          { id: "ws2", title: "History", accentColor: "#654321" },
        ]}
        onCancel={() => {}}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText(/Where should this document live\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /general/i }));
    expect(onSelect).toHaveBeenCalledWith(undefined);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(onSelect).toHaveBeenCalledWith("ws2");
  });
});

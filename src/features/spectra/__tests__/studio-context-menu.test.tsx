// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StudioMenuRegistry,
  useStudioContextItems,
  useStudioContextMenu,
  type StudioMenuContext,
  type StudioMenuGroup,
  type StudioMenuProvider,
} from "../components/studio-context-menu";

afterEach(cleanup);

function Part({ provider }: { provider: StudioMenuProvider }) {
  useStudioContextItems(provider);
  return <p data-testid="part">A paragraph</p>;
}

function Studio({ common, inner }: { common: StudioMenuProvider; inner: StudioMenuProvider }) {
  const { onContextMenu, element, registry } = useStudioContextMenu(common);
  return (
    <StudioMenuRegistry.Provider value={registry}>
      <div onContextMenu={onContextMenu}>
        <Part provider={inner} />
        <textarea aria-label="Notes" />
      </div>
      {element}
    </StudioMenuRegistry.Provider>
  );
}

describe("the studio's right-click", () => {
  it("lists the place's own entries first, the common ones last, and runs the one chosen", async () => {
    const copy = vi.fn();
    const remove = vi.fn();
    const inner = vi.fn((_context: StudioMenuContext): StudioMenuGroup[] => [[{ key: "comment", label: "Comment", onSelect: vi.fn() }]]);
    const common = (): StudioMenuGroup[] => [
      [{ key: "copy", label: "Copy", hint: "Ctrl+C", onSelect: copy }, { key: "paste", label: "Paste", disabled: true, onSelect: vi.fn() }],
      [{ key: "delete", label: "Delete", danger: true, onSelect: remove }],
    ];
    render(<Studio common={common} inner={inner} />);
    fireEvent.contextMenu(screen.getByTestId("part"), { clientX: 40, clientY: 50 });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Comment", "CopyCtrl+C", "Paste", "Delete"]);
    expect(items[2]!.getAttribute("aria-disabled")).toBe("true");
    expect(inner.mock.calls[0]![0]).toMatchObject({ x: 40, y: 50, selection: "" });
    fireEvent.click(items[1]!);
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(remove).not.toHaveBeenCalled();
  });

  it("leaves fields and Shift to the browser's own menu", () => {
    const common = vi.fn((): StudioMenuGroup[] => [[{ key: "copy", label: "Copy", onSelect: vi.fn() }]]);
    render(<Studio common={common} inner={() => null} />);
    expect(fireEvent.contextMenu(screen.getByRole("textbox", { name: "Notes" }))).toBe(true);
    expect(fireEvent.contextMenu(screen.getByTestId("part"), { shiftKey: true })).toBe(true);
    expect(common).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

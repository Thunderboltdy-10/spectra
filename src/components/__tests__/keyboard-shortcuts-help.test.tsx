// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  KeyboardShortcutsHelp,
  OPEN_SHORTCUTS_EVENT,
} from "../keyboard-shortcuts";

afterEach(cleanup);

describe("Keyboard shortcuts help", () => {
  it("lists Mod+K for the command bar beside Mod+Shift+F for sidebar search", () => {
    render(<KeyboardShortcutsHelp />);
    act(() => {
      window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
    });
    const commandBar = screen.getByText("Open command bar").parentElement!;
    expect(commandBar.textContent).toMatch(/K$/);
    expect(commandBar.textContent).not.toMatch(/Shift/);
    const search = screen.getByText("Find a conversation").parentElement!;
    expect(search.textContent).toMatch(/ShiftF$/);
  });
});

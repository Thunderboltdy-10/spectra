// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useModalFocus } from "./use-modal-focus";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  useModalFocus(surface, { open, onClose: () => setOpen(false) });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open ? (
        <div ref={surface} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Example">
          <button type="button">First</button>
          <button type="button">Last</button>
        </div>
      ) : null}
    </>
  );
}

describe("useModalFocus", () => {
  it("moves focus in, keeps Tab inside, closes on Escape and returns focus", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

/** Hand-built modals that implement the same trap, Escape and focus return
 * with their own key handlers. Anything else must use useModalFocus. */
const OWN_KEYBOARD_CONTRACT = new Set([
  "src/features/spectra/components/chat-browser-panel.tsx",
  "src/features/spectra/components/context-controls.tsx",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("hand-built modal dialogs", () => {
  it("all use the shared keyboard contract", () => {
    const root = process.cwd();
    const missing = sourceFiles(join(root, "src"))
      .map((path) => ({ path: relative(root, path).replace(/\\/g, "/"), source: readFileSync(path, "utf8") }))
      .filter(({ source }) => /aria-modal=(?:"true"|\{true\}|\{[^}]*\?\s*true)/.test(source))
      .filter(({ path, source }) => !source.includes("useModalFocus(") && !OWN_KEYBOARD_CONTRACT.has(path))
      .map(({ path }) => path);
    expect(missing).toEqual([]);
  });

  it("each surface that takes the keyboard contract is announced as modal", () => {
    const root = process.cwd();
    const unannounced = sourceFiles(join(root, "src"))
      .map((path) => ({ path: relative(root, path).replace(/\\/g, "/"), source: readFileSync(path, "utf8") }))
      .filter(({ source }) =>
        (source.match(/useModalFocus\(/g) ?? []).length >
        (source.match(/aria-modal=/g) ?? []).length)
      .map(({ path }) => path);
    expect(unannounced).toEqual([]);
  });
});

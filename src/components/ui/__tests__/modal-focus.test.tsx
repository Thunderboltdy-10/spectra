// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminDialog } from "@/features/spectra/administration/shared";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Remove member
      </button>
      <AdminDialog
        open={open}
        danger
        title="Remove this member?"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button">Remove</button>
          </>
        }
      >
        <p>They lose access to the school.</p>
      </AdminDialog>
    </>
  );
}

// AdminDialog is now the shared Radix Dialog; Radix returns focus on the
// frame after unmount, so the restore is awaited.
describe("admin dialogs", () => {
  it("move focus in, keep Tab inside, close on Escape and restore focus", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Remove member" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Remove this member?" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    const remove = screen.getByRole("button", { name: "Remove" });
    remove.focus();
    fireEvent.keyDown(remove, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(remove);

    fireEvent.keyDown(remove, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

/* Tailwind splits class names on whitespace, so an arbitrary value written
   with spaces ("bg-[color-mix(in oklab, …)]") silently produces no CSS: the
   /join and ManageBac error boxes lost their tinted background this way. */
describe("arbitrary Tailwind values", () => {
  it("never contain spaces inside a CSS function", () => {
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(absolute);
        } else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(absolute, "utf8");
          for (const match of source.matchAll(/[a-z]-\[[a-z-]+\([^\]"'`{}]* [^\]"'`{}]*\]/g))
            offenders.push(`${path.relative(process.cwd(), absolute)}: ${match[0]}`);
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});

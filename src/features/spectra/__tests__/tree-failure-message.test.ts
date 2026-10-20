import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { treeFailureMessage } from "../organization/tree-client";

describe("treeFailureMessage LIBRARY_* humanization", () => {
  it("maps known LIBRARY_* codes to plain sentences", () => {
    expect(treeFailureMessage(new Error("LIBRARY_TARGETS_REQUIRED"), "fallback")).toBe(
      "Select something first.",
    );
    expect(
      treeFailureMessage(new Error("LIBRARY_FOLDER_NAME_REQUIRED"), "fallback"),
    ).toBe("Enter a folder name first.");
    expect(
      treeFailureMessage(new Error("LIBRARY_RENAME_PARAMS_REQUIRED"), "fallback"),
    ).toBe("Choose one item and enter a new name.");
    expect(
      treeFailureMessage(new Error("LIBRARY_DESTINATION_REQUIRED"), "fallback"),
    ).toBe("Choose where to put it.");
  });

  it("strips Convex Uncaught Error prefix before mapping", () => {
    expect(
      treeFailureMessage(
        new Error("Uncaught Error: LIBRARY_TARGETS_REQUIRED\n  at handler"),
        "fallback",
      ),
    ).toBe("Select something first.");
  });

  it("uses the fallback for a redacted production Convex frame", () => {
    expect(
      treeFailureMessage(
        new Error(
          "[CONVEX M(libraryTree:move)] [Request ID: 5c2b1e0f9a] Server Error\n  Called by client",
        ),
        "Could not move.",
      ),
    ).toBe("Could not move.");
  });

  it("maps unknown LIBRARY_* codes to a generic Library sentence", () => {
    expect(
      treeFailureMessage(new Error("LIBRARY_SOMETHING_NEW"), "fallback"),
    ).toBe("Could not update the Library. Try again.");
  });

  it("AUTH_* humanization wins when AUTH_* and LIBRARY_* both appear", () => {
    expect(
      treeFailureMessage(
        new Error("AUTH_NOT_SIGNED_IN: Sign in. LIBRARY_TARGETS_REQUIRED"),
        "fallback",
      ),
    ).toBe("Sign in to continue.");
    expect(
      treeFailureMessage(
        new Error("Uncaught Error: AUTH_NO_SCHOOL: No school.\nLIBRARY_FOLDER_NAME_REQUIRED"),
        "fallback",
      ),
    ).toBe("This account does not have an active school membership.");
  });

  it("maps AUTH_* alone to identity copy (not raw code)", () => {
    expect(treeFailureMessage(new Error("AUTH_REQUIRED: Sign in."), "fallback")).toBe(
      "Check your account, then try again.",
    );
  });

  it("keeps non-LIBRARY messages and falls back when empty", () => {
    expect(treeFailureMessage(new Error("permission denied"), "fallback")).toBe(
      "permission denied",
    );
    expect(treeFailureMessage(new Error(""), "Could not move.")).toBe(
      "Could not move.",
    );
  });

  it("SurfaceNewMenu offers only what can be made where the reader stands", () => {
    const organizer = readFileSync(
      resolve(__dirname, "../organization/library-organizer.tsx"),
      "utf8",
    );
    const chrome = readFileSync(
      resolve(__dirname, "../organization/surface-chrome.tsx"),
      "utf8",
    );
    expect(organizer).toContain("const inFolder = location.kind === \"folder\"");
    // Recent, Favorites and Shared are ways of looking: new work still starts at
    // the top, but folders, workspaces and imports appear only inside a place.
    expect(organizer).toContain("onNewFolder={inFolder ? createFolderHere : undefined}");
    expect(organizer).toContain("onNewWork={createWorkHere}");
    // When New is unavailable the reason is visible, not hover-only.
    expect(chrome).toContain("disabledTitle");
    expect(chrome).toContain("aria-description");
    expect(chrome).toContain('role="status"');
    expect(chrome).toContain("{disabledTitle}");
    expect(chrome).toContain("withDisabledReason");
  });
});

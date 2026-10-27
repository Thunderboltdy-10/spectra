// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DisconnectDialog,
  changedFields,
  humanizeIntegrationError,
  integrationConnectionMessage,
  ManifestDialog,
  SettingsDialog,
  ConflictList,
} from "../pages/managebac-integration-shell";
import { getSpectraManageBacComparison } from "../data/api";

vi.mock("../data/api", async importOriginal => ({
  ...await importOriginal<typeof import("../data/api")>(),
  getSpectraManageBacComparison: vi.fn(),
}));

afterEach(cleanup);

describe("ManageBac conflict comparison", () => {
  it("reveals complete source and saved local values only on expansion", async () => {
    const prefix = "The same long beginning. ".repeat(10);
    vi.mocked(getSpectraManageBacComparison).mockResolvedValue({ state: "available", savedAt: 1234, fields: { description: prefix + "local ending" } });
    render(<ConflictList busy="" onResolve={vi.fn()} conflicts={[{
      _id: "conflict-1", kind: "customization_overlap", projectionType: "planner_task", oldSource: { description: prefix + "before ending" },
      newSource: { description: prefix + "after ending" }, suggestedActions: ["rebase", "keep_overlay"], affectedLinks: [], status: "open", createdAt: 1234,
    }]} />);
    expect(getSpectraManageBacComparison).not.toHaveBeenCalled();
    const details = screen.getByText("Compare full versions").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText(prefix + "local ending")).toBeTruthy();
    expect(screen.getByText(prefix + "before ending")).toBeTruthy();
    expect(screen.getByText(prefix + "after ending")).toBeTruthy();
    expect(getSpectraManageBacComparison).toHaveBeenCalledExactlyOnceWith("conflict-1");
  });

  it("keeps changes beyond the displayed preview and ignores HTML rewrapping", () => {
    const prefix = "A description with a long unchanged beginning. ".repeat(3);
    const fields = changedFields({ description: prefix + "old ending" }, { description: prefix + "new ending" });
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe("description");
    expect(fields[0].before).toHaveLength(80);
    expect(changedFields({ description: "<p>The same words</p>" }, { description: "<div>The same words</div>" })).toEqual([]);
  });
});

function settings(busy = false, onClose = vi.fn()) {
  render(
    <SettingsDialog
      config={{ baseUrl: "https://api.managebac.com", token: "" }}
      setConfig={vi.fn()}
      busy={busy}
      connected
      envTokenAvailable={false}
      onClose={onClose}
      onSave={vi.fn()}
      onManifest={vi.fn()}
    />,
  );
  return onClose;
}

describe("ManageBac dialogs on the shared Dialog", () => {
  it("asks to disconnect above every panel, starting on the safe answer", () => {
    const onConfirm = vi.fn();
    render(
      <DisconnectDialog busy={false} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Disconnect ManageBac?",
    });
    // The modal layer, not `dropdown`, which app panels and popovers paint over.
    expect(dialog.className).toContain("z-modal");
    expect(dialog.className).not.toContain("z-dropdown");
    expect(document.activeElement?.textContent).toBe("Keep connected");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed while the disconnect runs", () => {
    const onClose = vi.fn();
    render(<DisconnectDialog busy onClose={onClose} onConfirm={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Keep connected" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("names the settings and manifest dialogs by the titles they show", () => {
    settings();
    expect(
      screen.getByRole("dialog", { name: "ManageBac connection" }),
    ).toBeTruthy();
    cleanup();
    render(
      <ManifestDialog
        value=""
        setValue={vi.fn()}
        busy={false}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Verified capability manifest" }),
    ).toBeTruthy();
  });

  it("closes settings on Escape, but not while saving", () => {
    const onClose = settings();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const busyClose = settings(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(busyClose).not.toHaveBeenCalled();
  });
});

describe("ManageBac action failure recovery", () => {
  it("shows route/connection recovery for the structured not-ready response", () => {
    const error = Object.assign(new Error("Server Error"), { data: {
      code: "INTEGRATION_NOT_READY", message: "ManageBac must be connected with verified readable capabilities.",
    } });
    expect(humanizeIntegrationError(error)).toMatch(/administrator.*connection.*routes/i);
  });
  it("keeps a worded action failure and uses action copy for an unworded failure", () => {
    expect(humanizeIntegrationError({ data: { message: "The school token is missing." } })).toBe("The school token is missing.");
    expect(humanizeIntegrationError(new Error("Server Error"))).toBe("ManageBac could not complete that action. Try again.");
  });
});


describe("ManageBac connection history honesty", () => {
  it.each(["blocked", "degraded", "revoked", "connected"] as const)("does not invent a completed sync for first-use %s", status => {
    const message = integrationConnectionMessage({ status });
    expect(message).toContain("No synchronization has completed yet.");
    expect(message).not.toMatch(/completed with partial coverage|records.*available/i);
  });
  it("says why syncing is blocked and keeps historical completion separate", () => {
    const message = integrationConnectionMessage({ status: "blocked", lastSyncAt: 1234, blockedReason: "The stored read-only credential was rejected by ManageBac." });
    // Said plainly, with what to do about it, rather than the provider's own wording.
    expect(message).toContain("ManageBac turned down the saved API key");
    expect(message).not.toMatch(/No synchronization has completed|completed with partial coverage/);
  });
  it("does not infer partial coverage from a degraded connection with earlier history", () => {
    expect(integrationConnectionMessage({ status: "degraded", lastSyncAt: 1234 })).not.toMatch(/completed with partial coverage|records.*available/i);
  });
});

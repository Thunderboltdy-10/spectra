// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DisconnectDialog,
  humanizeIntegrationError,
  integrationConnectionMessage,
  ManifestDialog,
  SettingsDialog,
} from "../pages/managebac-integration-shell";

afterEach(cleanup);

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

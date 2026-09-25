// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DismissibleArtifactNotice } from "../components/dismissible-artifact-notice";

afterEach(cleanup);

describe("artifact sync notice dismissal", () => {
  it("hides repeated feedback without resolving or discarding a conflict", () => {
    const resolve = vi.fn();
    const notice = (identity = "native-revision-a") => (
      <DismissibleArtifactNotice artifactId="paper" identity={identity} role="alert">
        <span>Both copies changed.</span>
        <button onClick={resolve}>Keep Spectra version</button>
      </DismissibleArtifactNotice>
    );
    const { rerender } = render(notice());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss sync notice" }));
    rerender(notice());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(resolve).not.toHaveBeenCalled();

    rerender(notice("native-revision-b"));
    expect(screen.getByRole("alert").textContent).toContain("Both copies changed.");
    fireEvent.click(screen.getByRole("button", { name: "Keep Spectra version" }));
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("does not carry dismissal to another artifact or a new occurrence after recovery", () => {
    const notice = (artifactId: string) => (
      <DismissibleArtifactNotice artifactId={artifactId} identity="offline">
        Reconnecting while keeping your draft.
      </DismissibleArtifactNotice>
    );
    const { rerender } = render(notice("paper"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss sync notice" }));
    rerender(notice("deck"));
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss sync notice" }));
    rerender(<></>);
    rerender(notice("deck"));
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

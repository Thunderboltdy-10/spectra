// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicShareShell } from "../pages/public-share-shell";
import { SPECTRA_REQUEST_UNREACHABLE } from "../data/request";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("../components/published-code-runtime", () => ({
  PublishedCodeRuntime: () => null,
}));

const token = "a".repeat(40);
const returnKey = "spectra:public-share-return";
const projection = {
  resourceType: "artifact",
  level: "read",
  artifact: {
    artifactId: "shared-document",
    title: "Shared lesson",
    blueprintKey: "document",
    content: { blocks: [] },
    updatedAt: 1,
  },
};
const success = () => ({
  ok: true,
  status: 200,
  json: async () => ({ projection }),
});

beforeEach(() => {
  router.push.mockClear();
  window.history.replaceState(null, "", "/public");
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("public share auth return", () => {
  it("uses the app router for sign-in while keeping the token out of its URL", async () => {
    window.history.replaceState(null, "", "/public#" + token);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ code: "AUTH_REQUIRED", error: "Sign in to continue" }),
    }));
    render(<PublicShareShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to continue" }));
    expect(router.push).toHaveBeenCalledWith("/sign-in?redirect_url=%2Fpublic");
    expect(window.sessionStorage.getItem(returnKey)).toBe(token);
  });

  it("restores the fragment before clearing the return token and survives refresh", async () => {
    window.sessionStorage.setItem(returnKey, token);
    const fetchMock = vi.fn().mockImplementation(async () => success());
    vi.stubGlobal("fetch", fetchMock);
    const rendered = render(<PublicShareShell />);
    await screen.findByText("Shared lesson");
    expect(window.location.hash).toBe("#" + token);
    expect(window.sessionStorage.getItem(returnKey)).toBeNull();
    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).token).toBe(token);
    rendered.unmount();
    render(<PublicShareShell />);
    await screen.findByText("Shared lesson");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retains an auth-return token across a transient read failure", async () => {
    window.sessionStorage.setItem(returnKey, token);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Temporary read failure"))
      .mockImplementation(async () => success());
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicShareShell />);
    // A request that never reached the server speaks the shared connection copy.
    await screen.findByText(SPECTRA_REQUEST_UNREACHABLE);
    expect(window.sessionStorage.getItem(returnKey)).toBe(token);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await screen.findByText("Shared lesson");
    expect(window.location.hash).toBe("#" + token);
  });

  it("clears a terminal invalid return token", async () => {
    window.sessionStorage.setItem(returnKey, token);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({ error: "Shared view expired" }),
    }));
    render(<PublicShareShell />);
    await screen.findByText("Shared view expired");
    expect(window.sessionStorage.getItem(returnKey)).toBeNull();
  });
});

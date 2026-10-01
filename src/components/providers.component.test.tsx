// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { Providers } from "./providers";
import { showRetryToast } from "./ui/retry-toast";

vi.mock("next/navigation", () => ({ usePathname: () => "/school" }));
vi.mock("convex/react", () => ({ ConvexReactClient: vi.fn() }));
vi.mock("convex/react-clerk", () => ({ ConvexProviderWithClerk: ({ children }: { children: ReactNode }) => children }));
vi.mock("./use-recoverable-clerk-auth", () => ({ useRecoverableClerkAuth: vi.fn() }));
vi.mock("./account-storage-boundary", () => ({ AccountStorageBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock("./theme-provider", () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("./spectra-logo", () => ({ DynamicFavicon: () => null }));
vi.mock("./cookie-consent-manager", () => ({ CookieConsentManager: () => null }));
vi.mock("@/features/spectra/compute/cache/local-compute-cache-controller", () => ({ LocalComputeCacheController: () => null }));
vi.mock("@/features/spectra/motion/motion-primitives", () => ({ SpectraMotionConfig: ({ children }: { children: ReactNode }) => children }));

afterEach(() => {
  toast.dismiss();
  cleanup();
  vi.useRealTimers();
});

it("exposes both independent recovery actions without hovering or dismissing the newer notice", async () => {
  render(<Providers><main>School context</main></Providers>);
  const retryWork = vi.fn();
  const retryConversation = vi.fn((id: string | number) => { toast.dismiss(id); });
  showRetryToast("This conversation could not be opened.", retryConversation, { label: "Try again" });
  showRetryToast("This work could not be opened.", retryWork, { label: "Try again" });
  await screen.findByText("This work could not be opened.");
  const conversation = screen.getByText("This conversation could not be opened.").closest("[data-sonner-toast]") as HTMLElement;
  const work = screen.getByText("This work could not be opened.").closest("[data-sonner-toast]") as HTMLElement;
  // This attribute selects Sonner's separated layout instead of its overlapping stack.
  await waitFor(() => {
    expect(conversation.getAttribute("data-expanded")).toBe("true");
    expect(work.getAttribute("data-expanded")).toBe("true");
  });
  fireEvent.click(within(conversation).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByText("This conversation could not be opened.")).toBeNull());
  expect(retryConversation).toHaveBeenCalledOnce();
  expect(retryWork).not.toHaveBeenCalled();
  expect(within(work).getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.getByText("School context")).toBeTruthy();
});

it("still expires ordinary notifications with the expanded layout", async () => {
  vi.useFakeTimers();
  render(<Providers>{null}</Providers>);
  act(() => { toast.success("Saved."); });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(screen.getByText("Saved.")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.queryByText("Saved.")).toBeNull();
});

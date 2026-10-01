// @vitest-environment jsdom
import type { MouseEvent } from "react";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureSpectraNavigation, useSpectraRouter } from "./use-spectra-router";
import { SPECTRA_REQUEST_UNREACHABLE } from "../data/request";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() },
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("blocks offline push and replace and rechecks connectivity on the next activation", () => {
  let online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const { result } = renderHook(useSpectraRouter);
  expect(result.current.push("/calendar")).toBe(false);
  expect(result.current.replace("/admin?tab=people", { scroll: false })).toBe(false);
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect(mocks.router.replace).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenNthCalledWith(1, SPECTRA_REQUEST_UNREACHABLE);
  expect(mocks.error).toHaveBeenNthCalledWith(2, SPECTRA_REQUEST_UNREACHABLE);
  online = true;
  expect(result.current.push("/calendar")).toBe(true);
  expect(result.current.replace("/admin?tab=people", { scroll: false })).toBe(true);
  expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/calendar");
  expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/admin?tab=people", { scroll: false });
});

it("keeps local fragments and browser history usable offline", () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const { result } = renderHook(useSpectraRouter);
  expect(result.current.push("#open-section")).toBe(true);
  result.current.back(); result.current.forward();
  expect(mocks.router.push).toHaveBeenCalledWith("#open-section");
  expect(mocks.router.back).toHaveBeenCalledOnce();
  expect(mocks.router.forward).toHaveBeenCalledOnce();
  expect(mocks.error).not.toHaveBeenCalled();
});

it("does not fetch routes through refresh or background prefetch offline", () => {
  let online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const { result } = renderHook(useSpectraRouter);
  result.current.prefetch("/library");
  expect(mocks.error).not.toHaveBeenCalled();
  result.current.refresh();
  expect(mocks.router.prefetch).not.toHaveBeenCalled();
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith(SPECTRA_REQUEST_UNREACHABLE);
  online = true;
  result.current.prefetch("/library"); result.current.refresh();
  expect(mocks.router.prefetch).toHaveBeenCalledWith("/library");
  expect(mocks.router.refresh).toHaveBeenCalledOnce();
});

it.each([
  { label: "fragment", href: "#open-section" },
  { label: "malformed external link", href: "http://[" },
  { label: "external link", href: "https://outside.example/page" },
  { label: "download", href: "/download", download: "notes.docx" },
  { label: "new tab", href: "/library", target: "_blank" },
  { label: "modified activation", href: "/library", ctrlKey: true },
])("preserves $label activation offline", ({ href, download, target, ctrlKey }) => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const action = vi.fn((event: MouseEvent) => event.preventDefault());
  render(<div onClickCapture={captureSpectraNavigation}><a href={href} download={download} target={target} onClick={action}><span>Destination</span></a></div>);
  fireEvent.click(screen.getByText("Destination"), { ctrlKey });
  expect(action).toHaveBeenCalledOnce();
  expect(mocks.error).not.toHaveBeenCalled();
});

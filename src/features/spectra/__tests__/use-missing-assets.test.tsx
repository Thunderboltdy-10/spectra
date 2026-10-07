// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MISSING_ASSET_RETRIES_MS, useMissingAssets } from "../components/use-missing-assets";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("an asset the content names but the list lacks", () => {
  it("reloads the list, and stops once it is there", async () => {
    const known = new Set<string>();
    const reload = vi.fn(async () => known.add("a1"));
    const { rerender } = renderHook(({ ids }) => useMissingAssets(ids, known, reload), { initialProps: { ids: ["a1"] } });
    await act(async () => vi.advanceTimersByTime(MISSING_ASSET_RETRIES_MS[0]!));
    expect(reload).toHaveBeenCalledTimes(1);
    rerender({ ids: ["a1"] });
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("gives up after a few tries when the asset never appears", async () => {
    const reload = vi.fn(async () => undefined);
    renderHook(() => useMissingAssets(["gone"], new Set<string>(), reload));
    for (let look = 0; look < 6; look++) await act(async () => vi.advanceTimersByTime(6000));
    expect(reload).toHaveBeenCalledTimes(MISSING_ASSET_RETRIES_MS.length);
  });

  it("does nothing when every named asset is known", async () => {
    const reload = vi.fn(async () => undefined);
    renderHook(() => useMissingAssets(["a1"], new Set(["a1"]), reload));
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(reload).not.toHaveBeenCalled();
  });
});

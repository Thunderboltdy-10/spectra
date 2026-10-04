// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { useIslandEngine, useProvideIslandEngine, type IslandEngine, type SpectraRunEngine } from "../engine";

const engine = (name: string) => ({ name }) as unknown as SpectraRunEngine;

function Lender({ value }: { value: IslandEngine | null }) {
  useProvideIslandEngine(value);
  return null;
}

const latest: { current: IslandEngine | null } = { current: null };
function Reader() {
  const value = useIslandEngine();
  useEffect(() => {
    latest.current = value;
  });
  return null;
}

describe("island engine hand-off", () => {
  it("talks through the latest lender and falls back when it leaves", () => {
    const host = { engine: engine("host") };
    const page = { engine: engine("page"), restAsComposer: true };
    const view = render(
      <>
        <Reader />
        <Lender value={host} />
      </>,
    );
    expect(latest.current).toBe(host);
    view.rerender(
      <>
        <Reader />
        <Lender value={host} />
        <Lender value={page} />
      </>,
    );
    expect(latest.current).toBe(page);
    view.rerender(
      <>
        <Reader />
        <Lender value={host} />
      </>,
    );
    expect(latest.current).toBe(host);
    view.unmount();
    render(<Reader />);
    expect(latest.current).toBeNull();
  });

  it("updates a lender in place instead of moving it to the top", () => {
    const host = { engine: engine("host") };
    const first = { engine: engine("page"), focus: null };
    const second = { engine: engine("page"), focus: { threadId: "t", title: "Essay" } };
    const view = render(
      <>
        <Reader />
        <Lender value={first} />
        <Lender value={host} />
      </>,
    );
    expect(latest.current).toBe(host);
    act(() =>
      view.rerender(
        <>
          <Reader />
          <Lender value={second} />
          <Lender value={host} />
        </>,
      ),
    );
    expect(latest.current).toBe(host);
    view.unmount();
  });
});

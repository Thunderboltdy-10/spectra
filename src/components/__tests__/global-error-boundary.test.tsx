// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorScreen, GlobalErrorBoundary } from "@/components/global-error-boundary";
import RouteError from "@/app/error";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const providersSource = readFileSync(
  path.resolve(process.cwd(), "src/components/providers.tsx"),
  "utf8",
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

function StatefulChild({ shouldThrow = false }: { shouldThrow?: boolean }) {
  const [value, setValue] = useState("");
  if (shouldThrow) throw new Error("test boundary failure");
  return (
    <label>
      Draft
      <input
        aria-label="Draft"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
}

describe("GlobalErrorBoundary navigation recovery", () => {
  it("passes navigation changes as a reset signal instead of a React key", () => {
    expect(providersSource).toContain(
      "<GlobalErrorBoundary resetKey={pathname}>",
    );
    expect(providersSource).not.toContain(
      "<GlobalErrorBoundary key={pathname}>",
    );
  });

  it("preserves healthy child state when the reset key changes", () => {
    const view = render(
      <GlobalErrorBoundary resetKey="/sign-in">
        <StatefulChild />
      </GlobalErrorBoundary>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), {
      target: { value: "typed before navigation" },
    });
    view.rerender(
      <GlobalErrorBoundary resetKey="/sign-up">
        <StatefulChild />
      </GlobalErrorBoundary>,
    );

    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveProperty(
      "value",
      "typed before navigation",
    );
  });

  it("recovers a failed screen when navigation changes the reset key", () => {
    const view = render(
      <GlobalErrorBoundary resetKey="/factor-one">
        <StatefulChild shouldThrow />
      </GlobalErrorBoundary>,
    );
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();

    view.rerender(
      <GlobalErrorBoundary resetKey="/factor-two">
        <StatefulChild />
      </GlobalErrorBoundary>,
    );

    expect(screen.getByRole("textbox", { name: "Draft" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Something went wrong" })).toBeNull();
  });
});

describe("app router error screen", () => {
  it("gives a server-rendered failure the recovery screen and refetches on retry", () => {
    const reset = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteError error={Object.assign(new Error("Server Components render failed"), { digest: "123" })} reset={reset} />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
  });
});

function observePageReload() {
  const reload = vi.fn();
  const currentWindow = window;
  vi.stubGlobal("window", new Proxy(currentWindow, {
    get(target, property, receiver) {
      if (property === "location") return { reload };
      return Reflect.get(target, property, receiver);
    },
  }));
  return reload;
}

describe("module loading recovery", () => {
  it("reloads a rejected lazy module instead of retrying its cached rejection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi.fn<() => Promise<{ default: () => ReactNode }>>()
      .mockRejectedValueOnce(new Error("Failed to load chunk /_next/static/chunks/editor.js"))
      .mockResolvedValue({ default: () => <p>Editor loaded</p> });
    const FailedEditor = lazy(load);
    const view = render(
      <GlobalErrorBoundary>
        <Suspense fallback={<p>Loading editor</p>}><FailedEditor /></Suspense>
      </GlobalErrorBoundary>,
    );
    await screen.findByRole("heading", { name: "Something went wrong" });
    const reload = observePageReload();
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(reload).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    view.unmount();
    // A fresh page's lazy module has a new payload, unlike a boundary reset.
    const FreshEditor = lazy(load);
    render(<GlobalErrorBoundary><Suspense fallback={<p>Loading editor</p>}><FreshEditor /></Suspense></GlobalErrorBoundary>);
    expect(await screen.findByText("Editor loaded")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each([
    Object.assign(new Error("Loading chunk 123 failed.\n(error: /_next/static/chunks/123.js)"), { name: "ChunkLoadError" }),
    new Error("Failed to load chunk /_next/static/chunks/editor.js from module editor"),
    new TypeError("Failed to fetch dynamically imported module: /editor.js"),
    new TypeError("Importing a module script failed."),
    new TypeError("error loading dynamically imported module: /editor.js"),
  ])("offers one working reload action with public copy for %s", (error) => {
    const retry = vi.fn();
    render(<ErrorScreen error={error} onRetry={retry} />);
    expect(screen.getByText("Part of Spectra could not load. Reconnect, then reload the page.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const reload = observePageReload();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("uses the same module recovery for app-router failures", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<RouteError error={new Error("Failed to load chunk /route.js")} reset={reset} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    const reload = observePageReload();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("still retries ordinary render failures without reloading", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function RecoverableChild() {
      if (shouldThrow) throw new Error("ordinary render failure");
      return <p>Recovered content</p>;
    }
    render(<GlobalErrorBoundary><RecoverableChild /></GlobalErrorBoundary>);
    const reload = observePageReload();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered content")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});

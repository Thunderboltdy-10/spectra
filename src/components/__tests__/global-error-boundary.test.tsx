// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import RouteError from "@/app/error";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const providersSource = readFileSync(
  path.resolve(process.cwd(), "src/components/providers.tsx"),
  "utf8",
);

afterEach(cleanup);

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

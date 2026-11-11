// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { QuietReturnFocus } from "../quiet-return-focus";

afterEach(cleanup);

function setup() {
  const view = render(
    <>
      <QuietReturnFocus />
      <button>One</button>
      <button>Two</button>
    </>,
  );
  const [one, two] = view.getAllByRole("button");
  return { one, two };
}

it("keeps the element focused by the pointer quiet when the window comes back", () => {
  const { one } = setup();
  window.dispatchEvent(new Event("pointerdown"));
  one.focus();
  window.dispatchEvent(new Event("focus"));
  expect(one.hasAttribute("data-quiet-focus")).toBe(true);
  // Alt on its own (the Alt+Tab back) does not wake the ring.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
  expect(one.hasAttribute("data-quiet-focus")).toBe(true);
  // An arrow key, not only Tab, shows it again.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  expect(one.hasAttribute("data-quiet-focus")).toBe(false);
});

it("leaves the ring alone when the keyboard was last used", () => {
  const { one } = setup();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  one.focus();
  window.dispatchEvent(new Event("focus"));
  expect(one.hasAttribute("data-quiet-focus")).toBe(false);
});

it("drops the quiet mark when focus moves on", () => {
  const { one, two } = setup();
  window.dispatchEvent(new Event("pointerdown"));
  one.focus();
  window.dispatchEvent(new Event("focus"));
  two.focus();
  expect(one.hasAttribute("data-quiet-focus")).toBe(false);
  expect(document.querySelector("[data-quiet-focus]")).toBeNull();
});

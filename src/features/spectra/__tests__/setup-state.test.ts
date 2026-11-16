import { expect, it } from "vitest";
import { SETUP_NEW_ACCOUNTS_FROM, setupDue } from "../onboarding/setup-state";

it("skips existing accounts even when Setup is unfinished", () => {
  expect(setupDue({ setupStatus: "pending" }, SETUP_NEW_ACCOUNTS_FROM - 1)).toBe(false);
});
it("keeps Setup for new accounts until they finish", () => {
  expect(setupDue({ setupStatus: "pending" }, SETUP_NEW_ACCOUNTS_FROM)).toBe(true);
  expect(setupDue({ setupStatus: "done" }, SETUP_NEW_ACCOUNTS_FROM)).toBe(false);
});
it("does not show Setup before the account identity has loaded", () => {
  expect(setupDue({ setupStatus: "pending" })).toBe(false);
});

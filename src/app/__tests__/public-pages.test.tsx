// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import NotFound from "../not-found";
import RequestAccessPage from "../request-access/page";
import TermsPage from "../legal/terms/page";

afterEach(cleanup);

const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

describe("pages outside the app", () => {
  it("explains how to get in, with readable ways forward", () => {
    render(<RequestAccessPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Getting into Spectra" })).toBeTruthy();
    expect(href("I have an invitation")).toBe("/join");
    expect(href("Sign up")).toBe("/sign-up");
    expect(href("Sign in")).toBe("/sign-in");
    expect(href("Spectra home")).toBe("/");
    // The old primary link drew white text on a colour token that does not exist.
    expect(document.body.innerHTML).not.toContain("--accent-primary");
  });

  it("says a missing page is missing and offers the way back", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "This page isn’t here" })).toBeTruthy();
    expect(href("Go to your workspace")).toBe("/workspace");
  });

  it("keeps the legal wording and links its related pages", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeTruthy();
    expect(href("Privacy Notice")).toBe("/legal/privacy");
    expect(href("Cookie Policy")).toBe("/legal/cookies");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Landing preview for signed-in users", () => {
  it("keeps / as product home redirect and /landing as previewable shell", () => {
    const home = readFileSync(resolve(__dirname, "../../../app/page.tsx"), "utf8");
    const landing = readFileSync(
      resolve(__dirname, "../../../app/landing/page.tsx"),
      "utf8",
    );
    expect(home).toContain('redirect(`/workspace');
    expect(landing).toContain("LandingClient");
    expect(landing).not.toContain('redirect("/")');
  });
});

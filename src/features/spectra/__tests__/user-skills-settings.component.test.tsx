// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserSkillsSettings } from "@/features/spectra/settings/ui/user-skills-settings";

const skill = {
  id: "skill_essay_evidence",
  name: "Essay evidence checks",
  purpose: "Check every essay claim against a cited source.",
  triggerTerms: ["essay evidence", "source check"],
  version: 3,
  source: "self" as const,
  updatedAt: 100,
};

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data }),
  } as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AI skills settings", () => {
  it("fetches bodies only on inspect and removes a confirmed deletion", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "DELETE") {
          expect(JSON.parse(String(init.body))).toEqual({ skillId: skill.id });
          return jsonResponse({ removed: true, skillId: skill.id });
        }
        if (url.includes("skillId=")) {
          return jsonResponse({
            ...skill,
            body: "# Procedure\n\nInspect every material claim and flag unsupported wording.",
          });
        }
        return jsonResponse([skill]);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<UserSkillsSettings />);

    expect(await screen.findByText("Essay evidence checks")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Inspect every material claim/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View procedure" }));
    expect(
      await screen.findByText(/Inspect every material claim/i),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `skillId=${skill.id}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this skill?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("No personal skills yet")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
  });
});

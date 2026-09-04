// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClassShelfPicker,
  classShelfLoadState,
  type ClassShelfCandidate,
} from "../components/class-shelf-picker";

const classes: ClassShelfCandidate[] = [
  {
    recordId: "class-bio-current",
    title: "Biology HL",
    program: "IBDP",
    grade: "12",
    workspaceId: null,
  },
  {
    recordId: "class-bio-old",
    title: "Biology HL",
    program: "IBDP",
    grade: "11",
    workspaceId: null,
  },
  {
    recordId: "class-chem",
    title: "Chemistry SL",
    program: "IBDP",
    grade: "12",
    workspaceId: "workspace-chem",
  },
  {
    recordId: "class-tok",
    title: "Theory of Knowledge",
    program: "IBDP",
    grade: "12",
    workspaceId: null,
  },
];

afterEach(() => {
  cleanup();
});

describe("class shelf picker", () => {
  it("treats a missing integration as not connected, not as an empty class list", () => {
    expect(
      classShelfLoadState({
        integration: null,
        identityRequired: false,
        classes: [],
      }).kind,
    ).toBe("not_connected");
    expect(
      classShelfLoadState({
        integration: { status: "active" },
        identityRequired: true,
        classes: [],
      }).kind,
    ).toBe("identity_required");
  });

  it("searches and toggles a non-contiguous subset, including similarly named classes", () => {
    function Harness() {
      const [selectedIds, setSelectedIds] = useState(["class-chem"]);
      return (
        <ClassShelfPicker
          state={{ kind: "ready", classes }}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          submitting={false}
          primaryLabel="Use selected classes"
          onSubmit={() => undefined}
          skipLabel="Skip"
          onSkip={() => undefined}
        />
      );
    }
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Search classes"), {
      target: { value: "Biology" },
    });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("option")[0]);
    fireEvent.change(screen.getByLabelText("Search classes"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Theory of Knowledge/ }));
    expect(
      screen.getByRole("option", { name: /Chemistry SL/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("option", { name: /Theory of Knowledge/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getAllByRole("option", { name: /Biology HL/ })[0].getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
  });

  it("keeps a load failure as an error, not as an empty class list", () => {
    render(
      <ClassShelfPicker
        state={{ kind: "error", message: "Check your connection, then try loading classes again." }}
        selectedIds={[]}
        onSelectedIdsChange={() => undefined}
        submitting={false}
        primaryLabel="Save classes"
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByText("Classes could not load")).toBeTruthy();
    expect(
      screen.getByText("Check your connection, then try loading classes again."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Search classes")).toBeNull();
  });
});

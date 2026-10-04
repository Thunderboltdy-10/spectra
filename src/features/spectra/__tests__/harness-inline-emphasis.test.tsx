// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { emphasisSegments, plainEmphasis } from "../ai/inline-emphasis";
import { HarnessInputPanel } from "../components/harness-run-parts";
import { ProgressTrace } from "../components/progress-trace";

afterEach(cleanup);

// Tool labels and questions name work as *Title*. The thread shows that as
// italics and plain places drop the markers: raw asterisks never reach a user.

describe("inline emphasis", () => {
  it("splits emphasis, and leaves snake_case and arithmetic alone", () => {
    expect(emphasisSegments("Remove everything in *Old notes*?")).toEqual([
      { text: "Remove everything in ", emphasis: false },
      { text: "Old notes", emphasis: true },
      { text: "?", emphasis: false },
    ]);
    expect(plainEmphasis("Edited **Week plan** and *Lab_report*")).toBe("Edited Week plan and Lab_report");
    expect(plainEmphasis("read my_notes_file now")).toBe("read my_notes_file now");
    expect(plainEmphasis("Is 5 * 3 = 15?")).toBe("Is 5 * 3 = 15?");
  });

  it("shows an approval question with italics, not asterisks", () => {
    render(
      <HarnessInputPanel
        input={{ kind: "approval", toolCallId: "t1", executionId: "e1", question: "Remove everything in *Old notes*?" }}
        onAnswer={() => true}
      />,
    );
    const region = screen.getByLabelText("Spectra asks for your OK");
    expect(region.textContent).not.toContain("*");
    expect(region.querySelector("em")?.textContent).toBe("Old notes");
  });

  it("shows each tool step behind a caption on its own line, without markers", () => {
    render(
      <ProgressTrace
        active={false}
        hasOutput
        steps={[
          {
            id: "caption:a",
            title: "Drafting six slides",
            summary: "Created *Photosynthesis*\nEdited *Photosynthesis*",
            status: "done",
            createdAt: 1,
          },
        ]}
        answers={[{ toolCallId: "t1", kind: "approval", question: "Share *Revision plan* with Ana?", label: "Allowed" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Drafted six slides/ }));
    fireEvent.click(screen.getByRole("button", { name: /Show details/ }));
    expect(screen.getByText("Created Photosynthesis")).toBeTruthy();
    expect(screen.getByText("Edited Photosynthesis")).toBeTruthy();
    expect(document.body.textContent).not.toContain("*");
    expect(screen.getByLabelText("Your answers").querySelector("em")?.textContent).toBe("Revision plan");
  });
});

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

  it("shows tool steps and thinking in order, without markers", () => {
    render(
      <ProgressTrace
        active={false}
        hasOutput
        steps={[
          { id: "t1", kind: "thinking", title: "Thinking", summary: "**Finding the notes**\n\nThey are in *Biology*", status: "done", createdAt: 1 },
          { id: "s1", title: "Created *Photosynthesis*", status: "done", createdAt: 2 },
        ]}
        answers={[{ toolCallId: "t1", kind: "approval", question: "Share *Revision plan* with Ana?", label: "Allowed" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Finding the notes")).toBeTruthy();
    expect(screen.getAllByText("Created Photosynthesis").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Your answers").querySelector("em")?.textContent).toBe("Revision plan");
  });
});

describe("the progress trace before anything is known", () => {
  it("shows only that Spectra is thinking, with no placeholder step to open", () => {
    render(<ProgressTrace active steps={[]} />);
    const header = screen.getByRole("button", { name: "Thinking" });
    expect(header.classList.contains("cursor-default")).toBe(true);
    fireEvent.click(header);
    expect(document.body.textContent).not.toContain("Getting ready");
    expect(header.getAttribute("aria-expanded")).toBeNull();
  });
});

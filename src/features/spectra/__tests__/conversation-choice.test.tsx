// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import {
  BatchedChoiceBlock,
  ChoiceBlock,
} from "../components/conversation-choice";
import { ProductErrorState } from "../components/product-state";

function description(element: HTMLElement) {
  const id = element.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? "") : "";
}

afterEach(() => {
  cleanup();
  toastError.mockReset();
});

const options = [
  { key: "a", title: "Biology" },
  { key: "b", title: "Chemistry" },
];

describe("clarification choices", () => {
  it("tells the student a typed answer also works", () => {
    render(<ChoiceBlock question="Which subject?" options={options} onChoose={vi.fn()} />);
    const region = screen.getByRole("region", { name: "Choose one response" });
    expect(description(region)).toMatch(/type your own answer/i);
  });

  it("says when skipping fails and lets the student try again", async () => {
    const onSkip = vi.fn().mockRejectedValue(new Error("Spectra could not reach the server. Check your connection, then try again."));
    render(<ChoiceBlock question="Which subject?" options={options} onChoose={vi.fn()} onSkip={onSkip} />);
    const skip = screen.getByRole("button", { name: "Skip for now" });
    fireEvent.click(skip);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/could not reach the server/i)));
    expect((skip as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Biology" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains why Continue is disabled until every question is answered", () => {
    render(
      <BatchedChoiceBlock
        questions={[
          { id: "q1", question: "Which subject?", options },
          { id: "q2", question: "How long?", options: [{ key: "s", title: "Short" }, { key: "l", title: "Long" }] },
        ]}
        onSubmit={vi.fn()}
      />,
    );
    const submit = screen.getByRole("button", { name: "Continue with these answers" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(description(submit)).toMatch(/answer or skip the 2 remaining questions/i);
    fireEvent.click(screen.getByRole("button", { name: "Biology" }));
    expect(description(submit)).toMatch(/the last question/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Skip this question" })[1]!);
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("says when sending batched answers fails and re-enables Continue", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("offline"));
    render(<BatchedChoiceBlock questions={[{ id: "q1", question: "Which subject?", options }, { id: "q2", question: "Level?", options }]} onSubmit={onSubmit} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Biology" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Chemistry" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Continue with these answers" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("button", { name: "Continue with these answers" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("product error state", () => {
  it("is announced to assistive technology", () => {
    render(<ProductErrorState title="Library unavailable" detail="Try again in a moment." />);
    expect(screen.getByRole("alert").textContent).toContain("Library unavailable");
  });
});

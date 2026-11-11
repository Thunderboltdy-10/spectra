// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpectraRunTab } from "../../data/api";
import type { IslandTab } from "../island-model";
import { firstSentence, peekLine, ReplyPeek } from "../reply-peek";
import { shortTitle, workingLine } from "../island";

afterEach(cleanup);

function islandTab(reply: string, card?: Partial<NonNullable<SpectraRunTab["card"]>>): IslandTab {
  const source = {
    _id: "tab-1",
    runId: "run-1",
    threadId: "thread-1",
    surface: "chat",
    createdAt: 1,
    updatedAt: 1,
    run: { _id: "run-1", status: "completed", finalSummary: reply, userPrompt: "Where are the nodes?" },
    thread: { _id: "thread-1", title: "Standing wave nodes" },
    card: card ? { _id: "card-1", runId: "run-1", status: "completed", variant: "artifact", title: "Done", actions: [], createdAt: 1, updatedAt: 1, ...card } : null,
  } as unknown as SpectraRunTab;
  return { runId: "run-1", threadId: "thread-1", title: "Standing wave nodes", state: "completed", caption: "", status: "done", side: "play", automaticSide: "play", seen: false, updatedAt: 1, source };
}

describe("the reply peek (F3)", () => {
  it("shows a plain answer as the reply", () => {
    expect(peekLine(islandTab("The **nodes** sit at whole multiples of half a wavelength."))).toEqual({
      kind: "reply",
      text: "The nodes sit at whole multiples of half a wavelength.",
    });
  });

  it("says in one line what an edit changed, with Undo and Show landing on the change", () => {
    const line = peekLine(
      islandTab("Added a closing sentence to Physics progress. It ties the method back to the aim.", {
        actions: [{ key: "open", label: "Open", targetType: "artifact", targetId: "doc-1" }, { key: "revert", label: "Undo this run" }],
        provenance: { artifactIds: ["doc-1"], artifactTitles: ["Physics progress"], regions: [{ artifactId: "doc-1", regionId: "block:7" }] },
      }),
    );
    expect(line).toEqual({ kind: "changed", text: "Added a closing sentence to Physics progress.", artifactId: "doc-1", regionId: "block:7", canUndo: true });
    const onUndo = vi.fn();
    const onShow = vi.fn();
    render(<ReplyPeek line={line!} title="Physics" visible onOpen={vi.fn()} onRest={vi.fn()} onLeave={vi.fn()} onUndo={onUndo} onShow={onShow} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onShow).toHaveBeenCalledWith("doc-1", "block:7");
  });

  it("names a new work with Open", () => {
    const line = peekLine(
      islandTab("I made a revision sheet.", {
        actions: [{ key: "revert", label: "Undo this run" }],
        provenance: { artifactIds: ["doc-2"], artifactTitles: ["Photosynthesis sheet"], createdIds: ["doc-2"] },
      }),
    );
    expect(line).toEqual({ kind: "made", text: "Photosynthesis sheet", artifactId: "doc-2" });
  });

  it("never takes focus from where the person is typing", () => {
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    render(<ReplyPeek line={{ kind: "changed", text: "Added a sentence.", artifactId: "doc-1", canUndo: true }} title="x" visible onOpen={vi.fn()} onRest={vi.fn()} onLeave={vi.fn()} onUndo={vi.fn()} onShow={vi.fn()} />);
    const pressed = fireEvent.mouseDown(screen.getByRole("button", { name: "Show" }));
    expect(pressed).toBe(false);
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it("takes the first sentence", () => {
    expect(firstSentence("Done. More follows.")).toBe("Done.");
    expect(firstSentence("No full stop here")).toBe("No full stop here");
  });
});

describe("the field's line (F4)", () => {
  it("cuts a title on a word and never follows the ellipsis with a full stop", () => {
    const cut = shortTitle("Standing wave nodes and antinodes in a closed pipe experiment");
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\S…\.|…\./);
    expect("Standing wave nodes and antinodes in a closed pipe experiment".startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut.slice(0, -1).endsWith(" ")).toBe(false);
    expect(shortTitle("Short")).toBe("Short");
  });

  it("says the step it is on, with one ellipsis", () => {
    expect(workingLine("Reading **Physics progress**")).toBe("Reading Physics progress…");
    expect(workingLine("Reading Physics progress…")).toBe("Reading Physics progress…");
    expect(workingLine("")).toBe("Working…");
  });
});

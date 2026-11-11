// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { eventBelongsToFocusedStudio } from "../commands";
import { closeRequestReaches } from "../components/artifact-studio-value-utils";

/*
 * A work edited in place inside another (a deck inside a document, a sheet on
 * a whiteboard) is a whole studio inside the host's studio, and the same work
 * can be open in the Side at the same time. Window-level shortcuts and close
 * requests must reach only the studio they belong to.
 */

function studio(workId: string, parent: Element = document.body) {
  const section = document.createElement("section");
  section.setAttribute("data-spectra-studio", workId);
  const bar = document.createElement("div");
  const field = document.createElement("button");
  section.append(bar, field);
  parent.append(section);
  return { section, bar, field };
}

function press(target: Element) {
  (target as HTMLElement).focus();
  const event = new KeyboardEvent("keydown", { key: "b", ctrlKey: true });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shortcuts with an artifact edited inside another", () => {
  it("keeps the host's shortcuts out of the nested artifact, and the nested work's out of the host", () => {
    const host = studio("doc-1");
    const frame = document.createElement("div");
    frame.setAttribute("data-embed-editor", "");
    host.section.append(frame);
    const nested = studio("deck-1", frame);

    const inNested = press(nested.field);
    expect(eventBelongsToFocusedStudio(inNested, "deck-1", nested.bar)).toBe(true);
    expect(eventBelongsToFocusedStudio(inNested, "doc-1", host.bar)).toBe(false);

    const inHost = press(host.field);
    expect(eventBelongsToFocusedStudio(inHost, "doc-1", host.bar)).toBe(true);
    expect(eventBelongsToFocusedStudio(inHost, "deck-1", nested.bar)).toBe(false);
  });

  it("answers in only one copy when the same artifact is open in the Side and edited in place", () => {
    const side = studio("deck-1");
    const host = studio("doc-1");
    const inline = studio("deck-1", host.section);

    const inInline = press(inline.field);
    expect(eventBelongsToFocusedStudio(inInline, "deck-1", inline.bar)).toBe(true);
    expect(eventBelongsToFocusedStudio(inInline, "deck-1", side.bar)).toBe(false);

    const inSide = press(side.field);
    expect(eventBelongsToFocusedStudio(inSide, "deck-1", side.bar)).toBe(true);
    expect(eventBelongsToFocusedStudio(inSide, "deck-1", inline.bar)).toBe(false);
    // Without a scope, the check is by work and cannot tell the copies apart.
    expect(eventBelongsToFocusedStudio(inSide, "deck-1")).toBe(true);
  });

  it("still answers a lone studio when nothing is focused", () => {
    const only = studio("deck-1");
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true });
    expect(eventBelongsToFocusedStudio(event, "deck-1", only.bar)).toBe(true);
  });
});

describe("close requests", () => {
  it("reach the named copy only, and an unnamed request only the artifact's own studio", () => {
    const inline = { workId: "deck-1", instanceKey: "embed-1" };
    const side = { workId: "deck-1" };
    expect(closeRequestReaches({ workId: "deck-1", instance: "embed-1" }, inline)).toBe(true);
    expect(closeRequestReaches({ workId: "deck-1", instance: "embed-1" }, side)).toBe(false);
    expect(closeRequestReaches({ workId: "deck-1" }, side)).toBe(true);
    expect(closeRequestReaches({ workId: "deck-1" }, inline)).toBe(false);
    expect(closeRequestReaches({ workId: "deck-1", instance: "embed-2" }, inline)).toBe(false);
    expect(closeRequestReaches({ workId: "doc-1" }, side)).toBe(false);
  });
});

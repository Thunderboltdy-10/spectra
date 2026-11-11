// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpectraRichContent, type CitationSource } from "../components/spectra-rich-content";
import { spectraBus } from "../events";

const CONTENT = "Cells divide [[cite:book:e1|1]] and grow [[cite:web:e2|2]] slowly [[cite:other:e3|3]].";

describe("verified citations", () => {
  let container: HTMLDivElement;
  let root: Root;
  const env = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    env.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = (props: { sources?: CitationSource[]; verifiedSourceIds?: string[] }) =>
    act(() => root.render(<SpectraRichContent content={CONTENT} {...props} />));
  const citation = (label: string) =>
    [...container.querySelectorAll("button, span")].find((element) => element.textContent === `[${label}]`)!;

  it("opens an artifact source in the Side", () => {
    const opened: unknown[] = [];
    const stop = spectraBus.handle("work.open", (detail) => { opened.push(detail); });
    render({ sources: [{ id: "book", workId: "wx1", title: "Biology textbook" }] });
    const button = citation("1");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Open the source Biology textbook in the Side");
    act(() => (button as HTMLButtonElement).click());
    stop();
    // The citation's WHERE is the place in the source it opens at.
    expect(opened).toEqual([{ workId: "wx1", surface: "panel", region: { id: "e1" } }]);
  });

  it("opens the whole source when the citation names no place in it", () => {
    const opened: unknown[] = [];
    const stop = spectraBus.handle("work.open", (detail) => { opened.push(detail); });
    act(() =>
      root.render(
        <SpectraRichContent content="Cells divide [[cite:book:source|1]]." sources={[{ id: "book", workId: "wx1", title: "Biology textbook" }]} />,
      ),
    );
    act(() => (citation("1") as HTMLButtonElement).click());
    stop();
    expect(opened).toEqual([{ workId: "wx1", surface: "panel" }]);
  });

  it("opens a web source in a new tab, without giving it the page", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render({ sources: [{ id: "web", url: "https://example.org/cells" }] });
    act(() => (citation("2") as HTMLButtonElement).click());
    expect(open).toHaveBeenCalledWith("https://example.org/cells", "_blank", "noopener,noreferrer");
  });

  it("never makes a button that does nothing", () => {
    render({ verifiedSourceIds: ["book"], sources: [{ id: "web", url: "javascript:alert(1)" }] });
    expect(citation("1").tagName).toBe("SPAN");
    expect(citation("1").getAttribute("title")).toBe("Verified source");
    expect(citation("2").tagName).toBe("SPAN");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    // An unverified citation says so.
    expect(container.textContent).toContain("[3]");
    expect(container.querySelector('[title="Source verification unavailable"]')).not.toBeNull();
  });
});

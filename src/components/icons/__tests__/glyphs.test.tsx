// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GLYPHS, ICON_FAMILIES, Icon, type IconName } from "..";
import * as glyphIcons from "../glyph-icons";

describe("Spectra's glyph set", () => {
  it("shows every glyph in exactly one family of the icon lab", () => {
    const listed = ICON_FAMILIES.flatMap((family) => family.names);
    const unique = new Set(listed);
    // "conversations" is both a type and a destination; nothing else repeats.
    expect(listed.length - unique.size).toBe(1);
    expect([...unique].sort()).toEqual(Object.keys(GLYPHS).sort());
  });

  it("draws every glyph on the 20 px grid with its accent", () => {
    for (const name of Object.keys(GLYPHS) as IconName[]) {
      const { container, unmount } = render(<Icon name={name} size={20} accent="red" />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("viewBox")).toBe("0 0 20 20");
      expect(svg.getAttribute("data-icon")).toBe(name);
      expect(svg.childNodes.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("gives every icon-component name a glyph, and no sparkles", () => {
    const names = Object.keys(glyphIcons);
    expect(names).not.toContain("Sparkles");
    expect(names).not.toContain("WandSparkles");
    for (const name of names) {
      const Component = (glyphIcons as Record<string, unknown>)[name] as React.ComponentType<{ size?: number }>;
      const { container, unmount } = render(<Component size={16} />);
      expect(container.querySelector("svg.spectra-icon"), name).not.toBeNull();
      unmount();
    }
  });
});

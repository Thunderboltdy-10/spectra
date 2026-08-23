import { describe, expect, it } from "vitest";
import {
  fidelityRegionMap,
  regionsForLensFeature,
} from "../commands/office/fidelity-regions";
import { commandContext, commandForBinding, regionBlockedBy } from "../commands";
import type { CommandBinding } from "../commands";

/**
 * The seam between a lens and a command.
 *
 * Every other test in this suite builds its own fidelity map by hand, in region
 * keys, and so every other test passes whether or not this translation exists.
 * On a real linked file the lens supplies the map, in the lens's own words, and
 * without the translation `regionBlockedBy` looks up a key nothing ever wrote:
 * the preservation gate returns "editable" for everything and every control in
 * the bar claims it can write a file Spectra will not touch. That failure is
 * silent, it only appears on real documents, and it is what these tests are for.
 */
describe("lens fidelity → command regions", () => {
  it("translates a lens's own words into the region a command declares", () => {
    // XLSX reports parts, not regions: this lens never says "pivotTables".
    expect(regionsForLensFeature("pivot")).toEqual(["pivotTables"]);
    expect(regionsForLensFeature("conditional-formatting")).toEqual(["conditionalFormat"]);
    expect(regionsForLensFeature("macro")).toEqual(["macros"]);
    // DOCX splits one region across two parts.
    expect(regionsForLensFeature("headers")).toEqual(["headersFooters"]);
    expect(regionsForLensFeature("footers")).toEqual(["headersFooters"]);
    // Word endnotes live beside footnotes and are gated with them.
    expect(regionsForLensFeature("endnotes")).toEqual(["footnotes"]);
    // A lens that already speaks the region vocabulary passes straight through,
    // which is why DOCX and PPTX region rows need no entry in the table.
    expect(regionsForLensFeature("trackedChanges")).toEqual(["trackedChanges"]);
    expect(regionsForLensFeature("speakerNotes")).toEqual(["speakerNotes"]);
  });

  it("ignores per-block facts instead of turning one of them into a region-wide refusal", () => {
    // These are the most common entries a lens emits — one per paragraph, per
    // cell, per slide. Folding them in would refuse all typing in a document
    // that contains a single tracked-change paragraph.
    for (const feature of [
      "paragraph",
      "revision-or-field-paragraph",
      "nested-table",
      "cell",
      "recognized-formula",
      "unrecognized-formula",
      "slide",
    ]) {
      expect(regionsForLensFeature(feature)).toEqual([]);
    }

    const map = fidelityRegionMap([
      { feature: "body", class: "NATIVE" },
      { feature: "revision-or-field-paragraph", class: "PRESERVED" },
      { feature: "paragraph", class: "PRESERVED" },
    ]);
    expect(map.body).toBe("NATIVE");
    expect(map.trackedChanges).toBeUndefined();
  });

  it("keeps a region as editable as its least editable contributor", () => {
    // PPTX classes the same media parts twice, from two angles. The result must
    // not depend on which one the lens happened to emit last.
    const forward = fidelityRegionMap([
      { feature: "media", class: "NATIVE" },
      { feature: "media", class: "PRESERVED" },
    ]);
    const reversed = fidelityRegionMap([
      { feature: "media", class: "PRESERVED" },
      { feature: "media", class: "NATIVE" },
    ]);
    expect(forward.media).toBe("PRESERVED");
    expect(reversed.media).toBe("PRESERVED");

    // headersFooters is written by two parts; one preserved part preserves it.
    expect(fidelityRegionMap([
      { feature: "headers", class: "NATIVE" },
      { feature: "footers", class: "PRESERVED" },
    ]).headersFooters).toBe("PRESERVED");
  });

  it("leaves a region absent rather than inventing a refusal for it", () => {
    const map = fidelityRegionMap([{ feature: "cell", class: "NATIVE" }]);
    // No lens said anything about validation, so Spectra does not claim it
    // cannot write it. Guessing here would block work on files it handles.
    expect(map.validation).toBeUndefined();
    expect(map.artifact).toBe("NATIVE");
    expect(regionBlockedBy(map, ["validation"])).toBeUndefined();

    // Garbage from an older or newer lens is skipped, not coerced.
    expect(fidelityRegionMap([
      { feature: "macro", class: "SOMETHING_NEW" },
      { feature: 7, class: "PRESERVED" },
      {},
    ])).toEqual({ artifact: "NATIVE" });
  });

  it("actually disables a command on the map a real linked workbook produces", () => {
    // The XLSX lens's real output for a workbook with a pivot cache and a macro.
    const workbook = fidelityRegionMap([
      { feature: "cell", class: "NATIVE" },
      { feature: "pivot", class: "PRESERVED" },
      { feature: "macro", class: "PRESERVED" },
      { feature: "comment", class: "PRESERVED" },
    ]);

    const refresh: CommandBinding = {
      id: "data.pivot.refresh",
      label: "Refresh pivot",
      touches: ["pivotTables"],
      onSelect: () => {},
    };
    const typing: CommandBinding = {
      id: "data.setCell",
      label: "Set cell",
      touches: ["cells"],
      onSelect: () => {},
    };
    const linked = { compatibilityProfile: "strict-native" as const, fidelity: workbook };

    const pivot = commandForBinding("sheets", refresh, 0).availability(
      commandContext("sheets", () => true, "edit", undefined, linked),
    );
    expect(pivot.state).toBe("disabled");
    expect(pivot.state === "disabled" && pivot.reason).toContain("pivot tables");

    // And the same map leaves ordinary cell editing alone, which is the half of
    // this that a too-eager gate would break.
    expect(commandForBinding("sheets", typing, 1).availability(
      commandContext("sheets", () => true, "edit", undefined, linked),
    )).toEqual({ state: "enabled" });
  });
});

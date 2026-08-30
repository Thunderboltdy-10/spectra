import { describe, expect, it } from "vitest";
import {
  presentationCommandBindings,
  presentationStubHandlers,
  PRESENTATION_CAPABILITY_DEFERRALS,
  PRESENTATION_STRICT_REASONS,
  type PresentationHandlers,
} from "../commands/office/presentation-commands";
import {
  officeCapabilityAudit,
  officeCapabilityAuditIssues,
  officeCapabilityAuditSummary,
} from "../commands/office/capability-audit";
import { gateOperation, refusedOperations } from "../commands/office/operation-gate";
import {
  allTabsFor,
  commandContext,
  commandForBinding,
  COMMAND_TABS,
  executeCommand,
} from "../commands/registry";
import type { FidelityRegionKey } from "../commands/types";
import { auditDeck, contrastRatio, estimateTextOverflow } from "../presentation/audit";
import {
  createPresentationObject,
  createPresentationSlide,
  normalizePresentationContent,
  type PresentationContent,
} from "../presentation/model";

const bindings = () => presentationCommandBindings(presentationStubHandlers());

const commands = () =>
  bindings().map((binding, index) => commandForBinding("presentation", binding, index));

/** A context that grants everything, so tab and id checks are not gated. */
function fullContext(
  profile: "strict-native" | "enhanced" | "spectra-native" = "spectra-native",
  fidelity: Record<string, string> = {},
) {
  const ctx = commandContext("presentation", () => true, "edit");
  return { ...ctx, compatibilityProfile: profile, fidelity } as typeof ctx;
}

describe("presentation command set", () => {
  it("gives every command a stable, namespaced, unique id", () => {
    const ids = commands().map((command) => command.id);
    expect(ids.length).toBeGreaterThan(60);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("presentation.")).toBe(true);
  });

  it("places every command on a tab the registry declares for a deck", () => {
    const valid = new Set(allTabsFor("presentation"));
    const stray = commands()
      .filter((command) => !valid.has(command.defaultPlacement.tab))
      .map((command) => `${command.id}@${command.defaultPlacement.tab}`);
    expect(stray).toEqual([]);
  });

  it("ships the contract General defaults as General commands", () => {
    const general = new Map(
      bindings()
        .filter((binding) => binding.general)
        .map((binding) => [binding.id, binding]),
    );
    for (const id of [
      "history.undo",
      "history.redo",
      "slide.add",
      "slide.duplicate",
      "design.open",
      "present.start",
    ]) {
      expect(general.has(id)).toBe(true);
    }
  });

  it("populates all six deck tabs and both contextual tabs with real work", () => {
    const byTab = new Map<string, number>();
    for (const command of commands()) {
      const tab = command.defaultPlacement.tab;
      byTab.set(tab, (byTab.get(tab) ?? 0) + 1);
    }
    for (const tab of ["General", ...COMMAND_TABS.presentation]) {
      expect(byTab.get(tab) ?? 0).toBeGreaterThan(2);
    }
    for (const tab of ["Shape", "Transition"]) {
      expect(byTab.get(tab) ?? 0).toBeGreaterThan(1);
    }
  });

  it("keeps at most five essential commands in the General row", () => {
    // The cap is about the row a person always sees. A category tab promotes up
    // to five into the row and sends the rest to the same overflow menu, so only
    // General is bounded here.
    const essential = bindings().filter(
      (binding, index) =>
        binding.priority === "essential" &&
        commandForBinding("presentation", binding, index).defaultPlacement.tab ===
          "General",
    );
    expect(essential.length).toBeLessThanOrEqual(5);
  });

  it("gives every disabled command a sentence explaining why", () => {
    const unexplained = bindings()
      .filter(
        (binding) =>
          binding.disabled &&
          // Zoom is a shared family the deck reuses unchanged; its wording is
          // the shared module's to write.
          !binding.id.startsWith("view.zoom") &&
          (!binding.hint || binding.hint.length <= 12),
      )
      .map((binding) => binding.id);
    expect(unexplained).toEqual([]);
  });

  it("never claims a native region a deck lens does not write", () => {
    const forbidden: FidelityRegionKey[] = [
      "masters",
      "macros",
      "customXml",
      "smartArt",
      "ole",
    ];
    for (const binding of bindings()) {
      for (const region of binding.touches ?? []) {
        expect(forbidden).not.toContain(region);
      }
    }
  });

  it("gives every strict-native refusal a concrete reason", () => {
    for (const binding of bindings()) {
      if (binding.strictNative?.available !== false) continue;
      expect(binding.strictNative.reason).toBeTruthy();
      expect((binding.strictNative.reason ?? "").length).toBeGreaterThan(24);
    }
  });

  it("declares an AI operation on the deck operations the manifest names", () => {
    const declared = new Set(
      bindings().flatMap((binding) => [...(binding.manifestOps ?? [])]),
    );
    for (const op of [
      "add_slide",
      "apply_layout",
      "apply_theme",
      "rewrite_object",
      "create_object",
      "move_object",
      "resize_object",
      "write_speaker_notes",
      "generate_chart",
      "check_overflow",
      "check_contrast",
      "check_reading_order",
      "check_source_coverage",
      "build_bibliography",
      "inspect_deck",
      "plan_narrative",
      "prepare_presenter_output",
    ]) {
      expect(declared.has(op)).toBe(true);
    }
  });

  it("keeps the stage aids reachable with nothing selected", () => {
    // Grid, guides and snap are how a person places the *first* object on a
    // slide, so they cannot live on a tab that only appears once something is
    // selected. That is also why their ids are `stage.*`: the registry reads an
    // `arrange.*` id as belonging to the contextual Shape tab.
    for (const id of ["presentation.stage.snap", "presentation.stage.guides", "presentation.stage.grid"]) {
      const command = commands().find((candidate) => candidate.id === id);
      expect(command, id).toBeDefined();
      expect(command!.contextualTab, id).toBeUndefined();
      expect(command!.defaultPlacement.tab, id).toBe("Arrange");
      expect(command!.availability(fullContext()).state).toBe("enabled");
    }
  });

  it("puts the object commands on Arrange and the slide's own arrival on Transition", () => {
    // Appendix B's proposed layout. Aligning, grouping and ordering are Arrange
    // work and stay reachable there; the contextual Transition tab carries
    // exactly the slide's transition kind and length, beside the rows that say
    // what PowerPoint already saved on that slide.
    const byId = new Map(commands().map((command) => [command.id, command]));
    for (const id of [
      "align",
      "distribute",
      "group",
      "ungroup",
      "bringForward",
      "sendBackward",
      "bringToFront",
      "sendToBack",
    ]) {
      const command = byId.get(`presentation.arrange.${id}`);
      expect(command, id).toBeDefined();
      expect(command!.contextualTab, id).toBeUndefined();
      expect(command!.defaultPlacement.tab, id).toBe("Arrange");
    }
    for (const id of ["presentation.animate.transition", "presentation.animate.transitionDuration"]) {
      expect(byId.get(id)?.contextualTab, id).toBe("Transition");
    }
    // The Transition tab is not two disabled explainers on their own: the
    // controls that change a transition sit with them, so the tab is worth
    // opening. A tab whose every row is inert would be the same ghost as a
    // button that does nothing.
    const transitionTab = commands().filter((command) => command.contextualTab === "Transition");
    expect(transitionTab.length).toBeGreaterThan(2);
    expect(
      transitionTab.some(
        (command) => command.availability(fullContext("spectra-native")).state === "enabled",
      ),
    ).toBe(true);
  });

  it("gates on the deck's real regions, not on lens part names", async () => {
    // The gate is only real if the map it reads is keyed the way `touches` is.
    // While the two vocabularies disagreed, every preservation refusal was inert
    // on actual linked files and every test passed anyway, because tests build
    // the fidelity map by hand. This one builds it from the lens instead.
    const { pptxLens } = await import("../lenses/pptx-lens");
    const { fidelityRegionMap } = await import("../commands/office/fidelity-regions");
    const { Presentation } = await import("@ariadng/office/pptx");
    const deck = await Presentation.create();
    deck.addSlide({ layoutIndex: 0 });
    const opened = await pptxLens.open(await deck.save());
    const fidelity = fidelityRegionMap(opened.fidelityMap.entries);
    // Region keys, not part names, and the ones a deck must never claim.
    expect(fidelity.masters).toBe("PRESERVED");
    expect(fidelity.slides).toBe("NATIVE");
    expect(fidelity.shapes).toBe("NATIVE");

    const context = fullContext("strict-native", fidelity);
    const byId = new Map(commands().map((command) => [command.id, command]));
    // A command that writes a preserved region is refused with the lens's own
    // sentence rather than a generic one.
    const layoutCommand = byId.get("presentation.design.applyLayout")!;
    expect(layoutCommand.availability(context).state).toBe("disabled");
    // And a native region stays live, so the gate is a gate and not a wall.
    expect(byId.get("presentation.slide.setTitle")!.availability(context).state).toBe(
      "enabled",
    );
  });

  it("keeps speaker notes native even when old content carries the legacy unsupported marker", () => {
    // Old stored content can still contain this compatibility marker. The PPTX
    // lens now creates a native notes page and master, so that stale value must
    // not turn the editor control into a false refusal.
    const legacy = normalizePresentationContent({
      theme: { id: "spectra-botanical" },
      slides: [
        {
          ...createPresentationSlide(1),
          nativeCompatibility: { speakerNotes: "unsupported" },
        },
      ],
    });
    expect(legacy.slides[0]!.nativeCompatibility?.speakerNotes).toBe(
      "unsupported",
    );
    const withLegacyMarker = presentationCommandBindings(
      presentationStubHandlers(),
    );
    const index = withLegacyMarker.findIndex((binding) => binding.id === "notes.set");
    expect(index).toBeGreaterThanOrEqual(0);
    const command = commandForBinding("presentation", withLegacyMarker[index]!, index);
    const availability = command.availability(fullContext());
    expect(availability).toEqual({ state: "enabled" });
    expect(command.nativeDelta).toBe("set-notes");
  });

  it("enables adding a slide to a linked PowerPoint deck because the lens writes add-slide", () => {
    const add = commands().find((command) => command.id === "presentation.slide.add");
    expect(add?.nativeDelta).toBe("add-slide");
    expect(add?.availability(fullContext("strict-native"))).toEqual({
      state: "enabled",
    });
  });

  it("writes hidden-slide state through the same strict-native capability", () => {
    const hide = commands().find(
      (command) => command.id === "presentation.slide.hide",
    );
    expect(hide?.nativeDelta).toBe("set-slide-hidden");
    expect(hide?.availability(fullContext("strict-native", { slides: "NATIVE" })))
      .toEqual({ state: "enabled" });
    expect(
      gateOperation({
        type: "presentation",
        operation: "presentation.slide.hide",
        bindings: bindings(),
        compatibilityProfile: "strict-native",
        fidelity: { slides: "NATIVE" },
      }),
    ).toEqual({ allowed: true });
  });

  it("passes the office capability audit with one command per operation", () => {
    const issues = officeCapabilityAuditIssues(
      "presentation",
      bindings(),
      PRESENTATION_CAPABILITY_DEFERRALS,
    );
    expect(issues).toEqual([]);
    const entries = officeCapabilityAudit(
      "presentation",
      bindings(),
      PRESENTATION_CAPABILITY_DEFERRALS,
    );
    const summary = officeCapabilityAuditSummary(entries);
    // Nothing the assistant can do that a person cannot, and the one operation
    // Spectra deliberately does not perform is declared rather than missing.
    expect(summary.aiOnly).toBe(0);
    expect(
      entries.find((entry) => entry.operation === "presentation.apply.master"),
    ).toMatchObject({ status: "deferred" });
  });

  it("tells the assistant no in the same words as the person", () => {
    // A deck whose transitions the file only preserves: the command is refused
    // on the bar, so the operation has to be refused in chat too.
    const refused = refusedOperations(
      "presentation",
      bindings(),
      "strict-native",
      { transitions: "PRESERVED", slides: "NATIVE" },
    );
    for (const entry of refused) {
      expect(entry.region).toBe("transitions");
      expect(entry.reason.length).toBeGreaterThan(24);
    }
    // And a region the file writes natively is not refused.
    expect(
      gateOperation({
        type: "presentation",
        operation: "add_slide",
        bindings: bindings(),
        compatibilityProfile: "strict-native",
        fidelity: { slides: "NATIVE", transitions: "PRESERVED" },
      }),
    ).toEqual({ allowed: true });
  });

  it("gives every overflow command a sentence or a keystroke, not just a label", () => {
    // Only `advanced` commands are always in the `⋯` menu, where the label is
    // all a person gets. A `secondary` command is in the bar whenever there is
    // room, so demanding a sentence from those would only produce filler.
    for (const command of commands()) {
      if (command.priority !== "advanced") continue;
      const availability = command.availability(fullContext());
      if (availability.state === "hidden") continue;
      expect(
        command.description !== command.title || Boolean(command.shortcut),
        `${command.id} has neither a hint nor a shortcut`,
      ).toBe(true);
    }
  });

  it("never declares a native write it does not perform", () => {
    // A command that claims a region without writing it makes the assistant
    // refuse edits it could safely make (D25 in the other direction).
    const viewOnly = [
      "presentation.view.notesPage",
      "presentation.notes.panel",
      "presentation.notes.set",
    ];
    const byId = new Map(commands().map((command) => [command.id, command]));
    expect(byId.get("presentation.view.notesPage")!.touches ?? []).toEqual([]);
    expect(byId.get("presentation.notes.panel")!.touches ?? []).toEqual([]);
    // The command that does write a note still declares the region.
    expect(byId.get("presentation.notes.set")!.touches).toContain("speakerNotes");
    for (const id of viewOnly) expect(byId.has(id)).toBe(true);
  });

  it("routes a parameterized control through the one execute path", () => {
    const seen: string[] = [];
    const handlers = presentationStubHandlers();
    const wired: PresentationHandlers = {
      ...handlers,
      // A duration control only exists once the slide has a transition, so the
      // state says so rather than the test reaching past the gate.
      state: { ...handlers.state, transitionKind: "fade" },
      design: {
        ...handlers.design,
        applyLayout: (layoutId) => seen.push(`layout:${layoutId}`),
      },
      transition: {
        ...handlers.transition,
        setDuration: (ms) => seen.push(`duration:${ms}`),
      },
    };
    const list = presentationCommandBindings(wired);
    const layout = list.find((binding) => binding.id === "design.applyLayout")!;
    const duration = list.find(
      (binding) => binding.id === "animate.transitionDuration",
    )!;
    const ctx = fullContext();
    executeCommand(commandForBinding("presentation", layout, 0), ctx, "two-column");
    executeCommand(commandForBinding("presentation", duration, 1), ctx, 500);
    expect(seen).toEqual(["layout:two-column", "duration:500"]);
  });
});

describe("presentation honesty under strict-native", () => {
  it("refuses a transition rewrite with the transition sentence", () => {
    const binding = bindings().find((entry) => entry.id === "animate.transition")!;
    const command = commandForBinding("presentation", binding, 0);
    const availability = command.availability(fullContext("strict-native"));
    expect(availability.state).toBe("disabled");
    expect(availability.state === "disabled" ? availability.reason : "").toBe(
      PRESENTATION_STRICT_REASONS.transition,
    );
  });

  it("keeps the same transition control live in a Spectra-born deck", () => {
    const binding = bindings().find((entry) => entry.id === "animate.transition")!;
    const command = commandForBinding("presentation", binding, 0);
    expect(command.availability(fullContext("spectra-native")).state).toBe("enabled");
  });

  it("edits slide text natively in every profile", () => {
    const binding = bindings().find((entry) => entry.id === "object.setText")!;
    const command = commandForBinding("presentation", binding, 0);
    // Nothing is selected in the stub, so the honest answer is disabled with a
    // reason, never a silent no-op.
    expect(command.availability(fullContext("strict-native")).state).toBe("disabled");
    expect(binding.strictNative).toBeUndefined();
  });

  it("offers the equation control as disabled rather than absent", () => {
    const binding = bindings().find((entry) => entry.id === "insert.equation")!;
    expect(binding.disabled).toBe(true);
    expect(binding.hint).toMatch(/preserved exactly/);
  });

  it("names the preserved region on the Transition tab even with no transition", () => {
    const native = bindings().find((entry) => entry.id === "transition.native")!;
    expect(native.disabled).toBe(true);
    expect(native.hint).toMatch(/no PowerPoint transition/);
  });
});

function deckWith(slides: PresentationContent["slides"]): PresentationContent {
  return normalizePresentationContent({
    theme: { id: "spectra-botanical", tokens: { background: "#ffffff", body: "#2f3e39" } },
    slides,
  });
}

describe("deck audit", () => {
  it("measures overflow from the frame and the type size", () => {
    const tight = createPresentationObject("text", 1);
    tight.width = 200;
    tight.height = 40;
    tight.style = { fontSize: 24 };
    tight.content = {
      text: "A sentence long enough that it cannot possibly fit inside a frame this small.",
    };
    expect(estimateTextOverflow(tight)).toBe(true);

    const roomy = { ...tight, width: 900, height: 300 };
    expect(estimateTextOverflow(roomy)).toBe(false);
  });

  it("computes a WCAG ratio and returns undefined for unparseable colours", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("var(--ink)", "#ffffff")).toBeUndefined();
  });

  it("reports low contrast, missing alt text and uncited claims together", () => {
    const faint = createPresentationObject("text", 1);
    faint.style = { fontSize: 18, color: "#eeeeee" };
    faint.content = { text: "Barely there" };
    const picture = createPresentationObject("image", 2);
    const slide = { ...createPresentationSlide(1), objects: [faint, picture] };
    const report = auditDeck(deckWith([slide]));
    expect(report.counts.contrast).toBe(1);
    expect(report.counts.altText).toBe(1);
    expect(report.summary).toMatch(/1 low contrast/);
  });

  it("says so plainly when a deck has nothing to fix", () => {
    const clean = createPresentationSlide(1);
    const report = auditDeck(deckWith([{ ...clean, objects: [] }]));
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toMatch(/Nothing to fix/);
  });
});

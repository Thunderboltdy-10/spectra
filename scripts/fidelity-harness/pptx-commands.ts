import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement, serializeNode } from "@ariadng/office/xml";
import { Presentation } from "@ariadng/office/pptx";
import { pptxLens, type PptxProjection } from "../../src/features/spectra/lenses/pptx-lens";

/**
 * Command-level evidence for the deck.
 *
 * The inventory's rule is that a promotion with no fixture is not a promotion.
 * Each `.fixture.json` beside a `.pptx` names the commands that write into that
 * file and, for each, the parts it may dirty and the regions that must survive
 * untouched. This module runs every one of those rows for real: it drives the
 * command's own materialization path through the lens, then compares packages
 * part by part and re-reads the saved file to confirm the write landed.
 *
 * A row fails loudly for either reason — a part dirtied that the row does not
 * claim, or a preserved region that moved — because both are the same defect
 * from a person's side: the file came back different from the file they had.
 */

export type FixtureMutationRow = {
  commandId: string;
  touch: string[];
  preserve: string[];
};

export type FixtureSidecar = {
  source?: string;
  contains?: string[];
  expected?: Record<string, string>;
  mutations?: FixtureMutationRow[];
};

export type CommandAssertion = {
  fixture: string;
  commandId: string;
  /** The parts the write actually dirtied, relative to the package root. */
  changedParts: string[];
  /** Every claimed part matched something that changed. */
  touchedAsDeclared: boolean;
  /** No part outside the claim changed. */
  noCollateralChange: boolean;
  /** Every claimed preserved region is byte-identical or still present. */
  preserved: boolean;
  /** The write is visible when the file is reopened. */
  readBack: boolean;
  notes?: string;
};

function descendants(root: XmlElement) {
  const found: XmlElement[] = [];
  const pending = [...root.elements()].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    found.push(node);
    const nested = node.elements();
    for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!);
  }
  return found;
}

/** The serialized XML of every `p:transition` / `p:timing` in a deck, in order. */
async function subtrees(payload: Uint8Array, localName: string) {
  const deck = await Presentation.open(payload);
  const found: string[] = [];
  for (const slide of deck.slides()) {
    for (const node of descendants(slide.root())) {
      if (node.localName === localName) found.push(serializeNode(node));
    }
  }
  return found;
}

/**
 * A projection edit per command id. Each one is the same change the studio makes
 * when a person uses that control, so the evidence is about the command and not
 * about a bespoke test path.
 */
const EDITS: Record<string, (projection: PptxProjection) => PptxProjection | undefined> = {
  "presentation.slide.setTitle": (projection) => {
    const slide = projection.slides[0];
    if (!slide) return undefined;
    return {
      ...projection,
      slides: projection.slides.map((candidate, index) =>
        index === 0 ? { ...candidate, title: `${candidate.title} (checked)` } : candidate,
      ),
    };
  },
  "presentation.object.setText": (projection) => {
    const index = projection.slides.findIndex((slide) =>
      slide.objects.some((object) => object.type === "text" && !object.locked),
    );
    if (index < 0) return undefined;
    return {
      ...projection,
      slides: projection.slides.map((slide, slideIndex) =>
        slideIndex !== index
          ? slide
          : {
              ...slide,
              objects: slide.objects.map((object) =>
                object.type === "text" && !object.locked
                  ? { ...object, content: { ...(object.content as object), text: "Spectra checked this run" } }
                  : object,
              ),
            },
      ),
    };
  },
  "presentation.insert.textBox": (projection) => {
    const slide = projection.slides[0];
    if (!slide) return undefined;
    return {
      ...projection,
      slides: projection.slides.map((candidate, index) =>
        index !== 0
          ? candidate
          : {
              ...candidate,
              objects: [
                ...candidate.objects,
                {
                  id: `${candidate.id}:shape:new`,
                  type: "text" as const,
                  x: 80,
                  y: 420,
                  width: 600,
                  height: 60,
                  rotation: 0,
                  content: { text: "Added by the insert command" },
                },
              ],
            },
      ),
    };
  },
  "presentation.notes.set": (projection) => {
    const index = projection.slides.findIndex((slide) => slide.notesPartName);
    if (index < 0) return undefined;
    return {
      ...projection,
      slides: projection.slides.map((slide, slideIndex) =>
        slideIndex === index
          ? { ...slide, speakerNotes: "Open on the number, then the story behind it." }
          : slide,
      ),
    };
  },
  "presentation.accessibility.altText": (projection) => {
    const index = projection.slides.findIndex((slide) => slide.objects.length > 0);
    if (index < 0) return undefined;
    return {
      ...projection,
      slides: projection.slides.map((slide, slideIndex) =>
        slideIndex !== index
          ? slide
          : {
              ...slide,
              objects: slide.objects.map((object, objectIndex) =>
                objectIndex === 0
                  ? { ...object, altText: "A described object, for anyone reading by ear." }
                  : object,
              ),
            },
      ),
    };
  },
  "presentation.arrange.geometry.x": (projection) => moveFirstShape(projection, { x: 40 }),
  "presentation.arrange.geometry.y": (projection) => moveFirstShape(projection, { y: 40 }),
  "presentation.arrange.geometry.width": (projection) => moveFirstShape(projection, { width: 60 }),
  "presentation.slide.add": (projection) => ({
    ...projection,
    slides: [
      ...projection.slides,
      {
        id: "spectra:harness:added",
        index: projection.slides.length,
        title: "Added by the add-slide command",
        text: [],
        objects: [
          {
            id: "spectra:harness:added:shape:1",
            type: "text" as const,
            x: 80,
            y: 300,
            width: 600,
            height: 80,
            rotation: 0,
            content: { text: "One sentence a room can repeat." },
          },
        ],
        hasTransition: false,
        hasTiming: false,
        speakerNotes: "",
      },
    ],
  }),
  "presentation.slide.delete": (projection) =>
    projection.slides.length < 2
      ? undefined
      : { ...projection, slides: projection.slides.slice(0, -1) },
  "presentation.slide.moveLater": (projection) => {
    if (projection.slides.length < 2) return undefined;
    const [first, second, ...rest] = projection.slides;
    return { ...projection, slides: [second!, first!, ...rest] };
  },
};

function moveFirstShape(
  projection: PptxProjection,
  delta: { x?: number; y?: number; width?: number },
) {
  const index = projection.slides.findIndex((slide) =>
    slide.objects.some((object) => !object.locked),
  );
  if (index < 0) return undefined;
  return {
    ...projection,
    slides: projection.slides.map((slide, slideIndex) =>
      slideIndex !== index
        ? slide
        : {
            ...slide,
            objects: slide.objects.map((object, objectIndex) => {
              if (object.locked) return object;
              const first = slide.objects.findIndex((candidate) => !candidate.locked);
              if (objectIndex !== first) return object;
              return {
                ...object,
                ...(delta.x !== undefined ? { x: object.x + delta.x } : {}),
                ...(delta.y !== undefined ? { y: object.y + delta.y } : {}),
                ...(delta.width !== undefined ? { width: object.width + delta.width } : {}),
              };
            }),
          },
    ),
  };
}

/** True when a claimed preserved region survived the edit unchanged. */
async function preservedHolds(
  before: Uint8Array,
  after: Uint8Array,
  region: string,
  changedParts: Set<string>,
) {
  if (region === "p:transition" || region === "p:timing") {
    const local = region.slice(2);
    const [was, now] = await Promise.all([subtrees(before, local), subtrees(after, local)]);
    // Compared as a multiset, not a sequence. Which slide comes first is a
    // deck-level fact that reordering is allowed to change; what must not change
    // is any transition or timing tree itself. The byte-level `ppt/slides` claim
    // is what proves the slide parts themselves did not move.
    return was.length > 0 && JSON.stringify([...was].sort()) === JSON.stringify([...now].sort());
  }
  // A part-prefix claim: nothing under it may be reserialized.
  for (const part of changedParts) if (part.startsWith(region)) return false;
  return true;
}

export async function runPptxCommandFixtures(fixtureDir: string) {
  const assertions: CommandAssertion[] = [];
  const files = (await readdir(fixtureDir)).filter((name) => name.endsWith(".fixture.json"));
  for (const file of files.sort()) {
    const stem = file.replace(/\.fixture\.json$/, "");
    const sidecar = JSON.parse(await readFile(join(fixtureDir, file), "utf8")) as FixtureSidecar;
    if (!sidecar.mutations?.length) continue;
    const source = new Uint8Array(await readFile(join(fixtureDir, `${stem}.pptx`)));
    for (const row of sidecar.mutations) {
      const edit = EDITS[row.commandId];
      if (!edit) {
        assertions.push({
          fixture: stem,
          commandId: row.commandId,
          changedParts: [],
          touchedAsDeclared: false,
          noCollateralChange: false,
          preserved: false,
          readBack: false,
          notes: "no evidence path is registered for this command id",
        });
        continue;
      }
      const opened = await pptxLens.open(source);
      const next = edit(opened.projection);
      if (!next) {
        assertions.push({
          fixture: stem,
          commandId: row.commandId,
          changedParts: [],
          touchedAsDeclared: false,
          noCollateralChange: false,
          preserved: false,
          readBack: false,
          notes: "this fixture has nothing for the command to act on",
        });
        continue;
      }
      const saved = await pptxLens.materialize({ projection: next, carry: opened.preservedCarry });
      const comparison = await comparePackages(source, saved);
      const changed = comparison.parts
        .filter((part) => part.verdict !== "identical")
        .map((part) => part.name.replace(/^\//, ""));
      const changedSet = new Set(changed);
      // Every claim must match something, and nothing outside a claim may move.
      // `.rels` and `[Content_Types]` are infrastructure the OPC layer rewrites
      // when a part is added, so an insert is allowed to move them.
      const infrastructure = (part: string) =>
        part.includes("_rels/") || part.startsWith("[Content_Types]");
      const touchedAsDeclared = row.touch.every((claim) =>
        changed.some((part) => part.startsWith(claim)),
      );
      const noCollateralChange = changed.every(
        (part) => infrastructure(part) || row.touch.some((claim) => part.startsWith(claim)),
      );
      let preserved = true;
      for (const region of row.preserve) {
        if (!(await preservedHolds(source, saved, region, changedSet))) {
          preserved = false;
          break;
        }
      }
      // Reopening is the only proof that matters: the file a person gets back
      // has to carry the change and still open cleanly.
      const reopened = await pptxLens.open(saved);
      const readBack =
        JSON.stringify(reopened.projection.slides.map((slide) => [slide.title, slide.speakerNotes, slide.objects.map((object) => [object.x, object.y, object.width, object.altText ?? "", (object.content as { text?: string })?.text ?? ""])])) !==
        JSON.stringify(opened.projection.slides.map((slide) => [slide.title, slide.speakerNotes, slide.objects.map((object) => [object.x, object.y, object.width, object.altText ?? "", (object.content as { text?: string })?.text ?? ""])]));
      assertions.push({
        fixture: stem,
        commandId: row.commandId,
        changedParts: changed,
        touchedAsDeclared,
        noCollateralChange,
        preserved,
        readBack,
      });
    }
  }
  const failures = assertions.filter(
    (assertion) =>
      !assertion.touchedAsDeclared ||
      !assertion.noCollateralChange ||
      !assertion.preserved ||
      !assertion.readBack,
  );
  return { assertions, failures };
}

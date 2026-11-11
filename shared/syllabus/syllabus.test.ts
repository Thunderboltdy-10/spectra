import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectSyllabi, renderBundle, renderCatalog } from "../../scripts/bundle-syllabus";
import { markdownForLevel, outlineOf } from "./levels";

const PHYSICS = `---
id: physics
title: Physics
group: Group 4, Sciences
levels: SL, HL
first-assessment: 2025
source: Physics guide, first assessment 2025
match: phys
---

# A. Space, time and motion

## A.1 Kinematics

- Motion with constant acceleration

## A.4 Rigid body mechanics (HL)

- Torque

### A.4.1 Moments of inertia

- I = Σmr²

## A.5 Galilean relativity

- Reference frames
`;

const MATHS = `---
id: maths-aa
title: Mathematics: analysis and approaches
levels: SL, HL
match: maths aa, math aa, maths analysis
---

# Topic 1: Number and algebra

- Sequences
`;

let roots: string[] = [];
function subjects(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "syllabus-"));
  roots.push(root);
  mkdirSync(join(root, "shared/syllabus/subjects"), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, "shared/syllabus/subjects", name), body);
  return root;
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
  vi.resetModules();
  vi.doUnmock("./bundle.generated");
});

describe("syllabus bundle", () => {
  it("reads subject files, skips drafts and notes HL-only sections", () => {
    const [physics, ...rest] = collectSyllabi(subjects({ "physics.md": PHYSICS, "_draft.md": "ignored" }));
    expect(rest).toEqual([]);
    expect(physics).toMatchObject({
      id: "physics",
      title: "Physics",
      programme: "IB Diploma Programme",
      levels: ["SL", "HL"],
      firstAssessment: "2025",
      match: ["physics", "phys"],
    });
    expect(physics!.sections.filter((section) => section.hlOnly).map((section) => section.heading)).toEqual([
      "A.4 Rigid body mechanics (HL)",
      "A.4.1 Moments of inertia",
    ]);
    expect(physics!.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuses a file whose id is not its name, or with no title", () => {
    expect(() => collectSyllabi(subjects({ "chem.md": PHYSICS }))).toThrow(/must match the file name/);
    expect(() => collectSyllabi(subjects({ "x.md": "---\nid: x\n---\n# A" }))).toThrow(/needs a title/);
    expect(() => collectSyllabi(subjects({ "x.md": "---\nid: x\ntitle: X\nlevels: AL\n---\n# A" }))).toThrow(/SL and HL/);
  });

  it("renders a bundle and a catalog without outline text", () => {
    const syllabi = collectSyllabi(subjects({ "physics.md": PHYSICS }));
    expect(renderBundle(syllabi)).toContain("Motion with constant acceleration");
    const catalog = renderCatalog(syllabi);
    expect(catalog).not.toContain("Motion with constant acceleration");
    expect(catalog).toContain('"title": "Physics"');
    expect(renderCatalog([])).toContain('SYLLABUS_BUNDLE_VERSION = "none"');
  });

  it("cuts HL-only sections, and everything under them, for SL", () => {
    const body = collectSyllabi(subjects({ "physics.md": PHYSICS }))[0]!.markdown;
    const sl = markdownForLevel(body, "SL");
    expect(sl).not.toContain("Torque");
    expect(sl).not.toContain("Moments of inertia");
    expect(sl).toContain("A.5 Galilean relativity");
    expect(markdownForLevel(body, "HL")).toBe(body);
    expect(outlineOf(sl).some((section) => section.hlOnly)).toBe(false);
  });
});

describe("syllabus lookup", () => {
  async function load() {
    const bundle = collectSyllabi(subjects({ "physics.md": PHYSICS, "maths-aa.md": MATHS }));
    vi.doMock("./bundle.generated", () => ({ SYLLABUS_BUNDLE: bundle }));
    return import("./index");
  }

  it("finds a class's syllabus and level from its name", async () => {
    const { syllabusForClass, findSyllabus } = await load();
    expect(syllabusForClass("Physics HL")).toMatchObject({ entry: { id: "physics" }, level: "HL" });
    expect(syllabusForClass("IB DP Maths AA SL Y1")).toMatchObject({ entry: { id: "maths-aa" }, level: "SL" });
    expect(syllabusForClass("phys")).toMatchObject({ entry: { id: "physics" }, level: null });
    expect(findSyllabus("Physical education")).toBeNull();
    expect(findSyllabus("History")).toBeNull();
  });

  it("answers read_syllabus with the level's outline or one section", async () => {
    const { readSyllabus } = await load();
    expect(readSyllabus({})).toContain("- physics: Physics (SL, HL), first assessment 2025");
    const sl = readSyllabus({ subject: "Physics", level: "SL" });
    expect(sl).toContain("A.1 Kinematics");
    expect(sl).not.toContain("Torque");
    expect(readSyllabus({ subject: "physics hl", section: "A.4" })).toContain("Moments of inertia");
    expect(readSyllabus({ subject: "physics", section: "Z.9" })).toContain("No section matches");
    expect(readSyllabus({ subject: "Latin" })).toContain('No syllabus matches "Latin"');
  });

  it("says so when no syllabi are loaded", async () => {
    vi.doMock("./bundle.generated", () => ({ SYLLABUS_BUNDLE: [] }));
    const { readSyllabus } = await import("./index");
    expect(readSyllabus({ subject: "Physics" })).toMatch(/No syllabi are loaded/);
  });
});

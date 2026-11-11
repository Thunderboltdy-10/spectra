import { describe, expect, it } from "vitest";
import { collectSyllabi } from "../../scripts/bundle-syllabus";
import { findSyllabus, listSyllabi, readSyllabus, syllabusForClass, syllabusVariant } from "./index";

describe("shipped IB references", () => {
  it("ships exactly the requested families, with no first assessment later than 2027", () => {
    const expected = ["biology", "chemistry", "physics", "computer-science", "maths-aa", "maths-ai", "business-management", "history", "economics", "ess", "psychology", "tok", "extended-essay",
      ...["english", "french", "spanish"].flatMap((language) => ["a-literature", "a-language-literature", "b", "ab-initio", "literature-performance"].map((route) => `${language}-${route}`))];
    expect(listSyllabi().map((entry) => entry.id).sort()).toEqual(expected.sort());
    expect(listSyllabi()).toEqual(collectSyllabi());
    for (const entry of listSyllabi()) {
      expect(Number(entry.firstAssessment)).toBeLessThanOrEqual(2027);
      expect(entry.markdown).toContain("https://");
      expect(entry.markdown).not.toContain("@LANG");
      expect(entry.markdown.length).toBeLessThan(6_000);
    }
    expect(findSyllabus("Computer science")?.firstAssessment).toBe("2027");
    expect(findSyllabus("Psychology")?.firstAssessment).toBe("2027");
    expect(findSyllabus("Extended essay")?.firstAssessment).toBe("2027");
    expect(findSyllabus("History")?.firstAssessment).toBe("2017");
  });

  it.each([
    ["2527PhysHL1", "physics", "HL"], ["2527MAASL1", "maths-aa", "SL"],
    ["Math AI HL", "maths-ai", "HL"], ["Computer Science HL 2027", "computer-science", "HL"],
    ["2527HistHL1", "history", "HL"], ["Fre-B-SL-1", "french-b", "SL"],
    ["English A Language & Literature HL", "english-a-language-literature", "HL"],
    ["Spanish A Lit SL", "spanish-a-literature", "SL"],
    ["English ab initio", "english-ab-initio", "SL"], ["ESS HL", "ess", "HL"],
  ])("matches %s without losing course or level", (name, id, level) => {
    expect(syllabusForClass(name)).toMatchObject({ entry: { id }, level });
  });

  it("keeps unknown/mixed levels unknown, refuses invalid levels and ambiguous routes", () => {
    expect(syllabusForClass("Physics HL and SL")?.level).toBeNull();
    expect(syllabusVariant(findSyllabus("Physics")!).key).toBe("all");
    expect(syllabusForClass("French ab initio HL")).toBeNull();
    for (const name of ["Mathematics", "English A", "French", "History 2028", "Computer science 2026", "Spanish B 2029"])
      expect(findSyllabus(name), name).toBeNull();
  });

  it("retrieves small overviews and only the selected level's assessment", () => {
    const overview = readSyllabus({ subject: "physics", level: "SL" });
    expect(overview).toContain("Sections");
    expect(overview).not.toContain("Paper 1: 90 minutes");
    expect(overview).not.toContain("A.4 Rotation");
    const sl = readSyllabus({ subject: "physics", level: "SL", section: "Assessment" });
    const hl = readSyllabus({ subject: "physics", level: "HL", section: "Assessment" });
    expect(sl).toContain("90 minutes");
    expect(sl).not.toContain("150 minutes");
    expect(hl).toContain("150 minutes");
    expect(hl).not.toContain("90 minutes");
    for (const entry of listSyllabi())
      expect(readSyllabus({ subject: entry.id }).length).toBeLessThan(3_500);
    expect(readSyllabus({ subject: "French ab initio", level: "HL" })).toContain("only available at SL");
  });
});

import { describe, expect, it } from "vitest";
import {
  cleanGuideText,
  codeKey,
  findGuideSections,
  guideOutlineText,
  planGuide,
  renderGuideSection,
  sectionQueries,
  type ExtractedChapter,
  type ExtractedSection,
} from "./guides";

/* A small guide laid out the way the extractor writes one: page footers, running headers, bullets on their own line. */
const pieces: Array<[string, Partial<ExtractedSection> & { title: string }]> = [
  ["Physics guide\nFirst assessment 2025\n", { title: "Front matter", kind: "bookmark", depth: 0, areaType: "front matter" }],
  ["IB learner profile\nInquirers and thinkers.\n", { title: "IB learner profile", depth: 1, areaType: "front matter" }],
  ["Syllabus outline\nFive themes.\n", { title: "Syllabus outline", depth: 1, areaType: "syllabus" }],
  ["Syllabus format\nHow to read this.\n", { title: "Syllabus format", depth: 1, areaType: "syllabus" }],
  ["Syllabus content\n", { title: "Syllabus content", depth: 1, areaType: "syllabus" }],
  ["A. Space, time and motion\n", { title: "A. Space, time and motion", code: "A", depth: 1, areaType: "syllabus" }],
  [
    "A.2 Forces and momentum\nStudents should understand:\n•\nNewton’s three laws of motion\n•\nforces as interactions between bodies, \nwhich are drawn\n34\nPhysics guide\n\n\f\nSyllabus content\n•\nthat linear momentum p = mv is conserved\nAdditional higher level\nNone.\n",
    { title: "A.2 Forces and momentum", code: "A.2", depth: 2, areaType: "syllabus" },
  ],
  ["∫f(x)dx = F(x)\n", { title: "∫f(x)dx = F(x)", depth: 1, areaType: "syllabus" }],
  ["more of A.2 after a formula line\n", { title: "more", depth: 1, areaType: "syllabus" }],
  ["Methods of assessment\nThe IB uses criteria.\n", { title: "Methods of assessment", depth: 1, areaType: "assessment" }],
  ["Assessment criteria\nGeneric words.\n", { title: "Assessment criteria", depth: 2, areaType: "assessment" }],
  ["External assessment details—SL\n", { title: "External assessment details—SL", depth: 1, areaType: "assessment" }],
  ["Paper 1\nDuration: 1 hour 30 minutes\n", { title: "Paper 1", depth: 2, areaType: "assessment" }],
  ["External assessment details—HL\n", { title: "External assessment details—HL", depth: 1, areaType: "assessment" }],
  ["Paper 1\nDuration: 2 hours\n", { title: "Paper 1", depth: 2, areaType: "assessment" }],
  ["Glossary of command terms\n", { title: "Glossary of command terms", depth: 1, areaType: "appendices" }],
  ["Command terms for physics\nDescribe: give an account.\n", { title: "Command terms for physics", depth: 1, areaType: "appendices" }],
  ["Bibliography\nBooks.\n", { title: "Bibliography", depth: 1, areaType: "appendices" }],
];

function guide() {
  let fullText = "";
  const sections: ExtractedSection[] = [];
  for (const [text, section] of pieces) {
    sections.push({ code: null, kind: "heading", depth: 1, areaType: "syllabus", ...section, startChar: fullText.length, endChar: fullText.length + text.length });
    fullText += text;
  }
  // Parents span their children, as in the extractor's index.
  const span = (title: string, last: string) => {
    const parent = sections.find((section) => section.title === title)!;
    parent.endChar = sections.filter((section) => section.title === last).at(-1)!.endChar;
  };
  span("A. Space, time and motion", "more");
  span("A.2 Forces and momentum", "more");
  span("Methods of assessment", "Assessment criteria");
  sections[11]!.endChar = sections[12]!.endChar;
  sections[13]!.endChar = sections[14]!.endChar;
  const at = (title: string) => sections.find((section) => section.title === title)!.startChar;
  const chapters: ExtractedChapter[] = [
    { title: "Front matter", areaType: "front matter", start: 0, end: at("Syllabus outline") },
    { title: "Syllabus", areaType: "syllabus", start: at("Syllabus outline"), end: at("Methods of assessment") },
    { title: "Assessment", areaType: "assessment", start: at("Methods of assessment"), end: at("Glossary of command terms") },
    { title: "Appendices", areaType: "appendices", start: at("Glossary of command terms"), end: fullText.length },
  ];
  return planGuide({ guideId: "physics", title: "Physics guide", fullText, sections, chapters });
}

describe("official guides", () => {
  it("keeps the syllabus, the course's assessment and the command terms, and nothing else", () => {
    const titles = guide().outline.map((entry) => entry.title);
    expect(titles).toEqual([
      "Syllabus outline",
      "Syllabus content",
      "A. Space, time and motion",
      "A.2 Forces and momentum",
      "External assessment details—SL",
      "Paper 1",
      "External assessment details—HL",
      "Paper 1",
      "Glossary of command terms",
      "Command terms for physics",
    ]);
  });

  it("cleans page breaks, bullets and wrapped lines, and keeps a formula line with its section", () => {
    const plan = guide();
    const index = findGuideSections(plan.outline, "A.2")[0]!;
    const text = renderGuideSection(plan.outline, index, plan.segments, 12_000);
    expect(text).toContain("[Syllabus > Syllabus content > A. Space, time and motion > A.2 Forces and momentum]");
    expect(text).toContain("- Newton’s three laws of motion");
    expect(text).toContain("- forces as interactions between bodies, which are drawn\n- that linear momentum");
    expect(text.slice(text.indexOf("\n"))).not.toMatch(/Physics guide|Syllabus content|\f|34/);
    expect(text).toContain("more of A.2 after a formula line");
  });

  it("gives a topic with all its sub-topics", () => {
    const plan = guide();
    const text = renderGuideSection(plan.outline, findGuideSections(plan.outline, "A")[0]!, plan.segments, 12_000);
    expect(text).toContain("A.2 Forces and momentum");
    expect(text).toContain("Additional higher level");
  });

  it("finds sections by code in any spelling, and by heading at the student's level", () => {
    const { outline } = guide();
    expect(codeKey("A.2")).toBe(codeKey("a2"));
    expect(findGuideSections(outline, "a2").map((index) => outline[index]!.code)).toEqual(["A.2"]);
    expect(findGuideSections(outline, "paper 1")).toHaveLength(2);
    const hl = findGuideSections(outline, "Paper 1", "HL");
    expect(hl).toHaveLength(1);
    expect(renderGuideSection(outline, hl[0]!, guide().segments, 12_000)).toContain("2 hours");
    const glossary = findGuideSections(outline, "Glossary of command terms");
    expect(renderGuideSection(outline, glossary[0]!, guide().segments, 12_000)).toContain("Describe: give an account.");
    expect(findGuideSections(outline, "Bibliography")).toEqual([]);
  });

  it("cuts a long section at a segment edge and says what is left", () => {
    const plan = guide();
    const text = renderGuideSection(plan.outline, findGuideSections(plan.outline, "A")[0]!, plan.segments, 60);
    expect(text).toContain("[Cut for length. Read the rest by section: A.2.]");
  });

  it("lists the outline by code and heading", () => {
    expect(guideOutlineText(guide().outline)).toBe(
      ["Syllabus:", "- Syllabus outline", "- Syllabus content", "  - A. Space, time and motion", "    - A.2 Forces and momentum", "Assessment:", "- External assessment details—SL", "  - Paper 1", "- External assessment details—HL", "  - Paper 1", "Reference:", "- Glossary of command terms", "  - Command terms for physics"].join("\n"),
    );
  });

  it("splits several codes but keeps a heading with commas whole", () => {
    expect(sectionQueries("A.1, A.2; B.3")).toEqual(["A.1", "A.2", "B.3"]);
    expect(sectionQueries("SL 2.6, AHL 2.12")).toEqual(["SL 2.6", "AHL 2.12"]);
    expect(sectionQueries("A.3 Work, energy and power")).toEqual(["A.3 Work, energy and power"]);
    expect(sectionQueries("Internal assessment criteria; command terms")).toEqual(["Internal assessment criteria", "command terms"]);
  });

  it("keeps a lone bullet that starts a page", () => {
    expect(cleanGuideText("one\n12\nBiology guide\n\n\f\nSyllabus content\n•\ntwo", new Set(["0:Syllabus content"]))).toBe("one\n- two");
  });
});

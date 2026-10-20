import type { CodeProblem } from "./code-tray";

/*
 * What the running page reports about how readable it is to everyone, turned
 * into tips for the Problems list. They are suggestions, not errors: a quick
 * sketch does not need a title to be worth running.
 */

export type AccessibilityReport = {
  title: boolean;
  headingCount: number;
  landmarkCount: number;
  imagesWithoutAlt: number;
  unnamedControls: number;
  unlabelledGraphics: number;
  headingOrderIssues: number;
  duplicateIds: number;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function accessibilityTips(report: AccessibilityReport): CodeProblem[] {
  const tips: Array<[string, boolean, string]> = [
    ["title", !report.title, "Give the page a title, so it has a name in tabs and screen readers."],
    ["heading", report.headingCount === 0, "Add a heading, so people can see what the page is about."],
    ["landmark", report.landmarkCount === 0, "Put the main content inside <main>."],
    [
      "image-alt",
      report.imagesWithoutAlt > 0,
      `${plural(report.imagesWithoutAlt, "image has", "images have")} no alt text. Describe each one, or use alt="" if it is only decoration.`,
    ],
    ["control-name", report.unnamedControls > 0, `${plural(report.unnamedControls, "button or field has", "buttons or fields have")} no name.`],
    [
      "graphic-name",
      report.unlabelledGraphics > 0,
      `${plural(report.unlabelledGraphics, "chart or drawing needs", "charts or drawings need")} a short description.`,
    ],
    ["heading-order", report.headingOrderIssues > 0, `${plural(report.headingOrderIssues, "heading skips", "headings skip")} a level.`],
    ["duplicate-id", report.duplicateIds > 0, `${plural(report.duplicateIds, "id is", "ids are")} used more than once.`],
  ];
  return tips.filter(([, show]) => show).map(([id, , message]) => ({ id: `a11y:${id}`, severity: "info", message }));
}

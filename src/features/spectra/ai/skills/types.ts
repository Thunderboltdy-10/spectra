/** A skill folder as the build bundles it: SKILL.md front matter and body, plus readable resources. */
export type BundledSkill = {
  name: string;
  /** One line: when the skill is useful. The system prompt lists only this. */
  description: string;
  /** SKILL.md without its front matter. */
  body: string;
  /** Reference files beside SKILL.md, by path relative to the folder. */
  resources: readonly { path: string; content: string }[];
};

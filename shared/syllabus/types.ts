export type SyllabusLevel = "SL" | "HL";

/** One subject's syllabus as bundled from shared/syllabus/subjects/<id>.md. */
export type BundledSyllabus = {
  id: string;
  title: string;
  programme: string;
  group?: string;
  /** Empty for a syllabus with no levels (TOK, the Extended Essay, CAS). */
  levels: SyllabusLevel[];
  firstAssessment?: string;
  /** Do not assign a superseded specification beyond its final assessment. */
  lastAssessment?: string;
  /** Where the outline comes from, as its file says (a guide's name and year). */
  source?: string;
  /** Lowercase names a class or a request may use for it, its title first. */
  match: string[];
  /** Changes whenever the file does; a Syllabus artifact refreshes when it differs. */
  version: string;
  sections: Array<{ heading: string; depth: number; hlOnly: boolean; slOnly?: boolean }>;
  /** The whole outline; markdownForLevel cuts the SL version from it. */
  markdown: string;
};

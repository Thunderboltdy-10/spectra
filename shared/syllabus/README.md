# Syllabi

## Scope and sources

Verified against official IB sources on **11 November 2026**. These are original,
compact course references, not reproductions of full copyrighted subject guides.
Each file links its primary sources. Topic maps deliberately do not claim to list
every assessable understanding, language-specific grammar point or rubric detail.
Use the linked guide and the student's class instructions for those details.

The catalogue includes only the requested subjects, using the newest edition
whose **first assessment is no later than 2027**. There are 28 files:

| Courses | First assessment |
| --- | --- |
| Biology, chemistry, physics | 2025 |
| Computer science, psychology, extended essay | 2027 |
| Environmental systems and societies, SL and HL | 2026 |
| Mathematics AA and AI, each SL and HL | 2021 |
| Business management | 2024 |
| History | 2017, final assessment 2027 |
| Economics, TOK | 2022 |
| English, French and Spanish A literature and A language and literature | 2021 |
| English, French and Spanish B and ab initio | 2020 |
| English, French and Spanish literature and performance | 2024, SL only |

No 2028 history or 2029 mathematics/language specification is bundled. Current
maths/language editions remain valid through 2028; that end date does not make
them a newer specification. Literature-and-performance language availability
must be confirmed with the school. Legacy Mathematical Studies/Further Mathematics
are excluded because they are discontinued.

The [IB curriculum update calendar](https://www.ibo.org/university-admission/latest-curriculum-updates/)
establishes the transition dates. The
[current subject list](https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/all-dp-subjects-list-en.pdf)
also confirms English ab initio and both ESS levels. Some IB overview-page prose
describes older versions; the dated subject briefs take precedence for the facts
summarized here. Recheck sources and guide addenda when maintaining the files.

## Retrieval and cost

- Markdown is bundled at build time. `read_syllabus` reads it without a network
  request, then makes one indexed Convex query for the official guide (below).
  No syllabus text is inserted into the system prompt.
- A subject request returns its introduction and section index. Request only the
  relevant topic or `Assessment`; `section: "all"` explicitly retrieves the whole
  compact reference. Section responses are bounded to 6,000 characters.
- The current conversation's workspace contributes only its syllabus id/level
  pointer to the environment. Other course bodies are never preloaded.
- Convex materializes only a matching workspace's level-specific document. The
  generated picker catalogue contains metadata, not course bodies. A bundle hash
  prevents repeated sync jobs; the workspace's content hash avoids reading the
  artifact body or placement nodes on unchanged checks. Refresh-all is paginated
  in batches of 100 and schedules bounded per-workspace jobs.
- Read-only is enforced by the UI, full server authority and compact server
  authority, including collaboration writes. Permission checks use the existing
  server-maintained summary row, without an extra body read.
- Ambiguous language routes or unspecified AA/AI are not guessed. Unknown or
  mixed SL/HL stays unlabelled; single-level courses resolve to SL. An explicit
  examination year outside a reference's assessment window is rejected.
- Original ManageBac names are read when a syllabus check needs them, preserving
  cohort prefixes such as `2527HistHL1` that the display title strips off.
  A class rename also rechecks its match, including changes between SL and HL.

Measured with `cl100k_base` on the 28 shipped references: median overview 144
tokens (maximum 340); median assessment-section read 125 tokens (maximum 146).
These are tokenizer estimates, not a billing guarantee for the selected model.
The generated TypeScript bundle is about 82 KB; all Markdown bodies total about
39 KB. None of that full catalogue is sent to the model at run start.

## Official guides

The IB subject guides' own text is stored in Convex, so `read_syllabus` can quote
them. Only what students ask about is kept, split along the guide's sections:

- **Syllabus**: every topic and sub-topic with its content (and TOK's course chapter).
- **Assessment**: this course's papers, internal assessment and marking criteria.
  The IB's generic assessment pages are left out.
- **Reference**: the command terms, the subject's glossary, formulae and notation.

Front matter, approaches to teaching and learning, bibliographies and the rest are
not stored. Page footers, running headers and bullets are cleaned on import.
`shared/syllabus/guides.ts` holds the rules; `guides.test.ts` covers them.

Tables: `syllabusGuides` (outline per guide), `syllabusGuideSegments` (one text
segment per section, with a search index for questions that name no section) and
`syllabusGuideCourses` (course id to guide). The three literature-and-performance
courses have no guide and keep the compact reference only.

With no `section`, the tool gives the compact overview plus the guide's outline. A
`section` can be a code (`A.2`, `C1.3`, `SL 2.6`, several as `A.1, A.2`), a heading
(`Paper 1`, `Internal assessment criteria`, `Glossary of command terms`) or words;
`;` separates several. Reads are bounded to 12,000 characters per section and
18,000 per call, and say which sub-sections to read for the rest.

Import, once per deployment and again when a guide changes. The folder holds
`course-map.json` and `extracted/<guide>/{index.json,full.txt}`:

```sh
# Local: CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY
# Production: CONVEX_URL and CONVEX_DEPLOY_KEY
npx tsx scripts/import-syllabus-guides.ts <ib-guides folder> --dry-run
npx tsx scripts/import-syllabus-guides.ts <ib-guides folder>
```

The import replaces each guide in place and is safe to run again.

## Maintenance

Each subject is one Markdown file in `subjects/`, named by its id (`physics.md`).
Spectra reads them in two places:

- the AI's `read_syllabus` tool, for any question about what a course covers;
- the read-only **Syllabus** artifact. A ManageBac class gets one as its first artifact.
  A new workspace gets one when its creator picks a subject.

After adding or changing a file, run:

```sh
npm run syllabus:bundle
```

`npm run check:syllabus` (part of `prebuild`) fails when the bundle is out of date.
Deployment must include the generated bundle on both the web and Convex sides.
After the normal deployment, existing workspaces can be refreshed with the internal
`workspaceSyllabus:refreshAll` mutation, or through their next class sync. Coordinate
deployment with other work in this shared checkout; deploying it publishes all
pending backend changes, not just these references.

## File format

```md
---
id: physics
title: Physics
programme: IB Diploma Programme
group: Group 4, Sciences
levels: SL, HL
first-assessment: 2025
source: Physics guide, first assessment 2025
match: phys, physics hl, physics sl
---

# A. Space, time and motion

## A.1 Kinematics

- …

## A.4 Rigid body mechanics (HL)

- …
```

- `id`: lowercase letters, digits and dashes, the same as the file name.
- `title`: required. `levels`: `SL, HL`, one of them, or leave it out for
  courses with no levels (TOK, the Extended Essay, CAS).
- `match`: other names a ManageBac class or a student may use. Whole words, any case.
  "Physics HL" finds `physics` at HL. The longest match wins.
- A heading ending in `(HL)` or `(AHL)` marks an HL-only section. That section and
  everything under it is left out of the SL syllabus.
- A heading ending in `(SL)` marks an SL-only section, omitted for HL. Use these
  markers on assessment subsections as well as topics.
- `first-assessment` and optional `last-assessment` delimit valid examination years.
  This catalogue intentionally caps first assessment at 2027; the content test
  guards that cutoff.
- Files starting with `_` are ignored, so you can keep drafts in the same folder.

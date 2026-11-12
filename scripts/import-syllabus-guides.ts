/*
 * Puts the official IB guides into Convex for read_syllabus (shared/syllabus/README.md).
 *
 *   npx tsx scripts/import-syllabus-guides.ts <ib-guides folder> [--dry-run]
 *
 * The folder holds course-map.json and extracted/<guide>/{index.json,full.txt}.
 * The deployment comes from CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY
 * (local), or CONVEX_URL + CONVEX_DEPLOY_KEY (cloud). Running it again replaces
 * each guide. Nothing it reads or writes is printed beyond counts.
 */
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { planGuide, type ExtractedChapter, type ExtractedSection } from "../shared/syllabus/guides";
import { SYLLABUS_CATALOG } from "../shared/syllabus/catalog.generated";

const args = process.argv.slice(2);
const folder = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
if (!folder) {
  console.error("Usage: npx tsx scripts/import-syllabus-guides.ts <ib-guides folder> [--dry-run]");
  process.exit(1);
}

type CourseMap = Record<string, { guideId?: string | null } | undefined>;
type ExtractedIndex = { sourcePdfSha256?: string; textSha256?: string; sections: ExtractedSection[]; chapters: ExtractedChapter[] };

const BATCH_CHARACTERS = 400_000;

async function main() {
  const courseMap = JSON.parse(fs.readFileSync(path.join(folder!, "course-map.json"), "utf8")) as CourseMap;
  const known = new Set(SYLLABUS_CATALOG.map((course) => course.id));
  const courses = Object.entries(courseMap).flatMap(([courseId, entry]) => (entry?.guideId && known.has(courseId) ? [{ courseId, guideId: entry.guideId }] : []));
  const unknown = Object.keys(courseMap).filter((courseId) => !known.has(courseId));
  if (unknown.length) console.warn(`Not Spectra courses, skipped: ${unknown.join(", ")}`);
  const without = [...known].filter((courseId) => !courses.some((course) => course.courseId === courseId));
  if (without.length) console.warn(`Courses with no guide (they keep the compact reference): ${without.join(", ")}`);

  const guideIds = [...new Set(courses.map((course) => course.guideId))].sort();
  const plans = guideIds.map((guideId) => {
    const dir = path.join(folder!, "extracted", guideId);
    const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as ExtractedIndex;
    const fullText = fs.readFileSync(path.join(dir, "full.txt"), "utf8");
    const title = fullText.split("\n")[0]!.trim();
    const plan = planGuide({ guideId, title, fullText, sections: index.sections, chapters: index.chapters });
    if (!plan.outline.length) throw new Error(`${guideId}: no syllabus or assessment sections found.`);
    return { plan, sourceSha: index.sourcePdfSha256 ?? index.textSha256 ?? "" };
  });
  for (const { plan } of plans) {
    const characters = plan.segments.reduce((sum, segment) => sum + segment.text.length, 0);
    console.log(`${plan.guideId}: ${plan.outline.length} sections, ${characters.toLocaleString("en")} characters`);
  }
  if (dryRun) return;

  const url = process.env.CONVEX_SELF_HOSTED_URL ?? process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  const key = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY ?? process.env.CONVEX_DEPLOY_KEY;
  if (!url || !key) throw new Error("Set CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY, or CONVEX_URL and CONVEX_DEPLOY_KEY.");
  const client = new ConvexHttpClient(url);
  (client as unknown as { setAdminAuth(token: string): void }).setAdminAuth(key);
  const call = (name: string, input: Record<string, unknown>) => client.mutation(makeFunctionReference<"mutation">(`syllabusGuides:${name}`), input);

  for (const { plan, sourceSha } of plans) {
    while (!((await call("clearGuide", { guideId: plan.guideId })) as { done: boolean }).done);
    let batch: typeof plan.segments = [];
    let size = 0;
    for (const segment of plan.segments) {
      if (batch.length && size + segment.text.length > BATCH_CHARACTERS) {
        await call("addSegments", { guideId: plan.guideId, segments: batch });
        batch = [];
        size = 0;
      }
      batch.push(segment);
      size += segment.text.length;
    }
    if (batch.length) await call("addSegments", { guideId: plan.guideId, segments: batch });
    await call("saveGuide", { guideId: plan.guideId, title: plan.title, outline: plan.outline, sourceSha });
    console.log(`Imported ${plan.guideId}`);
  }
  await call("setCourses", { courses });
  console.log(`${plans.length} guides, ${courses.length} courses.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

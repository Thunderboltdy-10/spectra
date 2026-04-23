import path from "node:path";
import { promises as fs } from "node:fs";
import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

type RemoteSkill = {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  summary?: unknown;
  guidance?: unknown;
  prompt?: unknown;
  appliesToModes?: unknown;
  trigger?: unknown;
  priority?: unknown;
  audience?: unknown;
  preferredAssignmentLevels?: unknown;
  requiredToolBundles?: unknown;
  markdownUrl?: unknown;
};

type RemoteManifest = {
  skills?: RemoteSkill[];
};

const ONLINE_DIR = path.join(process.cwd(), "public", "skills", "online");
const MANIFEST_PATH = path.join(ONLINE_DIR, "manifest.json");

function sanitizeSkillId(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function parseSources(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();

    const body = (await request.json().catch(() => ({}))) as {
      manifestUrls?: unknown;
    };
    const bodySources = parseSources(body.manifestUrls);
    const envSources = parseSources((process.env.SKILL_REMOTE_MANIFEST_URLS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
    const sources = bodySources.length > 0 ? bodySources : envSources;
    if (sources.length === 0) {
      return badRequest("No manifest URLs provided. Pass manifestUrls[] or set SKILL_REMOTE_MANIFEST_URLS.");
    }

    await fs.mkdir(ONLINE_DIR, { recursive: true });

    const downloadedSkills: Array<Record<string, unknown>> = [];
    const failures: Array<{ source: string; reason: string }> = [];

    for (const source of sources) {
      try {
        const response = await fetch(source, { method: "GET", cache: "no-store" });
        if (!response.ok) {
          failures.push({ source, reason: `Manifest fetch failed (${response.status})` });
          continue;
        }
        const manifest = (await response.json()) as RemoteManifest;
        const skills = Array.isArray(manifest.skills) ? manifest.skills : [];
        for (const entry of skills) {
          const id = sanitizeSkillId(entry.id);
          if (!id) continue;
          const markdownUrl = typeof entry.markdownUrl === "string" ? entry.markdownUrl.trim() : "";
          let markdown = typeof entry.prompt === "string" ? entry.prompt.trim() : "";
          if (markdownUrl) {
            try {
              const markdownRes = await fetch(markdownUrl, { method: "GET", cache: "no-store" });
              if (markdownRes.ok) {
                markdown = (await markdownRes.text()).trim();
              }
            } catch {
              // Fall back to inline prompt/guidance below.
            }
          }
          if (!markdown) {
            const guidanceLines = Array.isArray(entry.guidance)
              ? (entry.guidance as unknown[])
                  .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              : [];
            markdown = guidanceLines.length > 0
              ? guidanceLines.map((line) => `- ${line.trim()}`).join("\n")
              : "";
          }
          if (!markdown) continue;
          const localPath = `/public/skills/online/${id}.md`;
          const absolutePath = path.join(ONLINE_DIR, `${id}.md`);
          await fs.writeFile(absolutePath, markdown, "utf8");

          downloadedSkills.push({
            id,
            name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
            category: typeof entry.category === "string" ? entry.category : "research",
            summary: typeof entry.summary === "string" && entry.summary.trim() ? entry.summary.trim() : "Online skill",
            guidance: Array.isArray(entry.guidance)
              ? (entry.guidance as unknown[])
                  .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                  .slice(0, 8)
              : undefined,
            prompt: markdown,
            appliesToModes: Array.isArray(entry.appliesToModes) ? entry.appliesToModes : undefined,
            trigger: typeof entry.trigger === "string" ? entry.trigger : undefined,
            priority: typeof entry.priority === "number" ? entry.priority : 3,
            audience: Array.isArray(entry.audience) ? entry.audience : undefined,
            preferredAssignmentLevels: Array.isArray(entry.preferredAssignmentLevels) ? entry.preferredAssignmentLevels : undefined,
            requiredToolBundles: Array.isArray(entry.requiredToolBundles) ? entry.requiredToolBundles : undefined,
            sourceUrl: markdownUrl || source,
            localPath,
          });
        }
      } catch (error) {
        failures.push({
          source,
          reason: error instanceof Error ? error.message : "Manifest parse failed",
        });
      }
    }

    const deduped = Array.from(
      new Map(downloadedSkills.map((skill) => [String(skill.id), skill])).values(),
    );

    await fs.writeFile(
      MANIFEST_PATH,
      JSON.stringify(
        {
          syncedAt: Date.now(),
          sources,
          skills: deduped,
          failures,
        },
        null,
        2,
      ),
      "utf8",
    );

    return ok({
      syncedAt: Date.now(),
      sources,
      downloaded: deduped.length,
      failures,
      manifestPath: "/public/skills/online/manifest.json",
      skillIds: deduped.map((entry) => entry.id),
    });
  });
}

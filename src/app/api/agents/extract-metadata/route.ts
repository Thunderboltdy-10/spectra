import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";

type ResourceTextRow = {
  resourceId: string;
  filename: string;
  status: "uploaded" | "processing" | "processed" | "failed";
  text: string;
};

function normalizeList(values: unknown, max = 16) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0),
    ),
  ).slice(0, max);
}

function fallbackTopicCandidates(filenames: string[], subjectArea?: string) {
  const base = Array.from(
    new Set(
      filenames
        .map((name) => name.toLowerCase().replace(/\.[a-z0-9]+$/i, ""))
        .flatMap((name) => name.split(/[_\-\s]+/))
        .map((token) => token.trim())
        .filter((token) => token.length >= 4),
    ),
  ).slice(0, 8);

  if (subjectArea?.trim()) {
    base.unshift(subjectArea.trim());
  }
  return Array.from(new Set(base)).slice(0, 12);
}

function buildFallback(params: {
  name?: string;
  subjectArea?: string;
  gradeLevel?: string;
  description?: string;
  filenames: string[];
  capabilities: string[];
}) {
  const topicMap = fallbackTopicCandidates(params.filenames, params.subjectArea);
  const rubricHints = [
    "Reward clear reasoning, not just final answers.",
    "Check terminology accuracy and subject vocabulary.",
    "Require one worked example when possible.",
  ];
  const misconceptions = [
    "Mixing definitions without explaining differences.",
    "Skipping intermediate reasoning steps.",
    "Answering by pattern instead of concept understanding.",
  ];
  const vocabulary = Array.from(
    new Set(
      [
        ...(params.subjectArea ? params.subjectArea.split(/[\s,]+/) : []),
        ...topicMap.flatMap((topic) => topic.split(/[\s,]+/)),
      ]
        .map((value) => value.trim())
        .filter((value) => value.length >= 4),
    ),
  ).slice(0, 16);
  const examStructure = [
    "Short concept checks",
    "Worked problem with marking notes",
    "Common errors and corrections",
  ];
  const summary = [
    params.description?.trim() || `${params.name || "Agent"} supports structured learning.`,
    params.subjectArea ? `Subject focus: ${params.subjectArea}.` : "",
    params.gradeLevel ? `Level: ${params.gradeLevel}.` : "",
    topicMap.length > 0 ? `Detected topics: ${topicMap.slice(0, 6).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const systemPrompt = `You are ${params.name || "a learning coach"} for ${params.gradeLevel || "secondary"} learners.

Subject focus: ${params.subjectArea || "general academics"}.

Core behavior:
- Teach with short, clear steps and one comprehension check when useful.
- Ground explanations in uploaded school resources whenever relevant.
- Prioritize accuracy, transparent reasoning, and exam-ready phrasing.
- If context is missing, ask one clarifying question before answering in depth.

Quality rubric:
${rubricHints.map((item) => `- ${item}`).join("\n")}

Common misconceptions to proactively address:
${misconceptions.map((item) => `- ${item}`).join("\n")}

Key vocabulary to reinforce:
${vocabulary.slice(0, 12).map((item) => `- ${item}`).join("\n")}

Preferred response structure:
${examStructure.map((item) => `- ${item}`).join("\n")}

Tools enabled:
${params.capabilities.length > 0 ? params.capabilities.map((tool) => `- ${tool}`).join("\n") : "- tutoring"}`
    .trim();

  return {
    topicMap,
    rubricHints,
    misconceptions,
    vocabulary,
    examStructure,
    guidelinesSummary: summary,
    systemPromptDraft: systemPrompt,
  };
}

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      subjectArea?: string;
      gradeLevel?: string;
      description?: string;
      capabilities?: string[];
      resourceIds?: string[];
    } | null;

    const resourceIds = Array.isArray(body?.resourceIds)
      ? body.resourceIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
    const capabilities = Array.isArray(body?.capabilities)
      ? body.capabilities.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0)
      : [];

    if ((!body?.name || body.name.trim().length < 2) && !body?.subjectArea?.trim()) {
      return badRequest("Provide at least agent name or subject area.");
    }

    let rows: ResourceTextRow[] = [];
    try {
      rows = (await convexQuery("resources:listPersonalTextsByIds", {
        actorClerkId: actor.clerkId,
        resourceIds,
      })) as ResourceTextRow[];
    } catch {
      rows = [];
    }
    const filenames = rows.map((row) => row.filename);
    const processed = rows.filter((row) => row.status === "processed" && row.text.trim().length > 0);
    const fallback = buildFallback({
      name: body?.name,
      subjectArea: body?.subjectArea,
      gradeLevel: body?.gradeLevel,
      description: body?.description,
      filenames,
      capabilities,
    });

    if (!process.env.OPENROUTER_API_KEY || processed.length === 0) {
      return ok({
        ...fallback,
        resourceCoverage: {
          total: rows.length,
          processed: processed.length,
          pending: rows.length - processed.length,
        },
      });
    }

    const sourceSnippet = processed
      .slice(0, 6)
      .map((row) => `FILE: ${row.filename}\n${row.text.slice(0, 3500)}`)
      .join("\n\n")
      .slice(0, 18_000);
    const completion = await openRouterChatCompletion({
      model: MODEL_CONFIG.smartCheap,
      fallbackModels: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.gptOss],
      temperature: 0.2,
      maxTokens: 1400,
      messages: [
        {
          role: "system",
          content: [
            "You are extracting educational agent metadata from uploaded school files.",
            "Return ONLY valid JSON with exact keys:",
            "{",
            '  "topicMap": string[],',
            '  "rubricHints": string[],',
            '  "misconceptions": string[],',
            '  "vocabulary": string[],',
            '  "examStructure": string[],',
            '  "guidelinesSummary": string,',
            '  "systemPromptDraft": string',
            "}",
            "Rules:",
            "- Keep each list item concise and practical.",
            "- topicMap max 16; rubricHints/misconceptions/examStructure max 12; vocabulary max 20.",
            "- systemPromptDraft must be production-ready and around 220-420 words.",
            "- Do not include markdown fences.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            identity: {
              name: body?.name ?? "",
              subjectArea: body?.subjectArea ?? "",
              gradeLevel: body?.gradeLevel ?? "",
              description: body?.description ?? "",
            },
            capabilities,
            files: processed.map((row) => row.filename),
            extractedText: sourceSnippet,
          }),
        },
      ],
    });

    await recordOpenRouterUsage({
      actorClerkId: actor.clerkId,
      model: completion.model ?? MODEL_CONFIG.smartCheap,
      usage: completion.usage,
    }).catch(() => {});

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return ok({
        ...fallback,
        resourceCoverage: {
          total: rows.length,
          processed: processed.length,
          pending: rows.length - processed.length,
        },
      });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      return ok({
        ...fallback,
        resourceCoverage: {
          total: rows.length,
          processed: processed.length,
          pending: rows.length - processed.length,
        },
      });
    }

    const topicMap = normalizeList(parsed.topicMap, 16);
    const rubricHints = normalizeList(parsed.rubricHints, 12);
    const misconceptions = normalizeList(parsed.misconceptions, 12);
    const vocabulary = normalizeList(parsed.vocabulary, 20);
    const examStructure = normalizeList(parsed.examStructure, 12);
    const guidelinesSummary =
      typeof parsed.guidelinesSummary === "string" && parsed.guidelinesSummary.trim().length > 0
        ? parsed.guidelinesSummary.trim().slice(0, 900)
        : fallback.guidelinesSummary;
    const systemPromptDraft =
      typeof parsed.systemPromptDraft === "string" && parsed.systemPromptDraft.trim().length > 0
        ? parsed.systemPromptDraft.trim()
        : fallback.systemPromptDraft;

    return ok({
      topicMap: topicMap.length > 0 ? topicMap : fallback.topicMap,
      rubricHints: rubricHints.length > 0 ? rubricHints : fallback.rubricHints,
      misconceptions: misconceptions.length > 0 ? misconceptions : fallback.misconceptions,
      vocabulary: vocabulary.length > 0 ? vocabulary : fallback.vocabulary,
      examStructure: examStructure.length > 0 ? examStructure : fallback.examStructure,
      guidelinesSummary,
      systemPromptDraft,
      resourceCoverage: {
        total: rows.length,
        processed: processed.length,
        pending: rows.length - processed.length,
      },
    });
  });
}

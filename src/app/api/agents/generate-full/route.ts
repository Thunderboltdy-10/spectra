import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

const SUBJECT_EMOJIS: Record<string, string> = {
  math: "🧮",
  science: "🔬",
  english: "📝",
  history: "🏛️",
  cs: "💻",
  languages: "🌍",
  arts: "🎨",
  economics: "📈",
  philosophy: "🤔",
  default: "🎓",
};

function pickAvatarEmoji(subjects: string[]): string {
  if (!subjects.length) return SUBJECT_EMOJIS.default;
  const first = subjects[0]?.toLowerCase() ?? "";
  return SUBJECT_EMOJIS[first] ?? SUBJECT_EMOJIS.default;
}

function buildFallbackResult(body: {
  audience?: string;
  goal?: string;
  purpose?: string;
  curriculum?: string;
  subjects?: string[];
  expertise?: string[];
  ibFocus?: string;
  level?: string;
  tone?: string;
  personality?: string;
  teachingStyle?: string;
  boundaries?: string[] | string;
  contextNotes?: string;
}) {
  const subjects = (body.expertise ?? body.subjects ?? ["general"]).filter(Boolean);
  const level = body.level ?? "Secondary";
  const tone = body.tone ?? body.personality ?? "Friendly coach";
  const teachingStyle = body.teachingStyle ?? "Step-by-step";
  const goal = body.goal ?? body.purpose ?? "Support user learning outcomes";
  const audience = body.audience ?? "Users";
  const boundaryList = Array.isArray(body.boundaries)
    ? body.boundaries
    : body.boundaries?.trim()
      ? [body.boundaries.trim()]
      : ["Do not fabricate facts or citations."];
  const curriculum = body.curriculum ?? "General Academic";
  const subjectLabel = subjects.join(", ");
  const ibLine = body.ibFocus?.trim() ? `\nIB focus: ${body.ibFocus.trim()}` : "";
  const contextLine = body.contextNotes?.trim() ? `\nAdditional context: ${body.contextNotes.trim()}` : "";

  const name = `${subjectLabel.split(",")[0]?.trim()} Learning Coach`;
  const description = `An AI learning agent for ${audience.toLowerCase()}, focused on ${subjectLabel} at ${level} level. ${goal.slice(0, 110)}.`;

  const systemPrompt = `You are an educational AI assistant designed for ${audience.toLowerCase()}, specializing in ${subjectLabel} at ${level} level.

Primary purpose:
${goal}

Target audience: ${audience}
Curriculum: ${curriculum}${ibLine}${contextLine}

Communication style:
- Tone: ${tone}
- Teaching approach: ${teachingStyle}

Instructional behaviour:
- Clarify the user's intent when the question is ambiguous.
- Use the "${teachingStyle}" approach in every response.
- Ask one check-for-understanding question after each key point when useful.
- Adapt your language to ${level}-level learners.

Boundaries:
${boundaryList.map((b) => `- ${b}`).join("\n")}

Formatting:
- Use headings and short bullet points where helpful.
- Include worked examples relevant to ${subjectLabel}.
- End every response with one concrete next step for the user.`;

  return {
    name,
    description,
    systemPrompt,
    suggestedMode: "tutor",
    suggestedCategory: subjects[0] ?? "General",
    avatarEmoji: pickAvatarEmoji(subjects),
  };
}

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();

    const body = (await request.json().catch(() => null)) as {
      audience?: string;
      goal?: string;
      curriculum?: string;
      ibFocus?: string;
      expertise?: string[];
      tone?: string;
      contextNotes?: string;
      purpose?: string;
      personality?: string;
      teachingStyle?: string;
      subjects?: string[];
      level?: string;
      boundaries?: string[] | string;
      builderStyle?: string;
    } | null;

    const goal = body?.goal?.trim() || body?.purpose?.trim();
    if (!goal) {
      return badRequest("goal is required");
    }

    const fallback = buildFallbackResult({
      ...body,
      goal,
    });

    if (!process.env.OPENROUTER_API_KEY) {
      return ok(fallback);
    }

    const systemInstruction = `You are an expert AI agent designer for an educational platform called AI School.
Given specifications from a user, generate a complete agent configuration that must stay faithful to the provided intent.
Do not invent a different storyline or domain than what is requested.
Output ONLY valid JSON with these exact keys:
{
  "name": "short creative agent name (2-4 words)",
  "description": "1-2 sentences describing what this agent does and for whom",
  "systemPrompt": "detailed multi-paragraph system prompt (220-420 words) covering persona, teaching style, boundaries, and formatting expectations",
  "suggestedMode": "one of: tutor, marker, exam, draft_coach, quiz, flashcard, research, explain, general",
  "suggestedCategory": "primary subject category string",
  "avatarEmoji": "single emoji that best represents this agent"
}
Do not include markdown fences, prose, or any text outside the JSON object.`;

    const userMessage = JSON.stringify({
      audience: body?.audience ?? "Users",
      goal,
      curriculum: body?.curriculum ?? "General Academic",
      ibFocus: body?.ibFocus ?? "",
      expertise: body?.expertise ?? body?.subjects ?? [],
      level: body?.level ?? "Secondary",
      tone: body?.tone ?? body?.personality ?? "Friendly coach",
      teachingStyle: body?.teachingStyle ?? "Step-by-step",
      boundaries: body?.boundaries ?? [],
      contextNotes: body?.contextNotes ?? "",
      builderStyle: body?.builderStyle ?? "conversation",
    });

    try {
      const completion = await openRouterChatCompletion({
        model: MODEL_CONFIG.smartCheap,
        fallbackModels: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker],
        temperature: 0.3,
        maxTokens: 1200,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userMessage },
        ],
      });

      const raw = completion.choices?.[0]?.message?.content ?? "{}";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return ok(fallback);
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      } catch {
        return ok(fallback);
      }

      return ok({
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : fallback.name,
        description:
          typeof parsed.description === "string" && parsed.description.trim()
            ? parsed.description.trim()
            : fallback.description,
        systemPrompt:
          typeof parsed.systemPrompt === "string" && parsed.systemPrompt.trim()
            ? parsed.systemPrompt.trim()
            : fallback.systemPrompt,
        suggestedMode:
          typeof parsed.suggestedMode === "string" && parsed.suggestedMode.trim()
            ? parsed.suggestedMode.trim()
            : fallback.suggestedMode,
        suggestedCategory:
          typeof parsed.suggestedCategory === "string" && parsed.suggestedCategory.trim()
            ? parsed.suggestedCategory.trim()
            : fallback.suggestedCategory,
        avatarEmoji:
          typeof parsed.avatarEmoji === "string" && parsed.avatarEmoji.trim()
            ? parsed.avatarEmoji.trim()
            : fallback.avatarEmoji,
      });
    } catch {
      return ok(fallback);
    }
  });
}

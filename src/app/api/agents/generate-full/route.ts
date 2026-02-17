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
  purpose?: string;
  subjects?: string[];
  level?: string;
  personality?: string;
  teachingStyle?: string;
  patience?: number;
  boundaries?: string[];
  strictness?: number;
}) {
  const subjects = body.subjects ?? ["general"];
  const level = body.level ?? "Secondary";
  const personality = body.personality ?? "Friendly";
  const teachingStyle = body.teachingStyle ?? "Step-by-step";
  const purpose = body.purpose ?? "Support student learning";
  const strictness = body.strictness ?? 3;

  const strictLabel = strictness >= 4 ? "strict" : strictness <= 2 ? "lenient" : "balanced";
  const subjectLabel = subjects.join(", ");

  const name = `${subjectLabel.split(",")[0]?.trim()} Tutor`;
  const description = `An AI tutor specialising in ${subjectLabel} for ${level}-level students. ${purpose.slice(0, 80)}.`;

  const systemPrompt = `You are an educational AI tutor specialising in ${subjectLabel} for ${level}-level students.

Primary purpose:
${purpose}

Communication style:
- Tone: ${personality}
- Teaching approach: ${teachingStyle}
- Patience level: ${body.patience ?? 3} out of 5

Instructional behaviour:
- Always clarify the student's question before answering.
- Use the "${teachingStyle}" approach in every response.
- Ask one check-for-understanding question after each key point.
- Adapt your language to ${level}-level learners.

Boundaries (${strictLabel} enforcement):
${(body.boundaries ?? ["Don't fabricate facts"]).map((b) => `- ${b}`).join("\n")}

Formatting:
- Use headings and short bullet points where helpful.
- Include worked examples relevant to ${subjectLabel}.
- End every response with one concrete next step for the student.`;

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
      purpose?: string;
      personality?: string;
      teachingStyle?: string;
      patience?: number;
      subjects?: string[];
      level?: string;
      boundaries?: string[];
      strictness?: number;
    } | null;

    if (!body?.purpose?.trim()) {
      return badRequest("purpose is required");
    }

    const fallback = buildFallbackResult(body);

    if (!process.env.OPENROUTER_API_KEY) {
      return ok(fallback);
    }

    const systemInstruction = `You are an expert AI agent designer for an educational platform called AI School.
Given specifications from a teacher or curriculum designer, generate a complete agent configuration.
Output ONLY valid JSON with these exact keys:
{
  "name": "short creative agent name (2-4 words)",
  "description": "1-2 sentences describing what this agent does and for whom",
  "systemPrompt": "detailed multi-paragraph system prompt (300-600 words) covering persona, teaching style, boundaries, and formatting expectations",
  "suggestedMode": "one of: tutor, marker, exam, draft_coach, quiz, flashcard, research, explain, general",
  "suggestedCategory": "primary subject category string",
  "avatarEmoji": "single emoji that best represents this agent"
}
Do not include markdown fences, prose, or any text outside the JSON object.`;

    const userMessage = JSON.stringify({
      purpose: body.purpose,
      personality: body.personality ?? "Friendly",
      teachingStyle: body.teachingStyle ?? "Step-by-step",
      patienceLevel: body.patience ?? 3,
      subjects: body.subjects ?? [],
      educationLevel: body.level ?? "Secondary",
      boundaries: body.boundaries ?? [],
      strictnessLevel: body.strictness ?? 3,
    });

    try {
      const completion = await openRouterChatCompletion({
        model: MODEL_CONFIG.tutorFast,
        fallbackModels: [MODEL_CONFIG.marker, MODEL_CONFIG.gptOss],
        temperature: 0.5,
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

import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { ok, badRequest } from "@/lib/http";

export const runtime = "nodejs";

type DiffOp = {
  type: "replace" | "insert" | "delete";
  from: number;
  to: number;
  content?: string;
  reason: string;
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const EDIT_MODEL = "anthropic/claude-haiku-4-5";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();

    const body = (await request.json()) as {
      instruction: string;
      document: object;
      documentText: string;
      noteId?: string;
      artifactId?: string;
      autoAccept?: boolean;
    };

    if (!body.instruction?.trim()) return badRequest("instruction is required");
    if (!body.documentText) return badRequest("documentText is required");

    const systemPrompt = `You are an AI document editor. Return ONLY a JSON object — no prose, no markdown.

The JSON must have:
- "ops": array of edit operations. Each op:
  - "type": "replace" | "insert" | "delete"
  - "from": character position start (integer, 0-indexed)
  - "to": character position end (integer)
  - "content": new text string (for replace/insert ops)
  - "reason": brief string explaining the change
- "summary": one sentence describing what changed

Rules:
- Be minimal — only change what the instruction asks for
- Preserve the author's voice and style
- Return valid JSON only`;

    const userPrompt = `Instruction: ${body.instruction}

Document:
"""
${body.documentText.slice(0, 8000)}
"""`;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return badRequest("OPENROUTER_API_KEY not configured");
    }

    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://spectra.ai",
        "X-Title": "Spectra AI Editor",
      },
      body: JSON.stringify({
        model: EDIT_MODEL,
        max_tokens: 2000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI request failed: ${errText}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const rawText = data.choices[0]?.message?.content ?? "{}";

    let parsed: { ops: DiffOp[]; summary: string };
    try {
      parsed = JSON.parse(rawText) as { ops: DiffOp[]; summary: string };
    } catch {
      parsed = { ops: [], summary: "Edit applied" };
    }

    if (!Array.isArray(parsed.ops)) parsed.ops = [];
    parsed.ops = parsed.ops.filter(
      (op) =>
        op &&
        typeof op.type === "string" &&
        typeof op.from === "number" &&
        typeof op.to === "number",
    );

    return ok(parsed);
  });
}

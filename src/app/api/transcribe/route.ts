import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const env = getEnv();
    if (!env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: "Transcription service not configured" }, { status: 503 });
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio");
    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const mimeType = audioFile.type || "audio/webm";

    // Attempt transcription with Whisper via the OpenRouter audio endpoint
    const openAiForm = new FormData();
    openAiForm.append(
      "file",
      new Blob([arrayBuffer], { type: mimeType }),
      `recording.${mimeType.split("/")[1]?.split(";")[0] ?? "webm"}`,
    );
    openAiForm.append("model", "openai/whisper-large-v3-turbo");
    openAiForm.append("language", "en");

    const transcribeResponse = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        ...(process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {}),
      },
      body: openAiForm,
    });

    if (transcribeResponse.ok) {
      const result = (await transcribeResponse.json()) as { text?: string };
      return NextResponse.json({ transcript: result.text ?? "" });
    }

    // Fallback: retry with the standard whisper model
    const fallbackForm = new FormData();
    fallbackForm.append(
      "file",
      new Blob([arrayBuffer], { type: mimeType }),
      `recording.${mimeType.split("/")[1]?.split(";")[0] ?? "webm"}`,
    );
    fallbackForm.append("model", "openai/whisper-large-v3");
    fallbackForm.append("language", "en");

    const fallbackResponse = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        ...(process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {}),
      },
      body: fallbackForm,
    });

    if (fallbackResponse.ok) {
      const fallbackResult = (await fallbackResponse.json()) as { text?: string };
      return NextResponse.json({ transcript: fallbackResult.text ?? "" });
    }

    return NextResponse.json({ error: "Transcription unavailable" }, { status: 502 });
  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}

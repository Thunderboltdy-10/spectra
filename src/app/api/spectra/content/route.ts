import { NextResponse } from "next/server";
import { storeArtifactContent } from "@/lib/convex-server";
import { requireActor } from "@/lib/auth-server";
import { MAX_DURABLE_PAYLOAD_BYTES } from "../../../../../shared/durable-content";

export async function POST(request: Request) {
  try {
    await requireActor();
    const artifactId = new URL(request.url).searchParams.get("artifactId");
    if (!artifactId || !request.body) throw new Error("CONTENT_UPLOAD_INVALID");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_DURABLE_PAYLOAD_BYTES) throw new Error("COLLABORATION_DURABLE_PAYLOAD_SIZE");
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const content = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return NextResponse.json(await storeArtifactContent(artifactId, content));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "CONTENT_UPLOAD_FAILED"}, {status:400});
  }
}

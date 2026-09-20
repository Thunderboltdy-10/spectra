import { NextResponse } from "next/server";
import { z } from "zod";
import { convexMutation } from "@/lib/convex-server";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("upload"), artifactId: z.string().min(1) }),
  z.object({ action: z.literal("adopt"), artifactId: z.string().min(1), storageId: z.string().min(1), digest: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive(), policyVersion: z.number().int(), dependencies: z.object({assetIds:z.array(z.string()).max(512),nativePayloadHashes:z.array(z.string()).max(512)}) }),
]);
export async function POST(request: Request) {
  try {
    const {action, ...args} = input.parse(await request.json());
    return NextResponse.json(await convexMutation(action === "upload" ? "artifactContent:issueUpload" : "artifactContent:adopt", args));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "CONTENT_UPLOAD_FAILED"}, {status:400});
  }
}

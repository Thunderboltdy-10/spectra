import { readFile } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { withRouteErrorHandling } from "@/lib/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ asset: string }> },
) {
  return withRouteErrorHandling(async () => {
    const { asset } = await context.params;
    if (asset !== "esbuild.wasm") {
      throw new Error("RUNTIME_ASSET_NOT_FOUND: This build asset is not available.");
    }
    const data = await readFile(
      join(process.cwd(), "node_modules", "esbuild-wasm", "esbuild.wasm"),
    );
    return new NextResponse(data, {
      headers: {
        "Content-Type": "application/wasm",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }, request);
}

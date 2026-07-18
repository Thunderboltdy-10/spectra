import { readFile } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { withRouteErrorHandling } from "@/lib/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSETS: Record<string, string> = {
  "pyodide.js": "text/javascript; charset=utf-8",
  "pyodide.mjs": "text/javascript; charset=utf-8",
  "pyodide.asm.mjs": "text/javascript; charset=utf-8",
  "pyodide.asm.wasm": "application/wasm",
  "python_stdlib.zip": "application/zip",
  "pyodide-lock.json": "application/json; charset=utf-8",
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ asset: string }> },
) {
  return withRouteErrorHandling(async () => {
    const { asset } = await context.params;
    const contentType = ASSETS[asset];
    if (!contentType)
      throw new Error(
        "RUNTIME_ASSET_NOT_FOUND: This runtime asset is not available.",
      );
    const data = await readFile(
      join(process.cwd(), "node_modules", "pyodide", asset),
    );
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }, request);
}

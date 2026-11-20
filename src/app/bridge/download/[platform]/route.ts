import { NextResponse } from "next/server";

/** The old address of the download, kept for links that still use it. */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const url = new URL(request.url);
  return NextResponse.redirect(new URL(`/desktop/download/${encodeURIComponent(platform)}${url.search}`, url), 308);
}

import { NextResponse } from "next/server";

/** The old address of the latest version, for pages still open from before. */
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/desktop/latest", request.url), 308);
}

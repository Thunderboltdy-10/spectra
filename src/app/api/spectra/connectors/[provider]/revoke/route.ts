import { NextRequest, NextResponse } from "next/server";
import { revokeOAuthConnection } from "@/features/spectra/connectors/core/oauth-worker";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  try {
    const body = (await request.json()) as { connectionId?: unknown };
    if (typeof body.connectionId !== "string")
      return NextResponse.json(
        { error: "connection_required" },
        { status: 400 },
      );
    const result = await revokeOAuthConnection({
      connectionId: body.connectionId,
      expectedProvider: provider,
    });
    return NextResponse.json({ data: result });
  } catch {
    return NextResponse.json(
      { error: "connection_revoke_failed" },
      { status: 409 },
    );
  }
}

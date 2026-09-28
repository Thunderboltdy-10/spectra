import { type NextRequest } from "next/server";
import { handleSpectraRunRequest } from "./runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return handleSpectraRunRequest(request);
}

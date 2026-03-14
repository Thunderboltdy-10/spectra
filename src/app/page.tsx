import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { LandingClient } from "./landing/landing-client";
import { requireActor } from "@/lib/auth-server";
import { hasClerkServerConfig } from "@/lib/clerk-config";

export const metadata: Metadata = {
  title: "AI School — The right tool for the right task",
  description:
    "Automatic AI orchestration for students and teachers. Every question routed to the right model, mode, and agent — instantly.",
};

function toQueryString(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") params.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default async function HomePage({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  if (hasClerkServerConfig()) {
    const authData = await auth();
    if (authData.userId) {
      try {
        await requireActor();
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith("AUTH_NO_ACCESS") || message.startsWith("AUTH_ORG_INACTIVE")) {
          redirect(message.startsWith("AUTH_ORG_INACTIVE") ? "/no-access?reason=inactive" : "/no-access");
        }
      }
      redirect(`/chat${toQueryString(searchParams)}`);
    }
  }
  return <LandingClient />;
}

import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { LandingClient } from "./landing/landing-client";
import { SignedInContinue } from "@/components/signed-in-continue";
import { hasClerkServerConfig } from "@/lib/clerk-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Spectra: connected learning work",
  description:
    "One place where documents, sources, plans and conversations stay aware of one another, so students, teachers and AI can work on the same thing at the same time.",
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

type HomePageSearchParams = Record<string, string | string[] | undefined>;

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<HomePageSearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};

  if (hasClerkServerConfig()) {
    const authData = await auth();
    if (authData.userId) {
      redirect(`/workspace${toQueryString(resolvedSearchParams)}`);
    }
  }
  return (
    <>
      <SignedInContinue to={`/workspace${toQueryString(resolvedSearchParams)}`} />
      <LandingClient />
    </>
  );
}

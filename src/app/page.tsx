import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { LandingClient } from "./landing/landing-client";

export const metadata: Metadata = {
  title: "AI School — The right tool for the right task",
  description:
    "Automatic AI orchestration for students and teachers. Every question routed to the right model, mode, and agent — instantly.",
};

export default async function HomePage() {
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    const authData = await auth();
    if (authData.userId) redirect("/chat");
  }
  return <LandingClient />;
}

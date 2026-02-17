"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { AgentBuilderForm } from "@/components/agents/agent-builder-form";
import { AppShell } from "@/components/layout/app-shell";

export default function NewAgentPage() {
  const router = useRouter();

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl">
        {/* Back link */}
        <Link
          href="/agents"
          className="mb-6 inline-flex cursor-pointer items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to agents
        </Link>

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Create a new agent</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Answer a few questions and we'll generate a fully configured AI tutor for your students.
          </p>
        </div>

        {/* Wizard card */}
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 sm:p-8">
          <AgentBuilderForm
            onCancelHref="/agents"
            onSubmit={async (values) => {
              const response = await fetch("/api/agents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values),
              });

              if (!response.ok) {
                throw new Error(await response.text());
              }

              const data = (await response.json()) as { agentId: string };
              toast.success("Agent created successfully");
              router.push(`/agents/${data.agentId}`);
            }}
          />
        </div>
      </div>
    </AppShell>
  );
}

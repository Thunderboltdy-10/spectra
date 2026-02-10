"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { AgentCard } from "@/components/agents/agent-card";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Agent } from "@/types";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const loadAgents = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("search", query.trim());
    if (category !== "all") params.set("category", category);

    const response = await fetch(`/api/agents?${params.toString()}`);
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = (await response.json()) as { agents: Agent[] };
    setAgents(data.agents);
  }, [category, query]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadAgents().catch((error) =>
        toast.error(error instanceof Error ? error.message : "Failed to load agents"),
      );
    }, 220);

    return () => clearTimeout(timeout);
  }, [loadAgents]);

  const categories = [
    "all",
    ...Array.from(new Set(agents.map((agent) => agent.category))).slice(0, 8),
  ];

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Custom Agents</h1>
          <p className="text-sm text-[var(--text-secondary)]">Browse, search, and launch classroom agents.</p>
        </div>
        <Button asChild>
          <Link href="/agents/new">
            <Plus className="mr-2 h-4 w-4" /> New agent
          </Link>
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents" className="pl-9" />
        </div>

        {categories.map((item) => (
          <Button
            key={item}
            type="button"
            variant={category === item ? "default" : "secondary"}
            size="sm"
            onClick={() => setCategory(item)}
          >
            {item === "all" ? "All" : item}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <AgentCard key={agent._id} agent={agent} />
        ))}
      </div>

      {agents.length === 0 && (
        <p className="rounded-[var(--radius-container)] border border-dashed border-[var(--border-default)] p-4 text-sm text-[var(--text-secondary)]">
          No agents found.
        </p>
      )}
    </AppShell>
  );
}

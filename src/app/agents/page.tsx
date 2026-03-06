"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { AgentCard } from "@/components/agents/agent-card";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Agent } from "@/types";

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticAgentScore(query: string, agent: Agent) {
  const cleanQuery = normalizeText(query);
  if (!cleanQuery) return 1;

  const haystack = normalizeText(
    [
      agent.name,
      agent.description,
      agent.category,
      agent.preferredMode ?? "",
      ...(agent.guidelinesTopicMap ?? []),
    ].join(" "),
  );

  if (!haystack) return 0;
  if (haystack.includes(cleanQuery)) return 1;

  const queryTokens = cleanQuery.split(" ").filter(Boolean);
  if (queryTokens.length === 0) return 1;

  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) hits += 1;
  }
  const coverage = hits / queryTokens.length;
  if (coverage >= 0.65) return 0.7 + coverage * 0.2;
  if (coverage >= 0.45) return 0.45 + coverage * 0.15;
  return 0;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [visibility, setVisibility] = useState<"all" | "public" | "private" | "shared">("all");

  const loadAgents = useCallback(async () => {
    const response = await fetch("/api/agents");
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = (await response.json()) as { agents: Agent[] };
    setAgents(data.agents);
  }, []);

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

  const filteredAgents = useMemo(() => {
    const next = agents
      .map((agent) => ({ agent, score: semanticAgentScore(query, agent) }))
      .filter(({ agent, score }) => {
        if (category !== "all" && agent.category !== category) return false;
        if (visibility !== "all" && agent.visibility !== visibility) return false;
        if (query.trim() && score <= 0) return false;
        return true;
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.agent.usageCount !== a.agent.usageCount) return b.agent.usageCount - a.agent.usageCount;
        return b.agent.updatedAt - a.agent.updatedAt;
      });
    return next.map((item) => item.agent);
  }, [agents, category, query, visibility]);

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3" data-tour="agents-header">
        <div>
          <h1 className="font-display text-2xl">Custom Agents</h1>
          <p className="text-sm text-[var(--text-secondary)]">Browse, search, and launch classroom agents.</p>
        </div>
        <Button asChild data-tour="agents-create">
          <Link href="/agents/new">
            <Plus className="mr-2 h-4 w-4" /> New agent
          </Link>
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" data-tour="agents-search">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            className="pl-9 focus-visible:border-[var(--border-default)] focus-visible:ring-0"
          />
        </div>

        <div className="flex flex-wrap gap-2" data-tour="agents-filters">
          {categories.map((item) => (
            <Button
              key={item}
              type="button"
              variant={category === item ? "default" : "secondary"}
              size="sm"
              onClick={() => setCategory(item)}
            >
              {item === "all" ? "All categories" : item}
            </Button>
          ))}
          {(["all", "public", "private", "shared"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={visibility === value ? "default" : "secondary"}
              size="sm"
              onClick={() => setVisibility(value)}
            >
              {value === "all" ? "All visibility" : value}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-tour="agents-grid">
        {filteredAgents.map((agent) => (
          <AgentCard key={agent._id} agent={agent} />
        ))}
      </div>

      {filteredAgents.length === 0 && (
        <p className="py-8 text-center text-sm text-[var(--text-secondary)]">
          No agents found.
        </p>
      )}
    </AppShell>
  );
}

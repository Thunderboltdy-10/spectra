import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Agent } from "@/types";

type AgentCardProps = {
  agent: Agent;
};

export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Link href={`/agents/${agent._id}`}>
      <Card className="h-full transition hover:-translate-y-0.5 hover:bg-[var(--bg-secondary)]">
        <CardHeader>
          <CardTitle className="text-base">
            {agent.avatarEmoji} {agent.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="line-clamp-3 text-[var(--text-secondary)]">{agent.description}</p>
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary">{agent.category}</Badge>
            <Badge variant="secondary">{agent.visibility}</Badge>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">Used {agent.usageCount.toLocaleString()} times</p>
        </CardContent>
      </Card>
    </Link>
  );
}

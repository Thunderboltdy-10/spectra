"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AgentBuilderForm } from "@/components/agents/agent-builder-form";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ModelOption = {
  modelId: string;
  name: string;
};

export default function NewAgentPage() {
  const router = useRouter();
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/models");
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as { models: Array<{ modelId: string; name: string }> };
        setModels(data.models);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load models");
      }
    })();
  }, []);

  return (
    <AppShell>
      <Card>
        <CardHeader>
          <CardTitle>Create Agent</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentBuilderForm
            models={models}
            submitLabel="Create agent"
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
              toast.success("Agent created");
              router.push(`/agents/${data.agentId}`);
            }}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}

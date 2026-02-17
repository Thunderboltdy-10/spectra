"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AgentEditForm } from "@/components/agents/agent-edit-form";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Agent } from "@/types";

type ResourceItem = {
  _id: string;
  filename: string;
  status: "uploaded" | "processed" | "failed";
  createdAt: number;
  parsedCharCount: number;
};

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    const [agentResponse, resourcesResponse] = await Promise.all([
      fetch(`/api/agents/${id}`),
      fetch(`/api/resources?scope=agent&agentId=${id}`),
    ]);

    if (!agentResponse.ok) throw new Error(await agentResponse.text());
    if (!resourcesResponse.ok) throw new Error(await resourcesResponse.text());

    const agentData = (await agentResponse.json()) as { agent: Agent };
    const resourcesData = (await resourcesResponse.json()) as { resources: ResourceItem[] };

    setAgent(agentData.agent);
    setResources(resourcesData.resources);
  }, [id]);

  useEffect(() => {
    void refresh().catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load agent"));
  }, [refresh]);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.set("scope", "agent");
      formData.set("agentId", id);
      for (const file of files) {
        formData.append("files", file);
      }

      const response = await fetch("/api/resources", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      toast.success(`Uploaded ${files.length} file(s) to this agent`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!agent) {
    return (
      <AppShell>
        <p className="text-sm text-[var(--text-secondary)]">Loading agent...</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href="/agents">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>

        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => {
            void (async () => {
              const response = await fetch(`/api/agents/${id}`, { method: "DELETE" });
              if (!response.ok) {
                toast.error(await response.text());
                return;
              }

              toast.success("Agent deleted");
              router.push("/agents");
            })();
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </Button>
      </div>

      <Tabs defaultValue="builder">
        <TabsList>
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
        </TabsList>

        <TabsContent value="builder">
          <Card>
            <CardHeader>
              <CardTitle>
                Edit Agent: {agent.avatarEmoji} {agent.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AgentEditForm
                submitLabel="Save changes"
                initialValues={{
                  name: agent.name,
                  description: agent.description,
                  systemPrompt: agent.systemPrompt,
                  avatarEmoji: agent.avatarEmoji,
                  category: agent.category,
                  visibility: agent.visibility,
                }}
                onSubmit={async (values) => {
                  const response = await fetch(`/api/agents/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(values),
                  });

                  if (!response.ok) {
                    throw new Error(await response.text());
                  }

                  toast.success("Agent updated");
                  await refresh();
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resources">
          <Card>
            <CardHeader>
              <CardTitle>Resources</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm font-medium">
                  <Upload className="h-4 w-4" />
                  {uploading ? "Uploading..." : "Upload PDFs/docs"}
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    disabled={uploading}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      void uploadFiles(files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <p className="text-xs text-[var(--text-secondary)]">
                  Uploading regenerates this agent&apos;s guideline summary.
                </p>
              </div>

              <div className="space-y-2">
                {resources.map((resource) => (
                  <div
                    key={resource._id}
                    className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{resource.filename}</p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {resource.status} • {resource.parsedCharCount.toLocaleString()} chars
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                      <Paperclip className="h-3 w-3" />
                      {new Date(resource.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}

                {resources.length === 0 && (
                  <p className="rounded-xl border border-dashed border-[var(--border-default)] p-4 text-sm text-[var(--text-secondary)]">
                    No resources uploaded yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

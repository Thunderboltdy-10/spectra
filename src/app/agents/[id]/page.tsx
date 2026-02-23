"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Paperclip, Search, Trash2, Upload, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { AgentEditForm } from "@/components/agents/agent-edit-form";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type CollaboratorUser = {
  _id: string;
  name: string;
  email: string;
  role: "student" | "teacher" | "admin";
};

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorUser[]>([]);
  const [collaboratorCandidates, setCollaboratorCandidates] = useState<CollaboratorUser[]>([]);
  const [collaboratorSearch, setCollaboratorSearch] = useState("");
  const [collaboratorLoading, setCollaboratorLoading] = useState(false);
  const [collaboratorMutatingId, setCollaboratorMutatingId] = useState<string | null>(null);
  const [canManageCollaborators, setCanManageCollaborators] = useState(false);

  const refresh = useCallback(async () => {
    const [agentResponse, resourcesResponse] = await Promise.all([
      fetch(`/api/agents/${id}`),
      fetch(`/api/resources?scope=agent&agentId=${id}`),
    ]);

    if (!agentResponse.ok) throw new Error(await agentResponse.text());

    const agentData = (await agentResponse.json()) as { agent: Agent };
    const resourcesData = resourcesResponse.ok
      ? ((await resourcesResponse.json()) as { resources: ResourceItem[] })
      : { resources: [] };

    setAgent(agentData.agent);
    setResources(resourcesData.resources);
  }, [id]);

  const loadCollaborators = useCallback(
    async (search: string) => {
      setCollaboratorLoading(true);
      try {
        const params = new URLSearchParams();
        const clean = search.trim();
        if (clean) params.set("search", clean);

        const response = await fetch(
          `/api/agents/${id}/collaborators${params.size > 0 ? `?${params.toString()}` : ""}`,
        );
        if (!response.ok) throw new Error(await response.text());

        const data = (await response.json()) as {
          collaborators: CollaboratorUser[];
          candidates: CollaboratorUser[];
          canManage: boolean;
        };
        setCollaborators(data.collaborators ?? []);
        setCollaboratorCandidates(data.candidates ?? []);
        setCanManageCollaborators(Boolean(data.canManage));
      } finally {
        setCollaboratorLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void refresh().catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load agent"));
  }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCollaborators(collaboratorSearch).catch((error) =>
        toast.error(error instanceof Error ? error.message : "Failed to load collaborators"),
      );
    }, 180);

    return () => window.clearTimeout(timer);
  }, [collaboratorSearch, loadCollaborators]);

  async function inviteCollaborator(userId: string) {
    setCollaboratorMutatingId(userId);
    try {
      const response = await fetch(`/api/agents/${id}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) throw new Error(await response.text());

      toast.success("Collaborator invited");
      await Promise.all([refresh(), loadCollaborators(collaboratorSearch)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to invite collaborator");
    } finally {
      setCollaboratorMutatingId(null);
    }
  }

  async function removeCollaborator(userId: string) {
    setCollaboratorMutatingId(userId);
    try {
      const response = await fetch(`/api/agents/${id}/collaborators`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) throw new Error(await response.text());

      toast.success("Collaborator removed");
      await Promise.all([refresh(), loadCollaborators(collaboratorSearch)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove collaborator");
    } finally {
      setCollaboratorMutatingId(null);
    }
  }

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

        {canManageCollaborators && (
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
        )}
      </div>

      <Tabs defaultValue="builder">
        <TabsList>
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
        </TabsList>

        <TabsContent value="builder">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>Edit Agent:</span>
                <AgentAvatar avatarIcon={agent.avatarIcon} avatarEmoji={agent.avatarEmoji} category={agent.category} />
                <span className="truncate">{agent.name}</span>
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
                  avatarIcon: agent.avatarIcon,
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

              <div className="mt-7 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Collaborators</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Invite same-school users to co-edit this agent.
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                    {collaborators.length} collaborator{collaborators.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="space-y-2">
                  {collaborators.map((user) => (
                    <div
                      key={user._id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{user.name}</p>
                        <p className="truncate text-xs text-[var(--text-secondary)]">
                          {user.email} · {user.role}
                        </p>
                      </div>
                      {canManageCollaborators && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={collaboratorMutatingId === user._id}
                          onClick={() => void removeCollaborator(user._id)}
                          className="cursor-pointer gap-1.5"
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                  {collaborators.length === 0 && (
                    <p className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                      No collaborators yet.
                    </p>
                  )}
                </div>

                <div className="mt-4 border-t border-[var(--border-default)] pt-4">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    Search by name or email
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
                    <Input
                      value={collaboratorSearch}
                      onChange={(event) => setCollaboratorSearch(event.target.value)}
                      placeholder="e.g. maria@school.edu"
                      className="pl-9"
                    />
                  </div>

                  <div className="mt-3 space-y-2">
                    {collaboratorLoading ? (
                      <p className="text-xs text-[var(--text-secondary)]">Searching users...</p>
                    ) : collaboratorCandidates.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                        No matching users available to invite.
                      </p>
                    ) : (
                      collaboratorCandidates.map((user) => (
                        <div
                          key={user._id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[var(--text-primary)]">{user.name}</p>
                            <p className="truncate text-xs text-[var(--text-secondary)]">
                              {user.email} · {user.role}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={!canManageCollaborators || collaboratorMutatingId === user._id}
                            onClick={() => void inviteCollaborator(user._id)}
                            className="cursor-pointer gap-1.5"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            Invite
                          </Button>
                        </div>
                      ))
                    )}
                  </div>

                  {!canManageCollaborators && (
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">
                      Only the agent owner or an admin can manage collaborators.
                    </p>
                  )}
                </div>
              </div>
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
                <label
                  className={`inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm font-medium ${
                    canManageCollaborators
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? "Uploading..." : "Upload PDFs/docs"}
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    disabled={uploading || !canManageCollaborators}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      void uploadFiles(files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <p className="text-xs text-[var(--text-secondary)]">
                  {canManageCollaborators
                    ? "Uploading regenerates this agent's guideline summary."
                    : "Only the agent owner or an admin can upload resources."}
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

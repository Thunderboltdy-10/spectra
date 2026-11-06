import { AgentLibraryShell } from "@/features/spectra/pages/agent-library-shell";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <AgentLibraryShell initialAgentId={agentId} />;
}

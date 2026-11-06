import { redirect } from "next/navigation";
import { workspaceHref } from "@/features/spectra/pages/shell-location";

export const dynamic = "force-dynamic";

/** A workspace is a place in the Library; old links land there. */
export default async function WorkspaceByIdPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  redirect(workspaceHref(workspaceId));
}

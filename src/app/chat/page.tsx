import { redirect } from "next/navigation";
import { HOME_PATH } from "@/features/spectra/chat/home-routes";

export const dynamic = "force-dynamic";

/** Conversations live on Home now; an old link to one still arrives. */
export default async function ChatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  params.delete("new");
  const query = params.toString();
  redirect(query ? `${HOME_PATH}?${query}` : HOME_PATH);
}

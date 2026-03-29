import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NotesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = (await props.searchParams) ?? {};
  const next = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(searchParams)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (typeof value !== "string") continue;
      if (key === "note") {
        next.set("id", value);
      } else {
        next.append(key, value);
      }
    }
  }

  const query = next.toString();
  redirect(query ? `/artifacts?${query}` : "/artifacts");
}

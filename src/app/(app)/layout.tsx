import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

/* One shell for the whole app: the rail, the island and the running work stay put while pages change under them. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

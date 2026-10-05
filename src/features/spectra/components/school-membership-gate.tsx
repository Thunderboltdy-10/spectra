import "server-only";

import type { ReactNode } from "react";
import Link from "next/link";
import { School } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { ProductEmptyState } from "./product-state";
import { isAuthNoSchool, requireActor } from "@/lib/auth-server";

/** Keep school readers unmounted until the account has a current membership. */
export async function SchoolMembershipGate({ children }: { children: ReactNode }) {
  try {
    await requireActor({ fresh: true });
  } catch (error) {
    if (!isAuthNoSchool(error)) throw error;
    return (
      <main className="grid h-full min-h-0 place-items-center overflow-y-auto px-6 py-12">
        <ProductEmptyState
          icon={School}
          title="Join your school to view school data"
          detail="You are signed in. Accept your school invitation to view school records and integrations."
          action={
            <Button variant="primary" size="sm" asChild>
              <Link href="/join">Open invitation</Link>
            </Button>
          }
        />
      </main>
    );
  }
  return children;
}

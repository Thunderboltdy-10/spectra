"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ErrorScreen } from "@/components/global-error-boundary";

/**
 * Server-rendered page failures (Clerk or Convex unavailable while a page
 * loads) never reach the client boundary in Providers; without this file
 * Next shows its unstyled "Application error" page with no way back.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error("[RouteError]", error.digest ?? "", error);
  }, [error]);
  return (
    <ErrorScreen
      error={error}
      onRetry={() =>
        // A server failure only clears once the segment is fetched again.
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
    />
  );
}

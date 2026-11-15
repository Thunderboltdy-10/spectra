/**
 * Whether Setup still stands before the app. Every account goes through it
 * once, including those made before it existed; finishing it marks it done.
 * An account that already took the tour is not shown the tour again.
 */
export function setupDue(integrations: { setupStatus: "pending" | "done"; tourStatus: "pending" | "done" }) {
  return integrations.setupStatus === "pending";
}

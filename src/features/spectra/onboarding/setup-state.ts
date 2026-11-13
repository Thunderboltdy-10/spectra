/**
 * Whether Setup still stands before the app. An account that finished the
 * tour before Setup existed is past it: Setup is for new accounts.
 */
export function setupDue(integrations: { setupStatus: "pending" | "done"; tourStatus: "pending" | "done" }) {
  return integrations.setupStatus === "pending" && integrations.tourStatus !== "done";
}

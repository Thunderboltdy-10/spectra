export type MetricScope = "account_private" | "school_aggregate" | "platform_aggregate";

export type SpectraMetricDefinition = {
  id: string;
  label: string;
  scope: MetricScope;
  source: string;
  query: string;
  aggregation: string;
  filters: readonly string[];
  zeroMeaning: string;
  freshness: string;
  instrumentation: "direct_records" | "operational_counter" | "usage_meter";
  excludes: readonly string[];
};

function defineMetric(definition: SpectraMetricDefinition) {
  return Object.freeze(definition);
}

export const SPECTRA_METRIC_REGISTRY = Object.freeze([
  defineMetric({ id: "account.work_created", label: "Work created", scope: "account_private", source: "spectraArtifactSummaries.by_account_created", query: "analytics:personalOverview", aggregation: "Count non-deleted work created in the selected range, excluding legacy timetable records.", filters: ["from", "to"], zeroMeaning: "The account created no work in the selected range.", freshness: "Computed on request from indexed records.", instrumentation: "direct_records", excludes: ["content", "textIndex"] }),
  defineMetric({ id: "account.active_workspaces", label: "Active workspaces", scope: "account_private", source: "spectraWorkspaces.by_account_status_activity", query: "analytics:personalOverview", aggregation: "Count active workspaces with activity in the selected range.", filters: ["from", "to"], zeroMeaning: "No active workspace recorded activity in the selected range.", freshness: "Computed on request from indexed records.", instrumentation: "direct_records", excludes: ["workspace content"] }),
  defineMetric({ id: "account.ai_runs", label: "AI runs", scope: "account_private", source: "spectraAnalyticsRunSummaries.by_account_created", query: "analytics:personalOverview", aggregation: "Count account-owned runs created in the selected range.", filters: ["from", "to"], zeroMeaning: "No AI runs were created in the selected range.", freshness: "Computed on request from indexed records.", instrumentation: "direct_records", excludes: ["userPrompt", "contextSnapshot"] }),
  defineMetric({ id: "account.ai_completion_rate", label: "Completion rate", scope: "account_private", source: "spectraAnalyticsRunSummaries.by_account_created", query: "analytics:personalOverview", aggregation: "Completed runs divided by completed, failed, and cancelled runs.", filters: ["from", "to"], zeroMeaning: "No settled run exists in the selected range.", freshness: "Computed on request from indexed records.", instrumentation: "direct_records", excludes: ["userPrompt", "contextSnapshot"] }),
  defineMetric({ id: "account.model_tokens", label: "Model tokens", scope: "account_private", source: "usageMeters.by_account_day", query: "analytics:personalOverview", aggregation: "Sum model input and output token meters for the account.", filters: ["fromDay", "toDay"], zeroMeaning: "Zero is shown only when metering rows exist; missing instrumentation is partial, not zero.", freshness: "Daily meter materialization; last computed time is displayed.", instrumentation: "usage_meter", excludes: ["prompt text", "response text"] }),
  defineMetric({ id: "account.collaboration_bytes", label: "Collaboration traffic", scope: "account_private", source: "usageMeters.by_account_day", query: "analytics:personalOverview", aggregation: "Sum collaboration byte meters for the account.", filters: ["fromDay", "toDay"], zeroMeaning: "Zero is shown only when metering rows exist; missing instrumentation is partial, not zero.", freshness: "Daily meter materialization; last computed time is displayed.", instrumentation: "usage_meter", excludes: ["document updates", "presence payloads"] }),

  defineMetric({ id: "school.members", label: "Members", scope: "school_aggregate", source: "schoolMemberships.by_school_status + accounts", query: "administration:schoolOverview", aggregation: "Count active memberships whose account remains active.", filters: ["schoolId"], zeroMeaning: "The school has no active members.", freshness: "Computed on request.", instrumentation: "direct_records", excludes: ["private account activity"] }),
  defineMetric({ id: "school.active_30d", label: "Active in 30 days", scope: "school_aggregate", source: "schoolMemberships.by_school_status + accounts.lastSeenAt", query: "administration:schoolOverview", aggregation: "Count active school members seen within 30 days.", filters: ["schoolId", "rolling30d"], zeroMeaning: "No active member was seen during the rolling window.", freshness: "Computed on request from last-seen metadata.", instrumentation: "direct_records", excludes: ["page history", "content"] }),
  defineMetric({ id: "school.invitations", label: "Pending invitations", scope: "school_aggregate", source: "membershipInvitations.by_school_status", query: "administration:schoolOverview", aggregation: "Count pending invitations.", filters: ["schoolId", "status=pending"], zeroMeaning: "No invitation is awaiting response.", freshness: "Computed on request.", instrumentation: "direct_records", excludes: ["invitation token"] }),
  defineMetric({ id: "school.pending_approvals", label: "Pending approvals", scope: "school_aggregate", source: "schoolRequests.by_school_status", query: "administration:schoolOverview", aggregation: "Count open school requests.", filters: ["schoolId", "status=open"], zeroMeaning: "No school request is awaiting review.", freshness: "Computed on request.", instrumentation: "direct_records", excludes: ["unrelated request detail"] }),
  defineMetric({ id: "school.groups", label: "Groups", scope: "school_aggregate", source: "schoolGroups.by_school_status", query: "administration:schoolOverview", aggregation: "Count active groups.", filters: ["schoolId", "status=active"], zeroMeaning: "No active groups exist.", freshness: "Computed on request.", instrumentation: "direct_records", excludes: ["member private data"] }),
  defineMetric({ id: "school.class_workspaces", label: "Class workspaces", scope: "school_aggregate", source: "spectraWorkspaces.by_school_starter_status", query: "administration:schoolOverview", aggregation: "Count active ManageBac class workspaces.", filters: ["schoolId", "starterKey=managebac-class", "status=active"], zeroMeaning: "No class workspace has been materialized.", freshness: "Computed on request.", instrumentation: "direct_records", excludes: ["work content"] }),
  defineMetric({ id: "school.feedback_new", label: "New reports", scope: "school_aggregate", source: "feedbackReports.by_school_status", query: "administration:schoolOverview", aggregation: "Count new school feedback reports.", filters: ["schoolId", "status=new"], zeroMeaning: "No new feedback report awaits triage.", freshness: "Computed on request.", instrumentation: "direct_records", excludes: ["feedback message from summary card"] }),
  ...(["work_created", "thread_messages", "ai_runs"] as const).map((metric) => defineMetric({ id: `school.${metric}`, label: metric.replaceAll("_", " "), scope: "school_aggregate", source: "operationalCounters.by_school_day", query: "administration:schoolOverview", aggregation: `Sum the school ${metric} operational counter in the selected range.`, filters: ["schoolId", "fromDay", "toDay"], zeroMeaning: "Null means instrumentation is absent; zero requires counter rows in the range.", freshness: "Daily operational counter; complete-through date is displayed.", instrumentation: "operational_counter", excludes: ["content", "prompt text"] })),

  defineMetric({ id: "platform.active_schools", label: "Active schools", scope: "platform_aggregate", source: "schools.by_status", query: "administration:platformOverview", aggregation: "Count schools with active status.", filters: ["status=active"], zeroMeaning: "No active school exists.", freshness: "Computed on request.", instrumentation: "direct_records", excludes: ["school content"] }),
  defineMetric({ id: "platform.total_users", label: "Total users", scope: "platform_aggregate", source: "accounts.by_status", query: "administration:platformOverview", aggregation: "Count active accounts.", filters: ["status=active"], zeroMeaning: "No active account exists.", freshness: "Computed on request.", instrumentation: "direct_records", excludes: ["email", "profile", "content"] }),
  defineMetric({ id: "platform.active_users_30d", label: "Active users in 30 days", scope: "platform_aggregate", source: "accounts.by_status + lastSeenAt", query: "administration:platformOverview", aggregation: "Count active accounts seen within 30 days.", filters: ["status=active", "rolling30d"], zeroMeaning: "No active account was seen in 30 days.", freshness: "Computed on request.", instrumentation: "direct_records", excludes: ["navigation history", "content"] }),
  ...(["work_created", "messages", "retention", "storage", "integration_health", "feedback", "failed_runs", "open_requests"] as const).map((metric) => defineMetric({ id: `platform.${metric}`, label: metric.replaceAll("_", " "), scope: "platform_aggregate", source: metric === "storage" ? "usageMeters.by_account_day" : metric === "integration_health" ? "schoolIntegrations.by_status" : metric === "feedback" ? "feedbackReports.by_status" : metric === "open_requests" ? "schoolRequests.by_status" : metric === "retention" ? "accounts.by_status + lastSeenAt" : "operationalCounters.by_day_category", query: "administration:platformOverview", aggregation: `Platform aggregate for ${metric.replaceAll("_", " ")} from indexed records or counters.`, filters: ["fromDay", "toDay"], zeroMeaning: "Zero is meaningful only for direct indexed records or when instrumentation rows exist; otherwise the value is null/unknown.", freshness: "Computed on request; meter/counter coverage is bounded by complete-through date.", instrumentation: metric === "storage" ? "usage_meter" : ["work_created", "messages", "failed_runs"].includes(metric) ? "operational_counter" : "direct_records", excludes: ["private prompts", "threads", "memory", "work content"] })),
] satisfies readonly SpectraMetricDefinition[]);

const BY_ID = new Map(SPECTRA_METRIC_REGISTRY.map((metric) => [metric.id, metric]));

export function metricDefinition(id: string) {
  const definition = BY_ID.get(id);
  if (!definition) throw new Error(`Unregistered displayed metric: ${id}`);
  return definition;
}

export function metricSourceLabel(definition: SpectraMetricDefinition) {
  if (definition.instrumentation === "usage_meter") return "Daily usage meter";
  if (definition.instrumentation === "operational_counter")
    return "Daily operational counters";
  return "Product records";
}

import type { ModelOperation, SpectraPlan } from "@/features/spectra/operations/schema";

export type Surface = "chat" | "workspace" | "artifacts" | "artifact";

export type StagedCandidateDisposition = "accepted" | "needs_revalidation" | "withdrawn";

/** Authenticated server restoration of a request paused for clarification.
 * Candidates are unexecuted proposals, never a client supplied write grant. */
export type RestoredClarification = {
  originalRequest: string;
  clarificationResponses: string[];
  candidates: Array<{ operation: unknown; disposition: StagedCandidateDisposition }>;
  candidatesOmitted: boolean;
};

/** One staged position of a clarifying run, in its stable index space. */
export type ParkedCandidate = {
  operation: ModelOperation;
  disposition: StagedCandidateDisposition;
  /** Unchanged restored candidate: keeps its original source evidence. */
  carried?: boolean;
};

export type HarnessAnswerInput =
  | { kind: "approval"; allowed: boolean; alwaysAllow?: boolean }
  | { kind: "question"; choiceKey?: string; text?: string };

export type Body = {
  action?:
    | "run"
    | "answer"
    | "steer"
    | "retry"
    | "confirm"
    | "cancel"
    | "stop"
    | "revert"
    | "clear_agent"
    | "scheduled_run"
    | "scheduled_resume"
    | "ui_observer"
    | "ui_observer_ack";
  uiObserver?: { clientId: string; mode: "ordinary" | "follow" };
  prompt?: string;
  surface?: Surface;
  workspaceId?: string;
  scopeNodeId?: string;
  artifactId?: string;
  threadId?: string;
  runId?: string;
  executionId?: string;
  /** The open question or approval this answer is for. */
  toolCallId?: string;
  answer?: HarnessAnswerInput;
  /** A steer: a message typed while the run works, read at its next turn. */
  text?: string;
  /** The user's IANA time zone, for dates and the calendar. */
  timeZone?: string;
  attachments?: AttachmentInput[];
  currentView?: string;
  submissionKey?: string;
  agentId?: string;
  actorClerkId?: string;
  resultCardId?: string;
  payload?: Record<string, unknown>;
};

export type AttachmentInput = {
  id?: string;
  assetId?: string;
  importId?: string;
  sourceRef?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  handling?: "pdf" | "text" | "docx" | "xlsx" | "pptx" | "image";
  data?: string;
};

export type PreparedAttachment = {
  id?: string;
  name: string;
  mimeType: string;
  size: number;
  handling: "pdf" | "text" | "docx" | "xlsx" | "pptx" | "image";
  data?: string;
  extractedText?: string;
  pageCount?: number;
  structuredRepresentation?: { kind: string; value: unknown };
  sourceMap?: Array<{
    kind: "page" | "slide" | "sheet" | "range" | "section";
    label: string;
    startOffset?: number;
    endOffset?: number;
  }>;
  warnings?: Array<{ code: string; message: string }>;
  provenance?: {
    source: "user_upload" | "integration" | "linked_work" | "research";
    originalFileId: string;
    originalName: string;
    originalMimeType: string;
    originalBytes: number;
    preparedAt: string;
    extractor: string;
  };
};

export type StoredOperation = {
  _id: string;
  _creationTime?: number;
  executionId?: string;
  type: string;
  input: unknown;
  status:
    "proposed" | "executing" | "waiting" | "executed" | "failed" | "cancelled";
  affected?: Array<{ type: string; id: string }>;
  output?: unknown;
  requiresConfirmation?: boolean;
  pendingArtifactId?: string;
  pendingWorkspaceId?: string;
};

export type ResultAction = {
  key: string;
  label: string;
  targetType?: "artifact" | "thread" | "run" | "workspace";
  targetId?: string;
};

export type Card = {
  _id: string;
  runId: string;
  status:
    | "queued"
    | "running"
    | "awaiting_confirmation"
    | "awaiting_resolution"
    | "completed"
    | "failed"
    | "cancelled";
  title: string;
  summary?: string;
  variant: "status" | "artifact" | "thread" | "operation" | "error";
  actions: ResultAction[];
  provenance?: unknown;
  updatedAt: number;
};

export type RunState = {
  status: Card["status"];
  sourceSurface: "chat" | "workspace" | "artifact";
  threadId?: string;
  workspaceId?: string;
  scopeNodeId?: string;
  artifactId?: string;
  userPrompt: string;
  finalSummary?: string;
  decision?: SpectraPlan["decision"];
  planIntent?: unknown;
  executionId?: string;
  workerId?: string;
  approval?: {
    executionId: string;
    status: "pending" | "accepted" | "rejected" | "revised";
  };
  selectedAgentId?: string;
  selectedAgentVersionId?: string;
  agentRouting?: {
    confidence: number;
    reason: string;
    source: "automatic" | "continued" | "explicit";
    reversible: boolean;
  };
  contextSnapshot?: {
    scopeNodeId?: string;
    currentView?: string;
    requestedAgentId?: string;
    disableAgentRouting?: boolean;
    researchEvidence?: unknown;
    qualityRequirements?: { numericSourceRequired: boolean };
  };
};

export type RunDetail = {
  run: RunState;
  cards: Card[];
  operations: StoredOperation[];
};

export type RetryReset = {
  runId: string;
  resultCardId?: string;
  prompt: string;
  workspaceId?: string;
  scopeNodeId?: string;
  artifactId?: string;
  sourceSurface: RunState["sourceSurface"];
  executionId: string;
  previousExecutionId: string;
  created: boolean;
  contextSnapshot?: RunState["contextSnapshot"];
  /** The answered run when this run continues a clarification. */
  continuationRunId?: string;
};

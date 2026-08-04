import { z } from "zod";

const optionSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  recommended: z.boolean().optional(),
});

const baseRequest = z.object({
  id: z.string().min(1).max(200),
  prompt: z.string().min(1).max(1_000),
  reason: z.string().max(600).optional(),
  cancellation: z.enum(["cancel_run", "skip", "use_default"]),
  defaultValue: z.unknown().optional(),
  allowOther: z.boolean().optional(),
});

export const userInputRequestSchema = z.discriminatedUnion("kind", [
  baseRequest.extend({ kind: z.literal("choice"), options: z.array(optionSchema).min(2).max(8) }),
  baseRequest.extend({ kind: z.literal("multiple_choice"), options: z.array(optionSchema).min(2).max(12), minSelections: z.number().int().nonnegative().default(0), maxSelections: z.number().int().positive().optional() }),
  baseRequest.extend({ kind: z.literal("short_answer"), placeholder: z.string().max(240).optional(), maxLength: z.number().int().positive().max(8_000).default(2_000) }),
  baseRequest.extend({ kind: z.literal("file"), accept: z.array(z.string().min(1)).max(20), multiple: z.boolean().default(false) }),
  baseRequest.extend({ kind: z.literal("context_target"), targetKinds: z.array(z.string().min(1)).min(1).max(20), multiple: z.boolean().default(false) }),
  baseRequest.extend({ kind: z.literal("confirmation"), confirmLabel: z.string().min(1).max(120), destructive: z.boolean().default(false) }),
  baseRequest.extend({ kind: z.literal("permission"), capability: z.string().min(1).max(160), scope: z.string().max(300).optional() }),
  baseRequest.extend({ kind: z.literal("comparison"), options: z.array(optionSchema).min(2).max(6), multiSelect: z.boolean().default(false) }),
]);

export type UserInputRequest = z.infer<typeof userInputRequestSchema>;

export type UserInputResponse = {
  requestId: string;
  value: unknown;
  respondedAt: number;
  cancelled?: boolean;
};

export class UserInputStore {
  private readonly requests = new Map<string, UserInputRequest>();
  private readonly responses = new Map<string, UserInputResponse>();

  request(input: UserInputRequest) {
    const parsed = userInputRequestSchema.parse(input);
    this.requests.set(parsed.id, parsed);
    return parsed;
  }

  respond(response: UserInputResponse) {
    const request = this.requests.get(response.requestId);
    if (!request) throw new Error("RUN_INPUT_REQUEST_UNKNOWN");
    if (this.responses.has(response.requestId)) return this.responses.get(response.requestId)!;
    if (!Number.isFinite(response.respondedAt)) throw new Error("RUN_INPUT_RESPONSE_TIME_INVALID");
    if (!response.cancelled) this.validateValue(request, response.value);
    const parsed = { ...response };
    this.responses.set(response.requestId, parsed);
    return parsed;
  }

  pending() {
    return [...this.requests.values()].filter((request) => !this.responses.has(request.id));
  }

  response(requestId: string) {
    return this.responses.get(requestId) ?? null;
  }

  snapshot() {
    return {
      version: 2 as const,
      requests: [...this.requests.values()],
      responses: [...this.responses.values()],
    };
  }

  static restore(snapshot: { version: number; requests: unknown[]; responses: UserInputResponse[] }) {
    if (snapshot.version !== 2) throw new Error("RUN_INPUT_SNAPSHOT_VERSION_UNSUPPORTED");
    const store = new UserInputStore();
    for (const request of snapshot.requests) store.request(userInputRequestSchema.parse(request));
    for (const response of snapshot.responses) store.respond(response);
    return store;
  }

  private validateValue(request: UserInputRequest, value: unknown) {
    const selection = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).selection
      : value;
    const optionIds = "options" in request ? new Set(request.options.map((option) => option.id)) : new Set<string>();
    if (request.kind === "choice" || (request.kind === "comparison" && !request.multiSelect)) {
      if (typeof selection !== "string" || (!optionIds.has(selection) && !(request.allowOther !== false && selection === "other")))
        throw new Error("RUN_INPUT_CHOICE_INVALID");
      return;
    }
    if (request.kind === "multiple_choice" || (request.kind === "comparison" && request.multiSelect)) {
      if (!Array.isArray(selection) || selection.some((id) => typeof id !== "string" || (!optionIds.has(id) && !(request.allowOther !== false && id === "other"))))
        throw new Error("RUN_INPUT_SELECTION_INVALID");
      const minimum = request.kind === "multiple_choice" ? request.minSelections : 0;
      const maximum = request.kind === "multiple_choice" ? request.maxSelections : undefined;
      if (selection.length < minimum || (maximum !== undefined && selection.length > maximum))
        throw new Error("RUN_INPUT_SELECTION_COUNT_INVALID");
      return;
    }
    if (request.kind === "short_answer") {
      if (typeof value !== "string" || value.length > request.maxLength) throw new Error("RUN_INPUT_ANSWER_INVALID");
      return;
    }
    if (request.kind === "confirmation" || request.kind === "permission") {
      if (typeof value !== "boolean") throw new Error("RUN_INPUT_BOOLEAN_INVALID");
      return;
    }
    if (request.kind === "file") {
      const files = request.multiple ? value : [value];
      if (!Array.isArray(files) || files.length === 0 || files.some((file) => !file || typeof file !== "object"))
        throw new Error("RUN_INPUT_FILE_INVALID");
      return;
    }
    if (request.kind === "context_target") {
      const targets = request.multiple ? value : [value];
      if (!Array.isArray(targets) || targets.length === 0 || targets.some((target) => !target || typeof target !== "object"))
        throw new Error("RUN_INPUT_TARGET_INVALID");
    }
  }
}

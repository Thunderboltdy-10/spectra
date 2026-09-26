import { z } from "zod";
import { observedActionIdentitySchema } from "@/features/spectra/actions/protocol/semantic-action";
import { mutate, query } from "./io";
import { notifyUiObservation } from "./ui-observation";

const observer = z.object({ clientId: z.string().trim().min(1).max(120), mode: z.enum(["ordinary", "follow"]) }).strict();
export const uiObserverSchema = observer;
const interest = z.object({
  runId: z.string().min(1).max(200), executionId: z.string().min(1).max(200),
  clientId: z.string().trim().min(1).max(120), mode: z.enum(["ordinary", "follow", "released"]),
  operationId: z.string().min(1).max(200).optional(),
  releaseCurrent: z.boolean().optional(),
}).strict();
const acknowledgement = z.object({
  identity: observedActionIdentitySchema,
  observer,
  outcome: z.enum(["target_ready", "invisible", "released"]).optional(),
}).strict();

/** Called only after runtime requireActor. These actions cannot confirm a run
 * or select a mutation; Convex authenticates the same current owner again. */
export async function handleUiObserverRequest(action: "ui_observer" | "ui_observer_ack", payload: unknown) {
  try {
    if (action === "ui_observer") {
      const input = interest.parse(payload);
      const result = await mutate<typeof input, { observation?: unknown }>("spectraOperations:setUiObserverInterest", input);
      if (input.operationId && result.observation)
        notifyUiObservation({ ...input, operationId: input.operationId }, result.observation);
      return Response.json(result);
    }
    const input = acknowledgement.parse(payload);
    const { runId, executionId, operationId, ...fence } = input.identity;
    const identity = { runId, executionId, operationId };
    const result = input.outcome
      ? await mutate("spectraOperations:acknowledgeUiAction", { ...identity, fence, observer: input.observer, outcome: input.outcome })
      : await query("spectraOperations:readUiAction", identity);
    if (input.outcome) notifyUiObservation(identity, result);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "Invalid observer request" : "This observed action is no longer available." }, { status: error instanceof z.ZodError ? 400 : 409 });
  }
}

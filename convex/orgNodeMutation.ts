import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "./_generated/dataModel";
import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
} from "./_generated/server";
import { orgNodeAggregates } from "./orgNodeAggregates";

const triggers = new Triggers<DataModel>();
for (const aggregate of orgNodeAggregates)
  triggers.register("orgNodes", aggregate.idempotentTrigger());

export const mutation = customMutation(
  rawMutation,
  customCtx(triggers.wrapDB),
);

export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(triggers.wrapDB),
);

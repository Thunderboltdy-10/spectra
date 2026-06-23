import { assertOperationAllowed } from "./policy";
import { parseOperationInput } from "./schema";

export type OperationExecutionStubResult = {
  status: "proposed" | "executed";
  requiresConfirmation: boolean;
  message: string;
};

export function executeOperationStub(value: unknown): OperationExecutionStubResult {
  const operation = assertOperationAllowed(parseOperationInput(value));
  if (operation.requiresConfirmation) {
    return {
      status: "proposed",
      requiresConfirmation: true,
      message: `${operation.type} requires confirmation before execution.`,
    };
  }
  return {
    status: "executed",
    requiresConfirmation: false,
    message: `${operation.type} accepted by Wave 0 operation scaffold.`,
  };
}


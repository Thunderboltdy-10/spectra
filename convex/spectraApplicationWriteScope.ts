function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortedValue(child)]));
}

/** Exact structural comparison, independent of JSON property ordering. */
export function applicationOperationScope(operation: { type: string; input: unknown }) {
  return JSON.stringify(sortedValue({ type: operation.type, input: operation.input }));
}

export function applicationWriteReceipt(output: unknown): { scope: string; result: unknown } | undefined {
  if (!output || typeof output !== "object") return undefined;
  const receipt = (output as Record<string, unknown>).applicationWriteReceipt;
  return receipt && typeof receipt === "object" && typeof (receipt as Record<string, unknown>).scope === "string" && "result" in receipt
    ? receipt as { scope: string; result: unknown } : undefined;
}

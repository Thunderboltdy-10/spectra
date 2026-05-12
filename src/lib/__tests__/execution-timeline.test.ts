import { describe, expect, it } from "vitest";
import { routeTraceToExecutionEvents } from "@/components/shared/execution-timeline";
import type { RouteTrace } from "@/types";

describe("execution timeline", () => {
  it("uses real execution events before phase fallbacks", () => {
    const trace = {
      selected: { modelId: "moonshotai/kimi-latest", reason: "Best fit" },
      executionEvents: [
        {
          id: "tool-1",
          kind: "tool",
          label: "Read uploaded material",
          status: "completed",
          toolName: "resource_lookup",
        },
      ],
    } as RouteTrace;

    const events = routeTraceToExecutionEvents(trace, false);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "tool-1",
      kind: "tool",
      label: "Read uploaded material",
      status: "completed",
      meta: "resource_lookup",
    });
  });

  it("preserves structured tool result and error payloads", () => {
    const trace = {
      selected: { modelId: "moonshotai/kimi-latest", reason: "Best fit" },
      executionEvents: [
        {
          id: "tool-1",
          kind: "tool",
          label: "Search Web",
          status: "failed",
          toolName: "search_web",
          detail: "Search failed.",
          resultPreview: { sourceCount: 0 },
          error: "Provider timeout",
        },
      ],
    } as RouteTrace;

    const events = routeTraceToExecutionEvents(trace, false);

    expect(events[0]).toMatchObject({
      id: "tool-1",
      kind: "tool",
      status: "failed",
      resultPreview: { sourceCount: 0 },
      error: "Provider timeout",
    });
  });

  it("derives neutral labels from route traces without decorative thinking text", () => {
    const trace = {
      selected: { modelId: "deepseek/deepseek-v4-pro-20260423", reason: "Capability match" },
      routingDurationMs: 125,
      phasePlan: [
        {
          id: "retrieval",
          label: "Checking uploaded materials",
          status: "skipped",
          detail: "Resources exist but are not fully processed yet.",
        },
      ],
      searchTrace: {
        strategy: "search",
        operations: [
          { tool: "search", query: "exam dates", status: "completed", durationMs: 250 },
        ],
      },
    } as RouteTrace;

    const events = routeTraceToExecutionEvents(trace, false);

    expect(events.map((event) => event.label)).toEqual([
      "Checking uploaded materials",
      "Search activity",
    ]);
    expect(events[1]?.children?.[0]).toMatchObject({
      kind: "search",
      label: "search: exam dates",
      status: "completed",
    });
  });

  it("does not render model selection as a runtime event", () => {
    const trace = {
      selected: { modelId: "deepseek/deepseek-v4-pro-20260423", reason: "Anchor retained" },
      phasePlan: [
        { id: "routing", label: "Planning the route", status: "completed" },
        { id: "authoring", label: "Answer stream", status: "completed" },
      ],
    } as RouteTrace;

    const events = routeTraceToExecutionEvents(trace, false);

    expect(events.map((event) => event.kind)).not.toContain("routing");
    expect(events.map((event) => event.label)).toEqual(["Answer stream"]);
  });
});

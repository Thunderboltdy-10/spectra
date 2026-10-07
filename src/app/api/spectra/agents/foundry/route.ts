/**
 * Agent Foundry creator
 * Phase 10 §10.2, §10.3, §10.4, §10.6, §10.7, §10.8
 *
 * Server side of the Foundry. Three operations:
 *  - `foundation`  — turns the two opening answers into a structured mission.
 *  - `next`        — generates the next highest-value section, or reports that
 *                    the current state is sufficient.
 *  - `compile`     — extracts evidence, proposes skills and produces the
 *                    routing signature as one background compiler pass.
 *
 * The model writes context-specific prompts; the deterministic planner decides
 * *which* facet to pursue. There is no hard-coded question sequence and no
 * conversational filler. The prompts and the model call live in
 * foundry-model.ts, and compiling in compile.ts, which Spectra's compile_agent
 * shares.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { convexQuery } from "@/lib/convex-server";
import { admitAgentModelWork } from "../model-work";
import {
  assessSufficiency,
  detectSecurityConcerns,
  inferArchetypes,
  nextFacetPlan,
  normalizeFoundryContent,
  type EvidenceExtraction,
} from "@/features/spectra/agents/foundry";
import { compileAgentDraft } from "./compile";
import {
  answeredDigest,
  EXTRACT_SYSTEM,
  facetGuidance,
  FOUNDATION_SYSTEM,
  foundryCompletion,
  foundrySpend,
  meterFoundryWork,
  missionDigest,
  normalizeExtraction,
  parseJson,
  record,
  SECTION_SYSTEM,
  sectionId,
} from "./foundry-model";

export const runtime = "nodejs";
export const maxDuration = 300;

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "The request could not complete.";
  const status = /not signed|AUTH_/i.test(message)
    ? 401
    : /permission|forbidden|not allowed/i.test(message)
      ? 403
      : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  // Tokens this request spent, metered once it ends however it ends.
  const spend = foundrySpend();
  let meterFor: { userId: string; agentId: string } | undefined;
  try {
    const session = await auth();
    if (!session.userId) throw new Error("AUTH_NOT_SIGNED_IN");

    const body = record(await request.json());
    if (typeof body.agentId !== "string" || !body.agentId) {
      throw new Error("An agent is required.");
    }

    // Reading compilation status needs neither a model nor the draft, so it is
    // answered before either is required.
    if (body.operation === "compileStatus") {
      const job = await convexQuery<{ agentId: string }, unknown>(
        "agents:compilerJob",
        { agentId: body.agentId },
      );
      return NextResponse.json({ ok: true, job });
    }

    // Compiling is shared with Spectra's compile_agent, and meters itself.
    if (body.operation === "compile") {
      const compiled = await compileAgentDraft({
        userId: session.userId,
        agentId: body.agentId,
        signal: request.signal,
      });
      return NextResponse.json({ ok: true, ...compiled });
    }

    await admitAgentModelWork(body.agentId);
    meterFor = { userId: session.userId, agentId: body.agentId };
    const now = Date.now();

    // Reading the draft through the existing permissioned query keeps the
    // creator route from inventing its own access path.
    const artifact = await convexQuery<
      { agentId: string },
      { title: string; summary?: string; blueprintKey: string; content: unknown }
    >("agents:draftForEvaluation", { agentId: body.agentId });
    if (artifact.blueprintKey !== "agent") {
      throw new Error("This item is not an agent.");
    }

    const content = normalizeFoundryContent(artifact.content);
    const mission = content.foundry.mission;

    if (body.operation === "foundation") {
      const objective =
        typeof body.objective === "string" ? body.objective.slice(0, 8_000) : "";
      const interaction =
        typeof body.interaction === "string"
          ? body.interaction.slice(0, 8_000)
          : "";
      if (objective.trim().length < 10) {
        throw new Error("Describe what the agent should do.");
      }

      const raw = await foundryCompletion({
        spend,
        signal: request.signal,
        system: FOUNDATION_SYSTEM,
        user: `What should this agent do?\n${objective}\n\nHow should it feel to work with?\n${interaction || "(not answered)"}`,
      });
      const parsed = parseJson(raw);

      // The creator's own answers are untrusted input too.
      const concerns = [
        ...detectSecurityConcerns(objective),
        ...detectSecurityConcerns(interaction),
      ];

      return NextResponse.json({
        ok: true,
        mission: parsed,
        title: typeof parsed.title === "string" ? parsed.title : undefined,
        summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
        securityConcerns: concerns,
      });
    }

    if (body.operation === "next") {
      const plan = nextFacetPlan(mission, content.foundry.state);
      const sufficiency = assessSufficiency(mission, content.foundry.state);

      if (!plan) {
        return NextResponse.json({
          ok: true,
          sufficient: true,
          sufficiency,
          section: null,
        });
      }

      const raw = await foundryCompletion({
        spend,
        signal: request.signal,
        system: SECTION_SYSTEM,
        user: `Agent mission:\n${missionDigest(mission)}\n\nAlready established:\n${answeredDigest(content.foundry.state.sections)}\n\nNext aspect to establish: ${plan.facet}\nWhy: ${plan.rationale}\nGuidance: ${facetGuidance(plan.facet)}\nInput shape: ${plan.suggestedKind}`,
      });
      const parsed = parseJson(raw);

      const maxOrder = content.foundry.state.sections.reduce(
        (highest, section) => Math.max(highest, section.order),
        0,
      );

      const section = {
        id: sectionId(plan.facet),
        kind: plan.suggestedKind,
        facet: plan.facet,
        prompt:
          typeof parsed.prompt === "string"
            ? parsed.prompt.slice(0, 2_000)
            : facetGuidance(plan.facet),
        ...(typeof parsed.detail === "string"
          ? { detail: parsed.detail.slice(0, 2_000) }
          : {}),
        ...(Array.isArray(parsed.options)
          ? {
              options: parsed.options
                .map((entry) => record(entry))
                .flatMap((entry, index) =>
                  typeof entry.label === "string"
                    ? [
                        {
                          id:
                            typeof entry.id === "string"
                              ? entry.id.slice(0, 120)
                              : `option-${index + 1}`,
                          label: entry.label.slice(0, 300),
                          ...(typeof entry.detail === "string"
                            ? { detail: entry.detail.slice(0, 600) }
                            : {}),
                          ...(entry.recommended === true
                            ? { recommended: true }
                            : {}),
                        },
                      ]
                    : [],
                )
                .slice(0, 12),
            }
          : {}),
        ...(parsed.multiSelect === true ? { multiSelect: true } : {}),
        ...(parsed.allowOther !== false ? { allowOther: true } : {}),
        required: parsed.required === true,
        order: maxOrder + 1,
      };

      return NextResponse.json({
        ok: true,
        sufficient: false,
        sufficiency,
        section,
        archetypes: inferArchetypes(mission),
      });
    }

    if (body.operation === "extract") {
      const sourceId =
        typeof body.sourceId === "string" ? body.sourceId : undefined;
      const text = typeof body.text === "string" ? body.text : "";
      const kind =
        typeof body.kind === "string"
          ? (body.kind as EvidenceExtraction["kind"])
          : "source_document";
      if (!sourceId || !text.trim()) {
        throw new Error("Evidence text and a source are required.");
      }

      const raw = await foundryCompletion({
        spend,
        signal: request.signal,
        system: EXTRACT_SYSTEM,
        user: `Agent mission:\n${missionDigest(mission)}\n\nSource kind: ${kind}\n\nSource content:\n<<<SOURCE\n${text.slice(0, 120_000)}\nSOURCE`,
      });

      const extraction = normalizeExtraction(
        parseJson(raw),
        sourceId,
        kind,
        text,
        now,
      );

      return NextResponse.json({ ok: true, extraction });
    }

    throw new Error("Unknown Foundry operation.");
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (meterFor) await meterFoundryWork(meterFor.userId, meterFor.agentId, spend);
  }
}

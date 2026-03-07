# AI School Product Differentiators

## What truly differentiates AI School now

AI School is now meaningfully differentiated by how it controls context and orchestration for school use, not by offering a larger model menu. The strongest implemented differentiator is the separation between `School SOUL` and `Your SOUL`: school-level identity is compiled into a compact, versioned capsule from [`convex/soul.ts`](<local-workspace> while user personalization is sourced separately from preferences and selective memory in [`src/lib/orchestrator/pipeline.ts`](<local-workspace> and only consulted when the route plan says it is relevant. That creates a product that feels controlled by the school without turning every answer into prompt soup.

The second real differentiator is explicit orchestration across model, mode, and agent. Requests are first converted into a deterministic `RoutePlan` in [`src/lib/orchestrator/route-plan.ts`](<local-workspace> then the pipeline uses that plan to gate memory, retrieval, search, and multi-agent collaboration in [`src/lib/orchestrator/pipeline.ts`](<local-workspace> Models are then chosen with catalog-aware routing in [`src/lib/routing/heuristic.ts`](<local-workspace> and [`src/lib/model-selection.ts`](<local-workspace> instead of hardcoding a single model per mode.

The third differentiator is scope-bounded evidence handling. Retrieval is no longer a single flattened “RAG on everything” path. The system keeps pack, personal, and agent resources distinct via [`convex/rag.ts`](<local-workspace> [`convex/resources.ts`](<local-workspace> and [`src/lib/orchestrator/retrieval.ts`](<local-workspace> while web search is enabled through an evidence ladder instead of being always-on. That makes answers more inspectable and less likely to drift into unrelated context.

The fourth differentiator is that document generation is now a real backend flow instead of a pretty client export. When the assistant emits a structured document payload, the backend creates persisted DOCX, PDF, and PPTX resources through [`src/lib/artifacts.ts`](<local-workspace> stores them through existing resource infrastructure in [`convex/resources.ts`](<local-workspace> and links them back into the assistant message in [`src/lib/orchestrator/pipeline.ts`](<local-workspace> That is materially better than “copy this JSON into another tool.”

## What is not actually differentiated

Model switching by itself is not differentiated.

Basic chat over uploaded files is not differentiated.

Thumbs feedback, notifications, and invite flows are necessary product infrastructure, but they are not a moat.

Running sub-agents is not differentiated on its own; many products do that now, and AI School should not claim novelty there without the route controls around it.

## Why the product feels better than generic chat for schools

The product feels better because it is stricter about what context is allowed into an answer and why. A generic lab chat tends to over-inject memory, overuse expensive models, flatten all uploaded sources together, and let “agent” personas become giant unstable prompts. AI School now routes simple tasks down a simple path, uses memory only when the question is genuinely personal, keeps school identity separate from student identity, and restricts resources by scope. That produces answers that are more bounded, cheaper to run, easier to debug, and more aligned with how a school actually wants AI used.

## Messaging options

### Concise version

AI School is a school-aligned AI workspace that separates institutional guidance from personal learning context, then routes each request across mode, model, and agent with explicit scope controls. The result is a system that feels more private, more pedagogy-aware, and less chaotic than generic multi-model chat.

### Sharper website version

Most AI school tools are just chat wrappers with too many models and too much context leakage. AI School is built differently: every request is routed through a school-controlled SOUL, a student-specific SOUL, and an explicit mode-agent-model plan that decides what memory, files, web evidence, and tools are actually allowed. That makes it more school-safe, more inspectable, and much harder to send students down expensive rabbit holes.

### Internal positioning

- Two-layer SOUL separates school identity from student memory.
- Route plans make model, mode, and agent decisions inspectable instead of magical.
- Retrieval stays bounded to the right scope instead of flattening every source into one pile.
- Web search is used deliberately for current information, not sprayed across all prompts.
- Document outputs become real stored artifacts inside chat instead of disposable JSON.

### What not to claim

Do not claim that AI School invented multi-agent orchestration.

Do not claim unique ownership of RAG, memory, or model routing; those are common patterns.

Do not claim perfect personalization. `Your SOUL` is selective and intentionally conservative.

Do not claim autonomous research everywhere. Deep orchestration is gated and should stay gated.

## Evidence from the actual system

| Claimed differentiator | Actual mechanism |
| --- | --- |
| Two-layer SOUL | [`convex/soul.ts`](<local-workspace> [`convex/personalSoul.ts`](<local-workspace> [`src/lib/orchestrator/pipeline.ts`](<local-workspace> |
| Inspectable route planning | [`src/lib/orchestrator/route-plan.ts`](<local-workspace> `route.trace.routePlan` in [`src/lib/orchestrator/pipeline.ts`](<local-workspace> |
| Catalog-aware model routing | [`src/lib/routing/heuristic.ts`](<local-workspace> [`src/lib/model-selection.ts`](<local-workspace> |
| Scoped retrieval and search discipline | [`convex/rag.ts`](<local-workspace> [`src/lib/orchestrator/retrieval.ts`](<local-workspace> |
| Real artifact generation in chat | [`src/lib/artifacts.ts`](<local-workspace> [`src/lib/orchestrator/pipeline.ts`](<local-workspace> [`convex/resources.ts`](<local-workspace> |

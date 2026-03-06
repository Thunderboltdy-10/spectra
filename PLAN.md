# Active Prompt Plan (2026-03-05 22:23 +01:00)

## Latest User Request (verbatim)
"Failed to compile.
./src/lib/orchestrator/pipeline.ts:385:7
Type error: Object literal may only specify known properties, and 'isFeatured' does not exist in type '{ modelId: string; name?: string | undefined; provider?: string | undefined; description?: string | undefined; contextLength?: number | undefined; inputCostPerM?: number | undefined; ... 7 more ...; capabilities?: { ...; } | undefined; }'.
  383 |       tags: [...new Set([...(existing?.tags ?? []), ...(model.tags ?? [])])],
  384 |       // Keep org curation metadata stable if it exists in DB.
> 385 |       isFeatured: existing?.isFeatured ?? model.isFeatured,
      |       ^
  386 |       featuredOrder: existing?.featuredOrder ?? model.featuredOrder,
  387 |     });
  388 |   }
Next.js build worker exited with code: 1 and signal: null
Error: Command "npm run build" exited with 1"

## Actionable Tasks
1. Inspect src/lib/orchestrator/pipeline.ts around the catalog merge block.
2. Remove or safely map unsupported fields (isFeatured, eaturedOrder) so object matches the expected ModelMetadata shape.
3. Keep merge behavior that preserves DB models without violating type constraints.
4. Run typecheck/build to confirm compilation passes.

## Assumptions
- isFeatured/eaturedOrder belong to a broader DB model shape but not the routing metadata type.
- Build command available in current shell context.

## Blockers
- None yet.

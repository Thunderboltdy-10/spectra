# Canonical Workspace Taxonomy

## Overview

The canonical workspace-facing type system defines how items are displayed on the workspace canvas. It sits between the storage-level `itemType` (thread|artifact|planner|utility|custom) and the artifact-level `renderMode` (e.g. flashcard_deck, quiz, visualization).

## Three Layers of Type Resolution

1. **`itemType`** (storage-level, 5 values): `thread | artifact | planner | utility | custom` — stored in `workspaceItems.itemType`, resolved by `resolveCanonicalWorkspaceItemType()` in `convex/workspaceHelpers.ts`
2. **`CanonicalWorkspaceType`** (display-level, 9 values): `note | visual | code | export | board | flashcard_deck | quiz | thread | planner` — defined in `src/lib/artifact-types.ts`, used for canvas rendering
3. **`renderMode`** (artifact-level, 16 values): matches `ArtifactType` — stored in `workspaceItems.renderMode`, used for detailed rendering

## Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `resolveCanonicalWorkspaceItemType` | `convex/workspaceHelpers.ts` | Resolves `itemType` from source fields and legacy type |
| `normalizeCanonicalWorkspaceItemType` | `convex/workspaceHelpers.ts` | Sanitizes `itemType` values (invalid → "custom") |
| `resolveWorkspaceCategory` | `convex/workspaceHelpers.ts` | Resolves category from explicit, itemType, renderMode, or legacyType |
| `workspaceItemTypeForArtifact` | `convex/workspaceItemSync.ts` | Maps artifact type → legacy `type` field |
| `workspaceCategoryForArtifact` | `convex/workspaceItemSync.ts` | Maps artifact type → `category` field |
| `canonicalWorkspaceTypeForArtifactType` | `src/lib/artifact-types.ts` | Maps artifact type → canonical workspace type |
| `canonicalWorkspaceTypeForLegacyType` | `src/lib/artifact-types.ts` | Maps legacy type → canonical workspace type |

## Dual-Read Migration Pattern

`buildWorkspaceItemFields()` in `convex/workspaceItems.ts` calls `resolveCanonicalWorkspaceItemType()` which checks:
1. `itemType` (if already present, return it)
2. `sourceChatId` → "thread"
3. `sourcePlannerItemId` → "planner"
4. `sourceArtifactId` → "artifact"
5. `legacyType` fallbacks (thread/planner/utility/custom)
6. Default → "artifact"

This ensures items created before `itemType` was added still resolve correctly.

## Test Coverage

- `convex/__tests__/workspace-canonical-taxonomy.test.ts` — 72 tests for workspaceHelpers functions
- `src/lib/__tests__/canonical-workspace-taxonomy.test.ts` — 63 tests for artifact-types mappings and workspaceItemSync mappings

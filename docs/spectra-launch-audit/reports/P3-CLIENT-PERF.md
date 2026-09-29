# P3 — Client performance (large artifacts, long sessions)

Branch `p3/client-perf`, from `main` 68275672.

## Method

Every change was measured before it was made. I used node/vitest micro-benchmarks over the real models:

- a 100-slide deck
- a 200- and 400-question quiz
- a 300-card deck
- a 1,000-node whiteboard
- a 5,000-row × 5-column sheet with formulas (905 KB of JSON)

The throwaway probe was deleted before this report. Each fix has a regression test with generous bounds, and each test was confirmed to fail on the old code.

## Fixed

| Sev | Commit | What | Before → after |
|---|---|---|---|
| High | 1d817096 | `changedArtifactRegionIds` (runs per keystroke in `changeContent`, and on the server in `collaborationGatewayStore`) found region ancestry by comparing every pair of regions, O(R²). It now uses a path index. `collaboration/artifact-yjs-model.ts` `regionHierarchy` | 200-question quiz 796 → 34 ms; 400-question quiz 4,216 ms → < 1 s bound; 300-card deck 304 → 19 ms |
| Med | 63242144 | Region templates deep-cloned the parent subtree of every region. They are now built copy-on-write (`withRegionMarkers`). Signatures use a code-unit sort in place of `localeCompare`. Output is byte-identical on all fixtures | quiz decompose 406 → 5.9 ms; per keystroke: deck 44 → 10 ms, quiz → 19 ms, cards → 10 ms, board 107 → 23 ms |
| High | 9a906c94 | Every live projection rebuilt the whole object graph, so a peer's edit on one slide gave all 100 slides a new identity. `shareUnchanged` (`work/models/yjs/shared.ts`) keeps unchanged subtrees, and the whole snapshot when nothing changed | identity kept: 0/40 → 39/40 slides; the share costs 0.1–2.2 ms per rebuild |
| Med | 4ac87cc3 | `replaceYArray` ran an O(n·m) LCS, and fell back to rewriting the whole list once it passed the cell cap. Distinct keyed ids now use LIS in O(n log n) | 2,000-item reverse 38 → 0.3 ms; 5,000-item move was a full rewrite, now a 1.6 ms minimal edit; concurrent reorders of 3,000 cards: 6,002 → 3,002 order entries |
| Low | 8bcb89a0 | Removed the write-only `__spectraNativeProjection` traces from the model and document-adapter save path (the model's trace ran a whole-content `JSON.stringify` per save) | — |
| — | 3f431f33 | Deleted the unreachable human region-claim branch: `ArtifactYjsModel`, `replaceRegion`/`replaceMetadata`, the `applied:false`/claim/queue UI in the studio, and the `RegionClaimResult` result type. `convex/regionClaims.ts` and `shared/region-claim-policy.ts` are untouched | −~400 lines |
| High | b055e5d4 | Sheets cell plan: normalization of both sides erased the studio's cell-overlay hint, so every commit and save normalized and compared all cells. Normalization is now cached per value, and the hint is read from the raw values. The deep share on the applied sheet snapshot was dropped | 5,000-row sheet: commit lookup 109 → 46 ms; save plan 87 → 1.5 ms; share 19–28 → 0 ms; normalizations 8 → 3 |
| High (leak) | d9ce71f5 | `localSyncKeysRef` kept the full-JSON key of every save whose echo was normalized (trimmed summary, re-spaced tags, reordered cells): about 0.9 MB per save on a large sheet. Now the 8 most recent keys are kept (`rememberLocalSyncKey`) | unbounded → ≤ 8 keys |
| High | 48b70a3b | The studio layers AI streaming frames (`presencePreview`), peer speculation (`editorContent`) and `mergeAiRegions` over its content. Each layer did one `structuredClone` of the whole artifact per patch. `setAtPointers` copies each path once. This also fixes a **crash**: `DataCloneError` on a sheet with an unsaved cell overlay (a Proxy) when an AI frame arrived | per frame: board (30 patches) 81–94 → 0.07 ms; deck (20 patches) 19–22 → 0.4 ms; cards 10 → 0.1 ms |
| Med | 53bae2ec | AI preview frames (`buildArtifactLivePreviewFrames`) deep-cloned and stringified the whole value for every typed prefix. They are now copy-on-write | board frames 188 → 4.4 ms; board beats 276 → 37 ms; deck beats 97 → 13 ms |

## Reported, not fixed (outside my lane, or not worth the risk now)

1. **Sheets save: a full rebuild right after the cell fast-path.** `components/artifact-studio.tsx:3602` calls `live.flushSnapshot()` after `synchronize`. For sheets this throws away the `exposeAppliedSheetSnapshot` fast path. On a 5,000-row sheet the rebuild costs about 170–280 ms (project 40–64, validate 68–96, regions 67–117). The same rebuild also runs 120 ms after every remote cell edit. Skipping it safely needs a "no foreign update since the last rebuild" guard, because concurrent peer cells could otherwise be missed. I left it rather than risk durability before launch.
2. **`validateArtifactContent` and `enumerateArtifactRegions` for sheets** (`artifacts/registry.ts:1413,1424`) cost about 70–120 ms each on 25k cells, per rebuild. Owner: registry. Suggested fix: validate or enumerate only the sheets whose `cells` reference changed.
3. **Studio memoisation (editors).** `shareUnchanged` and `setAtPointers` now keep item identity, but the studios hardly memoise items. Counts: presentation 1 (`SlideRailPreview`), quiz 0, flashcard 0, whiteboard 0, and sheets only the outer `SheetsStudio`. The exact change:
   - Wrap the per-item row components in `memo()` and pass the item object itself: the slide canvas/object, the quiz question card, the flashcard row, the whiteboard node.
   - Keep callbacks stable, with `useCallback` or by id-based handlers.

   A peer or AI edit to one item then re-renders one item instead of all N.
4. **Debug traces in files I don't own.**
   - `components/artifact-native-sync.ts:196-212` still writes `__spectraNativeProjection`. Its `syncRejected` check (line 61) is dead, because synchronize now always resolves `{applied:true}`.
   - `components/document-studio.tsx:1593` also writes `__spectraNativeProjection`.

   Delete both.
5. **`document-studio.tsx:1148-1149`** runs `documentReferenceIds(transaction.before/doc)` on every transaction. That is two whole-document walks per keystroke on a 60-page essay. Suggested fix: run it only when the transaction's steps touch reference nodes.
6. **Per-frame highlight memos** in `artifact-studio.tsx` (`materializeAiChangedPaths` ×4) recompute on every streaming frame. They are cheap now that `streamingContent` shares structure; I did not measure them separately.
7. **`textApproachBeats`/`dropdownBeats`** (`collaboration/interaction-choreography.ts:552`) still do one full `structuredClone` per text or atomic change, about 2 ms each on a large board. This is minor now.

## Rejected as not real

- `history.record`, `draftContentForLiveWrite`, `applyStudioHistory`, `applyProjection`, `project` and `validate` for deck, quiz, cards and board: 0.2–12 ms per save, and none scale badly.
- The per-keystroke `snapshotKey` stringify: already memoised per snapshot object (`createReconciliationSnapshotKey` WeakMap).
- Transport and collaboration listeners, observers and intervals: every add has a matching remove, clear or destroy. `authoredRegionIds` is capped at 128. Studio history is capped at 80 structurally shared entries.

## Needs live verification

- Typing in a 60-page document and a 100-slide deck with a second tab open: check presence, AI highlight dismissal and the save loop (identity sharing plus the region-claim removal).
- A 5,000-row sheet: edit cells while an AI run streams. There should be no crash and no lost peer cells. Save latency.
- AI streaming into a large board and deck: frames look the same as before (copy-on-write frames).
- Concurrent reorders of long lists: slides, cards, whiteboard z-order.
- A long session (more than 200 saves) on a large sheet: heap stays flat (the local-sync key bound).
- Recovery restore of regions (`recovery-controller.ts`) now that the busy/claim branch is gone.

## Shared files touched

- `components/artifact-studio.tsx`
- `components/artifact-studio-value-utils.ts`
- `collaboration/artifact-yjs-model.ts` (also imported by `convex/collaborationGatewayStore.ts`)
- `collaboration/region-controller.ts`
- `collaboration/recovery-controller.ts`
- `collaboration/artifact-live-preview.ts`
- `work/models/yjs/{shared,native-artifact-model,document-adapter,structured-adapters}.ts`

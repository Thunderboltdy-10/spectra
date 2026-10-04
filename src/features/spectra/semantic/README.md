# Semantic layer

Find anything the user can open, by meaning and by words: every artifact type, chats, calendar
items, school data (ManageBac tasks, CAS entries, announcements) and, on request, memory. Every
response is re-checked against live permissions, so a deleted item, a revoked share or a left
workspace is gone at once.

## Hooks (client)

```ts
import { useRelated, useSemanticSearch, useThreadSearch } from "@/features/spectra/semantic/use-semantic";

const search = useSemanticSearch(query, { kinds?, workspaceId?, limit?, openItemIds?, recentItemIds? });
const threads = useThreadSearch(query, { workspaceId?, limit? });
const related = useRelated(itemId, { limit? });
```

Each returns data, no UI:

| field | meaning |
|---|---|
| `status` | `idle` (query under 2 characters, no item, or `enabled: false`), `loading`, `results`, `empty`, `error` |
| `results` | `SemanticResult[]` (search) or `RelatedResult[]` (related). While search loads, the previous results stay. |
| `answered` | search only: the query `results` belong to (it lags the typed query while loading) |
| `mode` | `hybrid`, or `words_only` / `links_only` when embeddings are unavailable |
| `degraded` | `null`, or why: `embeddings_not_configured`, `embeddings_unavailable`, `query_too_large`, `index_partial` |
| `error` | a readable message when `status` is `error` |
| `refresh()` | ask again now |

Search is debounced (200 ms, `debounceMs` to change) and ignores answers to old queries. The hooks
send `now` and the timezone offset, so "yesterday" means the user's yesterday. `openItemIds` and
`recentItemIds` are ranking hints for vague references ("the presentation", "that essay"): they
reorder and may surface a hinted item that fits the query, and they never filter.

## Actions (Convex)

For the AI harness, server code or anything without React. All three need a signed-in member.

- `api.semantic.search({ query, kinds?, workspaceId?, limit?, hints? })` returns
  `{ results, mode, degraded?, tookMs }`. `kinds` defaults to artifact, thread, event and school.
  Memory is included only when `kinds` contains `"memory"`, and then follows the memory consent
  rules. `limit` defaults to 10, at most 30.
- `api.semantic.searchThreads({ query, workspaceId?, limit?, hints? })` searches chats only. The
  anchor's `messageId` is the best matching message.
- `api.semantic.related({ itemId, limit? })` takes an artifact, thread, event or school record id.
  It returns `{ results, mode, degraded?, cached, tookMs }`. Explicit links come first, then
  similar items above the tuned threshold. Every result has `reasons`: `link`, `similar`,
  `thread_about` or `made_in_thread`. The item itself and its copies are never listed. Similar
  items are cached per viewer until the item is re-indexed, but access is re-checked on every call.

A result (`SemanticResult`, in `./types`) carries the following.
- What it is: `kind`, `itemId`, `title`, `typeLabel` and `subtype`.
- Why it ranks: `snippet` and `location`, such as "Slide 3: Results".
- Where it opens: `anchor`. It is `{ kind: "artifact", artifactId, regionId?, label? }`,
  `{ kind: "thread", threadId, messageId? }`, `{ kind: "event", calendarItemId }`,
  `{ kind: "school", recordId }` or `{ kind: "memory", claimId }`.
- When: `updatedAt`, and `timeAt` (an event start or a due date).
- Context: `workspace` (only when the viewer can open it) and `ownership`: `mine`, `shared` or
  `school`.
- Ranking: `score` (0..1, comparable within a response) and `matchedBy`. `meaning`, `words` and
  `title` find the item; `type`, `when`, `open` and `recent` are ranking signals.

## What the query understands

Type words ("notes", "deck", "slides", "quiz", "chat", "what did I ask", "event", "task", and their
Spanish forms) and time words ("yesterday", "last week", "on Monday", "ayer", "la semana pasada")
rank matching items higher. "when" and "due" prefer things happening in the next two weeks.
"latest" prefers recent changes. None of these filter.

## Adding a kind

Register it once in `convex/semanticSources.ts` (instructions at the top of that file). Triggers,
the debounced queue, the backfill, search and related pick it up from there. New artifact types and
new school record types need no registration.

## Operating

- Env (Convex): `SPECTRA_EMBEDDING_MODEL` (an OpenRouter embedding model that supports 256
  dimensions), optional `SPECTRA_EMBEDDING_PROVIDER`, and `OPENROUTER_API_KEY`. Without a model,
  search runs on words only and says so.
- Edits re-index the item about 6 s after the last save (at most 60 s during continuous editing),
  and only changed chunks are embedded.
  Deletes, trash, unshares and lost access purge at once.
- Backfill or re-embed after a model change: `npx convex run semanticIndex:startBackfill`. Watch it
  with `npx convex run semanticIndex:backfillStatus`. It resumes, is rate-limited and is safe to
  rerun.
- Quality: `npm run eval:semantic` (live embeddings) and `scripts/semantic-eval/` (fixtures and the
  offline eval in Vitest).

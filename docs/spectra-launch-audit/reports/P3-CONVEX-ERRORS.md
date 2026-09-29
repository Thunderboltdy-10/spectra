# P3 — Convex errors (Phase 3)

Branch `p3/convex-errors`, from `main` a7861f4f. The goal is that worded Convex errors (`CODE: sentence`) survive a production deployment. This closes R1 of `P3-WORKSPACE-FLOWS.md`.

## What the installed package does (convex 1.45.0, convex-test 0.0.54)

These facts come from `node_modules/convex/dist/esm`, not from memory.

- **Server side.** `server/impl/registration_impl.js` `invokeFunction` catches whatever a handler throws. If the value carries `Symbol.for("ConvexError")`, `serializeConvexErrorData` JSON-encodes its `data`. Any other value is rethrown untouched. The backend sends the client `errorMessage`, plus `errorData` for a ConvexError only. Redaction to `[Request ID: …] Server Error` happens in the Rust backend, which is not in the package. The client code and the Convex docs both assume that only `errorData` survives in production. The design therefore never relies on `errorMessage`.
- **`ConvexHttpClient`** (`browser/http_client.js`), used for query, mutation, action and function calls. On an HTTP 560 it throws `new ConvexError(respJSON.errorMessage)` and sets `.data = jsonToConvex(errorData)`. Without `errorData` it throws a plain `new Error(errorMessage)`. So `error.message` is the (redacted) frame, and `.data` holds the structured value.
- **`ConvexReactClient`** (`browser/sync/client.js`, `useMutation`/`useAction`). It builds the message `[CONVEX M(path)] <errorMessage>\n  Called by client`. With `errorData` present it throws a `ConvexError` and `forwardData` sets `.data`. `useQuery` errors come from `optimistic_updates_impl.js` and follow the same rule.
- **What `error.message` becomes.** `new ConvexError("CODE: sentence")` has message `"CODE: sentence"` locally. Structured data gets `stringifyValueForError(data)`. On a client, the message is always the server frame, so only `.data` is reliable.
- **Errors through an action's `ctx.runQuery`/`runMutation`/`runAction`.** `server/impl/syscall.js` `performAsyncSyscall`: if the failed call carries `data`, the action receives `new ConvexError(e.message)` with `.data` decoded. Otherwise it receives `new Error(e.message)`. System errors lose any metadata on the JavaScript side, so wrapping them cannot change how the backend classifies them.
- **Validation.** Argument and return validation run from `exportArgs`/`exportReturns` in the backend, outside the handler, so they are unaffected.
- **convex-test.** It deserializes ConvexError data the same way (`deserializeConvexErrorData`). It never redacts, which is why no existing test could see R1.

## Design

- **One throw path.** `convex/functions.ts` wraps the six generated builders once. A plain `Error` thrown by a handler becomes `ConvexError<{ code, message }>`, where `message` is the verbatim thrown text and `code` is its leading `CODE`. The error keeps its original `.message` and `.stack`, so logs, local dev and every existing test read the same text; the full Convex and shared suites pass unchanged. `ConvexError`s and runtime faults (`TypeError` and similar, which are bugs rather than copy) pass through.
  - Internal builders are wrapped too, so the words travel through `ctx.run*` as data.
  - All 73 modules now import their builders from `./functions`. This is a mechanical import swap, with `orgNodeMutation`'s custom builders sitting on top of it.
  - `module-graph.test.ts` fails if a module imports a builder from `_generated/server`, so a future function cannot forget the rule. There are no call-site changes, so other branches merge cleanly.
- **One reader.** `shared/convex-error.mjs` (with a `.d.mts`) provides `toWordedConvexError`, `readConvexError` (data first, then the unredacted dev frame; empty when redacted) and `rethrowWorded`. It is plain JavaScript so the collaboration gateway can load it; it is added to the gateway Dockerfile.
  - The reader is used by `route-handler` (status and code), `convex-server` (`WordedConvexHttpClient` puts the words back on `error.message`, so all route branches on codes work), `tree-client` `treeFailureMessage`, `truthful-state` `describeFailure`, Bridge `humanize`, the gateway bridge client, and three direct-mutation catch sites.
  - It replaces the regexes in `route-handler` and `tree-client`.
- **Redaction simulator.** `src/test/convex-redaction.ts` `asDeployedError`/`deployed` delivers a convex-test failure the way production does (HTTP or React frame, `data` only for a ConvexError).

## Findings ledger

### Fixed

| # | Sev | Finding | Fix | Test (failed before) |
|---|---|---|---|---|
| E1 | High | Every worded Convex error was redacted to "Server Error" in production (about 1,300 throws). | `convex/functions.ts` boundary plus the import swap. | `shared/convex-error.test.ts`; module-graph invariant. |
| E2 | High | Calendar gesture conflict: the route answered 500 `INTERNAL_ERROR`, so a stale tab never reloaded. | `route-handler` reads through `readConvexError`. | `convex/worded-errors.test.ts`: real `calendar:moveWorkBlock` → 409 `CALENDAR_GESTURE_CONFLICT`. |
| E3 | High | Invitation decisions answered 500, so `/join` retried a final decision. | Same as E2. | `memberships:acceptInvitation` → 404 `INVITATION_INVALID`. |
| E4 | High | Route code keyed on `error.message` never fired (`MATERIALIZATION_BASE_STALE` retry, `LOCAL_REPLICA_UNAVAILABLE`, `UI_OBSERVATION_STALE`, lenses, ManageBac `errorCode`). | `WordedConvexHttpClient` in `src/lib/convex-server.ts`. | `src/lib/__tests__/convex-server-worded.test.ts` (real client, HTTP 560 response). |
| E5 | Medium | The Library showed the fallback instead of the server's sentence. AUTH_* codes read as "check your connection". | `treeFailureMessage` and `describeFailure` use the reader. | `worded-errors.test.ts`: `orgTree:createFolder` → "A name is required."; identity copy. |
| E6 | Medium | Gateway: a native overlap showed peers "durable failed", because `reason.includes("COLLABORATION_NATIVE_OVERLAP")` read the redacted message. | The bridge client calls `rethrowWorded`; the shared module is added to the Docker image. | `shared/convex-error.test.ts` gateway case; the gateway package test is green. |
| E7 | Medium | The composer dock toasted the raw `[CONVEX M(…)] … Server Error` frame. Bridge storage and pending-change errors could not be mapped. | The reader is used in `composer-artifact-dock`, `file-storage-controls`, `resource-surface` and `humanize.rawText`. | Bridge copy case in `shared/convex-error.test.ts`. |

### Reported, not fixed

| # | Where | Why |
|---|---|---|
| N1 | `whiteboard-studio.tsx:831` shows `error.message` from a direct mutation. | Studio file, owned by editors-2. The fix is `readConvexError(error).message \|\| fallback`. |
| N2 | `describeFailure` callers (document, whiteboard and embed hosts) only map AUTH_* codes, then use their fallback. | This is correct and no longer broken; richer copy is optional. |
| N3 | `scripts/collaboration-persist.mjs` `nestedConvexDetail` keeps its own parser (JSON-in-message and `COLLABORATION_*` extraction). | It already reads `error.data.message`, which works with the new data. Folding it into the reader is cleanup. |
| N4 | `useQuery` failures go to error boundaries with generic copy. | Behaviour is unchanged. The data is now available if a boundary wants it. |
| N5 | httpActions (`convex/http.ts`) are not wrapped. | They answer with a `Response`, not a thrown error. |

### Rejected

- A `fail(code, sentence)` helper at every throw site. That would touch about 1,320 lines across about 88 files and still leave room to forget one. The boundary fixes all of them at once.
- Rewriting the message on the browser `ConvexReactClient`. Only 12 files call hooks directly, and the reader covers them without subclassing the React client.

## Shared files touched

- `convex/*.ts`: import swap only (73 files).
- `convex/_generated/api.d.ts`: the `functions` module was added by hand, in codegen order. Regenerate with `npx convex codegen` when a deployment is available.
- `convex/module-graph.test.ts`: the builder invariant.
- `src/components/ui/truthful-state.tsx`: `rawText` only.
- `src/lib/convex-server.ts`
- `src/lib/route-handler.ts`
- `deploy/collaboration-gateway/Dockerfile`: one COPY line.
- `scripts/collaboration-gateway-bridge-client.mjs`
- `src/features/spectra/components/composer-artifact-dock.tsx`, `src/features/spectra/bridge/{humanize.ts,file-storage-controls.tsx,resource-surface.tsx}`: catch sites only.

## Needs live verification

Run these on a production (not dev) Convex deployment.

1. **Calendar conflict.** Drag a Calendar block in a stale tab.
   - Expected: a 409 with `CALENDAR_GESTURE_CONFLICT`, "Calendar changed", then a reload.
2. **Invitations.** Open `/join` with a revoked or used invitation.
   - Expected: the final "unavailable" copy, with no retries.
3. **Library.** Create a folder with a blank name.
   - Expected: "A name is required.", not the fallback.
4. **Response shape.** In devtools, a failed mutation's response carries `errorData: { code, message }`.
   - Confirm that `errorMessage` is still redacted and that no stack reaches the client.
5. **Transient errors.** Under OCC contention or write limits, confirm that mutations are still retried by Convex and that the gateway's transient retry still fires. The wrapper only changes the JavaScript error class; confirm that the backend does not key retries on it.
6. **Gateway.** Rebuild the gateway image and confirm it starts (it now loads `shared/convex-error.mjs`). A native-overlap rejection should close with the `COLLABORATION_NATIVE_OVERLAP` reason and no "durable failed" banner.
7. **Codegen.** Run `npx convex codegen` or a deploy and confirm that `api.d.ts` matches the hand edit.

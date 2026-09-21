# W9 gateway startup reliability — 2026-09-21

Private repair from primary `7e720624504b4275c6ffdb654e9c9051cfdc769d`, branch `codex/w9-gateway-startup-repairs`. Integration and live acceptance remain with the coordinator/DURABLE owner.

## Changes

- Removed unconditional listener termination, Bash/ss/lsof discovery and service-marker reuse. Both gateway entry points require a free configured address. `--force` now fails explicitly; stop the owning launcher deliberately before restarting an occupied address.
- One shared supervisor owns only its directly spawned Node child, handles spawn errors, retries exited children with bounded backoff, checks address availability before every replacement, cancels retries on shutdown and bounds shutdown of its own unresponsive child. No process lookup or port-based termination remains.
- Loader preserves supplied instance values and exact secret bytes, uses Node's env-file parser, loads file host/port defaults like the web command, and accepts a complete supplied environment without a root file. Supplied Convex URL aliases cannot be overridden by a different root file. The local stack explicitly passes its selected instance env file.
- Gateway applies `SPECTRA_COLLAB_HOST` to Hocuspocus's bind address. Generic/hosted starts retain wildcard `0.0.0.0`; the local stack supplies explicit `127.0.0.1`. This is the only change to `collaboration-gateway.mjs`. The diagnostic secret comparison follows the corrected precedence and exact-byte fingerprints.
- Hosted package follow-up corrects Docker's raw entry and incomplete module COPY set: it now invokes the supported loader and includes its full relative import graph, including shared modules. Docker, Compose and Fly explicitly configure wildcard binding. Source/config changes only; no image build or deployment.

## Evidence

All commands ran in the private checkout on Windows with Node `v24.11.1`; no real runtime, Convex, Bridge, browser, native Office or real env file was used.

- Core focused run: `node node_modules/vitest/vitest.mjs run scripts/load-collaboration-env.test.mjs scripts/collaboration-gateway-process.test.mjs scripts/serve-collaboration-gateway.test.mjs` — **35 passed** before the hosted package follow-up.
- Hosted follow-up: `node node_modules/vitest/vitest.mjs run scripts/collaboration-gateway-process.test.mjs scripts/collaboration-gateway-package.test.mjs scripts/serve-collaboration-gateway.test.mjs` — **28 passed**, including generic wildcard/local explicit-loopback compatibility and static resolution of all 17 modules required by the Docker entry and spawned raw gateway. This reruns affected ownership/launcher tests and adds two cases; it does not execute the gateway or build an image.
- Stack neighbors: `scripts/local/stack-config.test.mjs` and `scripts/local/stack-scaffold.test.mjs` — **9 passed** in the initial combined focused run. Scaffolding used a disposable directory and the example env only.
- Gateway/readiness neighbors: `src/features/spectra/__tests__/collaboration-gateway.test.ts` and `scripts/local/readiness.test.mjs` — **22 passed**.
- `node --test scripts/local/start-all.node.mjs` — **3 passed**.
- ESLint on the nine changed/new launcher, loader, supervisor, diagnostic and stack modules/tests, then on the changed supervisor and new packaging test — passed with zero warnings. `git diff --check` passed.

Regression coverage includes real disposable HTTP listeners returning ready/degraded/not-ready/legacy/foreign responses, a silent TCP listener, a native Windows launcher subprocess with an empty PATH (no Bash available), Node env-file subprocess comparison including CRLF/comments and exact exported secret bytes, selected-file and finalEnv precedence, invalid secrets/ports, missing executable, address takeover between retries, cancellation and owned-child shutdown escalation. No unidentified listener was killed.

## Limits

These are deterministic and disposable-process checks, not evidence of an integrated running stack. A new launch refuses even a healthy pre-existing gateway because health does not prove its instance identity or secret match. Existing complete-stack reuse remains the local start-all owner's responsibility. The brief port reservation cannot eliminate a bind race; the child's bind remains authoritative and the supervisor checks again before any retry.

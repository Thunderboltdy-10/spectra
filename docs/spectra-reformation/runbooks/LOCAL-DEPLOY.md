# LOCAL-DEPLOY — isolated Convex + Next.js + collaboration stacks

P9.I1 replaces the shared cloud development backend for verification. Each
numeric instance id owns a deterministic port block, its own Convex SQLite and
object-storage directory, its own environment file, and its own process record.
Instances do not share application state.

## Prerequisites

- Run `npm install` once in the checkout.
- Be signed in to the Convex CLI and have access to the existing Spectra Convex
  project. The first start of each instance selects that project once.
- Put real credentials in root `.env.local`, or fill the generated instance
  file after `local:add-instance`. Never edit or commit `.env.local.example`
  with real values.

The local template is `.env.local.example`. `local:add-instance` copies root
`.env.local` when it exists; otherwise it copies that template. The harness
then replaces all instance-owned URLs and ports. To use another source file,
pass `--source-env path/to/file`.

## Port and storage contract

The default block begins at `3000 + (instance - 1) * 20`:

| Instance | Next.js | Collaboration | Convex API | Convex site |
| -------- | ------: | ------------: | ---------: | ----------: |
| 1        |    3000 |          3001 |       3002 |        3003 |
| 2        |    3020 |          3021 |       3022 |        3023 |
| 3        |    3040 |          3041 |       3042 |        3043 |

Instances 4 and higher follow the same formula. `--port-base` and
`--port-stride` are available when a machine needs a different range; a
manifest freezes that mapping after the instance is added.

Runtime files are gitignored under:

```text
.spectra-local/instances/<n>/
  env.local                         Next.js/gateway/Bridge environment
  convex.env                       allowlisted values copied into Convex
  instance.json                    immutable id → port mapping
  runtime.json                     launcher and child PIDs while running
  project/package.json             private Convex CLI project contract
  project/.env.local               local Convex deployment selector
  project/.convex/local/default/   SQLite database + object storage + config
```

`local:add-instance` generates the private project package from the checkout's
declared Convex version. Do not copy or maintain a second application package
by hand; the harness refreshes this runtime-only contract on every start/add.

Set `SPECTRA_LOCAL_ROOT` to relocate the whole runtime root. Reset checks the
resolved instance path before deleting any Convex state.

## Environment contract

The harness refuses to start until these values are present:

| Variable                            | Runtime                | Requirement                                             |
| ----------------------------------- | ---------------------- | ------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next.js                | Clerk publishable key                                   |
| `CLERK_SECRET_KEY`                  | Next.js                | Clerk server key                                        |
| `CLERK_JWT_ISSUER_DOMAIN`           | Next.js + local Convex | Exact JWT issuer used by `convex/auth.config.ts`        |
| `OPENROUTER_API_KEY`                | Next.js + local Convex | Model provider key                                      |
| `SPECTRA_MASTER_ENCRYPTION_KEY`     | Next.js                | Exactly 32 bytes, base64 encoded                        |
| `SPECTRA_SECRET_BRIDGE_KEY`         | Next.js + local Convex | Independent random value, at least 32 characters        |
| `SPECTRA_CONNECTOR_BRIDGE_KEY`      | Next.js + local Convex | Independent random value, at least 32 characters        |
| `SPECTRA_COLLAB_BRIDGE_KEY`         | gateway + local Convex | Same random value on both sides, at least 32 characters |
| `SPECTRA_COLLAB_TOKEN_SECRET`       | Next.js + gateway      | Same random value on both sides, at least 32 characters |

The harness derives and overwrites `CONVEX_DEPLOYMENT`,
`NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`,
`NEXT_PUBLIC_APP_URL`, `SPECTRA_APP_URL`, `SPECTRA_APP_ORIGIN`,
`NEXT_PUBLIC_SPECTRA_COLLAB_URL`, `SPECTRA_CONVEX_URL`, and the web/collab
ports. `SPECTRA_APP_URL` is the loopback Next.js URL so local Convex scheduler
callbacks stay on the same instance. The browser-facing app/origin and proxied
collaboration URLs use `localhost` (required for the configured Clerk callback);
the Convex API/site and internal collaboration listener stay on `127.0.0.1`.

Before the final `convex dev` starts, the harness copies the backend allowlist
from `env.local` into that instance with `convex env set --from-file`: the Clerk
issuer, app callback URL, OpenRouter key, collaboration/connector/secret bridge
keys, optional agent-eval and analysis keys, and `SUPER_ADMIN_EMAILS` when set.
Clerk's publishable and secret keys remain only in Next.js. Optional
`MANAGEBAC_BASE_URL`, `MANAGEBAC_API_KEY`, and
`SPECTRA_MANAGEBAC_WORKER_HTTP_KEY` stay in the app environment; P9.I4 owns
seed/bootstrap behavior.

Every supported optional variable is named and commented in
`.env.local.example`, including email, observability, provider-routing,
separate worker, role-bootstrap, and ManageBac values.

## Add and start instances

Create the three standing instances:

```powershell
npm run local:add-instance -- --instance 1
npm run local:add-instance -- --instance 2
npm run local:add-instance -- --instance 3
```

Fill each printed `env.local` path if root `.env.local` did not already contain
the required credentials. Start each stack in its own terminal:

```powershell
npm run dev:local -- --instance 1
npm run dev:local -- --instance 2
npm run dev:local -- --instance 3
```

On the first start, `convex dev` asks which existing project to use. To make
that step non-interactive, set both `SPECTRA_LOCAL_CONVEX_TEAM` and
`SPECTRA_LOCAL_CONVEX_PROJECT` in the instance environment. The harness pins
the requested local ports, synchronizes the Convex environment, keeps that same
backend running, then starts Next.js and the Hocuspocus gateway. It
prints the app, Convex, dashboard, and Bridge URLs only after web, Convex, and
the gateway all report `status: "ready"` with their dependencies answering — not
merely that the processes exist. Large local SQLite files need minutes to bind;
the harness sets `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS` to 900 so the CLI
does not give up at 30 seconds.

## Production preflight

P8.P1 freezes a production candidate. Build first, then start the same instance
against that build:

```powershell
npm run local:build -- --instance 1
npm run local:start:prod -- --instance 1
```

`local:build` runs `next build` with that instance's `env.local`, so the
production client and health probes target the local Convex URL instead of a
cloud deployment leftover in root `.env.local`. `local:start:prod` refuses to
start without `.next/BUILD_ID`.

```powershell
node scripts/local/preflight.mjs --instance 1 --unit P8.P1
```

The shared evidence manifest lives at `.shots/reformation/<unit>/manifest.json`
and is the format RC.V1 and P8.V1 continue. It records commit, environment,
hashes, actors, steps, observations, budgets, repairs, and verdict. Do not copy
secrets into it. Originals under `Documents\IBDP1` stay unmounted; P8.P1 smoke
uses a disposable fixture, and RC.V1 hashes the sacrificial copy tree.

Check an instance without starting it:

```powershell
npm run local:status -- --instance 2
```

## Stop and reset

`Ctrl+C` in the owning terminal stops the complete process tree. From another
terminal:

```powershell
npm run local:stop -- --instance 2
```

Reset deletes only that instance's `project/.convex` database/object storage
and local deployment selector. It preserves `env.local` so credentials do not
need to be entered again. The explicit confirmation flag is required:

```powershell
npm run local:reset -- --instance 2 --yes
npm run dev:local -- --instance 2
```

Never reset an instance holding a live `local-deploy-n` lease. A reset is not a
seed operation; P9.I4 owns all seed and first-run bootstrap logic.

## Bridge on local Convex

The Bridge no longer has a cloud fallback or accepts a remembered deployment
as authority. It fails closed with a plain setup message unless
`SPECTRA_CONVEX_URL` is present. Use the exact URL printed by `dev:local`:

```powershell
$env:SPECTRA_CONVEX_URL = "http://127.0.0.1:3002"
cargo run --manifest-path bridge/Cargo.toml -p spectra-bridge
```

Use `3022` for instance 2, `3042` for instance 3, or read the generated
`env.local`. The Bridge remains an exclusive physical resource: pointing it at
a local instance does not grant a `bridge` lease.

## Verification lease protocol

1. The orchestrator chooses an unused `local-deploy-n` row and records the VU
   as holder in `docs/spectra-reformation/orchestration/LOCKS.md`. Agents do not
   self-assign or rewrite that ledger.
2. The VU starts only that numeric instance and cites the instance id in its
   evidence manifest. No other verifier may use the same id concurrently.
3. `playwright-a`, `playwright-b`, `office-com`, and `bridge` remain separate
   exclusive leases. A local deployment lease grants none of them.
4. At close-out the VU stops the instance and reports that it is down. The
   orchestrator verifies the process is gone, then clears the lease row.

If a port is occupied, the harness fails instead of moving silently. Stop the
recorded holder or add another instance; never aim a VU at the shared cloud dev
deployment.

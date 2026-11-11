# Launch runbook

How Spectra goes from the local stack to the cloud. Every step here is one Pablo starts; nothing in the repository
deploys on its own. Order matters: each tier needs the addresses and keys of the one before it.

## What runs where

| Tier | Host | What it is |
| --- | --- | --- |
| Backend | Convex (cloud, production deployment) | Database, functions, scheduled runs, file storage, vector and text search |
| Web app | Vercel | Next.js: pages, the AI run route, the Clerk webhook (`/api/webhooks/clerk`) |
| Collaboration | Fly.io, one machine (`deploy/collaboration-gateway/fly.toml`) | The live editing gateway (Y.js rooms in memory) |
| Bridge | The user's computer | Tauri app, released by tag through `.github/workflows/bridge-release.yml` |
| Auth | Clerk (production instance) | Sign-in; Convex trusts its JWT issuer |
| Models | OpenRouter | Every Spectra turn and the embeddings |

## Before you start

- A Convex production deployment, a Vercel project, a Fly app (`spectra-collaboration-gateway`), a Clerk production
  instance with your domain, an OpenRouter key with credit, and a Resend key with a verified sender.
- Fresh random secrets of 32 or more characters, one per name, never reused between names:
  `SPECTRA_MASTER_ENCRYPTION_KEY`, `SPECTRA_SECRET_BRIDGE_KEY`, `SPECTRA_COLLAB_BRIDGE_KEY`,
  `SPECTRA_COLLAB_TOKEN_SECRET`, `SPECTRA_CONNECTOR_BRIDGE_KEY`, and optionally `SPECTRA_AGENT_EVAL_BRIDGE_KEY`,
  `SPECTRA_MANAGEBAC_WORKER_HTTP_KEY`. Keep them in a password manager. Never commit them.

## 1. Convex

1. Deploy the functions: `npx convex deploy` (production). This also checks the schema; the schema never reads the
   environment (`convex/schema-imports.test.ts`).
2. Set the environment on the deployment (`npx convex env set NAME value --prod`):
   - **Required:** `CLERK_JWT_ISSUER_DOMAIN`, `SPECTRA_APP_URL` (the https web origin), `SUPER_ADMIN_EMAILS`,
     `OPENROUTER_API_KEY`, `SPECTRA_SECRET_BRIDGE_KEY`, `SPECTRA_COLLAB_BRIDGE_KEY`, `SPECTRA_CONNECTOR_BRIDGE_KEY`
     (the three keys identical to Vercel's).
   - **Search:** `SPECTRA_EMBEDDING_MODEL` (an OpenRouter embedding model returning 256 dimensions) and optionally
     `SPECTRA_EMBEDDING_PROVIDER`. Unset, search runs on exact words only and says so.
   - **Optional:** `SPECTRA_AGENT_EVAL_BRIDGE_KEY`.
   - **Must be absent:** `SPECTRA_LOCAL_SELF_HOSTED`, `SPECTRA_ALLOW_LOCAL_MANAGEBAC_FIXTURE`, and every
     `SPECTRA_*_EVIDENCE` flag.
3. Fill the search index once embeddings are set: `npx convex run semanticIndex:startBackfill --prod` and
   `npx convex run memory:backfillEmbeddings '{"limit":200}' --prod` (repeat until it reports nothing left).
4. Complete the catalog summaries: `npx convex run spectraArtifacts:backfillSummaries '{"cursor":null,"limit":10}' --prod`,
   then pass each returned cursor until it reports `done` (agent and artifact catalogs need the whole traversal).
5. Start school usage ceilings from real totals: `npx convex run metering:backfillSchoolUsageTotals '{}' --prod`, once.
6. Run `npx convex codegen` and confirm `convex/_generated/api.d.ts` has no diff.

## 2. Collaboration gateway (Fly)

1. Secrets: `fly secrets set -a spectra-collaboration-gateway CONVEX_URL=<convex url> SPECTRA_COLLAB_TOKEN_SECRET=… SPECTRA_COLLAB_BRIDGE_KEY=…`.
2. From the repository root:
   `fly deploy . -c deploy/collaboration-gateway/fly.toml --ha=false`.
3. Keep exactly one machine (`fly scale count 1 -a spectra-collaboration-gateway`); scale the VM up, never out. Its `wss://` address is
   `NEXT_PUBLIC_SPECTRA_COLLAB_URL` below.
4. Check `https://spectra-collaboration-gateway.fly.dev/_spectra/health`: both the overall `status` and
   `dependencies.convex.status` must be `ready`. HTTP 200 alone does not prove readiness.

The production gateway uses Paris (`cdg`), because Fly no longer accepts new machines in Madrid (`mad`).
Its public WebSocket URL is `wss://spectra-collaboration-gateway.fly.dev`.

## 3. Web app (Vercel)

1. Environment (Production), from `.env.example`:
   - Convex: `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`.
   - Origins: `NEXT_PUBLIC_APP_URL`, `SPECTRA_APP_URL`, `SPECTRA_APP_ORIGIN` (all the https domain).
   - Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (production `pk_live`/`sk_live`),
     `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`.
   - Secrets: the keys listed under "Before you start", plus `NEXT_PUBLIC_SPECTRA_COLLAB_URL`.
   - Codex and Claude Code through the Bridge: `SPECTRA_AGENT_HUB_URL`, on Vercel and Convex, the collaboration
     gateway's `wss://` address ending in `/_spectra/agent-hub`.
   - Models: `OPENROUTER_API_KEY`, `SPECTRA_MODEL_ID`, `SPECTRA_REASONING_PROFILE`, `SPECTRA_MODEL_PROVIDER`, and the
     optional fallback and judge settings. `OPENROUTER_APP_NAME`, `OPENROUTER_SITE_URL`.
   - Email: `RESEND_API_KEY`, `INVITE_FROM_EMAIL`. `SUPER_ADMIN_EMAILS`, `LOG_LEVEL`.
   - **Must be absent:** `MANAGEBAC_API_KEY` and every development-only name in `scripts/check-deploy-env.mjs`.
2. Deploy. `prebuild` runs `check:deploy-env`, which fails a production build on a missing model setting, a localhost
   URL, a development Clerk key or a short secret.
3. In Clerk, add the webhook `https://<domain>/api/webhooks/clerk` and copy its signing secret into
   `CLERK_WEBHOOK_SECRET`.
4. Check the run route's duration limit against the Vercel plan (P2-OPS-PERFORMANCE, "Run route duration").

## 4. Clerk

1. In the production instance, JWT templates → `convex`: set the token lifetime to **600 seconds**. Shorter lifetimes
   make Convex re-authenticate constantly; longer ones keep a revoked session alive.
2. Sign-up stays open in Clerk, but Spectra is by invitation: `identity:registerSelf` refuses an email with no live
   invitation (`IDENTITY_NOT_INVITED`), except the operators in `SUPER_ADMIN_EMAILS`. Set that name identically on
   Convex and Vercel.

## 5. Bridge releases

The Bridge updater and `/bridge/download/<platform>` both read the latest release of the public repository
`Thunderboltdy-10/spectra-bridge` (`bridge/bridge-app/tauri.conf.json`, `endpoints`).

1. Create that repository on GitHub: public, with a README so it has a default branch. Nothing else goes in it.
2. Make a fine-grained token with **Contents: read and write** on that repository only.
3. In **this** repository, Settings → Secrets and variables → Actions:
   - Variables: `SPECTRA_CONVEX_URL` (production Convex URL), `SPECTRA_ORIGINS` (the https web origin, comma-separated
     if several), `BRIDGE_RELEASES_REPO` = `Thunderboltdy-10/spectra-bridge`.
   - Secrets: `BRIDGE_RELEASES_TOKEN` (the token), `TAURI_SIGNING_PRIVATE_KEY` and
     `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the key whose public half is `pubkey` in `tauri.conf.json`; it is kept, commented
     out, in your local `.env.local`). Losing that key means installed Bridges can never update again.
   - Optional, for a notarized Mac build: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
     `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
4. Release: the tag must equal `bridge-v` + the `version` in `tauri.conf.json`:
   `git tag bridge-v0.1.0 && git push origin bridge-v0.1.0`. The workflow **Spectra Bridge release** builds the signed
   installers and `latest.json` and publishes them.
5. Check `https://github.com/Thunderboltdy-10/spectra-bridge/releases/latest/download/latest.json` opens, then
   `https://<domain>/bridge/download/windows` downloads the installer.
6. Every later release: bump `version` in `tauri.conf.json` (and `version` under `[workspace.package]` in `bridge/Cargo.toml`), commit, tag, push the
   tag. Installed Bridges check within 6 hours (20 minutes after a failed check) and install when idle.

## 6. Syllabi

Course references live in `shared/syllabus/subjects/<id>.md` (copy `_template.md`). After adding or changing one:

1. `npm run syllabus:bundle` (rebuilds `shared/syllabus/bundle.generated.ts` and `catalog.generated.ts`), then
   `npm run check:syllabus` and `npx vitest run shared/syllabus`.
2. Commit, then deploy both sides: `npx convex deploy` and the Vercel deploy.
3. Bring existing classes up to date: `npx convex run workspaceSyllabus:refreshAll --prod`. A class whose name is
   ambiguous (plain "Mathematics", "English A") is left alone; the student picks its course when creating a workspace.

## 7. First hour

Sign in as the super admin, create the school, invite a teacher and a student, connect ManageBac with the school's own
key, and make one of each artifact. Then run the live verification prompts in
`docs/spectra-launch-audit/LIVE-VERIFICATION-PROMPTS.md` journey by journey, fixing as you go.

## Not in this launch

- The Bridge cloud relay (controlling a Bridge on another computer): designed in
  `docs/spectra-launch-audit/reports/R-L4-LEFTOVERS.md`, deferred by decision.
- A collaboration gateway with more than one machine.
